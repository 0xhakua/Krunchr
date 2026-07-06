import fs from 'fs'
import path from 'path'
import PDFParser from 'pdf2json'
import mammoth from 'mammoth'
import { createWorker } from 'tesseract.js'
import Decimal from 'decimal.js'
import type { ValidatedFile } from '@/lib/upload/validation'

const OCR_TIMEOUT_MS = 60_000

function getOcrLangPath(): string {
  // Bundled English traineddata lives next to this module so tesseract.js
  // never has to reach out to jsDelivr (which is blocked/slow on Railway
  // and was the source of the "Reading file..." hang reported in #199).
  return path.join(process.cwd(), 'lib', 'ocr', 'tessdata')
}

export interface OcrAssetCheck {
  ok: boolean
  langPath: string
  engTraineddataBytes: number | null
  message: string
}

/**
 * Confirm that the bundled English traineddata is reachable at the
 * langPath that tesseract.js will read from. Logs a single line on first
 * call so Railway → Logs shows whether the file is in the deploy bundle
 * (issue #201). Returns the resolved path and byte length so the caller
 * can surface the same info via the public /api/health endpoint.
 */
export async function verifyOcrAssets(): Promise<OcrAssetCheck> {
  const langPath = getOcrLangPath()
  const traineddataPath = path.join(langPath, 'eng.traineddata')
  try {
    const stat = await fs.promises.stat(traineddataPath)
    const result: OcrAssetCheck = {
      ok: true,
      langPath,
      engTraineddataBytes: stat.size,
      message: `eng.traineddata present at ${traineddataPath} (${stat.size} bytes)`,
    }
    console.log(`[ocr-assets] ${result.message}`)
    return result
  } catch (err) {
    const result: OcrAssetCheck = {
      ok: false,
      langPath,
      engTraineddataBytes: null,
      message:
        err instanceof Error
          ? `eng.traineddata missing at ${traineddataPath}: ${err.message}`
          : `eng.traineddata missing at ${traineddataPath}`,
    }
    console.warn(`[ocr-assets] ${result.message}`)
    return result
  }
}

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

/**
 * Isolate the Payor Information section so the payee's own TIN/name
 * (which appears earlier on the form) is not mistaken for the payor's.
 */
function getPayorSection(text: string): string {
  const marker = /Payor Information/i.exec(text)
  if (!marker) return text
  return text.slice(marker.index)
}

/**
 * Remove cell-border noise between adjacent single digits. The 2307 form
 * lays out TINs and dates in one-box-per-character cells. Depending on
 * the input source, each cell separator may be emitted as:
 *   - whitespace (pdf2json uses U+00A0, tesseract.js often uses U+0020)
 *   - a comma or pipe (tesseract.js frequently misreads the cell border
 *     as a comma on image OCR of a real scan)
 * We collapse those specific characters between two adjacent digits. The
 * decimal point (`.`) and the thousands separator context are deliberately
 * left alone — the collapse must not eat the period in amounts like
 * `50,000.00`, otherwise the TIN regex downstream matches spurious digit
 * runs that span across newlines.
 *
 * We never cross newlines (carriage return or line feed) — otherwise
 * an item number like "7" on the next line would merge with the
 * trailing digit of the previous field (issue #199: the broader
 * `[\s,|]+` variant joined "123-456-789-000" to the next line's
 * "WI071" into "123-456-789-000071" and the TIN pattern then failed
 * to match because the trailing 4th group consumed "0000" and the
 * `(?![-\d])` lookahead saw the `7` from `WI071`).
 */
function collapseDigitSpacing(text: string): string {
  return text.replace(/(\d)[^\S\r\n,|]+(?=\d)/g, '$1')
}

/**
 * pdf2json emits fillable-form text in the order its underlying field
 * declarations are visited, which is rarely the visual reading order.
 * The 2018 ENCS Form 2307's TIN row is the canonical example: the four
 * 3-digit cells are emitted as `456 123 / 789 / 0000` instead of the
 * visual `789 456 123 0000`, and the date row's year and MMDD end up on
 * separate lines. Sorting by y then x restores the visual order so the
 * downstream regexes (which were written assuming canonical order) work
 * unchanged (#202).
 */
