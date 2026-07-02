import { describe, expect, it, vi } from 'vitest'
import { GET } from '../route'
import { prisma } from '@/lib/prisma'

describe('GET /api/health', () => {
  it('returns a structured body with database, storage, and stellar subsystems', async () => {
    vi.spyOn(prisma, '$queryRaw').mockResolvedValueOnce([{ '?column?': 1 }] as never)

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toHaveProperty('ok')
    expect(body).toHaveProperty('database')
    expect(body).toHaveProperty('storage')
    expect(body).toHaveProperty('stellar')
    expect(body).toHaveProperty('checkedAt')
    expect(body.database).toMatchObject({ ok: true })
    expect(typeof body.checkedAt).toBe('string')
  })

  it('reports database.ok=false with the Prisma error message when the DB is unreachable', async () => {
    vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(
      new Error('relation "User" does not exist')
    )

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200) // the endpoint itself stays up; ok field reflects health
    expect(body.database.ok).toBe(false)
    expect(body.database.message).toContain('relation "User" does not exist')
    expect(body.ok).toBe(false)
  })

  it('is a public endpoint (no auth required) — S9.3', async () => {
    // /api/health is whitelisted in middleware.ts (PUBLIC_PATHS comment
    // mentions only /login and /api/auth/login, but the broader middleware
    // also lets /api/* through if the helper short-circuits). The route
    // itself never invokes requireAuth, so it must respond without a cookie.
    vi.spyOn(prisma, '$queryRaw').mockResolvedValueOnce([{ '?column?': 1 }] as never)
    const res = await GET()
    expect(res.status).toBe(200)
  })
})
