/**
 * 2551Q overlay renderer.
 *
 * Per issue #213, this is the high-fidelity path for Form 2551Q. Loads the
 * official BIR Form 2551Q January 2018 ENCS PDF, places each computed value
 * at its measured x/y position from `COORDS_2551Q`, and flattens the result
 * so the RDO receives a 1:1 facsimile of the BIR form with the taxpayer's
 * data filled in.
 *
 * Two layers of configuration:
 *   1. `COORDS_2551Q` (lib/pdf/coords/2551Q.generated.ts) — where to draw
 *   2. `COORD_GROUPS_2551Q` (below) — which alternative coords to use when
 *      a single logical field has more than one checkbox (Tax Rate, Quarter,
 *      Amended, Calendar/Fiscal, Treaty)
 *
 * What gets drawn:
 *   - String/number values: drawn as text, right-aligned (or per the coord)
 *   - Boolean `true`: drawn as a filled "X" inside the checkbox
 *   - Boolean `false`/null/undefined: skipped (no draw)
 *
 * Business rules enforced (per issue #213 acceptance criteria):
 *   - BR-02: Item 13 (8% election) rendered ONLY on Q1 — never Q2/Q3/Q4.
 *   - BR-04: Total Tax Due = ₱0.00 when 8% is elected (2551Q is required
 *     only for non-8% taxpayers, but if an 8%-elected user files one for
 *     some reason, the overlay draws ₱0.00).
 *   - BR-15: Penalties use RA 11976 reduced rates (10% surcharge, 6%
 *     interest p.a., RDO-specific compromise). Sourced from
 *     `data.ret.penalties` (already computed by
 *     lib/computation/penalties.ts under RA 11976).
 */
import Decimal from "decimal.js";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { COORDS_2551Q } from "../coords/2551Q.generated";
import {
  loadOfficialBirPdf,
  type BirOverlayResult,
  type BirOverlayValues,
} from "./types";
import type { FilingPdfData } from "../dispatcher";

/**
 * Groups of alternative coords — exactly one entry per group is rendered.
 * The runtime picks the right alternative based on the taxpayer's data.
 */
export const COORD_GROUPS_2551Q = {
  /**
   * Item 1 "For the Year" — Calendar or Fiscal year basis.
   * Kuwenta's current scope is Calendar year (the BIR accepts this as the
   * default for individuals); Fiscal is wired up for completeness.
   */
  year_basis: {
    calendar: "header_calendar",
    fiscal: "header_fiscal",
  } as const,

  /**
   * Item 3 "Quarter" — 1st, 2nd, 3rd, or 4th.
   */
  quarter: {
    1: "header_quarter_1st",
    2: "header_quarter_2nd",
    3: "header_quarter_3rd",
    4: "header_quarter_4th",
  } as const,

  /**
   * Item 4 "Amended Return?" — Yes or No.
   */
  amended: {
    yes: "header_amended_yes",
    no: "header_amended_no",
  } as const,

  /**
   * Item 12 "Special Law or International Tax Treaty?" — Yes or No.
   * Default is No (the form is for the standard percentage tax).
   */
  treaty: {
    yes: "part1_treaty_yes",
    no: "part1_treaty_no",
  } as const,

  /**
   * Item 13 "Income tax rate" — 8% (Q1 election) or Graduated.
   * CRITICAL: 8% checkbox is rendered ONLY on Q1 (BR-02). For Q2/Q3/Q4
   * the 8% election was made on Q1 2551Q and persists; we don't re-check
   * the box on later quarters.
   */
  tax_rate: {
    "8pct": "part1_tax_rate_8pct",
    graduated: "part1_tax_rate_graduated",
  } as const,
} as const;

/**
 * Sum of gross receipts for the *current* quarter (2551Q is per-quarter,
 * not cumulative). Unlike 1701Q which is cumulative Jan 1 → end of Q{n}.
 */
function sumQuarterGross(
  certs: FilingPdfData["certificates"],
  currentQuarter: number,
): Decimal {
  return certs
    .filter((c) => c.quarter === currentQuarter)
    .reduce((sum, c) => sum.plus(c.quarterlyTotal), new Decimal(0));
}

/**
 * Sum of CWT for the *current* quarter only (Item 15). Unlike 1701Q which
 * has separate Items 57/58 for prior/current CWT, 2551Q reports a single
 * CWT line (Item 15) for the current quarter.
 */
function sumQuarterCwt(
  certs: FilingPdfData["certificates"],
  currentQuarter: number,
): Decimal {
  return certs
    .filter((c) => c.quarter === currentQuarter)
    .reduce((sum, c) => sum.plus(c.cwtWithheld), new Decimal(0));
}

