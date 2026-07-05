import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'
import { signToken } from '@/lib/auth/session'
import { createTaxpayerWithYear } from '@/lib/testing/factories'

function makeRequest({
  token,
  formData,
}: {
  token?: string
  formData?: FormData
}): NextRequest {
  const headers: Record<string, string> = {}
  if (token) headers.Cookie = `kuwenta_session=${token}`
  return new NextRequest('http://localhost/api/income/import', {
    method: 'POST',
    headers,
    body: formData ?? new FormData(),
  })
}

describe('POST /api/income/import', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
  })

  it('returns 400 when no file is provided', async () => {
    const { user } = await createTaxpayerWithYear()
    const token = await signToken({ sub: user.id, username: user.username, role: 'TAXPAYER' })
    const res = await POST(makeRequest({ token }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'No file provided' })
  })

  it('returns 400 for an unsupported file type', async () => {
    const { user } = await createTaxpayerWithYear()
    const token = await signToken({ sub: user.id, username: user.username, role: 'TAXPAYER' })

    const formData = new FormData()
    formData.append('file', new Blob(['not a valid file'], { type: 'text/plain' }), 'notes.txt')

    const res = await POST(makeRequest({ token, formData }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('UNSUPPORTED_TYPE')
  })
})
