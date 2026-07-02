import { describe, expect, it } from 'vitest'
import {
  adminUsersPatchSchema,
  adminUsersResetSchema,
  atcCreateSchema,
  atcDeleteSchema,
  atcUpdateSchema,
  certificateSchema,
  certificateUpdateSchema,
  electionSchema,
  holidaysBulkImportSchema,
  holidaysBulkRowSchema,
  holidaysCreateSchema,
  holidaysDeleteSchema,
  loginSchema,
  overpaymentDispositionSchema,
  overpaymentSettlementSchema,
  penaltiesSimulateSchema,
  priorYearCreditCreateSchema,
  rdoDeleteSchema,
  rdoUpdateSchema,
  rdoUpsertSchema,
  taxpayerSchema,
  tinRegex,
} from '@/lib/validation/schemas'

// Shorter aliases for the test file body. The canonical names live in
// lib/validation/schemas; this file references them under the names that
// the route handler uses.
const dispositionSchema = overpaymentDispositionSchema
const settlementSchema = overpaymentSettlementSchema
const simulateSchema = penaltiesSimulateSchema

// TIN regex is re-exported from app/api/taxpayer/route.ts; this guard
// is the single source of truth for the NNN-NNN-NNN-NNNN format the
// AGENT.md BR mandates. These tests lock in the regex itself.
describe('TIN regex (S9.2 / AGENT.md BR)', () => {
  it('matches a valid 12-digit TIN with three dashes', () => {
    expect(tinRegex.test('123-456-789-0123')).toBe(true)
    expect(tinRegex.test('000-000-000-0000')).toBe(true)
  })

  it('rejects missing or extra dashes', () => {
    expect(tinRegex.test('1234567890123')).toBe(false)
    expect(tinRegex.test('123-456-7890123')).toBe(false)
    expect(tinRegex.test('123-456-789-012')).toBe(false)
    expect(tinRegex.test('123-456-789-01234')).toBe(false)
  })

  it('rejects non-digit characters', () => {
    expect(tinRegex.test('123-456-789-012a')).toBe(false)
    expect(tinRegex.test('abc-def-ghi-jklm')).toBe(false)
    expect(tinRegex.test(' 123-456-789-0123')).toBe(false)
  })
})

describe('loginSchema (POST /api/auth/login)', () => {
  it('accepts a username and password', () => {
    expect(loginSchema.safeParse({ username: 'maria', password: 'Test1234!' }).success).toBe(true)
  })

  it('rejects an empty username with a field error', () => {
    const result = loginSchema.safeParse({ username: '', password: 'Test1234!' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.username).toBeDefined()
    }
  })

  it('rejects a missing password with a field error', () => {
    const result = loginSchema.safeParse({ username: 'maria' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.password).toBeDefined()
    }
  })
})

