import PDFParser from 'pdf2json'
import mammoth from 'mammoth'
import { createWorker } from 'tesseract.js'
import Decimal from 'decimal.js'
import type { ValidatedFile } from '@/lib/upload/validation'

export interface Extracted2307Fields {
  payorTin?: string
  payorName?: string
  atcCode?: string
  quarter?: number
  month1Amount?: string
  month2Amount?: string
  month3Amount?: string
  cwtWithheld?: string
  confidence: 'high' | 'medium' | 'low'
  warnings: string[]
}

interface ParseContext {
  text: string
  warnings: string[]
}

const MONTH_PATTERNS = [
  /(?:month\s*1|jan(?:uary)?|first\s*month|month\s*one)[^0-9]{0,20}([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2})/i,
  /(?:month\s*2|feb(?:ruary)?|second\s*month|month\s*two)[^0-9]{0,20}([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2})/i,
  /(?:month\s*3|mar(?:ch)?|third\s*month|month\s*three)[^0-9]{0,20}([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2})/i,
]

const TIN_PATTERN = /\b(\d{3}-\d{3}-\d{3}(?:-\d{3})?)\b/
const TIN_NO_DASH_PATTERN = /\b(\d{9}|\d{12})\b/

function normalizeTin(raw: string): string | undefined {
  const dashMatch = raw.match(TIN_PATTERN)
  if (dashMatch) {
    const tin = dashMatch[1]
    return /^\d{3}-\d{3}-\d{3}$/.test(tin) ? `${tin}-000` : tin
  }

  const noDashMatch = raw.match(TIN_NO_DASH_PATTERN)
  if (noDashMatch) {
    const digits = noDashMatch[1]
    if (digits.length === 9) {
      return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)}-000`
    }
    if (digits.length === 12) {
      return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)}-${digits.slice(9, 12)}`
    }
  }
  return undefined
}

function extractTin(ctx: ParseContext): string | undefined {
  return normalizeTin(ctx.text)
}

function extractAtcCode(ctx: ParseContext): string | undefined {
  // Primary BIR EWT ATC codes used by Kuwenta taxpayers start with WI.
  const wiMatch = ctx.text.match(/\b(WI\d{3,4})\b/i)
  if (wiMatch) return wiMatch[1].toUpperCase()

  // Fallback: any two letters + three or four digits.
  const genericMatch = ctx.text.match(/\b([A-Z]{1,2}\d{3,4})\b/i)
  if (genericMatch) return genericMatch[1].toUpperCase()

  return undefined
}

function extractPayorName(ctx: ParseContext): string | undefined {
  const text = ctx.text
  const labelPatterns = [
    /(?:payor'?s?\s*name|name\s*of\s*payor|from\s*whom\s*income\s*was\s*received)[\s:]*([A-Z][A-Za-z0-9\s,&.'()-]{5,80})/i,
    /(?:payor|withholding\s*agent)[\s:]*([A-Z][A-Za-z0-9\s,&.'()-]{5,80})/i,
  ]

  for (const pattern of labelPatterns) {
    const match = text.match(pattern)
    if (match) {
      const name = match[1].trim().split(/\n|\r/)[0].trim()
      if (name.length > 2) return name
    }
  }

  return undefined
}

function extractQuarter(ctx: ParseContext): number | undefined {
  const text = ctx.text
  const patterns = [
    { regex: /\bq1\b|\b1st\s*quarter\b|\bquarter\s*1\b/i, quarter: 1 },
    { regex: /\bq2\b|\b2nd\s*quarter\b|\bquarter\s*2\b/i, quarter: 2 },
    { regex: /\bq3\b|\b3rd\s*quarter\b|\bquarter\s*3\b/i, quarter: 3 },
    { regex: /\bq4\b|\b4th\s*quarter\b|\bquarter\s*4\b/i, quarter: 4 },
  ]

  for (const { regex, quarter } of patterns) {
    if (regex.test(text)) return quarter
  }

  return undefined
}

function parseAmount(raw: string): string | undefined {
  try {
    const cleaned = raw.replace(/,/g, '')
    const value = new Decimal(cleaned)
    if (value.isNegative()) return undefined
    return value.toDecimalPlaces(2).toFixed(2)
  } catch {
    return undefined
  }
}

function extractLabeledAmount(ctx: ParseContext, labels: RegExp[]): string | undefined {
  for (const label of labels) {
    const match = ctx.text.match(label)
    if (match?.[1]) {
      const parsed = parseAmount(match[1])
      if (parsed) return parsed
    }
  }
  return undefined
}

function extractMonthAmounts(ctx: ParseContext): { month1?: string; month2?: string; month3?: string } {
  const result: { month1?: string; month2?: string; month3?: string } = {}

  for (let i = 0; i < 3; i++) {
    const match = ctx.text.match(MONTH_PATTERNS[i])
    if (match?.[1]) {
      const parsed = parseAmount(match[1])
      if (parsed) {
        if (i === 0) result.month1 = parsed
        if (i === 1) result.month2 = parsed
        if (i === 2) result.month3 = parsed
      }
    }
  }

  return result
}

function extractCwtWithheld(ctx: ParseContext): string | undefined {
  const labels = [
    /(?:tax\s*withheld|cwt|creditable\s*tax\s*withheld|total\s*tax\s*withheld)[^0-9]{0,30}([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2})/i,
    /(?:tax\s*withheld|cwt|creditable\s*tax\s*withheld|total\s*tax\s*withheld)[^0-9]{0,30}(\d+\.\d{2})/i,
  ]
  return extractLabeledAmount(ctx, labels)
}

function parsePdfBuffer(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser(null, 1)
    let resolved = false

    pdfParser.on('pdfParser_dataError', (errData: { parserError?: Error }) => {
      if (!resolved) {
        resolved = true
        reject(errData.parserError ?? new Error('PDF parse error'))
      }
    })

    pdfParser.on('pdfParser_dataReady', () => {
      if (!resolved) {
        resolved = true
        resolve(pdfParser.getRawTextContent())
      }
    })

    pdfParser.parseBuffer(buffer)
  })
}

