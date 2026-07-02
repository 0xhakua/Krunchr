import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  createTaxpayerWithYear,
  seedReferenceData,
} from '@/lib/testing/factories'

vi.mock('@/lib/storage', () => ({
  writeFile: vi.fn().mockResolvedValue('returns/x/generated.pdf'),
  readFile: vi.fn().mockResolvedValue(Buffer.from('pdf')),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  getStorageRoot: vi.fn().mockReturnValue('./storage'),
}))

vi.mock('@/lib/stellar/anchor', () => ({
  anchorFilingReceipt: vi.fn().mockResolvedValue({
    stellarTxId: 'tx-confirmed-123',
    payloadHash: 'abc123',
    explorerUrl: 'https://stellar.expert/explorer/testnet/tx/tx-confirmed-123',
    status: 'CONFIRMED',
  }),
  storeFilingPackage: vi.fn().mockResolvedValue('returns/x/generated.pdf'),
  retryAnchorFilingReceipt: vi.fn(),
}))

const mockSession = vi.hoisted(() => ({ current: null as null | { sub: string; username: string; role: 'ADMIN' | 'TAXPAYER' } }))

vi.mock('@/lib/auth/session', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/session')>('@/lib/auth/session')
  return {
    ...actual,
    requireAuth: vi.fn(async () => mockSession.current),
  }
})

import { GET as listReturns } from '@/app/api/returns/route'
import { POST as generateReturn } from '@/app/api/returns/[id]/generate/route'

describe('GET /api/returns', () => {
  beforeAll(async () => {
    await seedReferenceData()
  })

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-jwt-secret-32-chars-minimum-aaaaaaaa'
  })

  it('includes the StellarReceipt on FILED returns', async () => {
    const { user, taxYear } = await createTaxpayerWithYear({
      year: 2026,
      corIncludes2551Q: true,
    })

    const ret = await prisma.taxReturn.findFirstOrThrow({
      where: { taxYearId: taxYear.id, sequenceOrder: 1 },
    })

    await prisma.stellarReceipt.create({
      data: {
        returnId: ret.id,
        stellarTxId: 'tx-confirmed-fixture',
        payloadHash: 'deadbeef',
        network: 'testnet',
        explorerUrl:
          'https://stellar.expert/explorer/testnet/tx/tx-confirmed-fixture',
        status: 'CONFIRMED',
      },
    })

    await prisma.taxReturn.update({
      where: { id: ret.id },
      data: { status: 'FILED', filedDate: new Date() },
    })

    mockSession.current = { sub: user.id, username: user.username, role: 'TAXPAYER' }

    const res = await listReturns()
    expect(res.status).toBe(200)
    const body = await res.json()
    const filed = body.returns.find(
      (r: { id: string; status: string }) => r.id === ret.id
    )
    expect(filed).toBeDefined()
    expect(filed.status).toBe('FILED')
    expect(filed.stellarReceipt).not.toBeNull()
    expect(filed.stellarReceipt.stellarTxId).toBe('tx-confirmed-fixture')
    expect(filed.stellarReceipt.explorerUrl).toMatch(/stellar\.expert/)
    expect(filed.stellarReceipt.status).toBe('CONFIRMED')
  })

  it('returns stellarReceipt: null for non-FILED returns', async () => {
    const { user } = await createTaxpayerWithYear({
      year: 2027,
      corIncludes2551Q: true,
    })

    mockSession.current = { sub: user.id, username: user.username, role: 'TAXPAYER' }

    const res = await listReturns()
    expect(res.status).toBe(200)
    const body = await res.json()
    const pending = body.returns.find(
      (r: { status: string }) => r.status !== 'FILED'
    )
    if (pending) {
      expect(pending.stellarReceipt).toBeNull()
    }
  })

  it('returns 401 when the request is unauthenticated (S9.3)', async () => {
    mockSession.current = null
    const res = await listReturns()
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toEqual({ error: 'Unauthorized' })
  })
})

describe('POST /api/returns/[id]/generate', () => {
  it('returns 422 with a structured error when generating 1701A after a VAT breach', async () => {
    const { user, taxYear } = await createTaxpayerWithYear({
      year: 2026,
      corIncludes2551Q: true,
    })

    await prisma.taxYear.update({
      where: { id: taxYear.id },
      data: { vatBreached: true, vatBreachDate: new Date() },
    })

    const annual = await prisma.taxReturn.findFirstOrThrow({
      where: { taxYearId: taxYear.id, formType: 'FORM_1701A' },
    })

    mockSession.current = { sub: user.id, username: user.username, role: 'TAXPAYER' }

    const res = await generateReturn(
      new Request(`http://localhost/api/returns/${annual.id}/generate`, {
        method: 'POST',
      }),
      { params: Promise.resolve({ id: annual.id }) }
    )

    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.code).toBe('VAT_BREACH_1701A_BLOCKED')
    expect(body.error).toContain('VAT threshold breached')
  })
})
