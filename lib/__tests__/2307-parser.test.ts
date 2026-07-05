import { describe, expect, it } from 'vitest'
import { parse2307Text, computeCwtFromAmounts } from '@/lib/ocr/2307-parser'

describe('parse2307Text', () => {
  it('extracts all fields from a synthetic 2307 text', () => {
    const text = `
      BIR Form 2307
      Quarter 2
      Payor's Name: ACME Corporation
      TIN: 123-456-789-000
      ATC Code: WI071
      Month 1: 10,000.00
      Month 2: 20,000.00
      Month 3: 30,000.00
      Total Tax Withheld: 6,000.00
    `

    const result = parse2307Text(text)

    expect(result.payorName).toBe('ACME Corporation')
    expect(result.payorTin).toBe('123-456-789-000')
    expect(result.atcCode).toBe('WI071')
    expect(result.quarter).toBe(2)
    expect(result.month1Amount).toBe('10000.00')
    expect(result.month2Amount).toBe('20000.00')
    expect(result.month3Amount).toBe('30000.00')
    expect(result.cwtWithheld).toBe('6000.00')
    expect(result.confidence).toBe('high')
    expect(result.warnings).toHaveLength(0)
  })

  it('normalises a 9-digit TIN to 12 digits', () => {
    const result = parse2307Text('TIN: 111-222-333')
    expect(result.payorTin).toBe('111-222-333-000')
  })

  it('normalises a 12-digit TIN without dashes', () => {
    const result = parse2307Text('TIN: 111222333000')
    expect(result.payorTin).toBe('111-222-333-000')
  })

  it('detects the quarter from common labels', () => {
    expect(parse2307Text('Q1').quarter).toBe(1)
    expect(parse2307Text('2nd quarter').quarter).toBe(2)
    expect(parse2307Text('quarter 3').quarter).toBe(3)
    expect(parse2307Text('Q4 filing').quarter).toBe(4)
  })

  it('prefers WI ATC codes', () => {
    const result = parse2307Text('ATC: WI140 and also AB123')
    expect(result.atcCode).toBe('WI140')
  })

  it('falls back to a generic ATC pattern', () => {
    const result = parse2307Text('ATC: AB123')
    expect(result.atcCode).toBe('AB123')
  })

  it('returns warnings for missing fields and low confidence', () => {
    const result = parse2307Text('')
    expect(result.confidence).toBe('low')
    expect(result.warnings).toContain('No text could be extracted from the file.')
  })

  it('warns when month amounts are missing', () => {
    const result = parse2307Text('Quarter 1\nATC: WI071')
    expect(result.warnings.some((w) => w.includes('monthly amounts'))).toBe(true)
  })
})

describe('computeCwtFromAmounts', () => {
  it('computes CWT from three monthly amounts and the EWT rate', () => {
    const cwt = computeCwtFromAmounts('10000.00', '20000.00', '30000.00', 0.1)
    expect(cwt).toBe('6000.00')
  })

  it('handles numeric inputs', () => {
    const cwt = computeCwtFromAmounts(5000, 5000, 5000, 0.1)
    expect(cwt).toBe('1500.00')
  })
})