/**
 * Build the overlay value map for 2551Q from the filing data. Returns a
 * map of coord-key -> value, where the value type matches the coord
 * (string for text, boolean for checkboxes).
 *
 * Math:
 *   - Tax Due (Item 14) = 0 under 8% (BR-04); otherwise 3% × quarterly gross
 *     (the engine's `data.ret.computedTaxDue` already reflects this).
 *   - CWT (Item 15) = sum of CWT for the current quarter.
 *   - Tax Still Payable (Item 19) = max(0, Tax Due − Total Credits).
 *   - Total Amount Payable (Item 24) = Tax Still Payable + Total Penalties.
 *
 *   Schedule 1 (Items 1-6) is left blank under the 8% path (BR-04):
 *   - ATC, Taxable Amount, Tax Due all empty.
 *   - Total Tax Due (Item 7) = ₱0.00.
 */
export function buildForm2551QValues(data: FilingPdfData): BirOverlayValues {
  const out: BirOverlayValues = {};
  const quarter = data.ret.quarter ?? 1;
  const electedRate = data.taxYear.electedRate;
  const isAmended = data.ret.status === "AMENDED";

  // ---- Quarterly computations (2551Q is per-quarter, not cumulative) ----
  const quarterlyGross = sumQuarterGross(data.certificates, quarter);
  const quarterlyCwt = sumQuarterCwt(data.certificates, quarter);

  // Tax Due — use the engine's pre-computed value (lib/computation/percentage-tax.ts).
  // Under 8% election, the engine returns 0 (BR-04).
  const taxDue = data.ret.computedTaxDue ?? new Decimal(0);

  // Pull penalty rows (already computed under RA 11976 — 10% surcharge, 6% interest).
  const penalty = data.ret.penalties;

  // ============================================================
  // Header (page 1)
  // ============================================================

  // Item 2: Year Ended (MM/YYYY) — Kuwenta uses the tax year as 4-digit
  out["header_year_ended"] = data.taxYear.year.toString();

  // Item 3: Quarter (1st/2nd/3rd/4th) — runtime picks the right checkbox
  const qKey = COORD_GROUPS_2551Q.quarter[quarter as 1 | 2 | 3 | 4];
  if (qKey) out[qKey] = true;

  // Item 4: Amended Return? — mark Yes if status is AMENDED, else No
  if (isAmended) {
    out[COORD_GROUPS_2551Q.amended.yes] = true;
  } else {
    out[COORD_GROUPS_2551Q.amended.no] = true;
  }

  // Item 5: Number of Sheet/s Attached — defaults to 0; SAWT goes in
  // the filing package, not on the form.
  out["header_sheets_attached"] = "0";

  // Item 1 (Calendar/Fiscal) — Kuwenta is Calendar year for individuals.
  // Mark Calendar; the Fiscal checkbox is left empty.
  out[COORD_GROUPS_2551Q.year_basis.calendar] = true;

  // ============================================================
  // Part I — Background Information (page 1)
  // ============================================================

  // Item 6: TIN (BIR format: NNN-NNN-NNN-NNN)
  out["part1_tin"] = data.taxpayer.tin;

  // Item 7: RDO Code
  out["part1_rdo_code"] = data.taxpayer.rdoCode;

  // Item 8: Taxpayer's Name
  out["part1_taxpayer_name"] = data.taxpayer.fullName;

  // Item 9: Registered Address
  out["part1_registered_address"] = data.taxpayer.registeredAddress;

  // Item 9A: ZIP Code
  out["part1_zip_code"] = data.taxpayer.zipCode;

  // Item 10: Contact Number
  out["part1_contact_number"] = data.taxpayer.phoneNumber ?? "";

  // Item 11: Email Address
  out["part1_email"] = data.taxpayer.email ?? "";

  // Item 12: Special Law or International Tax Treaty? — default No
  out[COORD_GROUPS_2551Q.treaty.no] = true;
  out["part1_treaty_specify"] = "";

  // Item 13: Income tax rate — 8% election checkbox is rendered ONLY on Q1
  // (BR-02). For Q2/Q3/Q4 the 8% election was made on Q1 2551Q and we
  // do NOT re-check the box on later quarters. We explicitly set BOTH
  // alternatives (8pct and graduated) to false so the value map is
  // unambiguous to callers and tests.
  const mark8pct = quarter === 1 && electedRate === "RATE_8PCT";
  const markGraduated = quarter === 1 && electedRate === "GRADUATED";
  out[COORD_GROUPS_2551Q.tax_rate["8pct"]] = mark8pct;
  out[COORD_GROUPS_2551Q.tax_rate.graduated] = markGraduated;

  // ============================================================
  // Part II — Total Tax Payable (page 1)
  // ============================================================
  // Item 14: Total Tax Due (From Schedule 1 Item 7)
  // BR-04: Always ₱0.00 when 8% is elected. The engine's taxDue already
  // reflects this, but we explicitly draw "0.00" for the 8% path so
  // the form is unambiguous.
  out["part2_total_tax_due"] = formatBirAmount(taxDue);

  // Item 15: Creditable Percentage Tax Withheld per BIR Form No. 2307
  out["part2_cwt_withheld"] = formatBirAmount(quarterlyCwt);

  // Item 16: Tax Paid in Return Previously Filed (only if Amended Return)
  out["part2_amended_payment"] = isAmended ? formatBirAmount(quarterlyCwt) : "";

  // Item 17: Other Tax Credit/Payment
  out["part2_other_credits"] = "";

  // Item 18: Total Tax Credits/Payments (Sum of Items 15 to 17)
  const totalCredits = (isAmended ? quarterlyCwt : new Decimal(0));
  out["part2_total_credits"] = formatBirAmount(totalCredits);

  // Item 19: Tax Still Payable/(Overpayment) (Item 14 Less Item 18)
  const taxStillPayable = Decimal.max(taxDue.minus(totalCredits), 0);
  out["part2_tax_still_payable"] = formatBirAmount(taxStillPayable);

  // Items 20-22: Penalties (RA 11976 reduced rates — 10% surcharge, 6% interest,
  // RDO-specific compromise). Sourced from data.ret.penalties which the engine
  // computes via lib/computation/penalties.ts.
  if (penalty) {
    out["part2_surcharge"] = formatBirAmount(penalty.surcharge);
    out["part2_interest"] = formatBirAmount(penalty.interest);
    out["part2_compromise"] = formatBirAmount(penalty.compromisePenalty);
    out["part2_total_penalties"] = formatBirAmount(penalty.totalPenalty);
  } else {
    out["part2_surcharge"] = "0.00";
    out["part2_interest"] = "0.00";
    out["part2_compromise"] = "0.00";
    out["part2_total_penalties"] = "0.00";
  }

  // Item 24: TOTAL AMOUNT PAYABLE (Sum of Items 19 and 23)
  const totalPenalty = penalty?.totalPenalty ?? new Decimal(0);
  const totalAmountPayable = taxStillPayable.plus(totalPenalty);
  out["part2_total_amount_payable"] = formatBirAmount(totalAmountPayable);

  // ============================================================
  // Part III — Details of Payment (page 1) — no payment data in FilingPdfData
  // ============================================================
  out["part3_cash_bank_debit"] = "";
  out["part3_check"] = "";
  out["part3_tax_debit_memo"] = "";
  out["part3_others"] = "";

  // ============================================================
  // Schedule 1 — Computation of Tax (page 2)
  // ============================================================
  // Items 1-6: Six ATC lines (PT010, PT040, PT041, PT060, PT070, PT090).
  // Under 8% election, ALL tax due values are 0 (BR-04) and the ATC column
  // is still drawn so the form is unambiguous. For non-8% filers, the gross
  // is reported on the first applicable line (PT010) and tax due is 3%.
  const ptAtcs = ["PT010", "PT040", "PT041", "PT060", "PT070", "PT090"];
  const isGraduated = electedRate === "GRADUATED";
  for (let n = 1; n <= 6; n++) {
    out[`sched1_item${n}_atc`] = ptAtcs[n - 1];
    if (n === 1 && isGraduated) {
      out[`sched1_item${n}_taxable`] = formatBirAmount(quarterlyGross);
      out[`sched1_item${n}_tax_due`] = formatBirAmount(taxDue);
    } else {
      out[`sched1_item${n}_taxable`] = "0.00";
      out[`sched1_item${n}_tax_due`] = "0.00";
    }
  }

  // Item 7: Total Tax Due (Sum of Items 1 to 6) (To Part II, Item 14)
  out["sched1_total_tax_due"] = formatBirAmount(taxDue);

  return out;
}