describe('taxpayerSchema (POST/PUT /api/taxpayer) — S9.2', () => {
  const valid = {
    tin: '123-456-789-0123',
    firstName: 'Maria',
    lastName: 'Dela Cruz',
    middleInitial: 'S',
    rdoCode: '040',
    registeredAddress: '1 Test St',
    zipCode: '1200',
    natureOfBusiness: 'Consulting',
    incomeType: 'PURE_SELF_EMPLOYMENT' as const,
    corIncludes2551Q: true,
    isNewRegistrant: false,
    atcCodes: ['WI071'],
    taxYear: 2026,
  }

  it('accepts a complete, valid payload', () => {
    expect(taxpayerSchema.safeParse(valid).success).toBe(true)
  })

  it('accepts a payload without middleInitial', () => {
    const { middleInitial: _middleInitial, ...rest } = valid
    void _middleInitial
    expect(taxpayerSchema.safeParse(rest).success).toBe(true)
  })

  it('rejects an invalid TIN with the documented NNN-NNN-NNN-NNNN error', () => {
    const result = taxpayerSchema.safeParse({ ...valid, tin: 'not-a-tin' })
    expect(result.success).toBe(false)
    if (!result.success) {
      const flat = result.error.flatten()
      const tinError = flat.fieldErrors.tin?.[0]
      expect(tinError).toMatch(/NNN-NNN-NNN-NNNN/)
    }
  })

  it('rejects empty first or last name', () => {
    expect(taxpayerSchema.safeParse({ ...valid, firstName: '' }).success).toBe(false)
    expect(taxpayerSchema.safeParse({ ...valid, lastName: '' }).success).toBe(false)
  })

  it('rejects a middleInitial longer than 2 characters', () => {
    expect(taxpayerSchema.safeParse({ ...valid, middleInitial: 'ABC' }).success).toBe(false)
  })

  it('rejects an empty atcCodes array with a custom message', () => {
    const result = taxpayerSchema.safeParse({ ...valid, atcCodes: [] })
    expect(result.success).toBe(false)
    if (!result.success) {
      const flat = result.error.flatten()
      expect(flat.fieldErrors.atcCodes?.[0]).toMatch(/at least one ATC code/i)
    }
  })

  it('rejects an invalid incomeType enum', () => {
    const result = taxpayerSchema.safeParse({ ...valid, incomeType: 'NOT_A_REAL_TYPE' })
    expect(result.success).toBe(false)
  })

  it('rejects an unknown or invalid ZIP code', () => {
    expect(taxpayerSchema.safeParse({ ...valid, zipCode: '9999' }).success).toBe(false)
    expect(taxpayerSchema.safeParse({ ...valid, zipCode: '12' }).success).toBe(false)
    expect(taxpayerSchema.safeParse({ ...valid, zipCode: 'abcd' }).success).toBe(false)
  })

  it('accepts a known Philippine ZIP code', () => {
    expect(taxpayerSchema.safeParse({ ...valid, zipCode: '1200' }).success).toBe(true)
  })

  it('rejects a tax year outside 2000–2100', () => {
    expect(taxpayerSchema.safeParse({ ...valid, taxYear: 1999 }).success).toBe(false)
    expect(taxpayerSchema.safeParse({ ...valid, taxYear: 2101 }).success).toBe(false)
  })

  it('defaults isNewRegistrant to false when omitted', () => {
    const { isNewRegistrant, ...rest } = valid
    expect(isNewRegistrant).toBe(false) // sanity-check the fixture
    const result = taxpayerSchema.safeParse(rest)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.isNewRegistrant).toBe(false)
    }
  })
})

describe('adminUsersPatchSchema (PATCH /api/admin/users)', () => {
  it('accepts a userId + isActive toggle', () => {
    expect(
      adminUsersPatchSchema.safeParse({ userId: 'user-1', isActive: false }).success
    ).toBe(true)
  })

  it('rejects an empty userId', () => {
    const result = adminUsersPatchSchema.safeParse({ userId: '', isActive: false })
    expect(result.success).toBe(false)
  })

  it('rejects a non-boolean isActive', () => {
    const result = adminUsersPatchSchema.safeParse({ userId: 'user-1', isActive: 'yes' })
    expect(result.success).toBe(false)
  })
})

describe('adminUsersResetSchema (POST /api/admin/users reset)', () => {
  it('accepts a non-empty userId', () => {
    expect(adminUsersResetSchema.safeParse({ userId: 'user-1' }).success).toBe(true)
  })

  it('rejects an empty userId', () => {
    expect(adminUsersResetSchema.safeParse({ userId: '' }).success).toBe(false)
  })
})

