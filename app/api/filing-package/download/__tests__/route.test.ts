import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest'
import JSZip from 'jszip'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/testing/db'
import {
  createTaxpayerWithYear,
  seedReferenceData,
  createForm2307,
  createATCCode,
} from '@/lib/testing/factories'

vi.mock('@/lib/storage', () => ({
  writeFile: vi.fn().mockResolvedValue('returns/x/generated.pdf'),
  readFile: vi.fn().mockResolvedValue(Buffer.from('pdf')),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  getStoragePath: vi.fn().mockReturnValue('./storage'),
  getStorageType: vi.fn().mockReturnValue('local'),
  checkStorageHealth: vi.fn().mockResolvedValue({
    ok: true,
    type: 'local',
    path: './storage',
    writable: true,
    message: 'ok',
  }),
}))

vi.mock('@/lib/stellar/anchor', () => ({
  anchorFilingReceipt: vi.fn().mockResolvedValue({
    stellarTxId: 'tx-test',
    payloadHash: 'abc',
    explorerUrl: 'https://stellar.expert/explorer/testnet/tx/tx-test',
    status: 'CONFIRMED',
  }),
  storeFilingPackage: vi.fn().mockResolvedValue('returns/x/generated.pdf'),
  retryAnchorFilingReceipt: vi.fn(),
}))

vi.mock('@/lib/pdf/cover-sheet', () => ({
  CoverSheet: () =>
    // @react-pdf/renderer expects a React element with `props`; return a minimal
    // placeholder that renderToBuffer can serialise.
    ({ type: 'Document', props: { children: null } } as unknown as ReturnType<
      typeof import('@/lib/pdf/cover-sheet').CoverSheet
    >),
}))

vi.mock('@react-pdf/renderer', () => ({
  renderToBuffer: vi.fn(async () => Buffer.from('%PDF-1.4\nfake pdf body')),
}))

vi.mock('@/lib/pdf/dispatcher', () => ({
  renderFilingPdf: vi.fn(async () => Buffer.from('%PDF-1.4\nfake pdf body')),
  loadFilingData: vi.fn(),
}))

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

const ZIP_LOCAL_HEADER = 0x04034b50 // 'PK\x03\x04'
const ZIP_EMPTY_ARCHIVE = 0x06054b50 // 'PK\x05\x06'

function isValidZip(buf: Buffer): boolean {
  if (buf.length < 22) return false
  const magic = buf.readUInt32LE(0)
  return magic === ZIP_LOCAL_HEADER || magic === ZIP_EMPTY_ARCHIVE
}

async function fileAllReturns(taxYearId: string): Promise<string[]> {
  const returns = await prisma.taxReturn.findMany({
    where: { taxYearId },
    orderBy: { sequenceOrder: 'asc' },
  })
  for (const ret of returns) {
    await prisma.taxReturn.update({
      where: { id: ret.id },
      data: { status: 'FILED', filedDate: new Date(), generatedAt: new Date() },
    })
  }
  return returns.map((r) => r.id)
}

describe('GET /api/filing-package/download', () => {
  beforeAll(async () => {
    await seedReferenceData()
  })

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-jwt-secret-32-chars-minimum-aaaaaaaa'
  })

  it('returns a real ZIP for a fully-filed 8-return tax year', async () => {
    const { user, taxYear } = await createTaxpayerWithYear({
      year: 2026,
      corIncludes2551Q: true,
    })
    const atc = await createATCCode({ code: 'WI010', ewtRate: 0.1 })
    await createForm2307(taxYear.id, atc.code, {
      quarter: 1,
      quarterlyTotal: 100000,
      cwtWithheld: 10000,
    })
    await fileAllReturns(taxYear.id)

    mockSession.current = { sub: user.id, username: user.username, role: 'TAXPAYER' }

    const req = new NextRequest('http://localhost/api/filing-package/download')
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/zip')
    const disposition = res.headers.get('Content-Disposition') ?? ''
    expect(disposition).toMatch(/attachment;\s*filename="filing-package-2026\.zip"/)

    const buf = Buffer.from(await res.arrayBuffer())
    expect(buf.length).toBeGreaterThan(0)
    expect(isValidZip(buf)).toBe(true)

    const zip = await JSZip.loadAsync(buf)
    const names = Object.keys(zip.files).sort()

    expect(names).toContain('cover-sheet.pdf')
    expect(names).toContain('SAWT-2026.csv')

    const returnPdfs = names.filter((n) => /^(2551Q|1701Q|1701A)-\w+-\d{4}\.pdf$/.test(n))
    expect(returnPdfs).toHaveLength(8)

    const cover = await zip.file('cover-sheet.pdf')!.async('nodebuffer')
    expect(cover.toString('utf8')).toContain('%PDF-1.4')

    const sawt = await zip.file('SAWT-2026.csv')!.async('string')
    expect(sawt).toContain('Quarter,PayorTIN,PayorName,ATC,GrossIncome,CWTWithheld')
    expect(sawt).toContain('1,123-456-789-000,Test Payor,WI010,100000.00,10000.00')
  })

  it('returns a 400 when no returns are filed', async () => {
    const { user } = await createTaxpayerWithYear({
      year: 2026,
      corIncludes2551Q: true,
    })
    mockSession.current = { sub: user.id, username: user.username, role: 'TAXPAYER' }

    const req = new NextRequest('http://localhost/api/filing-package/download')
    const res = await GET(req)

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body).toMatchObject({ error: expect.stringMatching(/filed/i) })
  })

  it('returns 401 when unauthenticated', async () => {
    mockSession.current = null

    const req = new NextRequest('http://localhost/api/filing-package/download')
    const res = await GET(req)

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toMatchObject({ error: 'Unauthorized' })
  })
})
