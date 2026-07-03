import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { PUT } from './route'
import {
  createTaxpayerWithYear,
  createATCCode,
  createForm2307,
  seedReferenceData,
} from '@/lib/testing/factories'
import { signToken } from '@/lib/auth/session'

const sessionStore = vi.hoisted(() => ({
  current: null as null | { sub: string; username: string; role: 'ADMIN' | 'TAXPAYER' },
}))

vi.mock('@/lib/auth/session', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('@/lib/auth/session')
  return {
    ...actual,
    signToken: actual.signToken,
    requireAuth: vi.fn(async () => sessionStore.current),
  }
})

function createRequest(id: string, body: unknown) {
  return new NextRequest(`http://localhost/api/income/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('PUT /api/income/[id]', () => {
  beforeEach(() => {
    sessionStore.current = null
  })

  it('returns structured validation errors on invalid payload', async () => {
    await seedReferenceData()
    const { user, taxYear } = await createTaxpayerWithYear()
    const atc = await createATCCode({ code: 'WI012', ewtRate: 0.1 })
    const cert = await createForm2307(taxYear.id, atc.code)

    const token = await signToken({ sub: user.id, username: user.username, role: 'TAXPAYER' })
    sessionStore.current = { sub: user.id, username: user.username, role: 'TAXPAYER' }

    const req = createRequest(cert.id, {
      quarter: 10,
      payorTin: '',
    })

    const res = await PUT(req, { params: Promise.resolve({ id: cert.id }) })
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toBe('Validation failed')
    expect(json.formErrors).toBeDefined()
    expect(json.fieldErrors).toBeDefined()
    expect(json.fieldErrors.quarter).toBeDefined()
    expect(json.fieldErrors.payorTin).toBeDefined()
  })
})
