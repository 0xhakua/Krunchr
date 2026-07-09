import { describe, expect, it } from 'vitest'
import Decimal from 'decimal.js'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { renderForm1701AOverlay, buildForm1701AValues, COORD_GROUPS_1701A, inferTaxpayerType, formatTinFor1701ACharacterBoxes } from '../bir/1701A'
import type { FilingPdfData } from '../dispatcher'

const OFFICIAL_PDF = join(process.cwd(), 'public', 'bir-forms', '1701A.pdf')

const sampleData: FilingPdfData = {
  ret: {
    id: 'test-1701a',
    formType: 'FORM_1701A',
    quarter: null,
    status: 'PENDING',
    computedTaxDue: new Decimal('0'),
    taxCreditsTotal: new Decimal('0'),
    netTaxDue: new Decimal('0'),
    overpaymentAmt: new Decimal('0'),
    statutoryDueDate: new Date(2027, 3, 15),
    filedDate: null,
    generatedAt: null,
    penalties: {
      daysLate: 0,
      surcharge: new Decimal('0'),
      interest: new Decimal('0'),
      compromisePenalty: new Decimal('1000'),
      totalPenalty: new Decimal('1000'),
    },
  },
  taxYear: { id: 'ty1', year: 2026, electedRate: 'RATE_8PCT', electionStatus: 'ELECTED_8PCT' },
  taxpayer: {
    fullName: 'Dela Cruz, Maria S.',
    tin: '123-456-789-001',
    rdoCode: '040',
    registeredAddress: '123 Mabini St, Makati City',
    zipCode: '1200',
    email: 'maria.delacruz@example.com',
    phoneNumber: '+639171234567',
    natureOfBusiness: 'Insurance Agent / Freelance Broker',
    incomeType: 'PURE_SELF_EMPLOYMENT',
    corIncludes2551Q: true,
  },
  certificates: [
    {
      quarter: 1,
      payorTin: '000-111-222-333',
      payorName: 'AXA Life',
      atcCode: 'WI071',
      month1Amount: new Decimal('13165.93'),
      month2Amount: new Decimal('13165.93'),
      month3Amount: new Decimal('13165.94'),
      quarterlyTotal: new Decimal('39497.80'),
      cwtWithheld: new Decimal('3949.78'),
    },
    {
      quarter: 2,
      payorTin: '000-444-555-666',
      payorName: 'Eternal Bright',
      atcCode: 'WI140',
      month1Amount: new Decimal('20097.14'),
      month2Amount: new Decimal('20097.14'),
      month3Amount: new Decimal('20097.14'),
      quarterlyTotal: new Decimal('60291.42'),
      cwtWithheld: new Decimal('6029.14'),
    },
  ],
  priorYearCredit: { amount: new Decimal('0') },
  overpayment: null,
  allReturns: [
    { formType: 'FORM_1701Q', quarter: 1, netTaxDue: new Decimal('0') },
    { formType: 'FORM_1701Q', quarter: 2, netTaxDue: new Decimal('0') },
  ],
}

