import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest'
import { prisma } from '@/lib/testing/db'
import {
  createTaxpayerWithYear,
  seedReferenceData,
} from '@/lib/testing/factories'

const storedPdf = Buffer.from('%PDF-1.4 stored filing pdf')
const regeneratedPdf = Buffer.from('%PDF-1.4 regenerated preview pdf')

vi.mock('@/lib/storage', () => ({
  readFile: vi.fn(async () => storedPdf),
  writeFile: vi.fn(),
  getStoragePath: vi.fn().mockReturnValue('./storage'),
  getStorageType: vi.fn().mockReturnValue('local'),
}))

vi.mock('@/lib/pdf/dispatcher', () => ({
  loadFilingData: vi.fn(),
  renderFilingPdf: vi.fn(async () => regeneratedPdf),
}))

const mockSession = vi.hoisted(() => ({
  current: null as null | { sub: string; username: string; role: 'ADMIN' | 'TAXPAYER' },
}))

vi.mock('@/lib/auth/session', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/session')>('@/lib/auth/session')
  return {
    ...actual,
    requireAuth: vi.fn(async () => mockSession.current),
  }
})

import { GET } from '../route'
import { loadFilingData, renderFilingPdf } from '@/lib/pdf/dispatcher'
import { readFile } from '@/lib/storage'

