import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { POST, PUT } from './route'
import { prisma } from '@/lib/testing/db'
import {
  createUser,
  createATCCode,
  seedReferenceData,
  createTaxpayerProfile,
  createTaxpayerWithYear,
} from '@/lib/testing/factories'
import { signToken } from '@/lib/auth/session'

async function makeRequest(userId: string, body: object): Promise<NextRequest> {
  const token = await signToken({ sub: userId, username: 'test', role: 'TAXPAYER' })
  return new NextRequest('http://localhost/api/taxpayer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `kuwenta_session=${token}` },
    body: JSON.stringify(body),
  })
}

async function makePutRequest(userId: string, body: object): Promise<NextRequest> {
  const token = await signToken({ sub: userId, username: 'test', role: 'TAXPAYER' })
  return new NextRequest('http://localhost/api/taxpayer', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: `kuwenta_session=${token}` },
    body: JSON.stringify(body),
  })
}

const basePayload = {
  tin: '123-456-789-999',
  firstName: 'New',
  lastName: 'Registrant',
  middleInitial: 'R',
  rdoCode: '040',
  phoneNumber: '+639171234567',
  email: 'new.registrant@example.com',
  registeredAddress: '123 Test St',
  zipCode: '1200',
  natureOfBusiness: 'Consulting',
  citizenship: 'Filipino',
  civilStatus: 'Single',
  claimingForeignTaxCredits: false,
  incomeType: 'PURE_SELF_EMPLOYMENT',
  corIncludes2551Q: true,
  taxYear: 2026,
}