function extractReadingOrderText(pdfData: unknown): string {
  const pages = (pdfData as { Pages?: Array<{ Texts?: Array<{ x: number; y: number; R?: Array<{ T?: string }> }> }> } | null)?.Pages
  if (!pages || pages.length === 0) return ''

  const lines: string[] = []
  for (const page of pages) {
    const texts = page.Texts ?? []
    if (texts.length === 0) continue
    const sorted = [...texts].sort((a, b) => a.y - b.y || a.x - b.x)
    let currentY: number | null = null
    let currentLine: string[] = []
    const flush = () => {
      if (currentLine.length > 0) {
        const joined = currentLine.join(' ').replace(/\s+/g, ' ').trim()
        if (joined) lines.push(joined)
        currentLine = []
      }
    }
    for (const run of sorted) {
      if (currentY === null || Math.abs(run.y - currentY) <= 3) {
        currentY = currentY ?? run.y
      } else {
        flush()
        currentY = run.y
      }
      const raw = run.R?.[0]?.T
      if (raw === undefined) continue
      let decoded: string
      try {
        decoded = decodeURIComponent(raw)
      } catch {
        decoded = raw
      }
      currentLine.push(decoded)
    }
    flush()
  }
  return lines.join('\n')
}

/**
 * Normalise a fillable-PDF text dump so the existing regex heuristics can
 * match the digit-cell layout used by the 2018 ENCS Form 2307.
 *
 * - A standalone line of dashes (e.g. `---`, ` - - - `) is the visual
 *   column separator in the TIN row. We remove the line entirely so the
 *   digit cells on either side join into a single 12+ digit run that
 *   `TIN_12_PATTERN` can match (#202).
 * - Consecutive lines that contain only digits and whitespace are joined
 *   into a single space-separated line. pdf2json emits each form cell on
 *   its own line for fillable PDFs, and the existing `collapseDigitSpacing`
 *   refuses to cross newlines (by design, see #199).
 */
function preprocessOcrText(text: string): string {
  const withSeparators = text.replace(/^[ \t]*(?:-\s+){2,}[ \t]*$|^[ \t]*---[ \t]*$\n?/gm, '')
  const digitCellRe = /^[ \t]*\d(?:\s+\d)*[ \t]*$/
  const lines = withSeparators.split(/\r?\n/)
  const out: string[] = []
  let buffer = ''
  for (const line of lines) {
    if (digitCellRe.test(line)) {
      buffer = buffer ? `${buffer} ${line.trim()}` : line.trim()
    } else {
      if (buffer) {
        out.push(buffer)
        buffer = ''
      }
      out.push(line)
    }
  }
  if (buffer) out.push(buffer)
  return out.join('\n')
}

const MONTH_PATTERNS = [
  /(?:month\s*1|1st\s*month(?:\s*of(?:\s*the(?:\s*quarter)?)?)?|jan(?:uary)?|first\s*month|month\s*one)[\s\S]{0,200}?([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2})/i,
  /(?:month\s*2|2nd\s*month(?:\s*of(?:\s*the(?:\s*quarter)?)?)?|feb(?:ruary)?|second\s*month|month\s*two)[\s\S]{0,200}?([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2})/i,
  /(?:month\s*3|3rd\s*month(?:\s*of(?:\s*the(?:\s*quarter)?)?)?|mar(?:ch)?|third\s*month|month\s*three)[\s\S]{0,200}?([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2})/i,
]

// The 4th group (the branch) accepts 3 OR 4 digits. tesseract.js
// frequently reads the trailing branch cell of the 2307 form as a 4th
// digit (e.g. "0,0,0,0" for the branch, where the real form only has 3
// cells); a strict `(\d{3})` plus the negative lookahead would reject
// the whole match. We trim to 3 in `normalizeTin` below. The first three
// groups stay strict at 3 digits each — being permissive there causes
// the pattern to match unrelated digit runs joined by `\s*` across
// newlines in multi-line text.
const TIN_PATTERN = /(?<![-\d])(\d{3})\s*-\s*(\d{3})\s*-\s*(\d{3})(?:\s*-\s*(\d{3,4}))?(?![-\d])/
// TIN_12_PATTERN matches 12 OR 13 consecutive digits: the 4th group is
// commonly emitted as 4 digits by both tesseract.js and pdf2json for
// fillable PDFs (#202), giving a 13-digit run after the pre-pass joins
// the digit cells. The format step slices 0-3, 3-6, 6-9, 9-12 in both
// cases, so a 13th digit is silently dropped.
const TIN_12_PATTERN = /(?<!\d)(\d{12,13})(?!\d)/
const TIN_9_PATTERN = /(?<!\d)(\d{9})(?!\d)/

