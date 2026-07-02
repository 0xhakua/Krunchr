import { describe, expect, it } from 'vitest'
import nextConfig from '@/next.config'

describe('next.config headers (S10.4)', () => {
  it('sets X-Content-Type-Options, X-Frame-Options, CSP and Referrer-Policy', async () => {
    const headersConfig = await nextConfig.headers?.()
    expect(headersConfig).toBeDefined()
    expect(headersConfig).toHaveLength(1)

    const [{ source, headers }] = headersConfig!
    expect(source).toBe('/:path*')

    const headerMap = new Map(headers.map((h) => [h.key, h.value]))
    expect(headerMap.get('X-Content-Type-Options')).toBe('nosniff')
    expect(headerMap.get('X-Frame-Options')).toBe('DENY')
    expect(headerMap.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin')

    const csp = headerMap.get('Content-Security-Policy')
    expect(csp).toBeDefined()
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain('https://horizon-testnet.stellar.org')
  })
})