describe('POST /api/taxpayer', () => {
  it('returns 401 when the request is unauthenticated (S9.3)', async () => {
    const req = new NextRequest('http://localhost/api/taxpayer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(basePayload),
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toEqual({ error: 'Unauthorized' })
  })
  it('pre-confirms 8% election when isNewRegistrant is true', async () => {
    await seedReferenceData()
    const user = await createUser()
    const atc = await createATCCode({ code: 'WI999', ewtRate: 0.1 })

    const req = await makeRequest(user.id, {
      ...basePayload,
      isNewRegistrant: true,
      atcCodes: [atc.code],
    })

    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.profile.isNewRegistrant).toBe(true)

    const taxYear = await prisma.taxYear.findFirst({
      where: { taxpayerId: json.profile.id },
    })
    expect(taxYear?.electionStatus).toBe('ELECTED_8PCT')
    expect(taxYear?.electedRate).toBe('RATE_8PCT')
    expect(taxYear?.electionDate).not.toBeNull()
    expect(taxYear?.electionLockedAt).not.toBeNull()
  })

  it('leaves election as NOT_ELECTED when isNewRegistrant is false', async () => {
    await seedReferenceData()
    const user = await createUser()
    const atc = await createATCCode({ code: 'WI998', ewtRate: 0.1 })

    const req = await makeRequest(user.id, {
      ...basePayload,
      isNewRegistrant: false,
      atcCodes: [atc.code],
    })

    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.profile.isNewRegistrant).toBe(false)

    const taxYear = await prisma.taxYear.findFirst({
      where: { taxpayerId: json.profile.id },
    })
    expect(taxYear?.electionStatus).toBe('NOT_ELECTED')
    expect(taxYear?.electedRate).toBeNull()
  })

  // Regression for #97: Zod's `error.format()` returns a nested
  // `{ _errors, field: { _errors, ... } }` object. Rendering that object
  // directly as a React child throws "Objects are not valid as a React
  // child (found: object with keys {_errors, tin})". The API must return
  // a flat, serializable shape.
  it('returns a flat, serializable error body on validation failure (issue #97)', async () => {
    await seedReferenceData()
    const user = await createUser()

    const req = await makeRequest(user.id, {
      ...basePayload,
      tin: '12345', // invalid: must match NNN-NNN-NNN or NNN-NNN-NNN-NNN
      atcCodes: [], // invalid: at least one required
    })

    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(400)
    // Top-level `error` is a plain string, never an object.
    expect(typeof json.error).toBe('string')
    // Field errors are flat string arrays keyed by field name.
    expect(json.fieldErrors).toBeTypeOf('object')
    expect(Array.isArray(json.fieldErrors.tin)).toBe(true)
    expect(json.fieldErrors.tin[0]).toMatch(/NNN-NNN-NNN/)
    expect(Array.isArray(json.fieldErrors.atcCodes)).toBe(true)
    // No nested `_errors` shape that would crash React.
    expect(json).not.toHaveProperty('_errors')
    expect(json.fieldErrors.tin).not.toHaveProperty('_errors')
  })

  it('accepts a 9-digit TIN and stores it as the 12-digit form (issue #180)', async () => {
    await seedReferenceData()
    const user = await createUser()
    const atc = await createATCCode({ code: 'WI989', ewtRate: 0.1 })

    const req = await makeRequest(user.id, {
      ...basePayload,
      tin: '123-456-789',
      atcCodes: [atc.code],
    })

    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.profile.tin).toBe('123-456-789-000')
  })

  it('persists phone number and email on onboarding (issue #152)', async () => {
    await seedReferenceData()
    const user = await createUser()
    const atc = await createATCCode({ code: 'WI988', ewtRate: 0.1 })

    const req = await makeRequest(user.id, {
      ...basePayload,
      phoneNumber: '09171234567',
      email: 'taxpayer152@example.com',
      atcCodes: [atc.code],
    })

    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.profile.phoneNumber).toBe('09171234567')
    expect(json.profile.email).toBe('taxpayer152@example.com')
  })

  it('rejects an invalid phone number or email with field errors (issue #152)', async () => {
    await seedReferenceData()
    const user = await createUser()

    const req = await makeRequest(user.id, {
      ...basePayload,
      phoneNumber: '12345',
      email: 'not-an-email',
      atcCodes: [],
    })

    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(Array.isArray(json.fieldErrors.phoneNumber)).toBe(true)
    expect(json.fieldErrors.phoneNumber[0]).toMatch(/valid Philippine number/i)
    expect(Array.isArray(json.fieldErrors.email)).toBe(true)
    expect(json.fieldErrors.email[0]).toMatch(/valid email/i)
  })

  it('rejects an unknown Philippine ZIP code with a field error', async () => {
    await seedReferenceData()
    const user = await createUser()
    const atc = await createATCCode({ code: 'WI990', ewtRate: 0.1 })

    const req = await makeRequest(user.id, {
      ...basePayload,
      zipCode: '9999',
      atcCodes: [atc.code],
    })

    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(Array.isArray(json.fieldErrors.zipCode)).toBe(true)
    expect(json.fieldErrors.zipCode[0]).toMatch(/known Philippine ZIP code/i)
  })
  // 4-return path. The onboarding API must persist the flag and
  // initialize exactly 4 TaxReturn slots (3 × 1701Q + 1 × 1701A/1701),
  // not the 8-slot default. See BR-14.
  it('initialises 4 return slots when corIncludes2551Q is false (S7.3 / BR-14)', async () => {
    await seedReferenceData()
    const user = await createUser()
    const atc = await createATCCode({ code: 'WI997', ewtRate: 0.1 })

    const req = await makeRequest(user.id, {
      ...basePayload,
      corIncludes2551Q: false,
      atcCodes: [atc.code],
    })

    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.profile.corIncludes2551Q).toBe(false)

    const taxYear = await prisma.taxYear.findFirst({
      where: { taxpayerId: json.profile.id },
      include: { returns: { orderBy: { sequenceOrder: 'asc' } } },
    })
    expect(taxYear).not.toBeNull()
    expect(taxYear!.returns).toHaveLength(4)

    // 4-return path: 1701Q Q1, Q2, Q3, then 1701A annual. No 2551Q slots.
    expect(taxYear!.returns.map((r) => `${r.formType}:${r.quarter}`)).toEqual([
      'FORM_1701Q:1',
      'FORM_1701Q:2',
      'FORM_1701Q:3',
      'FORM_1701A:null',
    ])
    expect(taxYear!.returns.map((r) => r.sequenceOrder)).toEqual([1, 2, 3, 4])
    expect(taxYear!.returns.find((r) => r.formType === 'FORM_2551Q')).toBeUndefined()
  })

  // S7.3: the inverse — when COR includes 2551Q, the 8-return path is
  // used. This is the regression guard for the 4-return path test above.
  it('initialises 8 return slots when corIncludes2551Q is true', async () => {
    await seedReferenceData()
    const user = await createUser()
    const atc = await createATCCode({ code: 'WI996', ewtRate: 0.1 })

    const req = await makeRequest(user.id, {
      ...basePayload,
      corIncludes2551Q: true,
      atcCodes: [atc.code],
    })

    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(201)

    const taxYear = await prisma.taxYear.findFirst({
      where: { taxpayerId: json.profile.id },
      include: { returns: { orderBy: { sequenceOrder: 'asc' } } },
    })
    expect(taxYear!.returns).toHaveLength(8)
    expect(taxYear!.returns.find((r) => r.formType === 'FORM_2551Q' && r.quarter === 1)).toBeDefined()
  })
})