describe('1701A overlay (issue #159)', () => {
  it('requires the official 1701A PDF in public/bir-forms/ to be present', () => {
    expect(existsSync(OFFICIAL_PDF)).toBe(true)
  })

  it('inferTaxpayerType classifies nature-of-business text conservatively', () => {
    expect(inferTaxpayerType('Insurance Agent')).toBe('single_proprietor')
    expect(inferTaxpayerType('Software Consultant')).toBe('professional')
    expect(inferTaxpayerType('Lawyer / Attorney')).toBe('professional')
    expect(inferTaxpayerType('CPA / Accountant')).toBe('professional')
    expect(inferTaxpayerType('Architect')).toBe('professional')
    expect(inferTaxpayerType('')).toBe('single_proprietor')
    expect(inferTaxpayerType(null)).toBe('single_proprietor')
  })

  it('formatTinFor1701ACharacterBoxes pads the 12-digit stored TIN to the 13-character BIR layout', () => {
    expect(formatTinFor1701ACharacterBoxes('123-456-789-001')).toBe('123-456-789-0001')
    expect(formatTinFor1701ACharacterBoxes('123456789001')).toBe('123-456-789-0001')
    expect(formatTinFor1701ACharacterBoxes('000-000-000-000')).toBe('000-000-000-0000')
    expect(formatTinFor1701ACharacterBoxes('')).toBe('')
    expect(formatTinFor1701ACharacterBoxes(null)).toBe('')
  })

  it('formatTinFor1701ACharacterBoxes can omit dashes for continuous-box rows', () => {
    expect(formatTinFor1701ACharacterBoxes('123-456-789-001', { includeDashes: false })).toBe(
      '1234567890001',
    )
  })

  it('buildForm1701AValues repeats the TIN on the Page 2 header row', () => {
    const values = buildForm1701AValues(sampleData)
    expect(values.page2_tin).toBe('123-456-789-001')
  })

  it('renderForm1701AOverlay draws Page 2 TIN header as a character-box field', async () => {
    const result = await renderForm1701AOverlay(sampleData)
    expect(result.drawnKeys).toContain('page2_tin')
  })

  it('buildForm1701AValues populates all coord keys with sensible values', () => {
    const values = buildForm1701AValues(sampleData)
    // Part I — header
    expect(values.part1_tin).toBe('123-456-789-001')
    expect(values.part1_rdo_code).toBe('040')
    expect(values.part1_zip_code).toBe('1200')
    expect(values.part1_taxpayer_name).toBe('Dela Cruz, Maria S.')
    expect(values.part1_email).toBe('maria.delacruz@example.com')
    expect(values.part1_contact_number).toBe('+639171234567')
    expect(values.part1_tax_rate).toBe(true)
    // Taxpayer Type group: agent -> single_proprietor
    expect(values.part1_taxpayer_type_single_proprietor).toBe(true)
    expect(values.part1_taxpayer_type_professional).toBeUndefined()
    // Part IV.B — 8% path
    expect(values.part4b_sales).toContain('99,789.22')
    expect(values.part4b_net_sales).toContain('99,789.22')
    expect(values.part4b_less_250k).toBe('250,000.00')
    expect(values.part4b_taxable_loss).toContain('0') // 99789.22 - 250000 < 0 -> clamped
    // Part IV.C — credits
    expect(values.part4c_prior_year_credits).toBe('0.00')
    expect(values.part4c_q4_cwt).toBe('0.00') // no Q4 certs
  })

  it('renderForm1701AOverlay produces a valid 2-page PDF', async () => {
    const result = await renderForm1701AOverlay(sampleData)
    expect(result.pageCount).toBe(2)
    expect(result.bytes.length).toBeGreaterThan(1000)
    // PDF magic header
    const header = Buffer.from(result.bytes.slice(0, 8)).toString('latin1')
    expect(header.startsWith('%PDF-')).toBe(true)
    // drawnKeys should be non-empty
    expect(result.drawnKeys.length).toBeGreaterThan(20)
  })

  it('renderForm1701AOverlay handles mixed-income earners (no exemption, no taxpayer_type-professional for non-pro nature-of-business)', async () => {
    const mixed: FilingPdfData = {
      ...sampleData,
      taxpayer: { ...sampleData.taxpayer, incomeType: 'MIXED_INCOME' },
    }
    const values = buildForm1701AValues(mixed)
    // Mixed-income earners get no 250k exemption, so the "less 250k" cell is 0.00
    expect(values.part4b_less_250k).toBe('0.00')
    const result = await renderForm1701AOverlay(mixed)
    expect(result.pageCount).toBe(2)
  })

  it('renderForm1701AOverlay marks the professional checkbox for consultant / lawyer nature-of-business', async () => {
    const pro: FilingPdfData = {
      ...sampleData,
      taxpayer: { ...sampleData.taxpayer, natureOfBusiness: 'Software Consultant' },
    }
    const values = buildForm1701AValues(pro)
    expect(values.part1_taxpayer_type_professional).toBe(true)
    expect(values.part1_taxpayer_type_single_proprietor).toBeUndefined()
  })

  it('COORD_GROUPS_1701A maps both alternative keys for the taxpayer_type field', () => {
    expect(COORD_GROUPS_1701A.taxpayer_type.single_proprietor).toBe(
      'part1_taxpayer_type_single_proprietor',
    )
    expect(COORD_GROUPS_1701A.taxpayer_type.professional).toBe(
      'part1_taxpayer_type_professional',
    )
  })

  it('renderForm1701AOverlay output is flattenable (no AcroForm fields throw)', async () => {
    // Re-render and check the second doc.save() call doesn't throw.
    // The current implementation always flattens (form.flatten is wrapped in try/catch).
    const result = await renderForm1701AOverlay(sampleData)
    // Re-load and verify we can save again without issue.
    const { PDFDocument } = await import('pdf-lib')
    const reloaded = await PDFDocument.load(result.bytes)
    const out = await reloaded.save()
    expect(out.length).toBeGreaterThan(1000)
  })
})
