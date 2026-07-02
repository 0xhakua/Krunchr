import Decimal from 'decimal.js'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '../prisma'
import { computeAnnualIncomeTax, computeQuarterlyIncomeTax } from './income-tax'
import { computePercentageTax } from './percentage-tax'
import { computePenalties, computeDaysLate } from './penalties'
import type { IncomeTypeValue, TaxRateValue } from './constants'
import {
  aggregateByQuarter,
  sumUpToQuarter,
  sumCwtUpToQuarter,
  sumFullYear,
  sumFullYearCwt,
} from './aggregate'

type TransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>

interface RecascadeInput {
  taxYearId: string
  tx?: TransactionClient
}

/**
 * Recompute all return values for a tax year whenever income changes.
 *
 * Affected returns:
 * - 2551Q Q1–Q4: percentage tax recomputed per quarter
 * - 1701Q Q1–Q3: cumulative income tax recomputed
 * - 1701A Annual: full-year income tax recomputed
 *
 * Penalties are also recalculated for any return not yet filed.
 */
export async function recascadeTaxYear({ taxYearId, tx }: RecascadeInput): Promise<void> {
  const db = tx ?? prisma

  const taxYear = await db.taxYear.findUnique({
    where: { id: taxYearId },
    include: {
      taxpayer: true,
      certificates: true,
      returns: {
        include: {
          penalties: true,
        },
      },
      priorYearCredit: true,
    },
  })

  if (!taxYear) throw new Error(`Tax year not found: ${taxYearId}`)

  const incomeType: IncomeTypeValue = taxYear.taxpayer.incomeType
  // taxYear.electedRate is TaxRate | null (Prisma enum). The compute
  // functions take TaxRateValue, which is the same two-element string
  // union. Default to RATE_8PCT when no election has been recorded so
  // the recascade produces a value (the BIR default) rather than
  // throwing on null. See #115 / #122.
  const electedRate: TaxRateValue = taxYear.electedRate ?? 'RATE_8PCT'

  // Aggregate certificates by quarter
  const quarterly = aggregateByQuarter(taxYear.certificates)

  // Recompute 2551Q returns
  for (const ret of taxYear.returns.filter((r) => r.formType === 'FORM_2551Q')) {
    const q = ret.quarter ?? 0
    const gross = quarterly[q]?.gross ?? new Decimal('0')
    const taxDue = computePercentageTax(gross, electedRate)

    await db.taxReturn.update({
      where: { id: ret.id },
      data: {
        computedTaxDue: taxDue,
        taxCreditsTotal: new Decimal('0'),
        netTaxDue: taxDue,
        overpaymentAmt: new Decimal('0'),
      },
    })

    await recomputePenalty(ret.id, taxDue, taxYear.taxpayer.rdoCode, db)
  }

  // Recompute 1701Q returns (cumulative).
  // The elected rate is passed through to the underlying computation, so
  // both the 8% flat-rate and the TRAIN graduated-rate paths are now
  // populated. Pre-S7.5 this branch nulled out 1701Q values when the
  // taxpayer had elected GRADUATED; that is no longer correct because
  // the graduated computation is implemented in quarterly-income.ts.
  const quarterKeys = [1, 2, 3] as const
  let priorQuartersTaxPaid = new Decimal('0')
  let quarterlyPaymentsCash = new Decimal('0')

  for (const q of quarterKeys) {
    const ret = taxYear.returns.find((r) => r.formType === 'FORM_1701Q' && r.quarter === q)
    if (!ret) continue

    const cumulativeGross = sumUpToQuarter(quarterly, q)
    const taxDue = computeQuarterlyIncomeTax(
      cumulativeGross,
      priorQuartersTaxPaid,
      incomeType,
      electedRate
    )

    const cumulativeCwt = sumCwtUpToQuarter(quarterly, q)
    const netTaxDue = Decimal.max(taxDue.minus(cumulativeCwt), 0)
    const overpayment = Decimal.max(cumulativeCwt.minus(taxDue), 0)

    await db.taxReturn.update({
      where: { id: ret.id },
      data: {
        computedTaxDue: taxDue,
        taxCreditsTotal: cumulativeCwt,
        netTaxDue,
        overpaymentAmt: overpayment,
      },
    })

    await recomputePenalty(ret.id, netTaxDue, taxYear.taxpayer.rdoCode, db)

    // For the next quarter's cumulative computation, add the full tax due
    // (whether paid by cash or CWT). For the annual return, only cash paid
    // counts as a quarterly payment credit.
    priorQuartersTaxPaid = priorQuartersTaxPaid.plus(taxDue)
    quarterlyPaymentsCash = quarterlyPaymentsCash.plus(netTaxDue)
  }

  // Recompute 1701A / 1701 annual return. The elected rate is passed
  // through to computeAnnualIncomeTax; graduated mixed-income earners
  // get the TRAIN bracket walk, 8% electees get 8% of gross, and
  // 1701A vs 1701 selection is already made at slot creation time
  // (see lib/tax-year.ts).
  const annualReturn = taxYear.returns.find(
    (r) => r.formType === 'FORM_1701A' || r.formType === 'FORM_1701'
  )
  if (annualReturn) {
    const fullYearGross = sumFullYear(quarterly)
    const cwtWithheld = sumFullYearCwt(quarterly)
    const priorYearCredit = taxYear.priorYearCredit?.amount ?? new Decimal('0')

    const { taxDue, totalCredits, netPosition } = computeAnnualIncomeTax(
      fullYearGross,
      priorYearCredit,
      quarterlyPaymentsCash,
      cwtWithheld,
      incomeType,
      electedRate
    )

    await db.taxReturn.update({
      where: { id: annualReturn.id },
      data: {
        computedTaxDue: taxDue,
        taxCreditsTotal: totalCredits,
        netTaxDue: Decimal.max(netPosition, 0),
        overpaymentAmt: Decimal.max(netPosition.negated(), 0),
        // BR-12: once the VAT threshold is breached, Form 1701A is out of
        // scope for a non-VAT taxpayer. Mark it blocked unless already filed.
        status:
          taxYear.vatBreached &&
          annualReturn.formType === 'FORM_1701A' &&
          annualReturn.status !== 'FILED'
            ? 'BLOCKED'
            : undefined,
      },
    })

    await recomputePenalty(annualReturn.id, Decimal.max(netPosition, 0), taxYear.taxpayer.rdoCode, db)
  }
}

