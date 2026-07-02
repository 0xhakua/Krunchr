import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockRequireAuth = vi.fn()

vi.mock('@/lib/auth/session', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
}))

import { middleware } from '../../middleware'

function req(
  pathname: string,
  method = 'GET',
  headers?: Record<string, string>
): NextRequest {
  return new NextRequest(`http://localhost${pathname}`, { method, headers })
}

describe('middleware route protection (S9.3)', () => {
  beforeEach(() => {
    mockRequireAuth.mockReset()
  })

  describe('public paths', () => {
    it('lets /login through without calling requireAuth', async () => {
      const res = await middleware(req('/login'))
      expect(res.status).not.toBe(401)
      expect(res.status).not.toBe(403)
      expect(res.headers.get('location')).toBeNull()
      expect(mockRequireAuth).not.toHaveBeenCalled()
    })

    it('lets /login?redirect=/dashboard through (preserves query)', async () => {
      const res = await middleware(req('/login?redirect=/dashboard'))
      expect(res.headers.get('location')).toBeNull()
      expect(mockRequireAuth).not.toHaveBeenCalled()
    })

    it('lets /api/auth/login through without calling requireAuth', async () => {
      const res = await middleware(req('/api/auth/login'))
      expect(res.status).not.toBe(401)
      expect(mockRequireAuth).not.toHaveBeenCalled()
    })

    it('lets /_next static asset requests through', async () => {
      const res = await middleware(req('/_next/static/chunks/main.js'))
      expect(res.status).not.toBe(401)
      expect(mockRequireAuth).not.toHaveBeenCalled()
    })

    it('lets /favicon.ico through', async () => {
      const res = await middleware(req('/favicon.ico'))
      expect(res.status).not.toBe(401)
      expect(mockRequireAuth).not.toHaveBeenCalled()
    })

    it('lets /api/auth/me through (whitelisted by /api/auth prefix)', async () => {
      // The middleware lets any path under /api/auth/ through without auth.
      // /api/auth/me is a public session probe used by the client.
      const res = await middleware(req('/api/auth/me'))
      expect(res.status).not.toBe(401)
      expect(mockRequireAuth).not.toHaveBeenCalled()
    })
  })

  describe('unauthenticated /api/*', () => {
    it('returns 401 with { error: "Unauthorized" } for /api/taxpayer', async () => {
      mockRequireAuth.mockResolvedValue(null)
      const res = await middleware(req('/api/taxpayer'))
      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body).toEqual({ error: 'Unauthorized' })
    })

    it('returns 401 for /api/income', async () => {
      mockRequireAuth.mockResolvedValue(null)
      const res = await middleware(req('/api/income'))
      expect(res.status).toBe(401)
    })

    it('returns 401 for /api/returns', async () => {
      mockRequireAuth.mockResolvedValue(null)
      const res = await middleware(req('/api/returns'))
      expect(res.status).toBe(401)
    })

    it('returns 401 for /api/returns/abc-123', async () => {
      mockRequireAuth.mockResolvedValue(null)
      const res = await middleware(req('/api/returns/abc-123'))
      expect(res.status).toBe(401)
    })

    it('returns 401 for /api/returns/abc-123/file', async () => {
      mockRequireAuth.mockResolvedValue(null)
      const res = await middleware(req('/api/returns/abc-123/file'))
      expect(res.status).toBe(401)
    })

    it('returns 401 for /api/election', async () => {
      mockRequireAuth.mockResolvedValue(null)
      const res = await middleware(req('/api/election'))
      expect(res.status).toBe(401)
    })

    it('returns 401 for /api/stellar/receipts', async () => {
      mockRequireAuth.mockResolvedValue(null)
      const res = await middleware(req('/api/stellar/receipts'))
      expect(res.status).toBe(401)
    })

    it('returns 401 for /api/journal/generate', async () => {
      mockRequireAuth.mockResolvedValue(null)
      const res = await middleware(req('/api/journal/generate'))
      expect(res.status).toBe(401)
    })

    it('returns 401 for /api/overpayment/2026', async () => {
      mockRequireAuth.mockResolvedValue(null)
      const res = await middleware(req('/api/overpayment/2026'))
      expect(res.status).toBe(401)
    })

    it('returns 401 for /api/prior-year-credit', async () => {
      mockRequireAuth.mockResolvedValue(null)
      const res = await middleware(req('/api/prior-year-credit'))
      expect(res.status).toBe(401)
    })

    it('returns 401 for /api/penalties', async () => {
      mockRequireAuth.mockResolvedValue(null)
      const res = await middleware(req('/api/penalties'))
      expect(res.status).toBe(401)
    })

    it('returns 401 for /api/computation/recascade', async () => {
      mockRequireAuth.mockResolvedValue(null)
      const res = await middleware(req('/api/computation/recascade'))
      expect(res.status).toBe(401)
    })

    it('returns 401 for /api/atc', async () => {
      mockRequireAuth.mockResolvedValue(null)
      const res = await middleware(req('/api/atc'))
      expect(res.status).toBe(401)
    })
  })

  describe('unauthenticated page routes', () => {
    it('redirects /dashboard to /login when not authenticated', async () => {
      mockRequireAuth.mockResolvedValue(null)
      const res = await middleware(req('/dashboard'))
      expect(res.status).toBe(307)
      expect(new URL(res.headers.get('location') ?? '', 'http://localhost').pathname).toBe('/login')
    })

    it('redirects /income to /login when not authenticated', async () => {
      mockRequireAuth.mockResolvedValue(null)
      const res = await middleware(req('/income'))
      expect(res.status).toBe(307)
      expect(new URL(res.headers.get('location') ?? '', 'http://localhost').pathname).toBe('/login')
    })

    it('redirects /onboarding to /login when not authenticated', async () => {
      mockRequireAuth.mockResolvedValue(null)
      const res = await middleware(req('/onboarding'))
      expect(res.status).toBe(307)
    })
  })

  describe('admin route gating (S9.3)', () => {
    it('returns 403 for /api/admin/users when a TAXPAYER session is present', async () => {
      mockRequireAuth.mockResolvedValue({
        sub: 'user-1',
        username: 'maria',
        role: 'TAXPAYER',
        iat: 1,
        exp: 9999999999,
      })
      const res = await middleware(req('/api/admin/users'))
      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body).toEqual({ error: 'Forbidden' })
    })

    it('returns 403 for /api/admin/atc when a TAXPAYER session is present', async () => {
      mockRequireAuth.mockResolvedValue({
        sub: 'user-1',
        username: 'maria',
        role: 'TAXPAYER',
        iat: 1,
        exp: 9999999999,
      })
      const res = await middleware(req('/api/admin/atc'))
      expect(res.status).toBe(403)
    })

    it('returns 403 for /api/admin/holidays when a TAXPAYER session is present', async () => {
      mockRequireAuth.mockResolvedValue({
        sub: 'user-1',
        username: 'maria',
        role: 'TAXPAYER',
        iat: 1,
        exp: 9999999999,
      })
      const res = await middleware(req('/api/admin/holidays'))
      expect(res.status).toBe(403)
    })

    it('returns 403 for /api/admin/system-health when a TAXPAYER session is present', async () => {
      mockRequireAuth.mockResolvedValue({
        sub: 'user-1',
        username: 'maria',
        role: 'TAXPAYER',
        iat: 1,
        exp: 9999999999,
      })
      const res = await middleware(req('/api/admin/system-health'))
      expect(res.status).toBe(403)
    })

    it('returns 403 for /api/admin/audit-log when a TAXPAYER session is present', async () => {
      mockRequireAuth.mockResolvedValue({
        sub: 'user-1',
        username: 'maria',
        role: 'TAXPAYER',
        iat: 1,
        exp: 9999999999,
      })
      const res = await middleware(req('/api/admin/audit-log'))
      expect(res.status).toBe(403)
    })

    it('redirects /admin to /dashboard when a TAXPAYER session is present', async () => {
      mockRequireAuth.mockResolvedValue({
        sub: 'user-1',
        username: 'maria',
        role: 'TAXPAYER',
        iat: 1,
        exp: 9999999999,
      })
      const res = await middleware(req('/admin'))
      expect(res.status).toBe(307)
      expect(new URL(res.headers.get('location') ?? '', 'http://localhost').pathname).toBe('/dashboard')
    })

    it('redirects /admin/users to /dashboard when a TAXPAYER session is present', async () => {
      mockRequireAuth.mockResolvedValue({
        sub: 'user-1',
        username: 'maria',
        role: 'TAXPAYER',
        iat: 1,
        exp: 9999999999,
      })
      const res = await middleware(req('/admin/users'))
      expect(res.status).toBe(307)
    })

    it('lets an ADMIN through to /api/admin/users', async () => {
      mockRequireAuth.mockResolvedValue({
        sub: 'admin-1',
        username: 'admin',
        role: 'ADMIN',
        iat: 1,
        exp: 9999999999,
      })
      const res = await middleware(req('/api/admin/users'))
      expect(res.status).not.toBe(401)
      expect(res.status).not.toBe(403)
      expect(res.headers.get('location')).toBeNull()
    })

    it('lets an ADMIN through to /admin', async () => {
      mockRequireAuth.mockResolvedValue({
        sub: 'admin-1',
        username: 'admin',
        role: 'ADMIN',
        iat: 1,
        exp: 9999999999,
      })
      const res = await middleware(req('/admin'))
      expect(res.status).not.toBe(401)
      expect(res.status).not.toBe(403)
    })
  })

  describe('authenticated non-admin requests', () => {
    it('lets a TAXPAYER through to /api/income', async () => {
      mockRequireAuth.mockResolvedValue({
        sub: 'user-1',
        username: 'maria',
        role: 'TAXPAYER',
        iat: 1,
        exp: 9999999999,
      })
      const res = await middleware(req('/api/income'))
      expect(res.status).not.toBe(401)
      expect(res.status).not.toBe(403)
    })

    it('lets a TAXPAYER through to /dashboard', async () => {
      mockRequireAuth.mockResolvedValue({
        sub: 'user-1',
        username: 'maria',
        role: 'TAXPAYER',
        iat: 1,
        exp: 9999999999,
      })
      const res = await middleware(req('/dashboard'))
      expect(res.status).not.toBe(401)
      expect(res.headers.get('location')).toBeNull()
    })
  })

  describe('Content-Type validation (S10.4)', () => {
    it('rejects POST /api/income with a non-JSON Content-Type', async () => {
      const res = await middleware(req('/api/income', 'POST', { 'content-type': 'text/html' }))
      expect(res.status).toBe(415)
      const body = await res.json()
      expect(body).toMatchObject({
        error: 'Unsupported Media Type',
        code: 'UNSUPPORTED_MEDIA_TYPE',
        expected: 'application/json',
      })
      expect(mockRequireAuth).not.toHaveBeenCalled()
    })

    it('rejects POST /api/income with no Content-Type header', async () => {
      const res = await middleware(req('/api/income', 'POST'))
      expect(res.status).toBe(415)
      expect(mockRequireAuth).not.toHaveBeenCalled()
    })

    it('allows POST /api/income with application/json to reach auth check', async () => {
      mockRequireAuth.mockResolvedValue(null)
      const res = await middleware(req('/api/income', 'POST', { 'content-type': 'application/json' }))
      expect(res.status).toBe(401)
      expect(mockRequireAuth).toHaveBeenCalledTimes(1)
    })

    it('rejects PATCH /api/admin/users with text/plain', async () => {
      const res = await middleware(
        req('/api/admin/users', 'PATCH', { 'content-type': 'text/plain' })
      )
      expect(res.status).toBe(415)
      expect(mockRequireAuth).not.toHaveBeenCalled()
    })

    it('allows PATCH /api/admin/users with application/json to reach auth check', async () => {
      mockRequireAuth.mockResolvedValue(null)
      const res = await middleware(
        req('/api/admin/users', 'PATCH', { 'content-type': 'application/json' })
      )
      expect(res.status).toBe(401)
    })

    it('exempts PUT /api/admin/holidays CSV bulk import from JSON requirement', async () => {
      mockRequireAuth.mockResolvedValue(null)
      const res = await middleware(
        req('/api/admin/holidays', 'PUT', { 'content-type': 'text/csv' })
      )
      expect(res.status).toBe(401)
      expect(mockRequireAuth).toHaveBeenCalledTimes(1)
    })

    it('does not enforce Content-Type on GET requests', async () => {
      mockRequireAuth.mockResolvedValue(null)
      const res = await middleware(req('/api/income'))
      expect(res.status).toBe(401)
    })
  })
})
