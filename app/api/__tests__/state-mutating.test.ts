import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/testing/db'
import {
  createUser,
  createTaxpayerWithYear,
  seedReferenceData,
  createForm2307,
  createPriorYearCredit,
  createOverpayment,
  createRDOPenaltySchedule,
} from '@/lib/testing/factories'

// Heavy external / side-effect modules are stubbed at the module boundary
// so the integration test exercises the route's own orchestration logic
// (validation, prisma writes, audit log, recascade, etc.) without
// hitting the filesystem, Horizon, or @react-pdf/renderer.

vi.mock('@/lib/storage', () => ({
  writeFile: vi.fn(async (path: string) => path),
  readFile: vi.fn(async () => Buffer.from('pdf-stub')),
  deleteFile: vi.fn(async () => undefined),
  getStorageRoot: vi.fn(() => './storage'),
  checkStorageHealth: vi.fn(async () => ({
    ok: true,
    type: 'local' as const,
    path: './storage',
    writable: true,
    message: 'ok',
  })),
}))

vi.mock('@/lib/stellar/anchor', () => ({
  anchorFilingReceipt: vi.fn(async (returnId: string) => ({
    stellarTxId: `tx-${returnId}`,
    payloadHash: 'a'.repeat(64),
    explorerUrl: `https://stellar.expert/explorer/testnet/tx/tx-${returnId}`,
    status: 'CONFIRMED' as const,
  })),
  storeFilingPackage: vi.fn(async (taxYearId: string, returnId: string) =>
    `returns/${taxYearId}/${returnId}/generated.pdf`
  ),
  retryAnchorFilingReceipt: vi.fn(async (returnId: string) => ({
    stellarTxId: `tx-retry-${returnId}`,
    payloadHash: 'b'.repeat(64),
    explorerUrl: `https://stellar.expert/explorer/testnet/tx/tx-retry-${returnId}`,
    status: 'CONFIRMED' as const,
  })),
}))

vi.mock('@/lib/pdf/dispatcher', () => ({
  renderFilingPdf: vi.fn(async () => Buffer.from('pdf-stub-bytes')),
  renderFilingPackageZip: vi.fn(async () => Buffer.from('zip-stub')),
}))

// Routes that call `requireAuth()` without forwarding the NextRequest end
// up calling `cookies()` from next/headers, which throws outside a request
// scope. We mock `requireAuth` itself so each request's JWT is decoded
// here without touching the Next.js request scope.
const sessionStore = vi.hoisted(() => ({
  current: null as null | {
    sub: string
    username: string
    role: 'ADMIN' | 'TAXPAYER'
    iat: number
    exp: number
  },
}))

vi.mock('@/lib/auth/session', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('@/lib/auth/session')
  return {
    ...actual,
    signToken: actual.signToken,
    requireAuth: vi.fn(async () => sessionStore.current),
  }
})

// Wrap helpers so each test can set the session BEFORE the route runs.
function authedSession(userId: string, username: string, role: 'ADMIN' | 'TAXPAYER' = 'TAXPAYER') {
  sessionStore.current = {
    sub: userId,
    username,
    role,
    iat: 1,
    exp: 9999999999,
  }
}

function clearSession() {
  sessionStore.current = null
}

// Re-import the route handlers after the vi.mock declarations so they
// pick up the mocked module surfaces.
import { POST as generateReturn } from '@/app/api/returns/[id]/generate/route'
import { POST as fileReturn } from '@/app/api/returns/[id]/file/route'
import { PATCH as patchOverpayment } from '@/app/api/overpayment/[taxYear]/route'
import { POST as createPriorYearCreditRoute } from '@/app/api/prior-year-credit/route'
import { POST as retryStellarReceipt } from '@/app/api/stellar/receipts/[id]/retry/route'
import { POST as regenerateJournal } from '@/app/api/journal/generate/route'