describe('holidaysCreateSchema (POST /api/admin/holidays)', () => {
  it('accepts a date string + name', () => {
    expect(
      holidaysCreateSchema.safeParse({ date: '2026-01-01', name: 'New Year' }).success
    ).toBe(true)
  })

  it('rejects a non-ISO date', () => {
    const result = holidaysCreateSchema.safeParse({ date: 'January 1', name: 'New Year' })
    expect(result.success).toBe(false)
  })

  it('rejects an empty name', () => {
    const result = holidaysCreateSchema.safeParse({ date: '2026-01-01', name: '' })
    expect(result.success).toBe(false)
  })

  it('rejects a name longer than 255 characters', () => {
    const result = holidaysCreateSchema.safeParse({ date: '2026-01-01', name: 'x'.repeat(256) })
    expect(result.success).toBe(false)
  })
})

describe('holidaysDeleteSchema (DELETE /api/admin/holidays)', () => {
  it('accepts a non-empty id', () => {
    expect(holidaysDeleteSchema.safeParse({ id: 'holiday-1' }).success).toBe(true)
  })

  it('rejects an empty id', () => {
    expect(holidaysDeleteSchema.safeParse({ id: '' }).success).toBe(false)
  })
})

describe('holidaysBulkRowSchema (PUT /api/admin/holidays CSV/JSON)', () => {
  it('accepts a row with date + name and infers year from date', () => {
    const result = holidaysBulkRowSchema.safeParse({ date: '2026-12-25', name: 'Christmas' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.year).toBe(2026)
    }
  })

  it('accepts a row with explicit year as a number', () => {
    const result = holidaysBulkRowSchema.safeParse({
      date: '2026-12-25',
      name: 'Christmas',
      year: 2025,
    })
    expect(result.success).toBe(true)
  })

  it('rejects a year outside 1900–2999', () => {
    const result = holidaysBulkRowSchema.safeParse({
      date: '2026-12-25',
      name: 'Christmas',
      year: 1800,
    })
    expect(result.success).toBe(false)
  })

  it('rejects an invalid date', () => {
    const result = holidaysBulkRowSchema.safeParse({ date: 'not-a-date', name: 'X' })
    expect(result.success).toBe(false)
  })
})

describe('holidaysBulkImportSchema (PUT /api/admin/holidays JSON)', () => {
  it('accepts a rows array with mode defaulting to insert', () => {
    const result = holidaysBulkImportSchema.safeParse({
      rows: [{ date: '2026-12-25', name: 'Christmas' }],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.mode).toBe('insert')
    }
  })

  it('accepts mode upsert when explicitly provided', () => {
    const result = holidaysBulkImportSchema.safeParse({
      rows: [{ date: '2026-12-25', name: 'Christmas' }],
      mode: 'upsert',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.mode).toBe('upsert')
    }
  })

  it('rejects an empty rows array (min 1)', () => {
    expect(holidaysBulkImportSchema.safeParse({ rows: [] }).success).toBe(false)
  })

  it('rejects a rows array longer than 500', () => {
    const rows = Array.from({ length: 501 }, () => ({ date: '2026-12-25', name: 'X' }))
    expect(holidaysBulkImportSchema.safeParse({ rows }).success).toBe(false)
  })

  it('rejects an unknown mode enum', () => {
    const result = holidaysBulkImportSchema.safeParse({
      rows: [{ date: '2026-12-25', name: 'X' }],
      mode: 'replace',
    })
    expect(result.success).toBe(false)
  })
})

describe('simulateSchema (POST /api/penalties/simulate)', () => {
  it('accepts a returnId and ISO date', () => {
    expect(
      simulateSchema.safeParse({ returnId: 'r-1', filedDate: '2026-05-15' }).success
    ).toBe(true)
  })

  it('rejects a non-ISO filedDate', () => {
    const result = simulateSchema.safeParse({ returnId: 'r-1', filedDate: 'May 15 2026' })
    expect(result.success).toBe(false)
  })

  it('rejects an empty returnId', () => {
    expect(
      simulateSchema.safeParse({ returnId: '', filedDate: '2026-05-15' }).success
    ).toBe(false)
  })
})

