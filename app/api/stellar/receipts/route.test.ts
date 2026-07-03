import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'
import { prisma } from '@/lib/testing/db'
import { createTaxpayerWithYear, createATCCode, seedReferenceData } from '@/lib/testing/factories'
import { signToken } from '@/lib/auth/session'

describe('GET /api/stellar/receipts', () => {
  it('returns stellar receipts for the authenticated taxpayer', async () => {
    await seedReferenceData()
    const atc = await createATCCode({ code: 'WI020', ewtRate: 0.1 })
    const { user, taxYear } = await createTaxpayerWithYear()

    const taxReturn = await prisma.taxReturn.findFirstOrThrow({
      where: { taxYearId: taxYear.id },
    })

    const receipt = await prisma.stellarReceipt.create({
      data: {
        returnId: taxReturn.id,
        stellarTxId: 'tx-test-123',
        payloadHash: 'a'.repeat(64),
        network: 'testnet',
        explorerUrl: 'https://stellar.expert/explorer/testnet/tx/tx-test-123',
        status: 'CONFIRMED',
        anchoredAt: new Date('2026-07-03T00:00:00.000Z'),
      },
    })

    const token = await signToken({ sub: user.id, username: user.username, role: 'TAXPAYER' })
    const req = new NextRequest('http://localhost/api/stellar/receipts', {
      headers: { Cookie: `kuwenta_session=${token}` },
    })

    const res = await GET(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.receipts).toHaveLength(1)
    expect(json.receipts[0].id).toBe(receipt.id)
    expect(json.receipts[0].stellarTxId).toBe('tx-test-123')
    expect(json.receipts[0].status).toBe('CONFIRMED')
  })

  it('returns 401 when the request is unauthenticated', async () => {
    const req = new NextRequest('http://localhost/api/stellar/receipts')
    const res = await GET(req)
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBe('Unauthorized')
  })
})