// tesseract.js commonly misreads the 2307 form's cell borders as
// brackets, parentheses, or other punctuation (e.g.
// "[7,8,9]-]4,5,6]-]1,2,3]-] 0,00,0"). Strip those before matching the
// TIN regex so the dashes in the canonical "789-456-123-000" shape
// aren't blocked by a stray `]` between the dash and the next group.
// Whitespace, digits, and dashes are preserved; everything else is
// removed (the amount-decimal `.` is intentionally kept out of the
// strip set since `normalizeTin` is only called on TIN-shaped snippets).
const TIN_NOISE_RE = /[^\d\s-]/g

function normalizeTin(raw: string): string | undefined {
  const cleaned = raw.replace(TIN_NOISE_RE, '')
  const collapsed = collapseDigitSpacing(cleaned)
  const dashMatch = collapsed.match(TIN_PATTERN)
  if (dashMatch) {
    const branchRaw = (dashMatch[4] ?? '000').slice(0, 3)
    const branch = branchRaw.padStart(3, '0')
    return `${dashMatch[1]}-${dashMatch[2]}-${dashMatch[3]}-${branch}`
  }

  const twelveMatch = collapsed.match(TIN_12_PATTERN)
  if (twelveMatch) {
    const digits = twelveMatch[1]
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)}-${digits.slice(9, 12)}`
  }

  const nineMatch = collapsed.match(TIN_9_PATTERN)
  if (nineMatch) {
    const digits = nineMatch[1]
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)}-000`
  }

  return undefined
}

function extractTin(ctx: ParseContext): string | undefined {
  const text = ctx.text
  // The 2307 form has two TINs: payee (Part I) and payor (Part II). We
  // anchor on the "Taxpayer Identification Number (TIN)" / "TIN" label
  // that's closest to "Payor's Name" going backward, rather than sweeping
  // a 500-char window that can pick up an unrelated 12-digit run from the
  // Part III table (issue #199: parser returned 115-000-001-500 from a
  // misread amount cluster instead of the real 789-456-123-000).
  const apostrophe = "[\u0027\u2019]"
  const payorLabelMatch = new RegExp(`Payor${apostrophe}?s?\\s*Name`, 'i').exec(text)

  if (payorLabelMatch) {
    // The "TIN" label appears twice on a real 2307 form: once near the
    // payee section, once near the payor section. Pick the closest TIN
    // label to "Payor's Name" without a hard distance cap, because the
    // 2018 ENCS fillable PDF (#202) scatters hundreds of whitespace
    // characters between the payor name and the payor TIN label, and a
    // 200-char window misses it entirely. We still prefer labels *before*
    // "Payor's Name" (the standard form layout puts Item 6 TIN before
    // Item 7 name) but fall back to the nearest label after the name
    // when no earlier label exists.
    const tinLabel = /\(?\bTIN\b\)?|Taxpayer\s+Identification\s+Number/gi
    const labels: { index: number; length: number }[] = []
    let m: RegExpExecArray | null
    while ((m = tinLabel.exec(text)) !== null) {
      labels.push({ index: m.index, length: m[0].length })
    }

    const payorIndex = payorLabelMatch.index

    const candidateLabels = [...labels].sort((a, b) => {
      const distA = Math.abs(a.index - payorIndex)
      const distB = Math.abs(b.index - payorIndex)
      if (distA !== distB) return distA - distB
      const aBefore = a.index < payorIndex
      const bBefore = b.index < payorIndex
      if (aBefore && !bBefore) return -1
      if (!aBefore && bBefore) return 1
      return aBefore ? b.index - a.index : a.index - b.index
    })

    const payorTinLabel = candidateLabels[0]
    if (payorTinLabel) {
      const start = payorTinLabel.index + payorTinLabel.length
      const end = Math.min(text.length, start + 400)
      const snippet = text.slice(start, end)
      const tin = normalizeTin(snippet)
      console.log(
        `[ocr-parser] tin: label at ${payorTinLabel.index} ` +
          `("${text.slice(payorTinLabel.index, payorTinLabel.index + payorTinLabel.length)}") ` +
          `→ snippet ${start}-${end} → ${tin ?? '∅'}`
      )
      if (tin) return tin
    }

    // Final fallback: a 400-char window before "Payor's Name". Catches
    // scans where the OCR drops or mangles the "TIN" label but still
    // produces the digit run. We deliberately do NOT look after "Payor's
    // Name" in this fallback — that side contains the Part III table
    // whose amounts (e.g. "150,000.00") can be misread by tesseract.js
    // into a 12-digit dash-grouped run that the TIN regex would
    // otherwise happily match (issue #199: returned "115-000-001-500"
    // from the amounts row instead of the real payor TIN).
    const start = Math.max(0, payorIndex - 400)
    const snippet = text.slice(start, payorIndex)
    const fallbackTin = normalizeTin(snippet)
    console.log(
      `[ocr-parser] tin: no label hit, fallback window ${start}-${payorIndex} → ${fallbackTin ?? '∅'}`
    )
    return fallbackTin
  }

  return normalizeTin(getPayorSection(text))
}

