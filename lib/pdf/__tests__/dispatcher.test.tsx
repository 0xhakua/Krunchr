import React from 'react'
import { describe, expect, it } from 'vitest'
import Decimal from 'decimal.js'
import { FilingPdfElement, type FilingPdfData } from '../dispatcher'
import { Form2551Q } from '../templates/form-2551q'
import { Form1701Q } from '../templates/form-1701q'
import { Form1701A } from '../templates/form-1701a'
import { Form1701 } from '../templates/form-1701'

// Reference engagement fixture: full-year gross ₱187,009.33, CWT ₱18,700.92,
// prior-year credit ₱54,270.00. Used by scripts/verify-computations.ts.
function makeData(formType: FilingPdfData['ret']['formType'], quarter: number | null = null): FilingPdfData {
  return {
    ret: {
      id: 'test-return',
      formType,
      quarter,
      status: 'PENDING',
      computedTaxDue: new Decimal('0'),
      taxCreditsTotal: new Decimal('0'),
      netTaxDue: new Decimal('0'),
      overpaymentAmt: new Decimal('0'),
      statutoryDueDate: new Date(2027, 3, 15),
      filedDate: null,
      generatedAt: null,
      penalties: null,
    },
    taxYear: {
      id: 'test-taxyear',
      year: 2026,
      electedRate: 'RATE_8PCT',
      electionStatus: 'ELECTED_8PCT',
    },
    taxpayer: {
      fullName: 'Maria Dela Cruz',
      tin: '123-456-789-001',
      rdoCode: '040',
      registeredAddress: '123 Test St, Makati City',
      zipCode: '1200',
      email: null,
      phoneNumber: null,
      natureOfBusiness: 'Insurance Agent',
      incomeType: 'PURE_SELF_EMPLOYMENT',
      corIncludes2551Q: true,
    },
    certificates: [
      {
        quarter: 1,
        payorTin: '000-111-222-333',
        payorName: 'AXA Life Insurance Corp',
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
        payorName: 'Eternal Bright Sanctuary',
        atcCode: 'WI140',
        month1Amount: new Decimal('20097.14'),
        month2Amount: new Decimal('20097.14'),
        month3Amount: new Decimal('20097.14'),
        quarterlyTotal: new Decimal('60291.42'),
        cwtWithheld: new Decimal('6029.14'),
      },
    ],
    priorYearCredit: { amount: new Decimal('54270.00') },
    overpayment: null,
    allReturns: [
      { formType: 'FORM_2551Q', quarter: 1, netTaxDue: new Decimal('0') },
      { formType: 'FORM_1701Q', quarter: 1, netTaxDue: new Decimal('0') },
    ],
  }
}

describe('FilingPdfElement routing', () => {
  it('routes FORM_2551Q to Form2551Q', () => {
    const element = FilingPdfElement(makeData('FORM_2551Q', 1))
    expect(React.isValidElement(element)).toBe(true)
    expect((element as React.ReactElement).type).toBe(Form2551Q)
  })

  it('routes FORM_1701Q to Form1701Q', () => {
    const element = FilingPdfElement(makeData('FORM_1701Q', 1))
    expect(React.isValidElement(element)).toBe(true)
    expect((element as React.ReactElement).type).toBe(Form1701Q)
  })

  it('routes FORM_1701A to Form1701A', () => {
    const element = FilingPdfElement(makeData('FORM_1701A'))
    expect(React.isValidElement(element)).toBe(true)
    expect((element as React.ReactElement).type).toBe(Form1701A)
  })

  it('routes FORM_1701 to Form1701 (S7.2 mixed-income annual path)', () => {
    // BR-13: mixed-income earners file Form 1701, not 1701A. The dispatcher
    // must therefore have a distinct case for FORM_1701 that maps to the
    // Form1701 template (lib/pdf/templates/form-1701.tsx), not to the
    // 1701A template.
    const data = makeData('FORM_1701')
    data.taxpayer.incomeType = 'MIXED_INCOME'

    const element = FilingPdfElement(data)
    expect(React.isValidElement(element)).toBe(true)
    expect((element as React.ReactElement).type).toBe(Form1701)
    // Negative assertion: it is not the 1701A template.
    expect((element as React.ReactElement).type).not.toBe(Form1701A)
  })
})
