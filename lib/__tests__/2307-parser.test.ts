import { describe, expect, it, vi } from 'vitest'
import { parse2307Text, computeCwtFromAmounts, extract2307Fields } from '@/lib/ocr/2307-parser'
import type { ValidatedFile } from '@/lib/upload/validation'

// tesseract.js is not safe to load inside the unit-test environment; the
// image-OCR branch is exercised end-to-end in app/api/income/import/route.test.ts.
// Here we only assert the timeout guard's effect on the parser's public API.
vi.mock('tesseract.js', () => ({
  createWorker: vi.fn(() => new Promise(() => {})), // never resolves
}))

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

  it('does not mistake the "Part II – Payor Information" section header for the payor name', () => {
    const text = `
      Part II – Payor Information
      6   Taxpayer Identification Number (TIN)  123-456-789-000
      7   Payor's Name  ACME Philippines Inc.
      ATC  WC010  50,000.00  50,000.00  50,000.00  150,000.00  15,000.00
    `
    const result = parse2307Text(text)
    expect(result.payorName).toBe('ACME Philippines Inc.')
  })

  it('extracts the payor name from the line before the label when fields are read before the header', () => {
    // Mirrors the pdf2json reading order seen in real 2307 PDFs: the payor
    // fields can appear on lines BEFORE "Payor's Name" because form fields
    // are declared in a different order than the visual layout.
    const text = `
      6   Taxpayer Identification Number (TIN)  123-456-789-000
      ABC Trading
      7   Payor's Name  (Last Name, First Name...)
      Payee's Name  DELA CRUZ, JUAN
    `
    const result = parse2307Text(text)
    expect(result.payorName).toBe('ABC Trading')
  })

  it('strips the descriptive parenthetical that follows the Payor Name label', () => {
    const text = `
      7   Payor's Name (Last Name, First Name, Middle Name for Individual OR Registered Name for Non-Individual)  ACME Philippines Inc.
      6   TIN  123-456-789-000
    `
    const result = parse2307Text(text)
    expect(result.payorName).toBe('ACME Philippines Inc.')
  })

  it('handles the curly apostrophe (U+2019) emitted by pdf2json for "Payor\u2019s Name"', () => {
    const text = `
      Payor\u2019s Name  ABC Trading
      6   TIN  123-456-789-000
    `
    const result = parse2307Text(text)
    expect(result.payorName).toBe('ABC Trading')
  })

  it('finds the payor TIN even when the label is just "TIN" (no parens) and a short TIN value', () => {
    // Before the fix, stripping whitespace joined the trailing "N" of "TIN"
    // to the first TIN digit, breaking the word boundary.
    const text = `
      6   TIN  123-456-789-000
      7   Payor's Name  ABC Trading
    `
    const result = parse2307Text(text)
    expect(result.payorTin).toBe('123-456-789-000')
  })

  it('parses a TIN where each digit is in its own form box (separated by spaces and U+00A0)', () => {
    // The 2307 form lays TINs out as one digit per cell, which pdf2json
    // emits with U+0020 and U+00A0 separators. The parser must collapse
    // these to recognise the canonical 12-digit shape.
    const text = `
      Payor's Name  ABC Trading
      6   TIN  1\u00A02\u00A03\u00A0-\u00A04\u00A05\u00A06\u00A0-\u00A07\u00A08\u00A09\u00A0-\u00A00\u00A00\u00A00
    `
    const result = parse2307Text(text)
    expect(result.payorTin).toBe('123-456-789-000')
  })

  it('parses a TIN where tesseract.js has read the cell borders as commas', () => {
    // tesseract.js commonly misreads the 2307 form's cell borders as
    // commas on image OCR of a real scan. The collapse step must treat
    // a comma between adjacent digits as cell noise so the canonical
    // TIN regex matches.
    const text = `
      Payor's Name  ABC Trading
      6   TIN  7,8,9 - 4,5,6 - 1,2,3 - 0,0,0
    `
    const result = parse2307Text(text)
    expect(result.payorTin).toBe('789-456-123-000')
  })

  it('tolerates a 4th branch digit (tesseract.js sometimes reads the last cell twice)', () => {
    // Some real scans produce "0,0,0,0" (4 cells) for the 12-digit-TIN
    // branch position, which is supposed to have only 3 cells. The
    // TIN pattern accepts 3-4 digits in the trailing group and trims
    // back to 3 in normalizeTin.
    const text = `
      Payor's Name  ABC Trading
      6   TIN  7,8,9 - 4,5,6 - 1,2,3 - 0,0,0,0
    `
    const result = parse2307Text(text)
    expect(result.payorTin).toBe('789-456-123-000')
  })

  it('parses a TIN when tesseract.js reads the cell borders as brackets and parens', () => {
    // Real scan of the 2307 form: tesseract.js misreads the form cell
    // borders as `]`, `)` etc. and leaves stray brackets between the
    // dashes and the digits (e.g. "[7,8,9]-]4,5,6]-]1,2,3]-] 0,00,0").
    // Without the bracket-strip in normalizeTin, the TIN regex can't
    // match across the stray `]` between the dash and the next group
    // and the payor TIN comes back as undefined. The "(TIN)" label
    // itself is also picked up by tesseract.js and the closing paren
    // must not interfere either.
    const text = `
      2   Taxpayer Identification Number (TIN) [1,2,3]-]4,5,6]]7,8 9] 0,0,0,0
      3   Payee's Name  Dela Cruz, Juan Pablo
      Part Il - Payor Information
      6   Taxpayer Identification Number (TIN) [7,8,9]-]4,5,6]-]1,2,3]-] 0,00,0
      7   Payors Name  ABC Trading
      8   Registered Address  Cebu City, Cebu
    `
    const result = parse2307Text(text)
    expect(result.payorTin).toBe('789-456-123-000')
  })

  it('folds in an orphan 3rd-month amount emitted on a separate line above the income row', () => {
    // pdf2json sometimes places one of the monthly amount cells on its own
    // line above the rest of the row. The parser should attach that orphan
    // amount to the next row as the 3rd-month value.
    const text = `
      Payor's Name  ABC Trading
      6   TIN  123-456-789-000
      ATC  1st Month  2nd Month  3rd Month  Total  Withheld
      20,000.00
      Rental  WC100  20,000.00  20,000.00  60,000.00  6,000.00
    `
    const result = parse2307Text(text)
    expect(result.atcCode).toBe('WC100')
    expect(result.month1Amount).toBe('20000.00')
    expect(result.month2Amount).toBe('20000.00')
    expect(result.month3Amount).toBe('20000.00')
    expect(result.cwtWithheld).toBe('6000.00')
  })

  it('detects the quarter from a period written as "From MMDD" with no separators', () => {
    const text = `
      1   For the Period    From  0101  2026  To  0331  2026
      6   TIN  123-456-789-000
      7   Payor's Name  ABC Trading
    `
    const result = parse2307Text(text)
    expect(result.quarter).toBe(1)
  })

  it('isolates the payor TIN when fields are read BEFORE the "Part II" header in pdf2json order', () => {
    // Mirrors the real 2307 PDF: the payor fields can appear on lines
    // before "Part II – Payor Information" because the form field
    // declaration order differs from the visual layout.
    const text = `
      6   Taxpayer Identification Number (TIN)                         7  8  9
      -4  5  6  -
      1  2  3
      -0  0  0   0
      7   Payor's Name  ABC Trading
      Part II – Payor Information
      5   Foreign Address, if applicable
      Dela Cruz, Juan Pablo
      3   Payee's Name  DELA CRUZ, JUAN
      2   Taxpayer Identification Number (TIN)
      1  2  3
      -
      4  5  6
      -
      7  8  9
      -
      0  0  0   0
    `
    const result = parse2307Text(text)
    expect(result.payorTin).toBe('789-456-123-000')
    expect(result.payorName).toBe('ABC Trading')
  })

  it('parses a 2018 ENCS fillable PDF snippet (#202): payor TIN, quarter, monthly amounts, CWT', () => {
    // The 2018 ENCS fillable PDF emits:
    //   - TIN digits on multiple lines with a standalone "---" column
    //     separator (read top-to-bottom, the 4 groups land in non-canonical
    //     order).
    //   - The period dates and amounts with the 2018 ENCS header labels
    //     ("1st Month of the Quarter", etc.) that the parser didn't
    //     recognise before.
    //
    // The text below is the reading-order output the new
    // extractReadingOrderText() would produce for the affected regions, so
    // we can exercise the pre-pass + TIN-window + MONTH_PATTERNS aliases
    // without an actual PDF fixture.
    const text = `
      Part I – Payee Information
      1  For the Period  From  01/01/2026  To  03/31/2026
      2  Taxpayer Identification Number  (TIN)  123-456-789-000
      3  Payee's Name  Dela Cruz, Juan Pablo
      4  Registered Address  Cebu City, Cebu  6 0 0 0
      Part II – Payor Information
      6  Taxpayer Identification Number  (TIN)  789-456-123-000
      7  Payor's Name  ABC Trading
      8  Registered Address  Cebu City, Cebu  6 0 0 0
      Part III – Details of Monthly Income Payments and Taxes Withheld
      Professional Fees  WI071
      1st Month of the  2nd Month of the  3rd Month of the  Total  Tax Withheld for the
      50,000.00  50,000.00  50,000.00  150,000.00  15,000.00
    `
    const result = parse2307Text(text)
    expect(result.payorTin).toBe('789-456-123-000')
    expect(result.payorName).toBe('ABC Trading')
    expect(result.atcCode).toBe('WI071')
    expect(result.quarter).toBe(1)
    expect(result.month1Amount).toBe('50000.00')
    expect(result.month2Amount).toBe('50000.00')
    expect(result.month3Amount).toBe('50000.00')
    expect(result.cwtWithheld).toBe('15000.00')
    expect(result.confidence).toBe('high')
  })

  it('replaces a standalone "---" column separator with a dash so the TIN pattern can match', () => {
    // A snippet where the only thing standing between the digit groups and
    // a valid TIN match is the standalone "---" line. After the pre-pass
    // the separator becomes a single dash and the existing
    // collapseDigitSpacing + TIN_PATTERN can resolve the full TIN.
    const text = `
      6  Taxpayer Identification Number  (TIN)
      7 8 9
      ---
      4 5 6
      1 2 3
      0 0 0 0
    `
    const result = parse2307Text(text)
    expect(result.payorTin).toBe('789-456-123-000')
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

describe('extract2307Fields — image OCR timeout', () => {
  // Smallest valid JPEG (FFD8FF…) so validateUploadFile accepts the file
  // and the parser routes to the image branch.
  const TINY_JPEG = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
  ])

  function makeJpeg(): ValidatedFile {
    return {
      buffer: TINY_JPEG,
      originalName: 'sample.jpg',
      mimeType: 'image/jpeg',
      byteLength: TINY_JPEG.byteLength,
    }
  }

  it('returns a timeout warning instead of hanging when OCR never resolves', async () => {
    // The mocked tesseract.js createWorker returns a promise that never
    // settles. The parser's 60s guard must convert the hang into a
    // structured warning so the route can return 200.
    //
    // We don't wait the full 60 seconds in wall-clock time — we advance
    // fake timers just past the guard and assert the parser resolves
    // with a timeout warning.
    vi.useFakeTimers()
    try {
      const resultPromise = extract2307Fields(makeJpeg())
      await vi.advanceTimersByTimeAsync(60_500)
      const result = await resultPromise

      expect(result.confidence).toBe('low')
      expect(result.warnings.join(' ')).toMatch(/timed out/i)
      // None of the structured fields should be populated from a hang.
      expect(result.payorTin).toBeUndefined()
      expect(result.atcCode).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })
})