describe('GET /api/returns/[id]/pdf', () => {
  beforeAll(async () => {
    await seedReferenceData()
  })

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-jwt-secret-32-chars-minimum-aaaaaaaa'
    vi.mocked(loadFilingData).mockReset()
    vi.mocked(renderFilingPdf).mockReset()
    vi.mocked(readFile).mockReset()
  })

  it('serves the stored filing PDF for a FILED return so the verifier hash matches', async () => {
    const { user, taxYear } = await createTaxpayerWithYear({
      year: 2026,
      corIncludes2551Q: true,
    })
    const ret = await prisma.taxReturn.findFirstOrThrow({
      where: { taxYearId: taxYear.id, sequenceOrder: 1 },
    })
    const pdfPath = `returns/${taxYear.id}/${ret.id}/generated.pdf`

    vi.mocked(loadFilingData).mockResolvedValue({
      ret: {
        id: ret.id,
        formType: 'FORM_2551Q',
        quarter: 1,
        status: 'FILED',
        pdfPath,
      },
      taxYear: { year: 2026 },
    } as Awaited<ReturnType<typeof loadFilingData>>)

    vi.mocked(readFile).mockResolvedValue(storedPdf)

    mockSession.current = { sub: user.id, username: user.username, role: 'TAXPAYER' }

    const res = await GET(
      new Request(`http://localhost/api/returns/${ret.id}/pdf`),
      { params: Promise.resolve({ id: ret.id }) }
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(res.headers.get('Content-Disposition')).toMatch(/attachment/)

    const body = Buffer.from(await res.arrayBuffer())
    expect(body.toString()).toBe(storedPdf.toString())
    expect(readFile).toHaveBeenCalledWith(pdfPath)
    expect(renderFilingPdf).not.toHaveBeenCalled()
  })

  it('falls back to regenerating the PDF when no stored pdfPath exists', async () => {
    const { user, taxYear } = await createTaxpayerWithYear({
      year: 2026,
      corIncludes2551Q: true,
    })
    const ret = await prisma.taxReturn.findFirstOrThrow({
      where: { taxYearId: taxYear.id, sequenceOrder: 1 },
    })

    vi.mocked(loadFilingData).mockResolvedValue({
      ret: {
        id: ret.id,
        formType: 'FORM_2551Q',
        quarter: 1,
        status: 'GENERATED',
        pdfPath: null,
      },
      taxYear: { year: 2026 },
    } as Awaited<ReturnType<typeof loadFilingData>>)

    mockSession.current = { sub: user.id, username: user.username, role: 'TAXPAYER' }

    const res = await GET(
      new Request(`http://localhost/api/returns/${ret.id}/pdf`),
      { params: Promise.resolve({ id: ret.id }) }
    )

    expect(res.status).toBe(200)
    const body = Buffer.from(await res.arrayBuffer())
    expect(body.toString()).toBe(regeneratedPdf.toString())
    expect(renderFilingPdf).toHaveBeenCalledWith(ret.id, user.id)
    expect(readFile).not.toHaveBeenCalled()
  })

  it('returns 404 when the stored filing PDF is missing from disk for a FILED return', async () => {
    const { user, taxYear } = await createTaxpayerWithYear({
      year: 2026,
      corIncludes2551Q: true,
    })
    const ret = await prisma.taxReturn.findFirstOrThrow({
      where: { taxYearId: taxYear.id, sequenceOrder: 1 },
    })
    const pdfPath = `returns/${taxYear.id}/${ret.id}/generated.pdf`

    vi.mocked(loadFilingData).mockResolvedValue({
      ret: {
        id: ret.id,
        formType: 'FORM_2551Q',
        quarter: 1,
        status: 'FILED',
        pdfPath,
      },
      taxYear: { year: 2026 },
    } as Awaited<ReturnType<typeof loadFilingData>>)

    vi.mocked(readFile).mockRejectedValue(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    )

    mockSession.current = { sub: user.id, username: user.username, role: 'TAXPAYER' }

    const res = await GET(
      new Request(`http://localhost/api/returns/${ret.id}/pdf`),
      { params: Promise.resolve({ id: ret.id }) }
    )

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/Filing PDF not found in storage/)
    expect(readFile).toHaveBeenCalledWith(pdfPath)
    expect(renderFilingPdf).not.toHaveBeenCalled()
  })

  it('returns 404 when a FILED return has no stored pdfPath', async () => {
    const { user, taxYear } = await createTaxpayerWithYear({
      year: 2026,
      corIncludes2551Q: true,
    })
    const ret = await prisma.taxReturn.findFirstOrThrow({
      where: { taxYearId: taxYear.id, sequenceOrder: 1 },
    })

    vi.mocked(loadFilingData).mockResolvedValue({
      ret: {
        id: ret.id,
        formType: 'FORM_2551Q',
        quarter: 1,
        status: 'FILED',
        pdfPath: null,
      },
      taxYear: { year: 2026 },
    } as Awaited<ReturnType<typeof loadFilingData>>)

    mockSession.current = { sub: user.id, username: user.username, role: 'TAXPAYER' }

    const res = await GET(
      new Request(`http://localhost/api/returns/${ret.id}/pdf`),
      { params: Promise.resolve({ id: ret.id }) }
    )

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/Filing PDF is not stored/)
    expect(readFile).not.toHaveBeenCalled()
    expect(renderFilingPdf).not.toHaveBeenCalled()
  })

  it('regenerates a preview when preview=1 and the stored filing PDF is missing', async () => {
    const { user, taxYear } = await createTaxpayerWithYear({
      year: 2026,
      corIncludes2551Q: true,
    })
    const ret = await prisma.taxReturn.findFirstOrThrow({
      where: { taxYearId: taxYear.id, sequenceOrder: 1 },
    })
    const pdfPath = `returns/${taxYear.id}/${ret.id}/generated.pdf`

    vi.mocked(loadFilingData).mockResolvedValue({
      ret: {
        id: ret.id,
        formType: 'FORM_2551Q',
        quarter: 1,
        status: 'FILED',
        pdfPath,
      },
      taxYear: { year: 2026 },
    } as Awaited<ReturnType<typeof loadFilingData>>)

    vi.mocked(readFile).mockRejectedValue(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    )
    vi.mocked(renderFilingPdf).mockResolvedValue(regeneratedPdf)

    mockSession.current = { sub: user.id, username: user.username, role: 'TAXPAYER' }

    const res = await GET(
      new Request(`http://localhost/api/returns/${ret.id}/pdf?preview=1`),
      { params: Promise.resolve({ id: ret.id }) }
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('X-Kuwenta-Preview')).toBe('regenerated')
    const body = Buffer.from(await res.arrayBuffer())
    expect(body.toString()).toBe(regeneratedPdf.toString())
    expect(readFile).toHaveBeenCalledWith(pdfPath)
    expect(renderFilingPdf).toHaveBeenCalledWith(ret.id, user.id)
  })

  it('regenerates a preview when preview=1 and the FILED return has no stored pdfPath', async () => {
    const { user, taxYear } = await createTaxpayerWithYear({
      year: 2026,
      corIncludes2551Q: true,
    })
    const ret = await prisma.taxReturn.findFirstOrThrow({
      where: { taxYearId: taxYear.id, sequenceOrder: 1 },
    })

    vi.mocked(loadFilingData).mockResolvedValue({
      ret: {
        id: ret.id,
        formType: 'FORM_2551Q',
        quarter: 1,
        status: 'FILED',
        pdfPath: null,
      },
      taxYear: { year: 2026 },
    } as Awaited<ReturnType<typeof loadFilingData>>)

    vi.mocked(renderFilingPdf).mockResolvedValue(regeneratedPdf)

    mockSession.current = { sub: user.id, username: user.username, role: 'TAXPAYER' }

    const res = await GET(
      new Request(`http://localhost/api/returns/${ret.id}/pdf?preview=1`),
      { params: Promise.resolve({ id: ret.id }) }
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('X-Kuwenta-Preview')).toBe('regenerated')
    const body = Buffer.from(await res.arrayBuffer())
    expect(body.toString()).toBe(regeneratedPdf.toString())
    expect(readFile).not.toHaveBeenCalled()
    expect(renderFilingPdf).toHaveBeenCalledWith(ret.id, user.id)
  })

  it('serves the stored filing PDF with preview=1 when it exists', async () => {
    const { user, taxYear } = await createTaxpayerWithYear({
      year: 2026,
      corIncludes2551Q: true,
    })
    const ret = await prisma.taxReturn.findFirstOrThrow({
      where: { taxYearId: taxYear.id, sequenceOrder: 1 },
    })
    const pdfPath = `returns/${taxYear.id}/${ret.id}/generated.pdf`

    vi.mocked(loadFilingData).mockResolvedValue({
      ret: {
        id: ret.id,
        formType: 'FORM_2551Q',
        quarter: 1,
        status: 'FILED',
        pdfPath,
      },
      taxYear: { year: 2026 },
    } as Awaited<ReturnType<typeof loadFilingData>>)

    vi.mocked(readFile).mockResolvedValue(storedPdf)

    mockSession.current = { sub: user.id, username: user.username, role: 'TAXPAYER' }

    const res = await GET(
      new Request(`http://localhost/api/returns/${ret.id}/pdf?preview=1`),
      { params: Promise.resolve({ id: ret.id }) }
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('X-Kuwenta-Preview')).toBe('stored')
    const body = Buffer.from(await res.arrayBuffer())
    expect(body.toString()).toBe(storedPdf.toString())
    expect(readFile).toHaveBeenCalledWith(pdfPath)
    expect(renderFilingPdf).not.toHaveBeenCalled()
  })

  it('returns 401 when unauthenticated', async () => {
    mockSession.current = null

    const res = await GET(
      new Request('http://localhost/api/returns/ret-123/pdf'),
      { params: Promise.resolve({ id: 'ret-123' }) }
    )

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toEqual({ error: 'Unauthorized' })
  })
})
