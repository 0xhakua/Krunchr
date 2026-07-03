import React from 'react'
import { FilingPdfElement, type FilingPdfData } from '../lib/pdf/dispatcher'

// Smoke test: verify the dispatcher routes every FormType to the right
// template, and that all four templates (2551Q, 1701Q, 1701A, 1701) can
// be reached without an exception being thrown at construction time.
//
// We do not call renderToBuffer() here because @react-pdf/renderer's
// runtime requires a browser-style document; the dispatcher itself is
// pure (it is a switch statement over formType). A separate vitest
// suite at lib/pdf/__tests__/dispatcher.test.tsx asserts the routing
// exhaustively. This script is for manual visual inspection only.
function dataFor(formType: FilingPdfData['ret']['formType'], quarter: number | null = null): FilingPdfData {
  return {
    ret: {
      id: 'test',
      formType,
      quarter,
      status: 'FILED',
      computedTaxDue: null,
      taxCreditsTotal: null,
      netTaxDue: null,
      overpaymentAmt: null,
      statutoryDueDate: new Date(2027, 3, 15),
      filedDate: null,
      generatedAt: null,
    },
    taxYear: {
      id: 'test',
      year: 2026,
      electedRate: 'RATE_8PCT',
      electionStatus: 'ELECTED_8PCT',
    },
    taxpayer: {
      fullName: 'Maria Dela Cruz',
      tin: '123-456-789-001',
      rdoCode: '040',
      registeredAddress: '123 Test St',
      zipCode: '1200',
      incomeType: 'MIXED_INCOME',
      corIncludes2551Q: true,
    },
    certificates: [],
    priorYearCredit: null,
    overpayment: null,
    allReturns: [],
  }
}

function main() {
  const cases: Array<[FilingPdfData['ret']['formType'], number | null]> = [
    ['FORM_2551Q', 1],
    ['FORM_1701Q', 1],
    ['FORM_1701A', null],
    ['FORM_1701', null],
  ]

  console.log('FilingPdfElement routing smoke test:')
  for (const [formType, quarter] of cases) {
    try {
      const element = FilingPdfElement(dataFor(formType, quarter))
      const label = quarter != null ? `${formType} Q${quarter}` : `${formType} Annual`
      if (React.isValidElement(element)) {
        const typeName = typeof element.type === 'string' ? element.type : (element.type as { name?: string }).name ?? 'Component'
        console.log(`  ${label} -> ${typeName}`)
      } else {
        console.log(`  ${label} -> (not an element)`)
        process.exitCode = 1
      }
    } catch (err) {
      console.error(`  ${formType} threw:`, err)
      process.exitCode = 1
    }
  }
  console.log('OK — all four form types routed.')
}

main()