beforeEach(async () => {
  process.env.JWT_SECRET = 'test-jwt-secret-32-chars-minimum-aaaaaaaa'
  clearSession()
  await prisma.$transaction([
    prisma.journalLine.deleteMany(),
    prisma.journalEntry.deleteMany(),
    prisma.stellarReceipt.deleteMany(),
    prisma.returnPenalty.deleteMany(),
    prisma.taxReturn.deleteMany(),
    prisma.form2307.deleteMany(),
    prisma.priorYearCredit.deleteMany(),
    prisma.overpayment.deleteMany(),
    prisma.taxYear.deleteMany(),
    prisma.taxpayerATC.deleteMany(),
    prisma.taxpayerProfile.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.user.deleteMany(),
    prisma.aTCCode.deleteMany(),
    prisma.rDOPenaltySchedule.deleteMany(),
    prisma.publicHoliday.deleteMany(),
  ])
  await seedReferenceData()
  await createRDOPenaltySchedule({ rdoCode: '040', compromiseFee: 500 })
})

function _postRequest(path: string) {
  return new NextRequest(`http://localhost${path}`, { method: 'POST' })
}
void _postRequest

async function authedRequest(path: string, init?: RequestInit & { userId?: string; username?: string }) {
  const userId = init?.userId ?? 'test-user'
  const username = init?.username ?? 'tester'
  authedSession(userId, username)
  return new NextRequest(`http://localhost${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
}

function unauthRequest(path: string) {
  clearSession()
  return new NextRequest(`http://localhost${path}`, { method: 'POST' })
}

describe('POST /api/returns/[id]/generate (S9.1)', () => {
  it('transitions a PENDING 2551Q Q1 to GENERATED with generatedAt set', async () => {
    const { user, taxYear } = await createTaxpayerWithYear({ year: 2026, corIncludes2551Q: true })
    const ret = await prisma.taxReturn.findFirstOrThrow({
      where: { taxYearId: taxYear.id, sequenceOrder: 1 },
    })

    const req = await authedRequest(`/api/returns/${ret.id}/generate`, { userId: user.id, username: user.username })
    const res = await generateReturn(req, { params: Promise.resolve({ id: ret.id }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ success: true, status: 'GENERATED' })

    const updated = await prisma.taxReturn.findUnique({ where: { id: ret.id } })
    expect(updated?.status).toBe('GENERATED')
    expect(updated?.generatedAt).not.toBeNull()
  })

  it('returns 404 when the return id is not in the user tax year', async () => {
    const { user } = await createTaxpayerWithYear()
    const req = await authedRequest('/api/returns/does-not-exist/generate', {
      userId: user.id,
      username: user.username,
    })
    const res = await generateReturn(req, { params: Promise.resolve({ id: 'does-not-exist' }) })
    expect(res.status).toBe(404)
  })

  it('returns 401 when no JWT is present', async () => {
    const { taxYear } = await createTaxpayerWithYear()
    const ret = await prisma.taxReturn.findFirstOrThrow({ where: { taxYearId: taxYear.id } })
    const res = await generateReturn(unauthRequest(`/api/returns/${ret.id}/generate`), {
      params: Promise.resolve({ id: ret.id }),
    })
    expect(res.status).toBe(401)
  })

  it('blocks FORM_1701A generation for mixed-income earners (BR-13)', async () => {
    const { user, taxYear } = await createTaxpayerWithYear({
      year: 2026,
      corIncludes2551Q: true,
      incomeType: 'MIXED_INCOME',
    })
    // Mixed-income earners get a FORM_1701 slot, not FORM_1701A. We
    // attempt to generate on a manually-inserted FORM_1701A row to
    // confirm the route blocks the cross-field guard.
    const blockCandidate = await prisma.taxReturn.create({
      data: {
        taxYearId: taxYear.id,
        formType: 'FORM_1701A',
        sequenceOrder: 99,
        statutoryDueDate: new Date('2027-04-15'),
        status: 'PENDING',
      },
    })

    const req = await authedRequest(`/api/returns/${blockCandidate.id}/generate`, {
      userId: user.id,
      username: user.username,
    })
    const res = await generateReturn(req, { params: Promise.resolve({ id: blockCandidate.id }) })
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.error).toMatch(/Form 1701/i)
  })
})

describe('POST /api/returns/[id]/file (S9.1)', () => {
  it('files a 2551Q Q1: marks FILED, persists PDF path, creates StellarReceipt and audit log', async () => {
    const { user, taxYear } = await createTaxpayerWithYear({ year: 2026, corIncludes2551Q: true })
    const ret = await prisma.taxReturn.findFirstOrThrow({
      where: { taxYearId: taxYear.id, sequenceOrder: 1 },
    })

    const req = await authedRequest(`/api/returns/${ret.id}/file`, { userId: user.id, username: user.username })
    const res = await fileReturn(req, { params: Promise.resolve({ id: ret.id }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.return.status).toBe('FILED')
    expect(body.return.filedDate).toBeTruthy()
    expect(body.stellar.status).toBe('CONFIRMED')
    expect(body.stellar.txId).toContain(ret.id)

    const updated = await prisma.taxReturn.findUniqueOrThrow({ where: { id: ret.id } })
    expect(updated.status).toBe('FILED')
    expect(updated.pdfPath).toBe(`returns/${taxYear.id}/${ret.id}/generated.pdf`)

    const receipt = await prisma.stellarReceipt.findUniqueOrThrow({ where: { returnId: ret.id } })
    expect(receipt.status).toBe('CONFIRMED')
    expect(receipt.payloadHash).toMatch(/^[a-f0-9]{64}$/)

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: 'TaxReturn', entityId: ret.id, action: 'RETURN_FILED' },
    })
    expect(audit).not.toBeNull()
  })

  it('returns 409 when attempting to refile an already-FILED return', async () => {
    const { user, taxYear } = await createTaxpayerWithYear({ year: 2026, corIncludes2551Q: true })
    const ret = await prisma.taxReturn.findFirstOrThrow({ where: { taxYearId: taxYear.id, sequenceOrder: 1 } })
    await prisma.taxReturn.update({ where: { id: ret.id }, data: { status: 'FILED' } })

    const req = await authedRequest(`/api/returns/${ret.id}/file`, { userId: user.id, username: user.username })
    const res = await fileReturn(req, { params: Promise.resolve({ id: ret.id }) })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/already filed/i)
  })

  it('returns 409 when predecessors are not yet filed (sequence enforcement)', async () => {
    const { user, taxYear } = await createTaxpayerWithYear({ year: 2026, corIncludes2551Q: true })
    const ret = await prisma.taxReturn.findFirstOrThrow({
      where: { taxYearId: taxYear.id, sequenceOrder: 5 }, // 1701Q Q1
    })

    const req = await authedRequest(`/api/returns/${ret.id}/file`, { userId: user.id, username: user.username })
    const res = await fileReturn(req, { params: Promise.resolve({ id: ret.id }) })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/Predecessor/)
  })

  it('returns 409 when the annual return has overpayment but no disposition is set', async () => {
    const { user, taxYear } = await createTaxpayerWithYear({ year: 2026, corIncludes2551Q: true })

    // Mark every 2551Q + 1701Q as FILED so the annual 1701A is unblocked.
    // The recascade call inside the route respects existing FILED status.
    const allQuarterly = await prisma.taxReturn.findMany({
      where: {
        taxYearId: taxYear.id,
        formType: { in: ['FORM_2551Q', 'FORM_1701Q'] },
      },
    })
    for (const q of allQuarterly) {
      await prisma.taxReturn.update({ where: { id: q.id }, data: { status: 'FILED' } })
    }

    const annual = await prisma.taxReturn.findFirstOrThrow({
      where: { taxYearId: taxYear.id, formType: 'FORM_1701A' },
    })
    await prisma.taxReturn.update({
      where: { id: annual.id },
      data: { overpaymentAmt: 1000, status: 'PENDING' },
    })

    const req = await authedRequest(`/api/returns/${annual.id}/file`, { userId: user.id, username: user.username })
    const res = await fileReturn(req, { params: Promise.resolve({ id: annual.id }) })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/disposition/)
  })

  it('returns 404 when the return id is not in the user tax year', async () => {
    const { user } = await createTaxpayerWithYear()
    const req = await authedRequest('/api/returns/missing-return/file', {
      userId: user.id,
      username: user.username,
    })
    const res = await fileReturn(req, { params: Promise.resolve({ id: 'missing-return' }) })
    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/overpayment/[taxYear] (S9.1)', () => {
  it('records REFUND_RECEIVED, persists reference and timestamp, writes audit log', async () => {
    const { user, taxYear } = await createTaxpayerWithYear({ year: 2026, corIncludes2551Q: true })
    await createOverpayment(taxYear.id, { disposition: 'REFUND', amount: 5000 })

    const req = await authedRequest(`/api/overpayment/${taxYear.year}`, {
      method: 'PATCH',
      body: JSON.stringify({
        event: 'REFUND_RECEIVED',
        reference: 'BIR-REF-12345',
      }),
      userId: user.id,
      username: user.username,
    })
    const res = await patchOverpayment(req, { params: Promise.resolve({ taxYear: String(taxYear.year) }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.overpayment.refundReference).toBe('BIR-REF-12345')
    expect(body.overpayment.refundReceivedAt).toBeTruthy()

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'OVERPAYMENT_REFUND_RECEIVED' },
    })
    expect(audit).not.toBeNull()
  })

  it('rejects REFUND_RECEIVED when the disposition is not REFUND', async () => {
    const { user, taxYear } = await createTaxpayerWithYear({ year: 2026, corIncludes2551Q: true })
    await createOverpayment(taxYear.id, { disposition: 'CARRY_OVER', amount: 5000 })

    const req = await authedRequest(`/api/overpayment/${taxYear.year}`, {
      method: 'PATCH',
      body: JSON.stringify({ event: 'REFUND_RECEIVED' }),
      userId: user.id,
      username: user.username,
    })
    const res = await patchOverpayment(req, { params: Promise.resolve({ taxYear: String(taxYear.year) }) })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/REFUND/i)
  })

  it('records TCC_APPLIED with tccNumber and appliedAt', async () => {
    const { user, taxYear } = await createTaxpayerWithYear({ year: 2026, corIncludes2551Q: true })
    await createOverpayment(taxYear.id, { disposition: 'TAX_CREDIT_CERTIFICATE', amount: 1000 })

    const req = await authedRequest(`/api/overpayment/${taxYear.year}`, {
      method: 'PATCH',
      body: JSON.stringify({
        event: 'TCC_APPLIED',
        tccNumber: 'TCC-001',
        appliedAt: '2026-04-15T10:00:00Z',
      }),
      userId: user.id,
      username: user.username,
    })
    const res = await patchOverpayment(req, { params: Promise.resolve({ taxYear: String(taxYear.year) }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.overpayment.tccNumber).toBe('TCC-001')
    expect(body.overpayment.tccAppliedAt).toBeTruthy()
  })

  it('rejects an unknown event', async () => {
    const { user, taxYear } = await createTaxpayerWithYear({ year: 2026, corIncludes2551Q: true })
    await createOverpayment(taxYear.id, { disposition: 'CARRY_OVER', amount: 1000 })

    const req = await authedRequest(`/api/overpayment/${taxYear.year}`, {
      method: 'PATCH',
      body: JSON.stringify({ event: 'NOT_A_REAL_EVENT' }),
      userId: user.id,
      username: user.username,
    })
    const res = await patchOverpayment(req, { params: Promise.resolve({ taxYear: String(taxYear.year) }) })
    expect(res.status).toBe(400)
  })

  it('returns 404 when there is no overpayment disposition on file', async () => {
    const { user, taxYear } = await createTaxpayerWithYear({ year: 2026, corIncludes2551Q: true })
    const req = await authedRequest(`/api/overpayment/${taxYear.year}`, {
      method: 'PATCH',
      body: JSON.stringify({ event: 'REFUND_RECEIVED' }),
      userId: user.id,
      username: user.username,
    })
    const res = await patchOverpayment(req, { params: Promise.resolve({ taxYear: String(taxYear.year) }) })
    expect(res.status).toBe(404)
  })
})

