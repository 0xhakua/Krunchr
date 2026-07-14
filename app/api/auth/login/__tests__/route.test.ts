import { describe, expect, it, vi, beforeEach } from 'vitest'

// `vi.mock` is hoisted to the top of the file, so any state it references
// has to be wrapped in `vi.hoisted` to avoid a TDZ error.
const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: mocks.findUnique },
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

import { createUser } from '@/lib/testing/factories'
import { POST } from '../route'

function jsonRequest(body: unknown) {
  return new Request('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-jwt-secret-32-chars-minimum-aaaaaaaa'
    mocks.findUnique.mockReset()
  })

  it('returns 503 with code DB_UNAVAILABLE when Prisma throws on the user lookup', async () => {
    mocks.findUnique.mockRejectedValueOnce(new Error('relation "User" does not exist'))

    const res = await POST(jsonRequest({ username: 'admin', password: 'admin1234!' }))
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body).toMatchObject({
      error: 'Sign-in is temporarily unavailable. Please try again in a few minutes.',
      code: 'DB_UNAVAILABLE',
    })
  })

  it('logs the Prisma errorName and errorMessage so Railway stdout shows which subsystem failed', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const prismaError = new Error('relation "User" does not exist')
    prismaError.name = 'PrismaClientKnownRequestError'
    mocks.findUnique.mockRejectedValueOnce(prismaError)

    await POST(jsonRequest({ username: 'admin', password: 'admin1234!' }))

    const loginLog = errorSpy.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('prisma.user.findUnique')
    )
    expect(loginLog).toBeDefined()
    const meta = loginLog?.[1] as {
      username: string
      errorName: string
      errorMessage: string
    }
    expect(meta).toMatchObject({
      username: 'admin',
      errorName: 'PrismaClientKnownRequestError',
      errorMessage: 'relation "User" does not exist',
    })

    errorSpy.mockRestore()
  })

  it('returns 401 with a friendly message when the user does not exist', async () => {
    mocks.findUnique.mockResolvedValueOnce(null)

    const res = await POST(jsonRequest({ username: 'no-such-user', password: 'whatever' }))
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body).toEqual({
      error: "Hmm, we couldn't find an account with those details. Please check your username and password and try again.",
    })
  })

  it('returns 401 with the same friendly message for a wrong password', async () => {
    const user = await createUser({ username: 'wrong-pwd-test', password: 'right-pwd' })
    mocks.findUnique.mockResolvedValueOnce(user)

    const res = await POST(jsonRequest({ username: user.username, password: 'wrong-pwd' }))
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body).toEqual({
      error: "Hmm, we couldn't find an account with those details. Please check your username and password and try again.",
    })
  })

  it('returns 200 with the user payload on a valid login', async () => {
    const user = await createUser({ username: 'happy-path', password: 'Test1234!' })
    mocks.findUnique.mockResolvedValueOnce(user)

    const res = await POST(jsonRequest({ username: 'happy-path', password: 'Test1234!' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.user).toMatchObject({
      id: user.id,
      username: 'happy-path',
    })
  })
})