async function extractTextFromFile(file: ValidatedFile): Promise<{ text: string; warnings: string[] }> {
  const warnings: string[] = []

  try {
    switch (file.mimeType) {
      case 'application/pdf': {
        const text = await parsePdfBuffer(file.buffer)
        if (text.trim().length > 20) {
          return { text, warnings }
        }
        warnings.push('PDF contains no extractable text; scanned PDFs are not supported yet.')
        return { text: '', warnings }
      }

      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
        const docxResult = await mammoth.extractRawText({ buffer: file.buffer })
        if (docxResult.messages.length) {
          warnings.push(...docxResult.messages.map((m) => m.message))
        }
        return { text: docxResult.value, warnings }
      }

      case 'image/jpeg':
      case 'image/png': {
        const worker = await createWorker('eng')
        try {
          const ocrResult = await worker.recognize(file.buffer)
          return { text: ocrResult.data.text, warnings }
        } finally {
          await worker.terminate()
        }
      }

      default:
        return { text: '', warnings: ['Unsupported MIME type for text extraction.'] }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.toLowerCase().includes('password')) {
      warnings.push('The file appears to be password-protected and cannot be parsed.')
    } else {
      warnings.push(`Extraction failed: ${message}`)
    }
    return { text: '', warnings }
  }
}

function computeConfidence(fields: Extracted2307Fields): 'high' | 'medium' | 'low' {
  const present = [
    fields.payorTin,
    fields.payorName,
    fields.atcCode,
    fields.month1Amount,
    fields.month2Amount,
    fields.month3Amount,
    fields.cwtWithheld,
  ].filter(Boolean).length

  if (present >= 6) return 'high'
  if (present >= 4) return 'medium'
  return 'low'
}

/**
 * Parse Form 2307 candidate fields from plain text.
 *
 * Exported separately from `extract2307Fields` so unit tests can exercise the
 * regex heuristics without constructing a real document buffer.
 */
export function parse2307Text(text: string): Extracted2307Fields {
  const warnings: string[] = []
  const ctx: ParseContext = { text, warnings }

  if (!text.trim()) {
    return {
      confidence: 'low',
      warnings: ['No text could be extracted from the file.'],
    }
  }

  const monthAmounts = extractMonthAmounts(ctx)
  const payorTin = extractTin(ctx)
  const payorName = extractPayorName(ctx)
  const atcCode = extractAtcCode(ctx)
  const quarter = extractQuarter(ctx)
  const cwtWithheld = extractCwtWithheld(ctx)

  const fields: Extracted2307Fields = {
    payorTin,
    payorName,
    atcCode,
    quarter,
    month1Amount: monthAmounts.month1,
    month2Amount: monthAmounts.month2,
    month3Amount: monthAmounts.month3,
    cwtWithheld,
    confidence: 'low',
    warnings,
  }

  fields.confidence = computeConfidence(fields)

  if (!payorTin) fields.warnings.push('Payor TIN not found; please enter it manually.')
  if (!payorName) fields.warnings.push('Payor name not found; please enter it manually.')
  if (!atcCode) fields.warnings.push('ATC code not found; please select one manually.')
  if (!quarter) fields.warnings.push('Quarter not detected; please select it manually.')
  if (!monthAmounts.month1 || !monthAmounts.month2 || !monthAmounts.month3) {
    fields.warnings.push('One or more monthly amounts not detected; please review.')
  }
  if (!cwtWithheld) {
    fields.warnings.push('CWT withheld not detected; it will be calculated from the ATC rate.')
  }

  return fields
}

/**
 * Extract Form 2307 candidate fields from an uploaded file.
 *
 * The returned values are best-effort and must be reviewed by the user before
 * saving. No monetary or taxpayer assumptions are hardcoded; the parser only
 * surfaces values it found in the document.
 */
export async function extract2307Fields(file: ValidatedFile): Promise<Extracted2307Fields> {
  const { text, warnings } = await extractTextFromFile(file)
  const parsed = parse2307Text(text)
  parsed.warnings = [...warnings, ...parsed.warnings]
  return parsed
}

/**
 * Recalculate CWT withheld from monthly amounts and the ATC EWT rate.
 *
 * Useful when the parser could not locate the CWT figure or when a duplicate
 * is created and the user wants the value recomputed from the copied amounts.
 */
export function computeCwtFromAmounts(
  month1: string | number,
  month2: string | number,
  month3: string | number,
  ewtRate: number
): string {
  const total = new Decimal(String(month1 || 0))
    .plus(new Decimal(String(month2 || 0)))
    .plus(new Decimal(String(month3 || 0)))
  return total.times(ewtRate).toDecimalPlaces(2).toFixed(2)
}