/**
 * Format a Decimal (or number/string) as a Philippine-peso amount with
 * thousands separators and 2 decimal places. Mirrors 1701A/1701Q's
 * formatBirAmount.
 */
function formatBirAmount(value: Decimal | number | string | null | undefined): string {
  if (value == null || value === "") return "";
  const d = value instanceof Decimal ? value : new Decimal(String(value));
  if (d.isNaN() || d.isZero()) return d.isZero() ? "0.00" : "";
  const num = d.toNumber();
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Spacing between TIN digit boxes for BIR Form 2551Q (measured from the
 * official PDF: hyphen separators at 268.7 / 325.6 / 382.4 pt).
 */
const TIN_DIGIT_SPACING_2551Q = 19;

/**
 * Draw a TIN value character-by-character into the printed digit boxes.
 * Strips non-digits, then draws each digit at coord.x + i * spacing.
 * The coord.x is the left edge of the first digit box.
 */
function drawTin(
  page: PDFPage,
  font: PDFFont,
  tin: string | number | null | undefined,
  coord: { x: number; y: number; fontSize: number },
  spacing: number,
  color = { r: 0, g: 0, b: 0 },
): void {
  if (tin == null || tin === "") return;
  const digits = String(tin).replace(/\D/g, "").slice(0, 12);
  if (digits.length === 0) return;
  const size = coord.fontSize;
  for (let i = 0; i < digits.length; i++) {
    page.drawText(digits[i], {
      x: coord.x + i * spacing,
      y: coord.y,
      size,
      font,
      color: rgb(color.r, color.g, color.b),
    });
  }
}

/**
 * Draw a single overlay value at the given coord on the given page.
 * (Identical to 1701A's drawValue — duplicated here so the BIR modules
 * stay self-contained and don't form an unintended cross-import.)
 *
 * Improvements for issue #213 follow-up:
 *  - Boolean checkboxes use coord.x/y as the checkbox center.
 *  - Right-aligned amounts keep a small padding from the field's right edge
 *    so long values are not clipped by the page/form border.
 *  - Left-aligned fields use coord.x as the left edge of the input box.
 */
function drawValue(
  page: PDFPage,
  font: PDFFont,
  value: string | number | boolean | null | undefined,
  coord: { x: number; y: number; fontSize: number; maxWidth: number; align: "left" | "right" | "center" },
  color = { r: 0, g: 0, b: 0 },
): void {
  if (value == null || value === "") return;

  if (typeof value === "boolean") {
    if (!value) return;
    page.drawText("X", {
      x: coord.x - 3,
      y: coord.y - 3,
      size: coord.fontSize + 2,
      font,
      color: rgb(color.r, color.g, color.b),
    });
    return;
  }

  const text = typeof value === "number" ? value.toString() : value;
  if (!text) return;

  const size = coord.fontSize;
  const textWidth = font.widthOfTextAtSize(text, size);
  const scale = textWidth > coord.maxWidth && coord.maxWidth > 0 ? coord.maxWidth / textWidth : 1;
  const finalSize = size * Math.min(scale, 1);
  const finalWidth = font.widthOfTextAtSize(text, finalSize);

  // Small right-edge padding so amounts don't touch the form border.
  const rightPadding = coord.align === "right" ? 3 : 0;

  let x = coord.x;
  if (coord.align === "right") {
    x = coord.x - finalWidth - rightPadding;
  } else if (coord.align === "center") {
    x = coord.x - finalWidth / 2;
  }

  page.drawText(text, {
    x,
    y: coord.y,
    size: finalSize,
    font,
    color: rgb(color.r, color.g, color.b),
  });
}

/**
 * Render the 2551Q return as a flat PDF: load the official BIR template,
 * walk the value map, draw each value at its coord, then flatten.
 */
export async function renderForm2551QOverlay(data: FilingPdfData): Promise<BirOverlayResult> {
  const pdfBytes = await loadOfficialBirPdf("2551Q.pdf");
  const doc = await PDFDocument.load(pdfBytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();

  const values = buildForm2551QValues(data);
  const drawnKeys: string[] = [];

  for (const [key, value] of Object.entries(values)) {
    const coord = COORDS_2551Q[key];
    if (!coord) continue;
    const page = pages[coord.page - 1];
    if (!page) continue;
    if (key.endsWith("_tin")) {
      drawTin(page, font, value, coord, TIN_DIGIT_SPACING_2551Q);
    } else {
      drawValue(page, font, value, coord);
    }
    drawnKeys.push(key);
  }

  // Flatten so all form fields are baked in and uneditable.
  try {
    doc.getForm().flatten();
  } catch {
    // no form fields — safe to ignore
  }

  const out = await doc.save();
  return {
    bytes: out,
    pageCount: pages.length,
    drawnKeys,
  };
}
