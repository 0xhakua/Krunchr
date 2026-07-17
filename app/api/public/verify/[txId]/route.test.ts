import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/testing/db'
import { createTaxpayerWithYear } from '@/lib/testing/factories'

const verifyMocks = vi.hoisted(() => ({
  fetchPublicAnchor: vi.fn(),
  getNetwork: vi.fn(() => 'testnet'),
  getExplorerUrl: vi.fn((txId: string) => `https://stellar.expert/explorer/testnet/tx/${txId}`),
}))

vi.mock('@/lib/stellar/verify', () => ({
  fetchPublicAnchor: verifyMocks.fetchPublicAnchor,
  getNetwork: verifyMocks.getNetwork,
  getExplorerUrl: verifyMocks.getExplorerUrl,
}))

const ORIGINAL_ENV = { ...process.env }

import { GET } from '@/app/api/public/verify/[txId]/route'

describe('GET /api/public/verify/[txId]', () => {
  beforeEach(() => {
    process.env.STELLAR_NETWORK = 'testnet'
    Object.values(verifyMocks).forEach((m) => m.mockReset?.())
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.clearAllMocks()
  })

  it('returns 400 for an invalid txId', async () => {
    const res = await GET(
      new Request('http://localhost/api/public/verify/not-a-tx-id'),
      { params: Promise.resolve({ txId: 'not-a-tx-id' }) }
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Invalid Stellar transaction ID/)
  })

  it('returns 404 when no Kuwenta anchor is found on-chain', async () => {
    verifyMocks.fetchPublicAnchor.mockResolvedValue(null)

    const res = await GET(
      new Request('http://localhost/api/public/verify/abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234'),
      { params: Promise.resolve({ txId: 'abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234' }) }
    )
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.code).toBe('RECEIPT_NOT_FOUND')
  })

  it('returns 200 with on-chain details when anchor is found', async () => {
    verifyMocks.fetchPublicAnchor.mockResolvedValue({
      returnId: 'ret_abc123',
      dataKey: 'kuwenta:ph:ret_abc123',
      dataValue: 'deadbeef'.repeat(8),
      payloadHash: 'deadbeef'.repeat(8),
      anchoredAt: '2026-07-17T10:00:00.000Z',
      sourceAccount: 'GSRC',
      transactionHash: 'tx_abc',
      ledgerCreatedAt: '2026-07-17T10:01:00.000Z',
    })

    const res = await GET(
      new Request('http://localhost/api/public/verify/abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234'),
      { params: Promise.resolve({ txId: 'abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234' }) }
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.txId).toBe('abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234')
    expect(body.returnId).toBe('ret_abc123')
    expect(body.onChainHash).toBe('deadbeef'.repeat(8))
    expect(body.onChainTimestamp).toBe('2026-07-17T10:00:00.000Z')
    expect(body.sourceAccount).toBe('GSRC')
    expect(body.ledgerCreatedAt).toBe('2026-07-17T10:01:00.000Z')
    expect(body.status).toBe('CONFIRMED')
    expect(body.return).toBeNull()
  })

  it('includes TaxReturn details when the return exists in the database', async () => {
    const { taxYear } = await createTaxpayerWithYear({ year: 2026, corIncludes2551Q: true })
    const taxReturn = await prisma.taxReturn.findFirstOrThrow({
      where: { taxYearId: taxYear.id },
    })

    verifyMocks.fetchPublicAnchor.mockResolvedValue({
      returnId: taxReturn.id,
      dataKey: `kuwenta:ph:${taxReturn.id}`,
      dataValue: 'deadbeef'.repeat(8),
      payloadHash: 'deadbeef'.repeat(8),
      anchoredAt: '2026-07-17T10:00:00.000Z',
      sourceAccount: 'GSRC',
      transactionHash: 'tx_abc',
      ledgerCreatedAt: '2026-07-17T10:01:00.000Z',
    })

    const txId = 'abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234'
    const res = await GET(
      new Request(`http://localhost/api/public/verify/${txId}`),
      { params: Promise.resolve({ txId }) }
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.return).not.toBeNull()
    expect(body.return.formType).toBe(taxReturn.formType)
    expect(body.return.quarter).toBe(taxReturn.quarter)
    expect(body.return.taxYear).toBe(2026)
  })

  it('returns 500 when Horizon verification throws', async () => {
    verifyMocks.fetchPublicAnchor.mockRejectedValue(new Error('Horizon timeout'))

    const txId = 'abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234'
    const res = await GET(
      new Request(`http://localhost/api/public/verify/${txId}`),
      { params: Promise.resolve({ txId }) }
    )
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/Horizon timeout/)
  })
})