describe('rdoUpsertSchema (POST /api/admin/rdo-penalties)', () => {
  it('accepts a 3-letter RDO code and positive fee', () => {
    expect(
      rdoUpsertSchema.safeParse({ rdoCode: '040', compromiseFee: '1500.50' }).success
    ).toBe(true)
  })

  it('trims and uppercases the rdoCode', () => {
    const result = rdoUpsertSchema.safeParse({ rdoCode: '  040a ', compromiseFee: '100' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.rdoCode).toBe('040A')
    }
  })

  it('rejects a fee with more than 2 decimal places', () => {
    const result = rdoUpsertSchema.safeParse({ rdoCode: '040', compromiseFee: '100.001' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/2 places/)
    }
  })

  it('rejects a zero fee', () => {
    const result = rdoUpsertSchema.safeParse({ rdoCode: '040', compromiseFee: '0' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/greater than zero/)
    }
  })

  it('rejects a non-numeric fee', () => {
    const result = rdoUpsertSchema.safeParse({ rdoCode: '040', compromiseFee: 'abc' })
    expect(result.success).toBe(false)
  })

  it('rejects an empty rdoCode', () => {
    expect(rdoUpsertSchema.safeParse({ rdoCode: '', compromiseFee: '100' }).success).toBe(false)
  })
})

describe('rdoUpdateSchema (PATCH /api/admin/rdo-penalties)', () => {
  it('accepts an id and positive fee', () => {
    expect(
      rdoUpdateSchema.safeParse({ id: 'sched-1', compromiseFee: '1500' }).success
    ).toBe(true)
  })

  it('rejects an empty id', () => {
    expect(rdoUpdateSchema.safeParse({ id: '', compromiseFee: '100' }).success).toBe(false)
  })

  it('rejects a zero fee with a clearer message', () => {
    const result = rdoUpdateSchema.safeParse({ id: 'sched-1', compromiseFee: '0.00' })
    expect(result.success).toBe(false)
  })
})

describe('rdoDeleteSchema (DELETE /api/admin/rdo-penalties)', () => {
  it('accepts a non-empty id', () => {
    expect(rdoDeleteSchema.safeParse({ id: 'sched-1' }).success).toBe(true)
  })

  it('rejects an empty id', () => {
    expect(rdoDeleteSchema.safeParse({ id: '' }).success).toBe(false)
  })
})

describe('atcCreateSchema (POST /api/admin/atc)', () => {
  it('accepts a code, description, ewtRate, isActive', () => {
    expect(
      atcCreateSchema.safeParse({
        code: 'WI071',
        description: 'Professional fees',
        ewtRate: '0.10',
        isActive: true,
      }).success
    ).toBe(true)
  })

  it('defaults isActive to true when omitted', () => {
    const result = atcCreateSchema.safeParse({
      code: 'WI071',
      description: 'Professional fees',
      ewtRate: '0.10',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.isActive).toBe(true)
    }
  })

  it('rejects an ewtRate with more than 4 decimal places', () => {
    const result = atcCreateSchema.safeParse({
      code: 'WI071',
      description: 'Professional fees',
      ewtRate: '0.12345',
    })
    expect(result.success).toBe(false)
  })

  it('rejects an empty code', () => {
    const result = atcCreateSchema.safeParse({
      code: '',
      description: 'X',
      ewtRate: '0.10',
    })
    expect(result.success).toBe(false)
  })
})

describe('atcUpdateSchema (PATCH /api/admin/atc)', () => {
  it('accepts a code with optional fields', () => {
    expect(
      atcUpdateSchema.safeParse({ code: 'WI071', isActive: false }).success
    ).toBe(true)
  })

  it('rejects an empty code', () => {
    expect(atcUpdateSchema.safeParse({ code: '' }).success).toBe(false)
  })
})

describe('atcDeleteSchema (DELETE /api/admin/atc)', () => {
  it('accepts a non-empty code', () => {
    expect(atcDeleteSchema.safeParse({ code: 'WI071' }).success).toBe(true)
  })

  it('rejects an empty code', () => {
    expect(atcDeleteSchema.safeParse({ code: '' }).success).toBe(false)
  })
})

