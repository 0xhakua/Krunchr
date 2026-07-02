import { describe, expect, it } from 'vitest'
import { recascadeTaxYear } from '../recascade'
import { determineReturnStatus, getReturnBlockReason } from '../sequence'
import { prisma } from '../../testing/db'
import {
  createForm2307,
  createTaxpayerWithYear,
  createATCCode,
  createRDOPenaltySchedule,
  seedReferenceData,
} from '../../testing/factories'

describe('recascadeTaxYear integration', () => {
  it('recomputes 8% path returns for Q1 and Q2 income', async () => {
    await seedReferenceData()
    const { profile, taxYear } = await createTaxpayerWithYear({
      year: 2026,
      incomeType: 'PURE_SELF_EMPLOYMENT',
      corIncludes2551Q: true,
      electedRate: 'RATE_8PCT',
    })

    const atc = await createATCCode({ code: 'WI100' })
    await createRDOPenaltySchedule({ rdoCode: profile.rdoCode, compromiseFee: 500 })

    await createForm2307(taxYear.id, atc.code, {
      quarter: 1,
      quarterlyTotal: 400000,
      cwtWithheld: 5000,
    })
    await createForm2307(taxYear.id, atc.code, {
      quarter: 2,
      quarterlyTotal: 200000,
      cwtWithheld: 3000,
    })

    const returnsBefore = await prisma.taxReturn.findMany({
      where: { taxYearId: taxYear.id },
      orderBy: { sequenceOrder: 'asc' },
    })
    expect(returnsBefore).toHaveLength(8)

    await recascadeTaxYear({ taxYearId: taxYear.id })

    const returns = await prisma.taxReturn.findMany({
      where: { taxYearId: taxYear.id },
      include: { penalties: true },
      orderBy: { sequenceOrder: 'asc' },
    })

    const q1_2551q = returns.find((r) => r.formType === 'FORM_2551Q' && r.quarter === 1)
    expect(q1_2551q?.computedTaxDue?.toString()).toBe('0')
    expect(q1_2551q?.netTaxDue?.toString()).toBe('0')

    const q1_1701q = returns.find((r) => r.formType === 'FORM_1701Q' && r.quarter === 1)
    expect(q1_1701q?.computedTaxDue?.toString()).toBe('12000')
    expect(q1_1701q?.taxCreditsTotal?.toString()).toBe('5000')
    expect(q1_1701q?.netTaxDue?.toString()).toBe('7000')
    expect(q1_1701q?.overpaymentAmt?.toString()).toBe('0')

    const q2_1701q = returns.find((r) => r.formType === 'FORM_1701Q' && r.quarter === 2)
    expect(q2_1701q?.computedTaxDue?.toString()).toBe('16000')
    expect(q2_1701q?.taxCreditsTotal?.toString()).toBe('8000')
    expect(q2_1701q?.netTaxDue?.toString()).toBe('8000')
    expect(q2_1701q?.overpaymentAmt?.toString()).toBe('0')

    const annual = returns.find((r) => r.formType === 'FORM_1701A')
    expect(annual?.computedTaxDue?.toString()).toBe('28000')
    expect(annual?.taxCreditsTotal?.toString()).toBe('23000')
    expect(annual?.netTaxDue?.toString()).toBe('5000')
    expect(annual?.overpaymentAmt?.toString()).toBe('0')

    // Penalties should have been computed for non-filed returns
    const penalizedReturns = returns.filter((r) => r.status !== 'FILED' && r.penalties)
    expect(penalizedReturns.length).toBeGreaterThan(0)
  })

  it('populates 1701Q/1701A values under the graduated rate (S7.5)', async () => {
    // S7.5 (#115): the recascade used to null out 1701Q and 1701A values
    // when electedRate === 'GRADUATED' because the graduated computation
    // was not yet implemented. After S6 the graduated path is implemented
    // in quarterly-income.ts and annual-income.ts; the recascade now
    // passes the elected rate through and populates the rows correctly.
    await seedReferenceData()
    const { profile, taxYear } = await createTaxpayerWithYear({
      year: 2026,
      electedRate: 'GRADUATED',
      electionStatus: 'ELECTED_GRADUATED',
    })

    const atc = await createATCCode({ code: 'WI100' })
    await createRDOPenaltySchedule({ rdoCode: profile.rdoCode, compromiseFee: 500 })
    // 100000 cumulative gross, no 250k exemption reduction. Under the
    // graduated schedule the 100k sits in the 0% bracket (250k @ 0%),
    // so the tax due is 0. We assert the recascade writes 0 (not null)
    // so the dashboard and the filing flow can read the values.
    await createForm2307(taxYear.id, atc.code, {
      quarter: 1,
      quarterlyTotal: 100000,
      cwtWithheld: 10000,
    })

    await recascadeTaxYear({ taxYearId: taxYear.id })

    const returns = await prisma.taxReturn.findMany({
      where: { taxYearId: taxYear.id },
      include: { penalties: true },
    })

    const q1_2551q = returns.find((r) => r.formType === 'FORM_2551Q' && r.quarter === 1)
    // 2551Q is computed under the elected rate. Under 8% the percentage
    // tax is 0 (BR-04), but under graduated the percentage tax is 3% of
    // gross receipts, so this should be 3000.
    expect(q1_2551q?.computedTaxDue?.toString()).toBe('3000')

    const q1_1701q = returns.find((r) => r.formType === 'FORM_1701Q' && r.quarter === 1)
    // 100000 sits in the 250k @ 0% bracket, so tax due is 0. CWT
    // exceeds tax due so the CWT is recorded as overpayment.
    expect(q1_1701q?.computedTaxDue?.toString()).toBe('0')
    expect(q1_1701q?.netTaxDue?.toString()).toBe('0')
    expect(q1_1701q?.overpaymentAmt?.toString()).toBe('10000')

    const annual = returns.find((r) => r.formType === 'FORM_1701A')
    // Same graduated schedule: 100000 is still in the 0% bracket, so
    // the annual tax due is 0 and the CWT is overpayment.
    expect(annual?.computedTaxDue?.toString()).toBe('0')
    expect(annual?.netTaxDue?.toString()).toBe('0')
    expect(annual?.overpaymentAmt?.toString()).toBe('10000')

    // Penalties computed against zero tax due still include compromise fee
    expect(q1_1701q?.penalties?.totalPenalty.toString()).toBe('500')
  })

  it('applies mixed-income rules with no 250k exemption', async () => {
    await seedReferenceData()
    const { profile, taxYear } = await createTaxpayerWithYear({
      year: 2026,
      incomeType: 'MIXED_INCOME',
      electedRate: 'RATE_8PCT',
    })

    const atc = await createATCCode({ code: 'WI100' })
    await createRDOPenaltySchedule({ rdoCode: profile.rdoCode, compromiseFee: 500 })
    await createForm2307(taxYear.id, atc.code, {
      quarter: 1,
      quarterlyTotal: 200000,
      cwtWithheld: 5000,
    })

    await recascadeTaxYear({ taxYearId: taxYear.id })

    const q1_1701q = await prisma.taxReturn.findFirst({
      where: { taxYearId: taxYear.id, formType: 'FORM_1701Q', quarter: 1 },
    })

    // 200000 * 8% = 16000; minus 5000 CWT = 11000
    expect(q1_1701q?.computedTaxDue?.toString()).toBe('16000')
    expect(q1_1701q?.netTaxDue?.toString()).toBe('11000')
  })

  it('routes mixed-income annual slot to FORM_1701 (not FORM_1701A) under 8%', async () => {
    // BR-13 + BR-08: mixed-income earners file Form 1701, not 1701A.
    // This test exercises the end-to-end flow: a MIXED_INCOME taxpayer has
    // a FORM_1701 slot in their tax year (verified separately in
    // lib/__tests__/tax-year.test.ts), and the recascade must write the
    // annual computation to that FORM_1701 row — not to a (non-existent)
    // FORM_1701A row.
    await seedReferenceData()
    const { profile, taxYear } = await createTaxpayerWithYear({
      year: 2026,
      incomeType: 'MIXED_INCOME',
      corIncludes2551Q: true,
      electedRate: 'RATE_8PCT',
    })

    const atc = await createATCCode({ code: 'WI100' })
    await createRDOPenaltySchedule({ rdoCode: profile.rdoCode, compromiseFee: 500 })
    await createForm2307(taxYear.id, atc.code, {
      quarter: 1,
      quarterlyTotal: 200000,
      cwtWithheld: 5000,
    })

    // Sanity-check the slot: there is exactly one FORM_1701 row and zero
    // FORM_1701A rows. BR-13 enforces the form-type choice; this guards
    // against a future refactor that reintroduces a 1701A slot for mixed-income
    // earners.
    const annualSlots = await prisma.taxReturn.findMany({
      where: { taxYearId: taxYear.id, quarter: null },
    })
    expect(annualSlots).toHaveLength(1)
    expect(annualSlots[0].formType).toBe('FORM_1701')

    await recascadeTaxYear({ taxYearId: taxYear.id })

    const form1701 = await prisma.taxReturn.findFirst({
      where: { taxYearId: taxYear.id, formType: 'FORM_1701' },
    })
    const form1701a = await prisma.taxReturn.findFirst({
      where: { taxYearId: taxYear.id, formType: 'FORM_1701A' },
    })

    // No 1701A row exists for a mixed-income taxpayer.
    expect(form1701a).toBeNull()

    // The recascade wrote the annual computation to the FORM_1701 row.
    // 200000 * 8% = 16000 (no 250k exemption under MIXED_INCOME).
    // Credits applied in BIR order: prior year 0 + Q1 1701Q payment 11000 +
    // CWT 5000 = 16000. Net position is 0 (not 11000 — the Q1 cash payment
    // is consumed by the annual credit cascade).
    expect(form1701).not.toBeNull()
    expect(form1701?.computedTaxDue?.toString()).toBe('16000')
    expect(form1701?.taxCreditsTotal?.toString()).toBe('16000')
    expect(form1701?.netTaxDue?.toString()).toBe('0')
    expect(form1701?.overpaymentAmt?.toString()).toBe('0')
  })

  it('populates 1701Q values under GRADUATED at 600k cumulative gross (S7.5)', async () => {
    // Reference figure from AGENT.md (GRADUATED_CUMULATIVE_MID):
    // 600,000 cumulative gross → 20,000 cumulative tax due under the
    // TRAIN graduated brackets. The 250k @ 0% bracket absorbs the first
    // 250k of taxable income; the next 100k (250k-350k) falls in the
    // 20% bracket = 20,000. (350k sits inside the 250k-400k band; the
    // 25% bracket with a 30k base does not enter until 400k.)
    await seedReferenceData()
    const { profile, taxYear } = await createTaxpayerWithYear({
      year: 2026,
      electedRate: 'GRADUATED',
      electionStatus: 'ELECTED_GRADUATED',
    })

    const atc = await createATCCode({ code: 'WI100' })
    await createRDOPenaltySchedule({ rdoCode: profile.rdoCode, compromiseFee: 500 })
    await createForm2307(taxYear.id, atc.code, {
      quarter: 1,
      quarterlyTotal: 600000,
      cwtWithheld: 5000,
    })

    await recascadeTaxYear({ taxYearId: taxYear.id })

    const q1_1701q = await prisma.taxReturn.findFirst({
      where: { taxYearId: taxYear.id, formType: 'FORM_1701Q', quarter: 1 },
    })
    const annual = await prisma.taxReturn.findFirst({
      where: { taxYearId: taxYear.id, formType: 'FORM_1701A' },
    })

    // Q1 cumulative tax due under the graduated bracket walk.
    expect(q1_1701q?.computedTaxDue?.toString()).toBe('20000')
    expect(q1_1701q?.taxCreditsTotal?.toString()).toBe('5000')
    expect(q1_1701q?.netTaxDue?.toString()).toBe('15000')
    expect(q1_1701q?.overpaymentAmt?.toString()).toBe('0')

    // Annual slot has the same 600k of income (only one quarter reported
    // so far); the tax due is the same as the Q1 cumulative figure, and
    // credits consume the entire tax due (Q1 cash 15000 + CWT 5000).
    expect(annual?.computedTaxDue?.toString()).toBe('20000')
    expect(annual?.netTaxDue?.toString()).toBe('0')
  })

  it('marks Form 1701A as BLOCKED with reason when VAT threshold is breached (BR-12)', async () => {
    await seedReferenceData()
    const { profile, taxYear } = await createTaxpayerWithYear({
      year: 2026,
      incomeType: 'PURE_SELF_EMPLOYMENT',
      corIncludes2551Q: true,
      electedRate: 'RATE_8PCT',
    })

    const atc = await createATCCode({ code: 'WI100' })
    await createRDOPenaltySchedule({ rdoCode: profile.rdoCode, compromiseFee: 500 })

    // A single quarter at the threshold triggers the VAT breach flag.
    await createForm2307(taxYear.id, atc.code, {
      quarter: 1,
      quarterlyTotal: 3_000_000,
      cwtWithheld: 300_000,
    })

    // Simulate the flag set by income ingestion (BR-12).
    await prisma.taxYear.update({
      where: { id: taxYear.id },
      data: { vatBreached: true, vatBreachDate: new Date() },
    })

    await recascadeTaxYear({ taxYearId: taxYear.id })

    const returns = await prisma.taxReturn.findMany({
      where: { taxYearId: taxYear.id },
      orderBy: { sequenceOrder: 'asc' },
    })

    const annual = returns.find((r) => r.formType === 'FORM_1701A')
    expect(annual).toBeDefined()

    // The recascade must persist the blocked status for the annual 1701A.
    expect(annual?.status).toBe('BLOCKED')

    // The sequence resolver must also report the annual return as blocked.
    const dynamicStatus = determineReturnStatus(
      annual!.sequenceOrder,
      returns,
      profile.corIncludes2551Q,
      true
    )
    expect(dynamicStatus).toBe('BLOCKED')

    // The block reason must explain the VAT-registration requirement.
    const reason = getReturnBlockReason(annual!, true)
    expect(reason).toContain('VAT threshold breached')
    expect(reason).toContain('register for VAT')
  })
})
