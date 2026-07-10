import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: mocks.findUnique },
  },
}))

import { GET } from '../route'

function jsonRequest(username: string) {
  return new Request(
    `http://localhost/api/auth/check-username?username=${encodeURIComponent(username)}`,
    { method: 'GET' }
  )
}

describe('GET /api/auth/check-username', () => {
  beforeEach(() => {
    mocks.findUnique.mockReset()
  })

  it('returns available=true when the username is not taken', async () => {
    mocks.findUnique.mockResolvedValueOnce(null)

    const res = await GET(jsonRequest('newuser'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ available: true, username: 'newuser' })
    expect(mocks.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { username: 'newuser' } })
    )
  })

  it('returns available=false when the username is already taken', async () => {
    mocks.findUnique.mockResolvedValueOnce({
      id: 'existing-user',
      username: 'existinguser',
      role: 'TAXPAYER',
    })

    const res = await GET(jsonRequest('existinguser'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ available: false, username: 'existinguser' })
  })

  it('returns 400 with an error when the username is too short', async () => {
    const res = await GET(jsonRequest('ab'))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.available).toBe(false)
    expect(body.error).toMatch(/at least 3 characters/)
    expect(mocks.findUnique).not.toHaveBeenCalled()
  })

  it('returns 503 when the database is unavailable', async () => {
    mocks.findUnique.mockRejectedValueOnce(new Error('connection failed'))

    const res = await GET(jsonRequest('newuser'))
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.available).toBe(false)
    expect(body.error).toBe('Database unavailable')
  })
})
