import { describe, expect, it, vi, beforeEach } from 'vitest'
import { GET, POST } from './route'
import { prisma } from '@/lib/prisma'
import { createUser, createTaxpayerProfile, createTaxYear } from '@/lib/testing/factories'
import { initializeTaxYear } from '@/lib/tax-year'

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

function jsonRequest(body: unknown) {
  return new Request('http://localhost/api/election', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('/api/election', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns 401 when the request is unauthenticated (S9.3)', async () => {
    vi.mocked(requireAuth).mockResolvedValue(null)
    const res = await POST(jsonRequest({ electedRate: 'RATE_8PCT', disclosuresAcknowledged: true }))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toEqual({ error: 'Unauthorized' })
  })

  it('records Form 1905 as the election method and resolves the path from COR flag', async () => {
    const user = await createUser()
    mockAuth(user.id)

    const profile = await createTaxpayerProfile(user.id, {
      corIncludes2551Q: true,
    })
    const taxYear = await createTaxYear(profile.id, 2026, {})
    await initializeTaxYear(profile.id, 2026, true, [], prisma)

    const res = await POST(
      jsonRequest({
        electedRate: 'RATE_8PCT',
        electionPath: 'FORM_1905',
        disclosuresAcknowledged: true,
      })
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.electionPath).toBe('ITEM_13_2551Q_Q1')
    expect(body.electionMethod).toBe('FORM_1905')
    expect(body.electedRate).toBe('RATE_8PCT')
    expect(body.electionLockedAt).toBeTruthy()

    const updated = await prisma.taxYear.findUnique({ where: { id: taxYear.id } })
    expect(updated?.electionPath).toBe('ITEM_13_2551Q_Q1')
    expect(updated?.electionMethod).toBe('FORM_1905')
    expect(updated?.electionStatus).toBe('ELECTED_8PCT')

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: 'TaxYear', entityId: taxYear.id },
      orderBy: { createdAt: 'desc' },
    })
    // S6.4 follow-up (#116): the audit action is now rate-agnostic. The
    // rate itself lives in metadata.electedRate so the audit log viewer
    // can still group and filter by rate.
    // S7.6 (#117): osdElection is recorded in metadata too.
    expect(audit?.action).toBe('ELECTION_CONFIRMED')
    expect((audit?.metadata as { electedRate?: string }).electedRate).toBe('RATE_8PCT')
    expect((audit?.metadata as { osdElection?: boolean }).osdElection).toBe(false)
    expect((audit?.metadata as { electionPath?: string }).electionPath).toBe('ITEM_13_2551Q_Q1')
    expect((audit?.metadata as { electionMethod?: string }).electionMethod).toBe('FORM_1905')
  })

  it('defaults to the COR-based path when no electionPath is provided', async () => {
    const user = await createUser()
    mockAuth(user.id)

    const profile = await createTaxpayerProfile(user.id, {
      corIncludes2551Q: false,
    })
    const taxYear = await createTaxYear(profile.id, 2026, {})
    await initializeTaxYear(profile.id, 2026, false, [], prisma)

    const res = await POST(
      jsonRequest({
        electedRate: 'RATE_8PCT',
        disclosuresAcknowledged: true,
      })
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.electionPath).toBe('ITEM_16_1701Q_Q1')
    expect(body.electionMethod).toBe('ITEM_16_1701Q_Q1')

    const updated = await prisma.taxYear.findUnique({ where: { id: taxYear.id } })
    expect(updated?.electionPath).toBe('ITEM_16_1701Q_Q1')
    expect(updated?.electionMethod).toBe('ITEM_16_1701Q_Q1')
  })

  it('resolves Form 1905 to Item 16 when COR does not include 2551Q', async () => {
    const user = await createUser()
    mockAuth(user.id)

    const profile = await createTaxpayerProfile(user.id, {
      corIncludes2551Q: false,
    })
    const taxYear = await createTaxYear(profile.id, 2026, {})
    await initializeTaxYear(profile.id, 2026, false, [], prisma)

    const res = await POST(
      jsonRequest({
        electedRate: 'RATE_8PCT',
        electionPath: 'FORM_1905',
        disclosuresAcknowledged: true,
      })
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.electionPath).toBe('ITEM_16_1701Q_Q1')
    expect(body.electionMethod).toBe('FORM_1905')

    const updated = await prisma.taxYear.findUnique({ where: { id: taxYear.id } })
    expect(updated?.electionPath).toBe('ITEM_16_1701Q_Q1')
    expect(updated?.electionMethod).toBe('FORM_1905')
  })

  it('returns the stored election path and method from GET', async () => {
    const user = await createUser()
    mockAuth(user.id)

    const profile = await createTaxpayerProfile(user.id, {
      corIncludes2551Q: true,
    })
    await createTaxYear(profile.id, 2026, {
      electionStatus: 'ELECTED_8PCT',
      electedRate: 'RATE_8PCT',
      electionPath: 'ITEM_13_2551Q_Q1',
      electionMethod: 'FORM_1905',
      electionLockedAt: new Date(),
    })
    await initializeTaxYear(profile.id, 2026, true, [], prisma)

    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.electionPath).toBe('ITEM_13_2551Q_Q1')
    expect(body.electionMethod).toBe('FORM_1905')
    expect(body.electionLockedAt).toBeTruthy()
  })

  it('sets ELECTED_GRADUATED state when the user elects the graduated rate', async () => {
    // Acceptance criterion for S6.4: the election API must accept
    // `electedRate: 'GRADUATED'` and persist the matching ElectionStatus.
    // The graduated path is the BIR default and does not require the
    // 8% disclosures to be acknowledged (line 141 of route.ts only blocks
    // disclosures for the 8% path).
    const user = await createUser()
    mockAuth(user.id)

    const profile = await createTaxpayerProfile(user.id, {
      corIncludes2551Q: true,
    })
    const taxYear = await createTaxYear(profile.id, 2026, {})
    await initializeTaxYear(profile.id, 2026, true, [], prisma)

    const res = await POST(
      jsonRequest({
        electedRate: 'GRADUATED',
        disclosuresAcknowledged: true,
      })
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.electedRate).toBe('GRADUATED')
    expect(body.electionStatus).toBe('ELECTED_GRADUATED')
    expect(body.electionPath).toBe('ITEM_13_2551Q_Q1')
    expect(body.electionLockedAt).toBeTruthy()
    expect(body.osdElection).toBe(false)

    const updated = await prisma.taxYear.findUnique({ where: { id: taxYear.id } })
    expect(updated?.electedRate).toBe('GRADUATED')
    expect(updated?.electionStatus).toBe('ELECTED_GRADUATED')
    expect(updated?.electionLockedAt).toBeTruthy()
    expect(updated?.osdElection).toBe(false)
  })

  // S7.6 (#117): the election API must accept `osdElection: true` and
  // round-trip it through GET and the response body. OSD replaces the
  // 250k exemption with a flat 40% deduction (NIRC Sec 24(A)(2)) and is
  // valid only under the graduated rate.
  it('persists osdElection=true on the graduated path (S7.6)', async () => {
    const user = await createUser()
    mockAuth(user.id)

    const profile = await createTaxpayerProfile(user.id, {
      corIncludes2551Q: true,
    })
    const taxYear = await createTaxYear(profile.id, 2026, {})
    await initializeTaxYear(profile.id, 2026, true, [], prisma)

    const res = await POST(
      jsonRequest({
        electedRate: 'GRADUATED',
        disclosuresAcknowledged: true,
        osdElection: true,
      })
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.osdElection).toBe(true)
    expect(body.electedRate).toBe('GRADUATED')

    const updated = await prisma.taxYear.findUnique({ where: { id: taxYear.id } })
    expect(updated?.osdElection).toBe(true)
    expect(updated?.electedRate).toBe('GRADUATED')

    // Round-trip through GET.
    const getRes = await GET()
    const getBody = await getRes.json()
    expect(getBody.osdElection).toBe(true)
  })

  // S7.6 (#117): OSD is mutually exclusive with the 8% flat rate
  // (NIRC Sec 24(A)(2)). The API must reject the combination with
  // 400 and a clear message. The underlying computeAnnualIncomeTax
  // function throws on this combination; the route catches the
  // Zod-level guard before that.
  it('rejects osdElection=true combined with electedRate=RATE_8PCT (S7.6)', async () => {
    const user = await createUser()
    mockAuth(user.id)

    const profile = await createTaxpayerProfile(user.id, {
      corIncludes2551Q: true,
    })
    await createTaxYear(profile.id, 2026, {})
    await initializeTaxYear(profile.id, 2026, true, [], prisma)

    const res = await POST(
      jsonRequest({
        electedRate: 'RATE_8PCT',
        disclosuresAcknowledged: true,
        osdElection: true,
      })
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    // The Zod superRefine surfaces a structured error with the
    // NIRC Sec 24(A)(2) message in the osdElection field.
    const formatted = body.error?.osdElection?._errors?.[0] ?? body.error?.osdElection?.[0]
    expect(typeof formatted).toBe('string')
    expect(formatted).toMatch(/OSD/)
    expect(formatted).toMatch(/24\(A\)\(2\)/)
  })
})