describe('POST /api/prior-year-credit (S9.1)', () => {
  it('creates a CARRY_OVER prior-year credit and writes the 9.10 journal entry', async () => {
    const { user, taxYear } = await createTaxpayerWithYear({ year: 2026, corIncludes2551Q: true })

    const req = await authedRequest('/api/prior-year-credit', {
      method: 'POST',
      body: JSON.stringify({
        amount: '5000.00',
        originYear: 2025,
        originForm: 'FORM_1701A',
        priorDisposition: 'CARRY_OVER',
      }),
      userId: user.id,
      username: user.username,
    })
    const res = await createPriorYearCreditRoute(req)
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.priorYearCredit.amount.toString()).toContain('5000')
    expect(body.priorYearCredit.originYear).toBe(2025)
    expect(body.priorYearCredit.isValidated).toBe(true)

    const journal = await prisma.journalEntry.findFirst({
      where: { taxYearId: taxYear.id, subsection: '9D' },
    })
    expect(journal).not.toBeNull()
  })

  it('rejects originYear >= currentTaxYear', async () => {
    const { user } = await createTaxpayerWithYear({ year: 2026, corIncludes2551Q: true })
    const req = await authedRequest('/api/prior-year-credit', {
      method: 'POST',
      body: JSON.stringify({
        amount: '100',
        originYear: 2026,
        originForm: '1701A',
        priorDisposition: 'CARRY_OVER',
      }),
      userId: user.id,
      username: user.username,
    })
    const res = await createPriorYearCreditRoute(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Origin year/)
  })

  it('rejects dispositions other than CARRY_OVER (BR-09)', async () => {
    const { user } = await createTaxpayerWithYear({ year: 2026, corIncludes2551Q: true })
    const req = await authedRequest('/api/prior-year-credit', {
      method: 'POST',
      body: JSON.stringify({
        amount: '100',
        originYear: 2025,
        originForm: '1701A',
        priorDisposition: 'REFUND',
      }),
      userId: user.id,
      username: user.username,
    })
    const res = await createPriorYearCreditRoute(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Carry Over/i)
  })

  it('rejects a zero or negative amount', async () => {
    const { user } = await createTaxpayerWithYear({ year: 2026, corIncludes2551Q: true })
    const req = await authedRequest('/api/prior-year-credit', {
      method: 'POST',
      body: JSON.stringify({
        amount: '0',
        originYear: 2025,
        originForm: '1701A',
        priorDisposition: 'CARRY_OVER',
      }),
      userId: user.id,
      username: user.username,
    })
    const res = await createPriorYearCreditRoute(req)
    expect(res.status).toBe(400)
  })

  it('returns 409 when a prior-year credit already exists for the active tax year', async () => {
    const { user, taxYear } = await createTaxpayerWithYear({ year: 2026, corIncludes2551Q: true })
    await createPriorYearCredit(taxYear.id)

    const req = await authedRequest('/api/prior-year-credit', {
      method: 'POST',
      body: JSON.stringify({
        amount: '500',
        originYear: 2025,
        originForm: '1701A',
        priorDisposition: 'CARRY_OVER',
      }),
      userId: user.id,
      username: user.username,
    })
    const res = await createPriorYearCreditRoute(req)
    expect(res.status).toBe(409)
  })
})