// #241: already-onboarded users can correct their onboarding answers via
// PUT /api/taxpayer. Covers ATC replacement, structural reconciliation of
// return slots, the GENERATED/FILED guardrail, and the TIN-unique 409.
describe('PUT /api/taxpayer (#241)', () => {
  it('returns 401 when the request is unauthenticated', async () => {
    const req = new NextRequest('http://localhost/api/taxpayer', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumber: '+639171234567' }),
    })
    const res = await PUT(req)
    expect(res.status).toBe(401)
  })

  it('returns 404 when the user has no taxpayer profile', async () => {
    const user = await createUser()
    const res = await PUT(await makePutRequest(user.id, { phoneNumber: '+639171234567' }))
    expect(res.status).toBe(404)
  })

  it('updates non-structural fields and writes an audit log entry', async () => {
    const { user, profile } = await createTaxpayerWithYear({ year: 2026 })

    const res = await PUT(
      await makePutRequest(user.id, {
        phoneNumber: '+639171234999',
        registeredAddress: '456 Updated Ave',
      })
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.restructured).toBe(false)
    expect(json.profile.phoneNumber).toBe('+639171234999')
    expect(json.profile.registeredAddress).toBe('456 Updated Ave')

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'TAXPAYER_PROFILE_UPDATED', entityId: profile.id },
    })
    expect(audit).not.toBeNull()
    expect(audit?.userId).toBe(user.id)
  })

  it('replaces the ATC code set when atcCodes is provided', async () => {
    await seedReferenceData()
    const { user, profile } = await createTaxpayerWithYear({ year: 2026 })
    await prisma.taxpayerATC.create({
      data: { taxpayerId: profile.id, atcCode: 'WI071' },
    })

    const res = await PUT(await makePutRequest(user.id, { atcCodes: ['WI140', 'WI100'] }))
    const json = await res.json()

    expect(res.status).toBe(200)

    const rows = await prisma.taxpayerATC.findMany({
      where: { taxpayerId: profile.id },
      orderBy: { atcCode: 'asc' },
    })
    expect(rows.map((r) => r.atcCode)).toEqual(['WI100', 'WI140'])
    expect(json.profile.atcCodes.map((a: { atcCode: string }) => a.atcCode).sort()).toEqual([
      'WI100',
      'WI140',
    ])
  })

  it('rejects invalid or inactive ATC codes with a 400', async () => {
    await seedReferenceData()
    const { user } = await createTaxpayerWithYear({ year: 2026 })

    const res = await PUT(await makePutRequest(user.id, { atcCodes: ['NOPE'] }))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toMatch(/ATC codes are invalid or inactive/i)
  })

  it('restructures 8 slots to 4 when corIncludes2551Q flips to false', async () => {
    await seedReferenceData()
    const { user, taxYear } = await createTaxpayerWithYear({
      year: 2026,
      corIncludes2551Q: true,
    })

    const res = await PUT(await makePutRequest(user.id, { corIncludes2551Q: false }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.restructured).toBe(true)

    const returns = await prisma.taxReturn.findMany({
      where: { taxYearId: taxYear.id },
      orderBy: { sequenceOrder: 'asc' },
    })
    expect(returns.map((r) => `${r.formType}:${r.quarter}`)).toEqual([
      'FORM_1701Q:1',
      'FORM_1701Q:2',
      'FORM_1701Q:3',
      'FORM_1701A:null',
    ])
    expect(returns.map((r) => r.sequenceOrder)).toEqual([1, 2, 3, 4])

    const profile = await prisma.taxpayerProfile.findUnique({ where: { userId: user.id } })
    expect(profile?.corIncludes2551Q).toBe(false)
  })

  it('restructures 4 slots to 8 when corIncludes2551Q flips to true', async () => {
    await seedReferenceData()
    const { user, taxYear } = await createTaxpayerWithYear({
      year: 2026,
      corIncludes2551Q: false,
    })

    const res = await PUT(await makePutRequest(user.id, { corIncludes2551Q: true }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.restructured).toBe(true)

    const returns = await prisma.taxReturn.findMany({
      where: { taxYearId: taxYear.id },
      orderBy: { sequenceOrder: 'asc' },
    })
    expect(returns).toHaveLength(8)
    expect(returns.map((r) => `${r.formType}:${r.quarter}`)).toEqual([
      'FORM_2551Q:1',
      'FORM_2551Q:2',
      'FORM_2551Q:3',
      'FORM_2551Q:4',
      'FORM_1701Q:1',
      'FORM_1701Q:2',
      'FORM_1701Q:3',
      'FORM_1701A:null',
    ])
  })

  it('switches the annual slot from 1701A to 1701 when incomeType becomes MIXED_INCOME', async () => {
    await seedReferenceData()
    const { user, taxYear } = await createTaxpayerWithYear({
      year: 2026,
      incomeType: 'PURE_SELF_EMPLOYMENT',
    })

    const res = await PUT(await makePutRequest(user.id, { incomeType: 'MIXED_INCOME' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.restructured).toBe(true)

    const returns = await prisma.taxReturn.findMany({
      where: { taxYearId: taxYear.id },
    })
    expect(returns.find((r) => r.formType === 'FORM_1701A')).toBeUndefined()
    const annual = returns.find((r) => r.formType === 'FORM_1701')
    expect(annual).toBeDefined()
    expect(annual?.sequenceOrder).toBe(8)
    // recascadeTaxYear ran: the annual slot carries recomputed values.
    expect(annual?.computedTaxDue).not.toBeNull()

    const profile = await prisma.taxpayerProfile.findUnique({ where: { userId: user.id } })
    expect(profile?.incomeType).toBe('MIXED_INCOME')
  })

  it('switches the annual slot from 1701 back to 1701A when incomeType becomes PURE_SELF_EMPLOYMENT', async () => {
    await seedReferenceData()
    const { user, taxYear } = await createTaxpayerWithYear({
      year: 2026,
      incomeType: 'MIXED_INCOME',
    })

    const res = await PUT(await makePutRequest(user.id, { incomeType: 'PURE_SELF_EMPLOYMENT' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.restructured).toBe(true)

    const returns = await prisma.taxReturn.findMany({
      where: { taxYearId: taxYear.id },
    })
    expect(returns.find((r) => r.formType === 'FORM_1701')).toBeUndefined()
    expect(returns.find((r) => r.formType === 'FORM_1701A')).toBeDefined()
  })

  it('refuses structural changes with a 409 once a return is GENERATED, but still allows non-structural edits', async () => {
    await seedReferenceData()
    const { user, taxYear } = await createTaxpayerWithYear({
      year: 2026,
      corIncludes2551Q: true,
    })
    const firstReturn = await prisma.taxReturn.findFirstOrThrow({
      where: { taxYearId: taxYear.id, sequenceOrder: 1 },
    })
    await prisma.taxReturn.update({
      where: { id: firstReturn.id },
      data: { status: 'GENERATED' },
    })

    const structuralRes = await PUT(await makePutRequest(user.id, { corIncludes2551Q: false }))
    const structuralJson = await structuralRes.json()

    expect(structuralRes.status).toBe(409)
    expect(structuralJson.error).toMatch(/generated or filed/i)

    // Slots untouched.
    const returns = await prisma.taxReturn.findMany({ where: { taxYearId: taxYear.id } })
    expect(returns).toHaveLength(8)

    // Non-structural edits remain accepted.
    const okRes = await PUT(await makePutRequest(user.id, { phoneNumber: '+639171234999' }))
    expect(okRes.status).toBe(200)
  })

  it('refuses structural changes with a 409 once a return is FILED', async () => {
    await seedReferenceData()
    const { user, taxYear } = await createTaxpayerWithYear({ year: 2026 })
    const firstReturn = await prisma.taxReturn.findFirstOrThrow({
      where: { taxYearId: taxYear.id, sequenceOrder: 1 },
    })
    await prisma.taxReturn.update({
      where: { id: firstReturn.id },
      data: { status: 'FILED', filedDate: new Date() },
    })

    const res = await PUT(await makePutRequest(user.id, { incomeType: 'MIXED_INCOME' }))
    expect(res.status).toBe(409)
  })

  it('returns 409 when the new TIN belongs to another taxpayer', async () => {
    const { user } = await createTaxpayerWithYear({ year: 2026 })
    const otherUser = await createUser()
    await createTaxpayerProfile(otherUser.id, { tin: '999-888-777-000' })

    const res = await PUT(await makePutRequest(user.id, { tin: '999-888-777-000' }))
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.error).toMatch(/TIN already registered/i)
  })

  it('returns a 400 field error when claiming foreign tax credits without a foreign tax number', async () => {
    const { user } = await createTaxpayerWithYear({ year: 2026 })

    const res = await PUT(await makePutRequest(user.id, { claimingForeignTaxCredits: true }))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(Array.isArray(json.fieldErrors.foreignTaxNumber)).toBe(true)
    expect(json.fieldErrors.foreignTaxNumber[0]).toMatch(/foreign tax credits/i)
  })
})
