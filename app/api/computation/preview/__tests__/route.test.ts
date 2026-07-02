import { describe, expect, it, vi, beforeEach } from 'vitest'
import { GET } from '../route'
import { prisma } from '@/lib/prisma'
import {
  createUser,
  createTaxpayerProfile,
  createTaxYear,
  createForm2307,
  createATCCode,
  seedReferenceData,
} from '@/lib/testing/factories'

vi.mock('@/lib/auth/session', () => ({
  requireAuth: vi.fn(),
}))

import { requireAuth } from '@/lib/auth/session'

function mockAuth(userId: string) {
  vi.mocked(requireAuth).mockResolvedValue({
    sub: userId,
    username: 'test',
    role: 'TAXPAYER',
    iat: 1,
    exp: 9999999999,
  })
}

const ATC = 'WI071'

describe('/api/computation/preview', () => {
  beforeEach(async () => {
    vi.resetAllMocks()
    await seedReferenceData()
  })

  it('returns the same JSON shape regardless of elected rate', async () => {
    const user = await createUser()
    mockAuth(user.id)
    const profile = await createTaxpayerProfile(user.id, {
      incomeType: 'PURE_SELF_EMPLOYMENT',
    })
    const atc = await createATCCode({ code: ATC, description: 'Insurance', ewtRate: 0.1 })
    const taxYear = await createTaxYear(profile.id, 2026, {
      electedRate: 'RATE_8PCT',
      electionStatus: 'ELECTED_8PCT',
      electionLockedAt: new Date(),
    })

    await createForm2307(taxYear.id, atc.code, {
      quarter: 1,
      payorTin: '111-111-111-111',
      payorName: 'Payor A',
      month1Amount: '100000',
      month2Amount: '100000',
      month3Amount: '100000',
      quarterlyTotal: '300000',
      cwtWithheld: '30000',
    })
    await createForm2307(taxYear.id, atc.code, {
      quarter: 2,
      payorTin: '111-111-111-111',
      payorName: 'Payor A',
      month1Amount: '150000',
      month2Amount: '150000',
      month3Amount: '150000',
      quarterlyTotal: '450000',
      cwtWithheld: '45000',
    })

    const res8 = await GET()
    expect(res8.status).toBe(200)
    const body8 = await res8.json()

    for (const key of [
      'preview',
      'taxYear',
      'incomeType',
      'electedRate',
      'fullYearGross',
      'exemption',
      'taxableIncome',
      'taxDue',
      'priorYearCredit',
      'quarterlyPayments',
      'cwtWithheld',
      'totalCredits',
      'netTaxDue',
      'overpayment',
      'creditApplicationSequence',
    ]) {
      expect(body8).toHaveProperty(key)
    }

    // Flip to GRADUATED — shape must stay identical.
    await prisma.taxYear.update({
      where: { id: taxYear.id },
      data: { electedRate: 'GRADUATED', electionStatus: 'ELECTED_GRADUATED' },
    })

    const resG = await GET()
    expect(resG.status).toBe(200)
    const bodyG = await resG.json()

    for (const key of [
      'preview',
      'taxYear',
      'incomeType',
      'electedRate',
      'fullYearGross',
      'exemption',
      'taxableIncome',
      'taxDue',
      'priorYearCredit',
      'quarterlyPayments',
      'cwtWithheld',
      'totalCredits',
      'netTaxDue',
      'overpayment',
      'creditApplicationSequence',
    ]) {
      expect(bodyG).toHaveProperty(key)
    }

    expect(Object.keys(body8).sort()).toEqual(Object.keys(bodyG).sort())
  })

  it('uses the graduated bracket table under GRADUATED election (gross 750k -> 55,000)', async () => {
    const user = await createUser()
    mockAuth(user.id)
    const profile = await createTaxpayerProfile(user.id, {
      incomeType: 'PURE_SELF_EMPLOYMENT',
    })
    const atc = await createATCCode({ code: ATC, description: 'Insurance', ewtRate: 0.1 })
    const taxYear = await createTaxYear(profile.id, 2026, {
      electedRate: 'GRADUATED',
      electionStatus: 'ELECTED_GRADUATED',
      electionLockedAt: new Date(),
    })

    // gross 750,000 -> taxable 500,000 (in the 25% bracket post 250k exemption)
    // applyGraduatedBrackets(500,000) = 30,000 + (500k - 400k) * 0.25 = 55,000
    await createForm2307(taxYear.id, atc.code, {
      quarter: 1,
      payorTin: '111-111-111-111',
      payorName: 'Payor A',
      month1Amount: '250000',
      month2Amount: '250000',
      month3Amount: '250000',
      quarterlyTotal: '750000',
      cwtWithheld: '75000',
    })

    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.electedRate).toBe('GRADUATED')
    expect(body.taxDue.raw).toBe('55000.00')
    expect(body.taxableIncome.raw).toBe('500000.00')
    expect(body.exemption.raw).toBe('250000.00')
  })

  it('uses the 8% flat rate when elected (gross 750k -> 40,000)', async () => {
    const user = await createUser()
    mockAuth(user.id)
    const profile = await createTaxpayerProfile(user.id, {
      incomeType: 'PURE_SELF_EMPLOYMENT',
    })
    const atc = await createATCCode({ code: ATC, description: 'Insurance', ewtRate: 0.1 })
    const taxYear = await createTaxYear(profile.id, 2026, {
      electedRate: 'RATE_8PCT',
      electionStatus: 'ELECTED_8PCT',
      electionLockedAt: new Date(),
    })

    // 8% of (750,000 - 250,000) = 40,000
    await createForm2307(taxYear.id, atc.code, {
      quarter: 1,
      payorTin: '111-111-111-111',
      payorName: 'Payor A',
      month1Amount: '250000',
      month2Amount: '250000',
      month3Amount: '250000',
      quarterlyTotal: '750000',
      cwtWithheld: '75000',
    })

    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.electedRate).toBe('RATE_8PCT')
    expect(body.taxDue.raw).toBe('40000.00')
  })

  it('defaults to 8% when no election has been recorded (NOT_ELECTED)', async () => {
    const user = await createUser()
    mockAuth(user.id)
    const profile = await createTaxpayerProfile(user.id, {
      incomeType: 'PURE_SELF_EMPLOYMENT',
    })
    const atc = await createATCCode({ code: ATC, description: 'Insurance', ewtRate: 0.1 })
    const taxYear = await createTaxYear(profile.id, 2026, {
      electedRate: null,
      electionStatus: 'NOT_ELECTED',
    })

    await createForm2307(taxYear.id, atc.code, {
      quarter: 1,
      payorTin: '111-111-111-111',
      payorName: 'Payor A',
      month1Amount: '250000',
      month2Amount: '250000',
      month3Amount: '250000',
      quarterlyTotal: '750000',
      cwtWithheld: '75000',
    })

    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.electedRate).toBe('RATE_8PCT')
    expect(body.taxDue.raw).toBe('40000.00')
  })

  it('treats null 1701Q netTaxDue as zero (graduated electee before any 1701Q generated)', async () => {
    // When the user elects graduated, recascade nulls out the 1701Q net tax
    // due rows because the per-quarter computation path is not yet wired.
    // The preview should fall back to zero rather than NaN.
    const user = await createUser()
    mockAuth(user.id)
    const profile = await createTaxpayerProfile(user.id, {
      incomeType: 'PURE_SELF_EMPLOYMENT',
    })
    const atc = await createATCCode({ code: ATC, description: 'Insurance', ewtRate: 0.1 })
    const taxYear = await createTaxYear(profile.id, 2026, {
      electedRate: 'GRADUATED',
      electionStatus: 'ELECTED_GRADUATED',
      electionLockedAt: new Date(),
    })

    await prisma.taxReturn.create({
      data: {
        taxYearId: taxYear.id,
        sequenceOrder: 5,
        formType: 'FORM_1701Q',
        quarter: 1,
        statutoryDueDate: new Date('2026-05-15'),
        status: 'PENDING',
        computedTaxDue: null,
        taxCreditsTotal: null,
        netTaxDue: null,
        overpaymentAmt: null,
      },
    })

    await createForm2307(taxYear.id, atc.code, {
      quarter: 1,
      payorTin: '111-111-111-111',
      payorName: 'Payor A',
      month1Amount: '250000',
      month2Amount: '250000',
      month3Amount: '250000',
      quarterlyTotal: '750000',
      cwtWithheld: '75000',
    })

    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.electedRate).toBe('GRADUATED')
    expect(body.quarterlyPayments.raw).toBe('0.00')
    expect(body.taxDue.raw).toBe('55000.00') // gross 750k -> taxable 500k -> 55,000
  })

  // S7.6 (#117): 40% Optional Standard Deduction. The preview endpoint
  // must read taxYear.osdElection and pass it to the underlying
  // computeAnnualIncomeTaxBreakdown so the user sees the OSD-adjusted
  // tax due before filing. Reference figure: 2,000,000 gross at 40%
  // OSD = 800,000 taxable -> 30,000 + 400,000 * 0.25 = 130,000 (AGENT.md
  // OSD_HIGH).
  it('applies 40% OSD when osdElection=true and electedRate=GRADUATED', async () => {
    const user = await createUser()
    mockAuth(user.id)
    const profile = await createTaxpayerProfile(user.id, {
      incomeType: 'PURE_SELF_EMPLOYMENT',
    })
    const atc = await createATCCode({ code: ATC, description: 'Insurance', ewtRate: 0.1 })
    const taxYear = await createTaxYear(profile.id, 2026, {
      electedRate: 'GRADUATED',
      electionStatus: 'ELECTED_GRADUATED',
      electionLockedAt: new Date(),
    })

    // Persist osdElection=true on the TaxYear.
    await prisma.taxYear.update({
      where: { id: taxYear.id },
      data: { osdElection: true },
    })

    // gross 2,000,000; split across two quarters to keep amounts realistic.
    await createForm2307(taxYear.id, atc.code, {
      quarter: 1,
      payorTin: '111-111-111-111',
      payorName: 'Payor A',
      month1Amount: '500000',
      month2Amount: '500000',
      month3Amount: '500000',
      quarterlyTotal: '1500000',
      cwtWithheld: '150000',
    })
    await createForm2307(taxYear.id, atc.code, {
      quarter: 2,
      payorTin: '111-111-111-111',
      payorName: 'Payor A',
      month1Amount: '166666.67',
      month2Amount: '166666.67',
      month3Amount: '166666.66',
      quarterlyTotal: '500000',
      cwtWithheld: '50000',
    })

    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.electedRate).toBe('GRADUATED')
    expect(body.osdElection).toBe(true)
    // 2,000,000 * 0.40 = 800,000 taxable. 30,000 base + 400,000 * 0.25
    // (the 400k-800k bracket walk) = 30,000 + 100,000 = 130,000.
    expect(body.taxableIncome.raw).toBe('800000.00')
    expect(body.exemption.raw).toBe('0.00')
    expect(body.taxDue.raw).toBe('130000.00')
  })

  it('returns 401 when the request is unauthenticated (S9.3)', async () => {
    vi.mocked(requireAuth).mockResolvedValue(null)
    const res = await GET()
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toEqual({ error: 'Unauthorized' })
  })
})
