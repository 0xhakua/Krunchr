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

const MONTH_PATTERNS = [
  /(?:month\s*1|jan(?:uary)?|first\s*month|month\s*one)[^0-9]{0,20}([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2})/i,
  /(?:month\s*2|feb(?:ruary)?|second\s*month|month\s*two)[^0-9]{0,20}([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2})/i,
  /(?:month\s*3|mar(?:ch)?|third\s*month|month\s*three)[^0-9]{0,20}([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2})/i,
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
const TIN_12_PATTERN = /(?<!\d)(\d{12})(?!\d)/
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
    // payee section, once near the payor section. The payor TIN is the
    // one whose label sits closest to "Payor's Name" (within ~200 chars
    // on either side). We prefer labels *before* "Payor's Name" because
    // that's the standard form layout (Item 6 TIN, then Item 7 name),
    // but a label *after* the name is the next best signal — the
    // synthetic-text fixtures use that order. Do NOT exclude based on
    // the payee label position: the pdf2json order test puts the payor
    // TIN label *before* the payee's "Payee's Name" label.
    const tinLabel = /\(?\bTIN\b\)?|Taxpayer\s+Identification\s+Number/gi
    const labels: { index: number; length: number }[] = []
    let m: RegExpExecArray | null
    while ((m = tinLabel.exec(text)) !== null) {
      labels.push({ index: m.index, length: m[0].length })
    }

    const payorIndex = payorLabelMatch.index

    const candidateLabels = labels
      .filter((l) => Math.abs(l.index - payorIndex) < 200)
      .sort((a, b) => {
        const aBefore = a.index < payorIndex
        const bBefore = b.index < payorIndex
        if (aBefore && !bBefore) return -1
        if (!aBefore && bBefore) return 1
        return aBefore ? b.index - a.index : a.index - b.index
      })

    const payorTinLabel = candidateLabels[0]
    if (payorTinLabel) {
      const start = payorTinLabel.index + payorTinLabel.length
      const end = Math.min(text.length, start + 200)
      const snippet = text.slice(start, end)
      const tin = normalizeTin(snippet)
      console.log(
        `[ocr-parser] tin: label at ${payorTinLabel.index} ` +
          `("${text.slice(payorTinLabel.index, payorTinLabel.index + payorTinLabel.length)}") ` +
          `→ snippet ${start}-${end} → ${tin ?? '∅'}`
      )
      if (tin) return tin
    }

    // Final fallback: a narrow 200-char window before "Payor's Name".
    // Catches scans where the OCR drops or mangles the "TIN" label but
    // still produces the digit run. We deliberately do NOT look after
    // "Payor's Name" — that side contains the Part III table whose
    // amounts (e.g. "150,000.00") can be misread by tesseract.js into
    // a 12-digit dash-grouped run that the TIN regex would otherwise
    // happily match (issue #199: returned "115-000-001-500" from the
    // amounts row instead of the real payor TIN).
    const start = Math.max(0, payorIndex - 200)
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
  const collapsed = collapseDigitSpacing(text)
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
  // Most recent line that contained a single bare amount (no ATC, no other
  // text). If the next line is a valid 4-amount row, we treat the orphan
  // as that row's 3rd-month amount.
  let orphanAmount: string | undefined

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    // Detect a bare-amount line: just a number, nothing else.
    const standalone = line.match(/^([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2})$/)
    if (standalone) {
      const parsed = parseAmount(standalone[1])
      if (parsed) {
        orphanAmount = parsed
        continue
      }
    }

    const strictAtc = line.match(/\b([A-Za-z]{1,3}\d{3,4})\b/)
    const tolerantAtc = !strictAtc ? line.match(/\b([A-Za-z]{1,3}[0-9OIlLo]{3,5})\b/) : null
    const atcRaw = strictAtc?.[1] ?? tolerantAtc?.[1]
    if (!atcRaw) {
      // Some other text in between (header, label, etc.) — drop the orphan
      // so a stale value isn't attached to a far-away row.
      orphanAmount = undefined
      continue
    }

    const atcCode = strictAtc ? normalizeAtc(atcRaw) : cleanAtcCandidate(atcRaw)
    if (!atcCode) {
      orphanAmount = undefined
      continue
    }

    const rawAmounts = line.match(AMOUNT_PATTERN)
    const amounts = (rawAmounts ?? [])
      .map((raw) => parseAmount(raw))
      .filter((v): v is string => Boolean(v))
    if (amounts.length < 4) {
      orphanAmount = undefined
      continue
    }

    const month1 = amounts[0]
    const month2 = amounts[1]
    let month3 = amounts[2]
    const cwtWithheld = amounts[amounts.length - 1]

    // If the row has only 4 amounts (1st, 2nd, total, cwt) and we have an
    // orphan amount from the line above, use it as the 3rd-month amount.
    if (amounts.length === 4 && orphanAmount) {
      month3 = orphanAmount
    }

    if (!firstRow) {
      firstRow = { month1, month2, month3, cwtWithheld, atcCode }
    } else if (firstRow.atcCode !== atcCode) {
      extraRows++
    }

    orphanAmount = undefined
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
  const ctx: ParseContext = { text, warnings }

  if (!text.trim()) {
    return {
      confidence: 'low',
      warnings: ['No text could be extracted from the file.'],
    }
  }

  // Diagnostic log so we can see what tesseract.js actually emitted on a
  // real 2307 scan — the heuristics below can pick a wrong TIN if the
  // OCR mis-reads a cell, and seeing the raw text is the only way to
  // know whether to fix the parser or push back on the OCR quality.
  console.log(`[ocr-parser] raw text (${text.length} chars):\n${text}`)

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

  if (!cwtWithheld && tableRow.cwtWithheld) {
    cwtWithheld = tableRow.cwtWithheld
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
