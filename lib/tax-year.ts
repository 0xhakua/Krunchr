import type { PrismaClient } from '@prisma/client'
import { prisma } from './prisma'
import { getDueDatesForYear } from './computation/due-dates'
import type { FormTypeValue, IncomeTypeValue } from './computation/constants'

type TransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>

export type ReturnSlot = {
  formType: FormTypeValue
  quarter: number | null
  sequenceOrder: number
}

/**
 * The legally-mandated return slots for a tax year, in filing order.
 * Shared by initializeTaxYear (onboarding) and reconcileTaxYearReturns
 * (profile edit, #241) so the two can never drift apart.
 */
export function buildReturnSlots(
  corIncludes2551Q: boolean,
  incomeType: IncomeTypeValue
): ReturnSlot[] {
  const annualForm: FormTypeValue = incomeType === 'MIXED_INCOME' ? 'FORM_1701' : 'FORM_1701A'
  return corIncludes2551Q
    ? [
        { formType: 'FORM_2551Q' as const, quarter: 1, sequenceOrder: 1 },
        { formType: 'FORM_2551Q' as const, quarter: 2, sequenceOrder: 2 },
        { formType: 'FORM_2551Q' as const, quarter: 3, sequenceOrder: 3 },
        { formType: 'FORM_2551Q' as const, quarter: 4, sequenceOrder: 4 },
        { formType: 'FORM_1701Q' as const, quarter: 1, sequenceOrder: 5 },
        { formType: 'FORM_1701Q' as const, quarter: 2, sequenceOrder: 6 },
        { formType: 'FORM_1701Q' as const, quarter: 3, sequenceOrder: 7 },
        { formType: annualForm, quarter: null, sequenceOrder: 8 },
      ]
    : [
        { formType: 'FORM_1701Q' as const, quarter: 1, sequenceOrder: 1 },
        { formType: 'FORM_1701Q' as const, quarter: 2, sequenceOrder: 2 },
        { formType: 'FORM_1701Q' as const, quarter: 3, sequenceOrder: 3 },
        { formType: annualForm, quarter: null, sequenceOrder: 4 },
      ]
}

/**
 * Initialize a TaxYear and its mandatory TaxReturn slots for a taxpayer.
 *
 * - 8 returns if COR includes 2551Q (4 × 2551Q + 3 × 1701Q + annual)
 * - 4 returns if COR does not include 2551Q (3 × 1701Q + annual)
 * - Mixed-income earners use Form 1701 as the annual return; all others use 1701A.
 */
export async function initializeTaxYear(
  taxpayerId: string,
  year: number,
  corIncludes2551Q: boolean,
  holidays: Date[] = [],
  tx: TransactionClient = prisma,
  isNewRegistrant: boolean = false,
  incomeType: IncomeTypeValue = 'PURE_SELF_EMPLOYMENT'
) {
  const taxYear = await tx.taxYear.upsert({
    where: {
      taxpayerId_year: {
        taxpayerId,
        year,
      },
    },
    update: {},
    create: {
      taxpayerId,
      year,
      // BR-18: taxpayers who elected 8% on Form 1901 at initial BIR
      // registration are pre-confirmed; no Item 13 / Item 16 election needed.
      ...(isNewRegistrant && {
        electionStatus: 'ELECTED_8PCT',
        electedRate: 'RATE_8PCT',
        electionDate: new Date(),
        electionLockedAt: new Date(),
      }),
    },
  })

  const dueDates = getDueDatesForYear(year, corIncludes2551Q, holidays, incomeType)
  const returns = buildReturnSlots(corIncludes2551Q, incomeType)

  for (const r of returns) {
    const dueDateEntry = dueDates.find(
      (d) => d.formType === r.formType && d.quarter === r.quarter
    )
    if (!dueDateEntry) continue

    const existing = await tx.taxReturn.findFirst({
      where: {
        taxYearId: taxYear.id,
        formType: r.formType,
        quarter: r.quarter,
      },
    })

    if (existing) {
      await tx.taxReturn.update({
        where: { id: existing.id },
        data: {
          sequenceOrder: r.sequenceOrder,
          statutoryDueDate: dueDateEntry.adjustedDueDate,
        },
      })
    } else {
      await tx.taxReturn.create({
        data: {
          taxYearId: taxYear.id,
          formType: r.formType,
          quarter: r.quarter,
          sequenceOrder: r.sequenceOrder,
          statutoryDueDate: dueDateEntry.adjustedDueDate,
        },
      })
    }
  }

  return taxYear
}