function normalizeAtc(code: string): string {
  const match = code.match(/^([A-Za-z]+)(\d+)$/)
  if (!match) return code.toUpperCase()
  const letters = match[1].toUpperCase()
  const digits = match[2].replace(/^0+/, '') || '0'
  const normalizedDigits = digits.length >= 3 ? digits : digits.padStart(3, '0')
  return `${letters}${normalizedDigits}`
}

/**
 * Normalize an ATC candidate that may contain OCR errors in the numeric part
 * (e.g. WCO010 -> WC010, wcioo -> WC100). The letter prefix is left as-is.
 */
function cleanAtcCandidate(raw: string): string | undefined {
  const match = raw.match(/^([A-Za-z]{1,3})([0-9OIlLo]{3,5})$/)
  if (!match) return undefined

  const letters = match[1].toUpperCase()
  const digits = match[2]
    .replace(/[oO]/g, '0')
    .replace(/[iIlL]/g, '1')

  if (!/^\d+$/.test(digits)) return undefined

  const trimmed = digits.replace(/^0+/, '') || '0'
  const normalizedDigits = trimmed.length >= 3 ? trimmed : trimmed.padStart(3, '0')
  return `${letters}${normalizedDigits}`
}

function extractAtcCode(ctx: ParseContext): string | undefined {
  const text = ctx.text

  // Strict match for already-valid codes.
  const strictMatch = text.match(/\b([A-Za-z]{1,3}\d{3,4})\b/)
  if (strictMatch) return normalizeAtc(strictMatch[1])

  // OCR-tolerant match for codes with misread digits.
  const tolerantMatch = text.match(/\b([A-Za-z]{1,3}[0-9OIlLo]{3,5})\b/)
  if (tolerantMatch) {
    const cleaned = cleanAtcCandidate(tolerantMatch[1])
    if (cleaned) return cleaned
  }

  return undefined
}

function extractPayorName(ctx: ParseContext): string | undefined {
  const text = ctx.text

  // pdf2json emits U+2019 (right single quotation mark) for the apostrophe in
  // "Payor's"; accept both straight and curly forms in the label regex.
  const apostrophe = "[\u0027\u2019]"

  // Strategy 1: name on the same line as the "Payor's Name" label
  // (e.g. "Payor's Name: ACME Philippines" or with the parenthetical hint).
  // The character class uses a literal space (not \s) so the capture stops at
  // the next line and we don't accidentally swallow the TIN row.
  const sameLinePatterns = [
    new RegExp(
      `(?:payor${apostrophe}?s?\\s*name|name\\s*of\\s*payor|from\\s*whom\\s*income\\s*was\\s*received)[\\s:]*([A-Z(][A-Za-z0-9 ,&.'()-]{0,120})`,
      'i'
    ),
  ]
  for (const pattern of sameLinePatterns) {
    const match = text.match(pattern)
    if (match) {
      const name = cleanPayorNameCapture(match[1])
      if (name && name.length > 2 && isLikelyPayorName(name)) return name
    }
  }

  // Strategy 2: name on a separate line adjacent to the "Payor's Name"
  // label. pdf2json sometimes emits the value BEFORE the label depending on
  // the PDF's field declaration order, so check both directions.
  const payorLabelMatch = new RegExp(`Payor${apostrophe}?s?\\s*Name`, 'i').exec(text)
  if (!payorLabelMatch) return undefined

  const beforeLines = text
    .slice(0, payorLabelMatch.index)
    .split(/\n|\r/)
    .map((l) => l.trim())
    .filter(Boolean)
  for (let i = beforeLines.length - 1; i >= Math.max(0, beforeLines.length - 3); i--) {
    const line = beforeLines[i]
    if (isLikelyPayorName(line)) return line
  }

  const afterLines = text
    .slice(payorLabelMatch.index)
    .split(/\n|\r/)
    .map((l) => l.trim())
    .filter(Boolean)
  for (let i = 1; i < Math.min(4, afterLines.length); i++) {
    const line = afterLines[i]
    if (isLikelyPayorName(line)) return line
  }

  return undefined
}