describe('dispositionSchema (POST /api/overpayment/[taxYear])', () => {
  it('accepts the three disposition enums', () => {
    expect(dispositionSchema.safeParse({ disposition: 'CARRY_OVER' }).success).toBe(true)
    expect(dispositionSchema.safeParse({ disposition: 'REFUND' }).success).toBe(true)
    expect(
      dispositionSchema.safeParse({ disposition: 'TAX_CREDIT_CERTIFICATE' }).success
    ).toBe(true)
  })

  it('rejects an unknown disposition', () => {
    expect(
      dispositionSchema.safeParse({ disposition: 'WRITE_OFF' }).success
    ).toBe(false)
  })

  it('rejects a missing disposition', () => {
    expect(dispositionSchema.safeParse({}).success).toBe(false)
  })
})

describe('settlementSchema (PATCH /api/overpayment/[taxYear])', () => {
  it('accepts an event with optional reference/tccNumber/appliedAt', () => {
    const result = settlementSchema.safeParse({
      event: 'REFUND_RECEIVED',
      reference: 'BIR-12345',
    })
    expect(result.success).toBe(true)
  })

  it('accepts a valid appliedAt ISO datetime', () => {
    const result = settlementSchema.safeParse({
      event: 'TCC_APPLIED',
      tccNumber: 'TCC-001',
      appliedAt: '2026-05-15T10:00:00Z',
    })
    expect(result.success).toBe(true)
  })

  it('rejects an invalid appliedAt datetime', () => {
    const result = settlementSchema.safeParse({
      event: 'TCC_APPLIED',
      appliedAt: 'tomorrow',
    })
    expect(result.success).toBe(false)
  })

  it('rejects an unknown event', () => {
    expect(settlementSchema.safeParse({ event: 'NOT_A_REAL_EVENT' }).success).toBe(false)
  })

  it('rejects a reference longer than 120 characters', () => {
    expect(
      settlementSchema.safeParse({ event: 'REFUND_RECEIVED', reference: 'x'.repeat(121) })
        .success
    ).toBe(false)
  })
})

