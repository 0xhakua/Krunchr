import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  create: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: mocks.findUnique, create: mocks.create },
  },
}))

vi.mock('@/lib/auth/session', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/session')>('@/lib/auth/session')
  return {
    ...actual,
    setSessionCookie: vi.fn().mockResolvedValue(undefined),
  }
})

const cookieStore = new Map<string, string>()
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieStore.get(name)
      return value != null ? { name, value } : undefined
    },
    set: (opts: { name: string; value: string }) => {
      cookieStore.set(opts.name, opts.value)
    },
  }),
}))

import { resetRateLimit } from '@/lib/rate-limit'
import { POST } from '../route'

function jsonRequest(body: unknown) {
  return new Request('http://localhost/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/auth/register', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-jwt-secret-32-chars-minimum-aaaaaaaa'
    mocks.findUnique.mockReset()
    mocks.create.mockReset()
    resetRateLimit('register:unknown')
  })

  it('returns 201 with the user payload on successful registration', async () => {
    mocks.findUnique.mockResolvedValueOnce(null)
    mocks.create.mockResolvedValueOnce({
      id: 'user-123',
      username: 'newuser',
      role: 'TAXPAYER',
    })

    const res = await POST(
      jsonRequest({
        username: 'newuser',
        password: 'Test1234!',
        confirmPassword: 'Test1234!',
      })
    )
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.user).toMatchObject({
      id: 'user-123',
      username: 'newuser',
      role: 'TAXPAYER',
    })
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          username: 'newuser',
          role: 'TAXPAYER',
          isActive: true,
        }),
      })
    )
  })

  it('returns 409 when the username is already taken', async () => {
    mocks.findUnique.mockResolvedValueOnce({
      id: 'existing-user',
      username: 'existinguser',
      role: 'TAXPAYER',
    })

    const res = await POST(
      jsonRequest({
        username: 'existinguser',
        password: 'Test1234!',
        confirmPassword: 'Test1234!',
      })
    )
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body).toMatchObject({
      error: 'That username is already taken — please choose another one.',
      code: 'USERNAME_TAKEN',
    })
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('returns 400 when passwords do not match', async () => {
    const res = await POST(
      jsonRequest({
        username: 'newuser',
        password: 'Test1234!',
        confirmPassword: 'Different123!',
      })
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('Some fields need a quick fix — please check the highlighted fields and try again.')
    expect(body.details).toHaveProperty('confirmPassword')
    expect(body.details.confirmPassword).toContain("Passwords don't match — please re-enter them")
    expect(mocks.findUnique).not.toHaveBeenCalled()
  })

  it('returns 400 for a weak password with field-level details', async () => {
    const res = await POST(
      jsonRequest({
        username: 'newuser',
        password: 'short',
        confirmPassword: 'short',
      })
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('Some fields need a quick fix — please check the highlighted fields and try again.')
    expect(body.details).toHaveProperty('password')
    expect(mocks.findUnique).not.toHaveBeenCalled()
  })

  it('returns 400 for invalid input when required fields are missing', async () => {
    const res = await POST(jsonRequest({}))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('Some fields need a quick fix — please check the highlighted fields and try again.')
    expect(body.details).toHaveProperty('username')
    expect(body.details).toHaveProperty('password')
    expect(body.details).toHaveProperty('confirmPassword')
  })

  it('returns 429 after exceeding the registration rate limit', async () => {
    const invalidBody = { username: 'a', password: 'b', confirmPassword: 'c' }

    // First 5 requests are within the limit.
    for (let i = 0; i < 5; i++) {
      const res = await POST(jsonRequest(invalidBody))
      expect(res.status).toBe(400)
    }

    // 6th request from the same IP should be rate limited.
    const res = await POST(jsonRequest(invalidBody))
    const body = await res.json()

    expect(res.status).toBe(429)
    expect(body).toMatchObject({
      error: 'Too many registration attempts. Please try again later.',
      code: 'RATE_LIMITED',
    })
  })

  it('returns 503 with code DB_UNAVAILABLE when Prisma throws on username lookup', async () => {
    mocks.findUnique.mockRejectedValueOnce(new Error('relation "User" does not exist'))

    const res = await POST(
      jsonRequest({
        username: 'newuser',
        password: 'Test1234!',
        confirmPassword: 'Test1234!',
      })
    )
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body).toMatchObject({
      error: 'Registration is temporarily unavailable. Please try again in a few minutes.',
      code: 'DB_UNAVAILABLE',
    })
  })
})