function isLikelyPayorName(line: string): boolean {
  if (line.length < 2 || line.length > 80) return false
  if (!/[A-Za-z]/.test(line[0])) return false
  if (/\d/.test(line)) return false
  if (/TIN|Address|ZIP|Foreign|Registered|Taxpayer|Payee|Part\s|Signature/i.test(line)) return false
  if (/City|St\.|Avenue|Ave\.|Street|Rd\.?|Road|Barangay|Brgy|Province/i.test(line)) return false
  return true
}

/**
 * Real 2307 scans often include the parenthetical description
 * "(Last Name, First Name, Middle Name for Individual OR Registered Name for
 * Non-Individual)" on the same line as the label and the actual name. Strip
 * that description so the user sees the company name, not the field hint.
 *
 * Returns undefined when no plausible name can be recovered, so the caller
 * can fall back to a line-adjacency strategy.
 */
function cleanPayorNameCapture(raw: string): string | undefined {
  const lines = raw.split(/\n|\r/).map((l) => l.trim()).filter(Boolean)
  const firstLine = lines[0] ?? ''
  if (!firstLine.startsWith('(')) return firstLine

  const closeParen = firstLine.indexOf(')')
  if (closeParen !== -1) {
    const tail = firstLine.slice(closeParen + 1).trim()
    if (tail.length >= 2 && isLikelyPayorName(tail)) return tail
  }
  return undefined
}

function quarterFromMonth(month: number): number | undefined {
  if (month >= 1 && month <= 3) return 1
  if (month >= 4 && month <= 6) return 2
  if (month >= 7 && month <= 9) return 3
  if (month >= 10 && month <= 12) return 4
  return undefined
}

