import crypto from 'crypto'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  encodeAnchorPayload,
  parseAnchorOperations,
  retryAnchorFilingReceipt,
} from '../anchor'
import * as storage from '@/lib/storage'
import * as dispatcher from '@/lib/pdf/dispatcher'

vi.mock('@/lib/storage', async () => {
  const actual = await vi.importActual<typeof import('@/lib/storage')>('@/lib/storage')
  return {
    ...actual,
    readFile: vi.fn(),
  }
})

vi.mock('@/lib/pdf/dispatcher', async () => {
  const actual = await vi.importActual<typeof import('@/lib/pdf/dispatcher')>('@/lib/pdf/dispatcher')
  return {
    ...actual,
    renderFilingPdf: vi.fn(),
  }
})

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('encodeAnchorPayload', () => {
  it('splits the hash and ISO timestamp into two manageData entries', () => {
    const returnId = 'cm00000000000000000000001'
    const hash = crypto.createHash('sha256').update('pdf-bytes').digest('hex')
    const filedDate = '2026-06-29T12:34:56.789Z'

    const payload = encodeAnchorPayload(returnId, hash, filedDate)

    expect(payload.hashKey).toBe(`kuwenta:ph:${returnId}`)
    expect(payload.hashValue).toBe(hash)
    expect(payload.timestampKey).toBe(`kuwenta:ts:${returnId}`)
    expect(payload.timestampValue).toBe(filedDate)

    expect(Buffer.byteLength(payload.hashValue, 'utf8')).toBe(64)
    expect(Buffer.byteLength(payload.timestampValue, 'utf8')).toBeLessThanOrEqual(64)
  })

  it('rejects an invalid hash', () => {
    expect(() => encodeAnchorPayload('ret-id', 'not-a-hash', '2026-06-29T12:34:56.789Z')).toThrow(
      'payloadHash must be a 64-character lower/upper-case hex string'
    )
  })

  it('rejects an invalid timestamp', () => {
    const hash = crypto.createHash('sha256').update('x').digest('hex')
    expect(() => encodeAnchorPayload('ret-id', hash, 'not-a-date')).toThrow(
      'filedDate must be a valid ISO timestamp'
    )
  })
})

describe('parseAnchorOperations', () => {
  const returnId = 'cm00000000000000000000001'
  const hash = crypto.createHash('sha256').update('pdf-bytes').digest('hex')
  const filedDate = '2026-06-29T12:34:56.789Z'

  it('recovers hash and timestamp from SDK-style Buffer operations', () => {
    const parsed = parseAnchorOperations([
      { type: 'manageData', name: `kuwenta:ph:${returnId}`, value: Buffer.from(hash, 'utf8') },
      { type: 'manageData', name: `kuwenta:ts:${returnId}`, value: Buffer.from(filedDate, 'utf8') },
    ])

    expect(parsed).toEqual({ payloadHash: hash, filedDate })
  })

  it('recovers hash and timestamp from Horizon-style base64 operations', () => {
    const parsed = parseAnchorOperations([
      {
        type: 'manageData',
        name: `kuwenta:ph:${returnId}`,
        value: Buffer.from(hash, 'utf8').toString('base64'),
      },
      {
        type: 'manageData',
        name: `kuwenta:ts:${returnId}`,
        value: Buffer.from(filedDate, 'utf8').toString('base64'),
      },
    ])

    expect(parsed).toEqual({ payloadHash: hash, filedDate })
  })

  it('returns null when the hash entry is missing', () => {
    const parsed = parseAnchorOperations([
      { type: 'manageData', name: `kuwenta:ts:${returnId}`, value: Buffer.from(filedDate, 'utf8') },
    ])

    expect(parsed).toBeNull()
  })

  it('returns null when the timestamp entry is missing', () => {
    const parsed = parseAnchorOperations([
      { type: 'manageData', name: `kuwenta:ph:${returnId}`, value: Buffer.from(hash, 'utf8') },
    ])

    expect(parsed).toBeNull()
  })

  it('ignores non-manageData operations', () => {
    const parsed = parseAnchorOperations([
      { type: 'payment', name: undefined, value: undefined },
      { type: 'manageData', name: `kuwenta:ph:${returnId}`, value: Buffer.from(hash, 'utf8') },
      { type: 'manageData', name: `kuwenta:ts:${returnId}`, value: Buffer.from(filedDate, 'utf8') },
    ])

    expect(parsed).toEqual({ payloadHash: hash, filedDate })
  })
})

describe('retryAnchorFilingReceipt', () => {
  const returnId = 'cm00000000000000000000002'
  const userId = 'user-123'
  const pdfPath = 'returns/ty-123/ret-456/generated.pdf'
  const pdfBuffer = Buffer.from('pdf-bytes')
  const regeneratedBuffer = Buffer.from('regenerated-pdf-bytes')

  it('re-anchors a PDF that is still on disk', async () => {
    vi.spyOn(storage, 'readFile').mockResolvedValue(pdfBuffer)
    vi.spyOn(dispatcher, 'renderFilingPdf').mockResolvedValue(null)

    const result = await retryAnchorFilingReceipt(returnId, userId, pdfPath)

    expect(storage.readFile).toHaveBeenCalledWith(pdfPath)
    expect(dispatcher.renderFilingPdf).not.toHaveBeenCalled()
    // Stellar is not configured in tests, so anchoring fails gracefully and
    // still reports the hash of the PDF it attempted to anchor.
    expect(result.status).toBe('FAILED')
    expect(result.payloadHash).toBe(crypto.createHash('sha256').update(pdfBuffer).digest('hex'))
  })

  it('regenerates the PDF from return data when the stored file is missing', async () => {
    const error = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    vi.spyOn(storage, 'readFile').mockRejectedValue(error)
    vi.spyOn(dispatcher, 'renderFilingPdf').mockResolvedValue(regeneratedBuffer)

    const result = await retryAnchorFilingReceipt(returnId, userId, pdfPath)

    expect(storage.readFile).toHaveBeenCalledWith(pdfPath)
    expect(dispatcher.renderFilingPdf).toHaveBeenCalledWith(returnId, userId)
    expect(result.status).toBe('FAILED')
    expect(result.payloadHash).toBe(
      crypto.createHash('sha256').update(regeneratedBuffer).digest('hex')
    )
  })

  it('throws a clear error when the PDF is missing and cannot be regenerated', async () => {
    const error = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    vi.spyOn(storage, 'readFile').mockRejectedValue(error)
    vi.spyOn(dispatcher, 'renderFilingPdf').mockResolvedValue(null)

    await expect(retryAnchorFilingReceipt(returnId, userId, pdfPath)).rejects.toThrow(
      'Filing PDF not found at path:'
    )
  })
})