describe('POST /api/stellar/receipts/[id]/retry (S9.1)', () => {
  it('retries a FAILED receipt and updates it to CONFIRMED with audit log entry', async () => {
    const { user, taxYear } = await createTaxpayerWithYear({ year: 2026, corIncludes2551Q: true })
    const ret = await prisma.taxReturn.findFirstOrThrow({
      where: { taxYearId: taxYear.id, sequenceOrder: 1 },
    })
    await prisma.taxReturn.update({
      where: { id: ret.id },
      data: { status: 'FILED', pdfPath: `returns/${taxYear.id}/${ret.id}/generated.pdf` },
    })
    const failed = await prisma.stellarReceipt.create({
      data: {
        returnId: ret.id,
        stellarTxId: `failed-${ret.id}`,
        payloadHash: 'a'.repeat(64),
        network: 'testnet',
        status: 'FAILED',
        explorerUrl: '',
      },
    })

    const req = await authedRequest(`/api/stellar/receipts/${failed.id}/retry`, {
      userId: user.id,
      username: user.username,
    })
    const res = await retryStellarReceipt(req, { params: Promise.resolve({ id: failed.id }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.receipt.status).toBe('CONFIRMED')
    expect(body.receipt.stellarTxId).toContain('tx-retry-')

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'STELLAR_ANCHOR_RETRY', entityId: failed.id },
    })
    expect(audit).not.toBeNull()
  })

  it('returns 409 when the receipt is already CONFIRMED', async () => {
    const { user, taxYear } = await createTaxpayerWithYear({ year: 2026, corIncludes2551Q: true })
    const ret = await prisma.taxReturn.findFirstOrThrow({
      where: { taxYearId: taxYear.id, sequenceOrder: 1 },
    })
    const receipt = await prisma.stellarReceipt.create({
      data: {
        returnId: ret.id,
        stellarTxId: 'tx-confirmed',
        payloadHash: 'a'.repeat(64),
        network: 'testnet',
        status: 'CONFIRMED',
        explorerUrl: 'https://stellar.expert/...',
      },
    })

    const req = await authedRequest(`/api/stellar/receipts/${receipt.id}/retry`, {
      userId: user.id,
      username: user.username,
    })
    const res = await retryStellarReceipt(req, { params: Promise.resolve({ id: receipt.id }) })
    expect(res.status).toBe(409)
  })

  it('returns 404 when the receipt id does not exist', async () => {
    const { user } = await createTaxpayerWithYear()
    const req = await authedRequest('/api/stellar/receipts/missing-receipt/retry', {
      userId: user.id,
      username: user.username,
    })
    const res = await retryStellarReceipt(req, { params: Promise.resolve({ id: 'missing-receipt' }) })
    expect(res.status).toBe(404)
  })

  it('returns 403 when the receipt belongs to another user', async () => {
    const owner = await createTaxpayerWithYear({ year: 2026, corIncludes2551Q: true })
    const ret = await prisma.taxReturn.findFirstOrThrow({
      where: { taxYearId: owner.taxYear.id, sequenceOrder: 1 },
    })
    const receipt = await prisma.stellarReceipt.create({
      data: {
        returnId: ret.id,
        stellarTxId: 'tx-failed',
        payloadHash: 'a'.repeat(64),
        network: 'testnet',
        status: 'FAILED',
        explorerUrl: '',
      },
    })

    const other = await createUser({ username: 'intruder' })
    const req = await authedRequest(`/api/stellar/receipts/${receipt.id}/retry`, {
      userId: other.id,
      username: 'intruder',
    })
    const res = await retryStellarReceipt(req, { params: Promise.resolve({ id: receipt.id }) })
    expect(res.status).toBe(403)
  })
})