/**
 * Reconcile an existing tax year's return slots after the taxpayer changes
 * `corIncludes2551Q` or `incomeType` (#241).
 *
 * - Slots that no longer belong (2551Q quarters on the 4-return path, or the
 *   old annual form after a 1701A↔1701 switch) are deleted, penalties first
 *   (ReturnPenalty has no ON DELETE cascade).
 * - Kept slots are resequenced and their statutory due dates refreshed.
 * - Missing slots are created as BLOCKED; PENDING is derived at read time by
 *   determineReturnStatus().
 *
 * Guardrail: throws if any return in the tax year is GENERATED or FILED.
 * Callers (the PUT /api/taxpayer route) check this first to return a clean
 * 409 — the throw here is defense in depth. The caller is also responsible
 * for running recascadeTaxYear() afterwards to repopulate computed values.
 */
export async function reconcileTaxYearReturns(
  taxYearId: string,
  corIncludes2551Q: boolean,
  incomeType: IncomeTypeValue,
  holidays: Date[] = [],
  tx: TransactionClient = prisma
): Promise<void> {
  const taxYear = await tx.taxYear.findUnique({
    where: { id: taxYearId },
    include: { returns: true },
  })
  if (!taxYear) throw new Error(`Tax year not found: ${taxYearId}`)

  const hasLockedReturn = taxYear.returns.some(
    (r) => r.status === 'GENERATED' || r.status === 'FILED'
  )
  if (hasLockedReturn) {
    throw new Error(
      'Cannot restructure return slots once a return has been generated or filed'
    )
  }

  const targets = buildReturnSlots(corIncludes2551Q, incomeType)
  const dueDates = getDueDatesForYear(taxYear.year, corIncludes2551Q, holidays, incomeType)

  const slotKey = (formType: FormTypeValue, quarter: number | null) =>
    `${formType}:${quarter ?? 'annual'}`
  const targetKeys = new Set(targets.map((t) => slotKey(t.formType, t.quarter)))

  // Remove slots that are not part of the target structure.
  const stale = taxYear.returns.filter((r) => !targetKeys.has(slotKey(r.formType, r.quarter)))
  for (const ret of stale) {
    await tx.returnPenalty.deleteMany({ where: { returnId: ret.id } })
    await tx.taxReturn.delete({ where: { id: ret.id } })
  }

  // Upsert target slots: resequence + refresh due dates on kept rows, create
  // missing ones.
  for (const t of targets) {
    const dueDateEntry = dueDates.find(
      (d) => d.formType === t.formType && d.quarter === t.quarter
    )
    if (!dueDateEntry) continue

    const existing = taxYear.returns.find(
      (r) => r.formType === t.formType && r.quarter === t.quarter
    )
    if (existing) {
      await tx.taxReturn.update({
        where: { id: existing.id },
        data: {
          sequenceOrder: t.sequenceOrder,
          statutoryDueDate: dueDateEntry.adjustedDueDate,
        },
      })
    } else {
      await tx.taxReturn.create({
        data: {
          taxYearId: taxYear.id,
          formType: t.formType,
          quarter: t.quarter,
          sequenceOrder: t.sequenceOrder,
          statutoryDueDate: dueDateEntry.adjustedDueDate,
        },
      })
    }
  }
}