async function recomputePenalty(
  returnId: string,
  taxDue: Decimal,
  rdoCode: string,
  tx: TransactionClient = prisma
) {
  const ret = await tx.taxReturn.findUnique({
    where: { id: returnId },
    include: { penalties: true },
  })
  if (!ret || ret.status === 'FILED') return

  const schedule = await tx.rDOPenaltySchedule.findUnique({
    where: { rdoCode },
  })
  const compromiseFee = schedule?.compromiseFee ?? new Decimal('0')

  const now = new Date()
  const daysLate = computeDaysLate(ret.statutoryDueDate, now)
  const penalty = computePenalties({ taxDue, daysLate, compromiseFee })

  await tx.returnPenalty.upsert({
    where: { returnId: ret.id },
    update: {
      daysLate: penalty.daysLate,
      surcharge: penalty.surcharge,
      interest: penalty.interest,
      compromisePenalty: penalty.compromisePenalty,
      totalPenalty: penalty.totalPenalty,
      computedAt: new Date(),
    },
    create: {
      returnId: ret.id,
      daysLate: penalty.daysLate,
      surcharge: penalty.surcharge,
      interest: penalty.interest,
      compromisePenalty: penalty.compromisePenalty,
      totalPenalty: penalty.totalPenalty,
    },
  })
}
