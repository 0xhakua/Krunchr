import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { signToken } from '@/lib/auth/session'
import { createTaxpayerWithYear } from '@/lib/testing/factories'
import { createWorker as tesseractCreateWorker } from 'tesseract.js'

// `vi.mock` is hoisted, so the factory must not reference any out-of-scope
// variables. Each test resets the per-call behaviour via the spies.
vi.mock('tesseract.js', () => ({
  createWorker: vi.fn(),
}))

const createWorker = vi.mocked(tesseractCreateWorker)

// Smallest valid JPEG signature (FFD8FF) plus a few padding bytes. The route
// only checks the magic number for type validation, so this is enough to pass
// `validateUploadFile` and reach the OCR branch.
const TINY_JPEG_BYTES = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
])

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

function makeImageFormData(filename = 'sample.jpg'): FormData {
  const formData = new FormData()
  formData.append(
    'file',
    new Blob([TINY_JPEG_BYTES], { type: 'image/jpeg' }),
    filename
  )
  return formData
}

async function authedToken(): Promise<string> {
  const { user } = await createTaxpayerWithYear()
  return signToken({ sub: user.id, username: user.username, role: 'TAXPAYER' })
}

describe('POST /api/income/import', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns 401 when unauthenticated', async () => {
    const { POST } = await import('./route')
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
  })

  it('returns 400 when no file is provided', async () => {
    const { POST } = await import('./route')
    const token = await authedToken()
    const res = await POST(makeRequest({ token }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'No file provided' })
  })

  it('returns 400 for an unsupported file type', async () => {
    const { POST } = await import('./route')
    const token = await authedToken()

    const formData = new FormData()
    formData.append('file', new Blob(['not a valid file'], { type: 'text/plain' }), 'notes.txt')

    const res = await POST(makeRequest({ token, formData }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('UNSUPPORTED_TYPE')
  })

  it('returns 200 with extracted fields for a JPEG image', async () => {
    const recognize = vi.fn().mockResolvedValue({
      data: { text: 'Payor Name ACME 123-456-789-000 WC010 100.00 200.00 300.00 50.00' },
    })
    const terminate = vi.fn().mockResolvedValue({ jobId: 'terminate', data: { terminated: true } })
    createWorker.mockResolvedValue({ recognize, terminate } as never)

    const { POST } = await import('./route')
    const token = await authedToken()
    const res = await POST(makeRequest({ token, formData: makeImageFormData() }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.extracted).toBeDefined()
    expect(body.extracted.warnings).toEqual(expect.any(Array))
    // The mock produces no real 2307 fields, but the response shape must be
    // present and warnings should never be the silent-hang empty list.
    expect(body.extracted.confidence).toBeDefined()

    // Critical: tesseract.js must be told to load its traineddata from the
    // bundled path so production does not reach out to jsDelivr.
    expect(createWorker).toHaveBeenCalledTimes(1)
    const options = createWorker.mock.calls[0]?.[2] as
      | { langPath?: string; cacheMethod?: string; gzip?: boolean }
      | undefined
    expect(options?.langPath).toMatch(/lib[\\/]ocr[\\/]tessdata$/)
    expect(options?.cacheMethod).toBe('none')
    expect(options?.gzip).toBe(false)
    expect(terminate).toHaveBeenCalled()
  })

  it('returns 200 with a timeout warning when the parser reports a timeout', async () => {
    // The route must surface the parser's timeout as a structured 200 +
    // warning rather than 500, so the income-page client never gets a
    // "silent hang". The parser-level timeout logic is exercised
    // directly in lib/__tests__/2307-parser.test.ts; here we only assert
    // the route's behaviour in response to a warning-bearing payload.
    vi.doMock('@/lib/ocr/2307-parser', () => ({
      extract2307Fields: vi.fn().mockResolvedValue({
        confidence: 'low',
        warnings: [
          'Image OCR timed out after 60s. Try a higher-resolution scan or upload the PDF version.',
        ],
      }),
      verifyOcrAssets: vi.fn().mockResolvedValue({
        ok: true,
        langPath: '/mock/lang',
        engTraineddataBytes: 5199098,
        message: 'eng.traineddata present (mocked)',
      }),
    }))

    try {
      const { POST } = await import('./route')
      const token = await authedToken()
      const res = await POST(makeRequest({ token, formData: makeImageFormData() }))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.extracted).toBeDefined()
      expect(body.extracted.warnings.join(' ')).toMatch(/timed out/i)
    } finally {
      vi.doUnmock('@/lib/ocr/2307-parser')
    }
  })
})