describe('POST /api/journal/generate (S9.1)', () => {
  it('regenerates all journal entries for the active tax year and writes audit log', async () => {
    const { user, taxYear } = await createTaxpayerWithYear({ year: 2026, corIncludes2551Q: true })
    const atc = await prisma.aTCCode.findFirstOrThrow()
    await createForm2307(taxYear.id, atc.code, { quarter: 1, quarterlyTotal: 50000, cwtWithheld: 5000 })

    const req = await authedRequest('/api/journal/generate', {
      userId: user.id,
      username: user.username,
    })
    const res = await regenerateJournal(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.taxYear).toBe(taxYear.year)
    expect(body.regeneratedAt).toBeTruthy()

    // The 9A income recognition entries should now be present.
    const entries = await prisma.journalEntry.findMany({
      where: { taxYearId: taxYear.id, subsection: '9A' },
      include: { lines: true },
    })
    expect(entries.length).toBeGreaterThan(0)

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'JOURNAL_ENTRIES_REGENERATED', entityId: taxYear.id },
    })
    expect(audit).not.toBeNull()
  })

  it('returns 404 when the user has no active tax year', async () => {
    const user = await createUser({ username: 'no-year' })
    const req = await authedRequest('/api/journal/generate', { userId: user.id, username: 'no-year' })
    const res = await regenerateJournal(req)
    expect(res.status).toBe(404)
  })

  it('returns 401 when no JWT is present', async () => {
    const res = await regenerateJournal(unauthRequest('/api/journal/generate'))
    expect(res.status).toBe(401)
  })
})