describe('priorYearCreditCreateSchema (POST /api/prior-year-credit)', () => {
  it('accepts a numeric amount as a string', () => {
    expect(
      priorYearCreditCreateSchema.safeParse({
        amount: '5000',
        originYear: 2025,
        originForm: '1701A',
        priorDisposition: 'CARRY_OVER',
      }).success
    ).toBe(true)
  })

  it('coerces a numeric amount to a string in the transformed output', () => {
    const result = priorYearCreditCreateSchema.safeParse({
      amount: 5000,
      originYear: 2025,
      originForm: '1701A',
      priorDisposition: 'CARRY_OVER',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(typeof result.data.amount).toBe('string')
      expect(result.data.amount).toBe('5000')
    }
  })

  it('rejects a non-integer originYear', () => {
    const result = priorYearCreditCreateSchema.safeParse({
      amount: '100',
      originYear: 2025.5,
      originForm: '1701A',
      priorDisposition: 'CARRY_OVER',
    })
    expect(result.success).toBe(false)
  })

  it('rejects an empty originForm', () => {
    expect(
      priorYearCreditCreateSchema.safeParse({
        amount: '100',
        originYear: 2025,
        originForm: '',
        priorDisposition: 'CARRY_OVER',
      }).success
    ).toBe(false)
  })
})

describe('certificateSchema (POST /api/income) — S9.2 Decimal BR', () => {
  const valid = {
    quarter: 1,
    payorTin: '123-456-789-000',
    payorName: 'Test Payor',
    atcCode: 'WI071',
    month1Amount: '100.00',
    month2Amount: '100.00',
    month3Amount: '100.00',
    cwtWithheld: '10.00',
  }

  it('accepts a complete, valid certificate (string amounts)', () => {
    expect(certificateSchema.safeParse(valid).success).toBe(true)
  })

  it('accepts numeric amounts via the union — the route converts to Decimal', () => {
    const numeric = {
      ...valid,
      month1Amount: 100,
      month2Amount: 100,
      month3Amount: 100,
      cwtWithheld: 10,
    }
    expect(certificateSchema.safeParse(numeric).success).toBe(true)
  })

  it('rejects an invalid quarter outside 1..4', () => {
    expect(certificateSchema.safeParse({ ...valid, quarter: 0 }).success).toBe(false)
    expect(certificateSchema.safeParse({ ...valid, quarter: 5 }).success).toBe(false)
  })

  it('rejects an empty payorTin / payorName / atcCode', () => {
    expect(certificateSchema.safeParse({ ...valid, payorTin: '' }).success).toBe(false)
    expect(certificateSchema.safeParse({ ...valid, payorName: '' }).success).toBe(false)
    expect(certificateSchema.safeParse({ ...valid, atcCode: '' }).success).toBe(false)
  })
})

describe('certificateUpdateSchema (PUT /api/income/[id])', () => {
  it('accepts an empty body — every field is optional', () => {
    expect(certificateUpdateSchema.safeParse({}).success).toBe(true)
  })

  it('accepts a partial body with just one field', () => {
    expect(
      certificateUpdateSchema.safeParse({ payorName: 'New Name' }).success
    ).toBe(true)
  })

  it('still rejects an empty required-style field if provided', () => {
    expect(certificateUpdateSchema.safeParse({ payorName: '' }).success).toBe(false)
  })
})

describe('electionSchema (POST /api/election)', () => {
  it('accepts the 8% rate with disclosures acknowledged', () => {
    expect(
      electionSchema.safeParse({
        electedRate: 'RATE_8PCT',
        disclosuresAcknowledged: true,
      }).success
    ).toBe(true)
  })

  it('still requires disclosuresAcknowledged: true under GRADUATED (BR-19 default applies at the route layer, not the schema)', () => {
    // The schema locks disclosuresAcknowledged to true for both rates;
    // the route's BR-19 default for GRADUATED sets it to true on the
    // server before parsing, so the client never sends false for
    // GRADUATED. This test pins the current schema contract.
    expect(
      electionSchema.safeParse({
        electedRate: 'GRADUATED',
        disclosuresAcknowledged: true,
      }).success
    ).toBe(true)
  })

  it('rejects disclosuresAcknowledged: false for the 8% rate', () => {
    const result = electionSchema.safeParse({
      electedRate: 'RATE_8PCT',
      disclosuresAcknowledged: false,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const flat = result.error.flatten()
      expect(flat.fieldErrors.disclosuresAcknowledged?.[0]).toMatch(/disclosures/i)
    }
  })

  it('rejects the combination OSD + 8% flat rate (S7.6 BR, NIRC Sec 24(A)(2))', () => {
    const result = electionSchema.safeParse({
      electedRate: 'RATE_8PCT',
      disclosuresAcknowledged: true,
      osdElection: true,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const flat = result.error.flatten()
      expect(flat.fieldErrors.osdElection?.[0]).toMatch(/24\(A\)\(2\)/)
    }
  })

  it('accepts OSD + GRADUATED (valid combination)', () => {
    expect(
      electionSchema.safeParse({
        electedRate: 'GRADUATED',
        disclosuresAcknowledged: true,
        osdElection: true,
      }).success
    ).toBe(true)
  })

  it('rejects an unknown electedRate', () => {
    expect(
      electionSchema.safeParse({ electedRate: 'RATE_5PCT', disclosuresAcknowledged: true })
        .success
    ).toBe(false)
  })

  it('defaults osdElection to false when omitted', () => {
    const result = electionSchema.safeParse({
      electedRate: 'GRADUATED',
      disclosuresAcknowledged: true,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.osdElection).toBe(false)
    }
  })
})
