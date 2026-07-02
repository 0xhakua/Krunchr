import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '../route'
import { prisma } from '@/lib/testing/db'
import { createUser, seedReferenceData } from '@/lib/testing/factories'
import { initializeTaxYear } from '@/lib/tax-year'
import { signToken } from '@/lib/auth/session'

// The dashboard route calls into Next.js's cookies() helper via
// lib/active-year.ts to resolve the active tax year. Vitest cannot
// provide a Next.js request scope, so we stub the helper to bypass
// cookies() entirely and return the test's intended year.
vi.mock('@/lib/active-year', () => ({
  ACTIVE_YEAR_COOKIE: 'active_year',
  ACTIVE_YEAR_QUERY: 'year',
  getActiveYearFromRequest: vi.fn(async () => 2026),
  setActiveYearCookie: vi.fn(),
  buildActiveYearCookieAttributes: vi.fn(() => ''),
  resolveTaxYearFromRequest: vi.fn(async (_req: Request, taxYears: { year: number }[]) =>
    taxYears[0] ?? null
  ),
}))

vi.mock('@/lib/auth/session', async (importOriginal) => {
  const actual = (await importOriginal()) as { signToken: typeof signToken }
  return {
    ...actual,
    requireAuth: vi.fn(),
  }
})

import { requireAuth } from '@/lib/auth/session'

async function makeRequest(userId: string): Promise<NextRequest> {
  const token = await signToken({ sub: userId, username: 'test', role: 'TAXPAYER' })
  return new NextRequest('http://localhost/api/dashboard', {
    method: 'GET',
    headers: { Cookie: `kuwenta_session=${token}` },
  })
}

describe('GET /api/dashboard', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns 401 when the request is unauthenticated (S9.3)', async () => {
    vi.mocked(requireAuth).mockResolvedValue(null)
    const req = new NextRequest('http://localhost/api/dashboard', { method: 'GET' })
    const res = await GET(req)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toEqual({ error: 'Unauthorized' })
  })

  it('returns annualFormType FORM_1701A for pure self-employment taxpayers', async () => {
    await seedReferenceData()
    const user = await createUser()
    const profile = await prisma.taxpayerProfile.create({
      data: {
        userId: user.id,
        tin: '111-111-111-1111',
        fullName: 'Pure SE',
        rdoCode: '040',
        registeredAddress: '1 Test',
        zipCode: '1200',
        natureOfBusiness: 'Consulting',
        incomeType: 'PURE_SELF_EMPLOYMENT',
        corIncludes2551Q: true,
      },
    })
    await initializeTaxYear(profile.id, 2026, true, [], prisma)

    vi.mocked(requireAuth).mockResolvedValue({
      sub: user.id,
      username: 'test',
      role: 'TAXPAYER',
      iat: 1,
      exp: 9999999999,
    })

    const res = await GET(await makeRequest(user.id))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.annualFormType).toBe('FORM_1701A')
  })

  it('returns annualFormType FORM_1701 for mixed-income taxpayers (S7.4 / BR-13)', async () => {
    await seedReferenceData()
    const user = await createUser()
    const profile = await prisma.taxpayerProfile.create({
      data: {
        userId: user.id,
        tin: '222-222-222-2222',
        fullName: 'Mixed Income',
        rdoCode: '040',
        registeredAddress: '1 Test',
        zipCode: '1200',
        natureOfBusiness: 'Consulting',
        incomeType: 'MIXED_INCOME',
        corIncludes2551Q: true,
      },
    })
    await initializeTaxYear(profile.id, 2026, true, [], prisma, false, 'MIXED_INCOME')

    vi.mocked(requireAuth).mockResolvedValue({
      sub: user.id,
      username: 'test',
      role: 'TAXPAYER',
      iat: 1,
      exp: 9999999999,
    })

    const res = await GET(await makeRequest(user.id))
    const json = await res.json()

    expect(res.status).toBe(200)
    // BR-13: mixed-income earners file Form 1701, not 1701A.
    expect(json.annualFormType).toBe('FORM_1701')
    // The annual position must read from the FORM_1701 row, not the
    // (non-existent) FORM_1701A row.
    expect(json.taxpayer.incomeType).toBe('MIXED_INCOME')
  })
})
