import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'
import { prisma } from '@/lib/testing/db'
import { createTaxpayerWithYear, createATCCode, seedReferenceData } from '@/lib/testing/factories'
import { signToken } from '@/lib/auth/session'
import { VAT_THRESHOLD, VAT_WARNING_THRESHOLD } from '@/lib/computation/vat-threshold'

function unauthRequest() {
  return new NextRequest('http://localhost/api/income', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quarter: 1 }),
  })
}

describe('POST /api/income', () => {
  it('returns 401 when the request is unauthenticated (S9.3)', async () => {
    // No Cookie header: requireAuth reads an empty token from the request
    // and returns null, so the route short-circuits with 401.
    const res = await POST(unauthRequest())
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toEqual({ error: 'Unauthorized' })
  })
  it('returns VAT status and records breach when threshold is crossed', async () => {
    await seedReferenceData()
    const { user, taxYear } = await createTaxpayerWithYear()
    const atc = await createATCCode({ code: 'WI010', ewtRate: 0.1 })

    const token = await signToken({ sub: user.id, username: user.username, role: 'TAXPAYER' })
    const req = new NextRequest('http://localhost/api/income', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `kuwenta_session=${token}` },
      body: JSON.stringify({
        quarter: 1,
        payorTin: '123-456-789-000',
        payorName: 'Test Payor',
        atcCode: atc.code,
        month1Amount: VAT_THRESHOLD.dividedBy(3).toNumber(),
        month2Amount: VAT_THRESHOLD.dividedBy(3).toNumber(),
        month3Amount: VAT_THRESHOLD.dividedBy(3).toNumber(),
        cwtWithheld: VAT_THRESHOLD.times(0.1).toNumber(),
      }),
    })

    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.vatStatus.thresholdReached).toBe(true)
    expect(json.vatStatus.vatBreached).toBe(true)

    const updated = await prisma.taxYear.findUnique({ where: { id: taxYear.id } })
    expect(updated?.vatBreached).toBe(true)
  })

  it('warns when YTD gross is at or above 80% of threshold', async () => {
    await seedReferenceData()
    const { user } = await createTaxpayerWithYear()
    const atc = await createATCCode({ code: 'WI011', ewtRate: 0.1 })

    const token = await signToken({ sub: user.id, username: user.username, role: 'TAXPAYER' })
    const req = new NextRequest('http://localhost/api/income', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `kuwenta_session=${token}` },
      body: JSON.stringify({
        quarter: 1,
        payorTin: '123-456-789-000',
        payorName: 'Test Payor',
        atcCode: atc.code,
        month1Amount: VAT_WARNING_THRESHOLD.plus(1).dividedBy(3).toNumber(),
        month2Amount: VAT_WARNING_THRESHOLD.plus(1).dividedBy(3).toNumber(),
        month3Amount: VAT_WARNING_THRESHOLD.plus(1).dividedBy(3).toNumber(),
        cwtWithheld: VAT_WARNING_THRESHOLD.plus(1).times(0.1).toNumber(),
      }),
    })

    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.vatStatus.warningActive).toBe(true)
    expect(json.vatStatus.thresholdReached).toBe(false)
  })

  it('returns structured validation errors on invalid payload', async () => {
    await seedReferenceData()
    const { user } = await createTaxpayerWithYear()

    const token = await signToken({ sub: user.id, username: user.username, role: 'TAXPAYER' })
    const req = new NextRequest('http://localhost/api/income', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `kuwenta_session=${token}` },
      body: JSON.stringify({
        quarter: 5,
        payorTin: '',
        payorName: '',
        atcCode: '',
        month1Amount: 'not-a-number',
        month2Amount: '',
        month3Amount: '',
        cwtWithheld: '',
      }),
    })

    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toBe('Validation failed')
    expect(json.formErrors).toBeDefined()
    expect(json.fieldErrors).toBeDefined()
    expect(json.fieldErrors.quarter).toBeDefined()
    expect(json.fieldErrors.payorTin).toBeDefined()
    expect(json.fieldErrors.atcCode).toBeDefined()
  })
})