function extractQuarterFromPeriod(text: string): number | undefined {
  // The 2018 ENCS fillable PDF (#202) places the year and MMDD on
  // separate visual rows from the "For the Period / From / To" labels.
  // Build a snippet that starts at the label and runs 300 chars into
  // the text so the regex can see both the keyword and the digits.
  const labelMatch = /(for the period|period|from|to)/i.exec(text)
  const window = labelMatch
    ? text.slice(labelMatch.index, Math.min(text.length, labelMatch.index + 300))
    : text
  // Collapse newlines into spaces so the regex can match across the
  // label line and the digit-cell line below it.
  const collapsed = collapseDigitSpacing(window.replace(/\r?\n/g, ' '))
  // Real 2307 scans often drop the slash separators between day/month/year
  // when each character sits in its own form box, so we accept MM/DD/YYYY,
  // MM-DD-YYYY, MM.DD.YYYY, and the no-separator MMDDYYYY form.
  const patterns = [
    /(?:for the period|period)[\s:]*(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/i,
    /(?:from)[\s:]*(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/i,
    /(?:to)[\s:]*(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/i,
  ]

  for (const pattern of patterns) {
    const match = collapsed.match(pattern)
    if (match) {
      const month = Number(match[1])
      const quarter = quarterFromMonth(month)
      if (quarter) return quarter
    }
  }

  // No-separator fallback: a "from" or "to" keyword followed by at least four
  // digits. The year may or may not be on the same line, so accept both
  // "from 0101" (just MMDD) and "from 01012026" (MMDDYYYY, the year
  // collapsed together with the date by collapseDigitSpacing).
  const noSepMatch = collapsed.match(/(?:from|to)[\s:]*(\d{2})(\d{2})(?:\d{4})?/i)
  if (noSepMatch) {
    const quarter = quarterFromMonth(Number(noSepMatch[1]))
    if (quarter) return quarter
  }

  return undefined
}

function extractQuarter(ctx: ParseContext): number | undefined {
  const text = ctx.text
  const explicitPatterns = [
    { regex: /\bq1\b|\b1st\s*quarter\b|\bquarter\s*1\b/i, quarter: 1 },
    { regex: /\bq2\b|\b2nd\s*quarter\b|\bquarter\s*2\b/i, quarter: 2 },
    { regex: /\bq3\b|\b3rd\s*quarter\b|\bquarter\s*3\b/i, quarter: 3 },
    { regex: /\bq4\b|\b4th\s*quarter\b|\bquarter\s*4\b/i, quarter: 4 },
  ]

  for (const { regex, quarter } of explicitPatterns) {
    if (regex.test(text)) return quarter
  }

  // Fallback: infer from "For the Period 01/01/2026 ... 03/31/2026".
  return extractQuarterFromPeriod(text)
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

const AMOUNT_PATTERN = /[0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2}/g

/**
 * Extract monthly amounts and CWT from a 2307 Part II table row.
 * Real 2307 scans often omit the "Month 1/2/3" labels and simply list
 * amounts in order after an ATC code, e.g.:
 *   Professional Fees WC010 50,000.00 50,000.00 50,000.00 150,000.00 15,000.00
 * Returns the first matching row and warns if additional income rows exist.
 *
 * pdf2json sometimes emits one of the monthly amount cells on a separate
 * line above the rest of the row (because the cell's PDF position is offset
 * from its row's other cells). We detect this by remembering the previous
 * "orphan" line and folding it in as the 3rd-month amount when the current
 * row has only 4 amounts.
 */
function extractTableRowAmounts(
  ctx: ParseContext
): { month1?: string; month2?: string; month3?: string; cwtWithheld?: string; atcCode?: string; extraRows?: number } {
  const lines = ctx.text.split(/\r?\n/)

  let firstRow:
    | { month1: string; month2: string; month3: string; cwtWithheld: string; atcCode: string }
    | undefined
  let extraRows = 0
  let orphanAmount: string | undefined
  let pendingAmounts: { month1?: string; month2?: string; month3?: string; cwtWithheld?: string } | undefined
  // The most recent ATC code we saw without a same-line amount set. The
  // 2018 ENCS fillable PDF (#202) emits the ATC on its own line and the
  // amounts one or two lines below; we attach the amounts to the most
  // recent pending ATC at end-of-input (and also when a *new* ATC line
  // appears, to handle the case where the same line has both ATC and
  // amounts and should win over the pending ATC).
  let pendingAtc: string | undefined

  const flushPending = (atcCode: string) => {
    if (!pendingAmounts?.month1) return
    if (firstRow && firstRow.atcCode === atcCode) return
    const m1 = pendingAmounts.month1
    const m2 = pendingAmounts.month2 ?? m1
    const m3 = pendingAmounts.month3 ?? m2
    const row = {
      month1: m1,
      month2: m2,
      month3: m3,
      cwtWithheld: pendingAmounts.cwtWithheld ?? cwtFromLabeledAmounts(ctx) ?? m3,
      atcCode,
    }
    if (!firstRow) {
      firstRow = row
    } else if (firstRow.atcCode !== atcCode) {
      extraRows++
    }
    pendingAmounts = undefined
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    const standalone = line.match(/^([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2})$/)
    if (standalone) {
      const parsed = parseAmount(standalone[1])
      if (parsed) {
        orphanAmount = parsed
        continue
      }
    }

    const lineAmounts = (line.match(AMOUNT_PATTERN) ?? [])
      .map((raw) => parseAmount(raw))
      .filter((v): v is string => Boolean(v))

    const strictAtc = line.match(/\b([A-Za-z]{1,3}\d{3,4})\b/)
    const tolerantAtc = !strictAtc ? line.match(/\b([A-Za-z]{1,3}[0-9OIlLo]{3,5})\b/) : null
    const atcRaw = strictAtc?.[1] ?? tolerantAtc?.[1]

    if (!atcRaw) {
      if (lineAmounts.length >= 3) {
        // The 2307 form's amounts row is laid out as
        // [Month 1, Month 2, Month 3, Total, Tax Withheld]. The CWT
        // (tax withheld for the quarter) is always the rightmost
        // amount on the line, so take the last one (#202: the BIR
        // template sometimes emits only 4 amounts and sometimes 5,
        // depending on the form variant).
        pendingAmounts = {
          month1: lineAmounts[0],
          month2: lineAmounts[1],
          month3: lineAmounts[2],
          cwtWithheld: lineAmounts[lineAmounts.length - 1],
        }
      } else if (lineAmounts.length === 0) {
        pendingAmounts = undefined
      }
      orphanAmount = undefined
      continue
    }

    const atcCode = strictAtc ? normalizeAtc(atcRaw) : cleanAtcCandidate(atcRaw)
    if (!atcCode) {
      pendingAmounts = undefined
      orphanAmount = undefined
      continue
    }

    let month1: string | undefined
    let month2: string | undefined
    let month3: string | undefined
    let cwtWithheld: string | undefined

    if (lineAmounts.length >= 4) {
      month1 = lineAmounts[0]
      month2 = lineAmounts[1]
      month3 = lineAmounts[2]
      cwtWithheld = lineAmounts[lineAmounts.length - 1]
      if (lineAmounts.length === 4 && orphanAmount) {
        month3 = orphanAmount
      }
      pendingAmounts = undefined
    } else if (pendingAmounts?.month1) {
      month1 = pendingAmounts.month1
      month2 = pendingAmounts.month2
      month3 = pendingAmounts.month3
      cwtWithheld = pendingAmounts.cwtWithheld ?? cwtFromLabeledAmounts(ctx) ?? lineAmounts[lineAmounts.length - 1]
      pendingAmounts = undefined
    } else {
      // ATC line with no same-line amounts and no buffered amounts yet.
      // Stash it so a later amount-only line can attach to it.
      pendingAtc = atcCode
      orphanAmount = undefined
      continue
    }

    if (!firstRow) {
      firstRow = {
        month1: month1 ?? '',
        month2: month2 ?? month1 ?? '',
        month3: month3 ?? month2 ?? month1 ?? '',
        cwtWithheld: cwtWithheld ?? month3 ?? month2 ?? month1 ?? '',
        atcCode,
      }
    } else if (firstRow.atcCode !== atcCode) {
      extraRows++
    }

    pendingAtc = undefined
    orphanAmount = undefined
  }

  // End-of-text: if we still have a pending ATC and buffered amounts,
  // attach them now. This handles the 2018 ENCS fillable layout where
  // the ATC is emitted on its own line at the top of the table and the
  // amounts are emitted on the last line, with no "next" ATC to flush
  // them against.
  if (pendingAtc && pendingAmounts?.month1) {
    flushPending(pendingAtc)
  }

  if (!firstRow) return {}

  return {
    month1: firstRow.month1,
    month2: firstRow.month2,
    month3: firstRow.month3,
    cwtWithheld: firstRow.cwtWithheld,
    atcCode: firstRow.atcCode,
    extraRows,
  }
}

function cwtFromLabeledAmounts(ctx: ParseContext): string | undefined {
  return extractCwtWithheld(ctx)
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

    pdfParser.on('pdfParser_dataReady', (pdfData: unknown) => {
      if (!resolved) {
        resolved = true
        const readingOrder = extractReadingOrderText(pdfData)
        const fallback = pdfParser.getRawTextContent()
        resolve(readingOrder || fallback)
      }
    })

    pdfParser.parseBuffer(buffer)
  })
}

async function extractTextFromImage(
  file: ValidatedFile
): Promise<{ text: string; warnings: string[] }> {
  const warnings: string[] = []
  const langPath = getOcrLangPath()
  const startedAt = Date.now()

  // We deliberately suppress the unhandled-rejection from the `work` promise
  // because if the timeout wins, `createWorker` and/or `worker.recognize` may
  // still resolve/reject in the background — we don't want to crash the route.
  const work = (async () => {
    const w = await createWorker('eng', 1, {
      langPath,
      gzip: false,
      cacheMethod: 'none',
      logger: (m) => {
        if (!m.status) return
        const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
        const pct = Math.round((m.progress ?? 0) * 100)
        // Server-side log so the user can see what's happening when the
        // client spinner is up. Filtered to the long phases only.
        if (
          m.status === 'loading tesseract core' ||
          m.status === 'initializing tesseract' ||
          m.status === 'loading language traineddata' ||
          m.status === 'initializing api' ||
          m.status === 'recognizing text'
        ) {
          console.log(`[ocr ${elapsed}s] ${m.status} (${pct}%)`)
        }
      },
    })
    try {
      const result = await w.recognize(file.buffer)
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
      console.log(`[ocr ${elapsed}s] recognize complete (${result.data.text.length} chars)`)
      return { worker: w, result }
    } catch (err) {
      w.terminate().catch(() => {})
      throw err
    }
  })()
  work.catch(() => {})

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Image OCR timed out after ${OCR_TIMEOUT_MS / 1000}s`)),
      OCR_TIMEOUT_MS
    )
  })

  try {
    const { worker, result } = await Promise.race([work, timeout])
    if (timer) clearTimeout(timer)
    worker.terminate().catch(() => {})
    return { text: result.data.text, warnings }
  } catch (err) {
    if (timer) clearTimeout(timer)
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
    console.warn(`[ocr ${elapsed}s] aborted:`, err instanceof Error ? err.message : err)
    const message = err instanceof Error ? err.message : String(err)
    if (message.toLowerCase().includes('timed out')) {
      warnings.push(
        `Image OCR timed out after ${OCR_TIMEOUT_MS / 1000}s. Try a higher-resolution scan or upload the PDF version.`
      )
    } else {
      warnings.push(`Image OCR failed: ${message}`)
    }
    return { text: '', warnings }
  }
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
      case 'image/png':
        return extractTextFromImage(file)

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
  const normalised = preprocessOcrText(text)
  const ctx: ParseContext = { text: normalised, warnings }

  if (!normalised.trim()) {
    return {
      confidence: 'low',
      warnings: ['No text could be extracted from the file.'],
    }
  }

  // Diagnostic log so we can see what the PDF/OCR backend actually emitted
  // on a real 2307 scan — the heuristics below can pick a wrong TIN if
  // a cell is mis-read, and seeing the raw text is the only way to know
  // whether to fix the parser or push back on the input quality.
  console.log(`[ocr-parser] raw text (${normalised.length} chars):\n${normalised}`)

  const monthAmounts = extractMonthAmounts(ctx)
  const tableRow = extractTableRowAmounts(ctx)
  const payorTin = extractTin(ctx)
  const payorName = extractPayorName(ctx)
  let atcCode = extractAtcCode(ctx)
  const quarter = extractQuarter(ctx)
  let cwtWithheld = extractCwtWithheld(ctx)

  const month1Amount = monthAmounts.month1 ?? tableRow.month1
  const month2Amount = monthAmounts.month2 ?? tableRow.month2
  const month3Amount = monthAmounts.month3 ?? tableRow.month3

  // Prefer the table-row CWT (the last amount on the amounts line) over
  // the labelled CWT. The labelled lookup matches the FIRST amount after
  // the "Tax Withheld" label, which on the 2018 ENCS fillable PDF (#202)
  // is the first monthly amount rather than the actual CWT figure.
  if (tableRow.cwtWithheld) {
    cwtWithheld = tableRow.cwtWithheld
  } else {
    cwtWithheld = extractCwtWithheld(ctx)
  }

  if (!atcCode && tableRow.atcCode) {
    atcCode = tableRow.atcCode
  }

  if (tableRow.extraRows && tableRow.extraRows > 0) {
    warnings.push(
      `Multiple income lines detected; only the first line (${tableRow.atcCode ?? 'unknown ATC'}) was imported. Add another certificate for the remaining line(s).`
    )
  }

  const fields: Extracted2307Fields = {
    payorTin,
    payorName,
    atcCode,
    quarter,
    month1Amount,
    month2Amount,
    month3Amount,
    cwtWithheld,
    confidence: 'low',
    warnings,
  }

  fields.confidence = computeConfidence(fields)

  console.log(
    `[ocr-parser] extracted: tin=${payorTin ?? '∅'} atc=${atcCode ?? '∅'} ` +
      `name=${payorName ?? '∅'} q=${quarter ?? '∅'} ` +
      `m1=${month1Amount ?? '∅'} m2=${month2Amount ?? '∅'} m3=${month3Amount ?? '∅'} ` +
      `cwt=${cwtWithheld ?? '∅'} conf=${fields.confidence}`
  )

  if (!payorTin) fields.warnings.push('Payor TIN not found; please enter it manually.')
  if (!payorName) fields.warnings.push('Payor name not found; please enter it manually.')
  if (!atcCode) fields.warnings.push('ATC code not found; please select one manually.')
  if (!quarter) fields.warnings.push('Quarter not detected; please select it manually.')
  if (!month1Amount || !month2Amount || !month3Amount) {
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
