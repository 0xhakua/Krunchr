/**
 * 1701Q overlay renderer.
 *
 * Per issue #212, this is the high-fidelity path for Form 1701Q. Loads the
 * official BIR Form 1701Q January 2018 ENCS PDF, places each computed value
 * at its measured x/y position from `COORDS_1701Q`, and flattens the result
 * so the RDO receives a 1:1 facsimile of the BIR form with the taxpayer's
 * data filled in.
 *
 * Two layers of configuration:
 *   1. `COORDS_1701Q` (lib/pdf/coords/1701Q.generated.ts) — where to draw
 *   2. `COORD_GROUPS_1701Q` (below) — which alternative coords to use when
 *      a single logical field has more than one checkbox (Taxpayer Type,
 *      ATC, tax rate, quarter selector)
 *
 * What gets drawn:
 *   - String/number values: drawn as text, right-aligned (or per the coord)
 *   - Boolean `true`: drawn as a filled "X" inside the checkbox
 *   - Boolean `false`/null/undefined: skipped (no draw)
 *
 * 1701Q is the quarterly income tax return — cumulative from January 1 to
 * the end of the current quarter (Q1, Q2, or Q3). The primary Kuwenta path
 * is the 8% flat rate (Schedule II on page 2). Schedule I (graduated) is
 * mapped for completeness but the dispatcher renders the 8% values.
 *
 * Mixed-income earners (incomeType === "MIXED_INCOME") get NO ₱250,000
 * exemption on freelance income — BR-13. The overlay passes the correct
 * taxable income figure (0 exemption for mixed).
 */
import Decimal from "decimal.js";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { COORDS_1701Q } from "../coords/1701Q.generated";
import {
  loadOfficialBirPdf,
  type BirOverlayResult,
  type BirOverlayValue,
  type BirOverlayValues,
} from "./types";
import type { FilingPdfData } from "../dispatcher";
import { inferTaxpayerType } from "./1701A";

/**
 * Groups of alternative coords — exactly one entry per group is rendered.
 * The runtime picks the right alternative based on the taxpayer's data.
 */
export const COORD_GROUPS_1701Q = {
  /**
   * Item 7 "Taxpayer/Filer Type" — mutually exclusive checkboxes.
   * Single Proprietor vs Professional vs Estate vs Trust. Kuwenta's main
   * profile is single_proprietor and professional (the latter inferred from
   * natureOfBusiness). Estate and Trust are wired up for completeness; the
   * default if none match is single_proprietor.
   */
  taxpayer_type: {
    single_proprietor: "part1_taxpayer_type_single_proprietor",
    professional: "part1_taxpayer_type_professional",
    estate: "part1_taxpayer_type_estate",
    trust: "part1_taxpayer_type_trust",
  } as const,

  /**
   * Item 8 "ATC" under the 8% path — three checkboxes (II015, II016, II017).
   * The runtime picks the one matching the taxpayer's primary ATC.
   */
  atc: {
    II015: "part1_atc_ii015",
    II016: "part1_atc_ii016",
    II017: "part1_atc_ii017",
  } as const,

  /**
   * Item 2 "Quarter" — Q1, Q2, or Q3 (1701Q is never generated for Q4).
   */
  quarter: {
    1: "part1_quarter_first",
    2: "part1_quarter_second",
    3: "part1_quarter_third",
  } as const,

  /**
   * Item 16 "Tax Rate" — 8% flat, Graduated, Itemized, or OSD. The 8%
   * election checkbox is the primary Kuwenta path. For taxpayers whose
   * COR includes 2551Q the 8% election is made on 2551Q Item 13; for
   * taxpayers whose COR does NOT include 2551Q the election is made on
   * 1701Q Item 16 (Q1 filing). In both cases the form's Item 16 reflects
   * the same election, so we mark the 8% box whenever the elected rate
   * is RATE_8PCT.
   */
  tax_rate: {
    "8pct": "part1_tax_rate_8pct",
    graduated: "part1_tax_rate_graduated",
    itemized: "part1_tax_rate_itemized",
    osd: "part1_tax_rate_osd",
  } as const,
} as const;

/**
 * Pick the 8%-path ATC key for the taxpayer. Returns null if the taxpayer's
 * ATC isn't one of the three 8% options (II015, II016, II017).
 */
function pickAtcKey(atcCode: string): keyof typeof COORD_GROUPS_1701Q.atc | null {
  if (atcCode === "II015" || atcCode === "II016" || atcCode === "II017") {
    return atcCode;
  }
  return null;
}

/**
 * Pick the primary ATC from the certificates (same approach as 1701A's
 * pickPrimaryAtc). Used when the overlay needs a single ATC for the
 * checkbox selection.
 */
function pickPrimaryAtc(data: FilingPdfData): string {
  for (const c of data.certificates) {
    if (c.atcCode) return c.atcCode;
  }
  return "";
}

/**
 * Compute the cumulative gross receipts from January 1 to the end of
 * the current quarter (Q1, Q2, or Q3). The 1701Q is *cumulative* — not
 * standalone quarterly.
 */
function sumCumulativeGross(
  certs: FilingPdfData["certificates"],
  currentQuarter: number,
): Decimal {
  return certs
    .filter((c) => c.quarter <= currentQuarter)
    .reduce((sum, c) => sum.plus(c.quarterlyTotal), new Decimal(0));
}

/**
 * Sum of CWT for the *current* quarter only (Item 58).
 */
function sumCurrentQuarterCwt(
  certs: FilingPdfData["certificates"],
  currentQuarter: number,
): Decimal {
  return certs
    .filter((c) => c.quarter === currentQuarter)
    .reduce((sum, c) => sum.plus(c.cwtWithheld), new Decimal(0));
}

/**
 * Sum of CWT for quarters *before* the current one (Item 57). The 1701Q
 * is cumulative, so the CWT on prior 2307s has already been applied to
 * the prior 1701Q filings. The current 1701Q reports the remaining CWT
 * for the current quarter only (Item 58).
 */
function sumPriorQuarterCwt(
  certs: FilingPdfData["certificates"],
  currentQuarter: number,
): Decimal {
  return certs
    .filter((c) => c.quarter < currentQuarter)
    .reduce((sum, c) => sum.plus(c.cwtWithheld), new Decimal(0));
}

/**
 * Sum of the *prior* 1701Q net tax payments (Item 56). These are the
 * payments made for Q1, Q2, ..., Q{n-1}.
 */
function sumPriorQuarterPayments(
  allReturns: FilingPdfData["allReturns"],
  currentQuarter: number,
): Decimal {
  return allReturns
    .filter(
      (r) =>
        r.formType === "FORM_1701Q" &&
        r.quarter != null &&
        r.quarter < currentQuarter,
    )
    .reduce((sum, r) => sum.plus(r.netTaxDue ?? 0), new Decimal(0));
}

/**
 * Sum of CWT on all 2307s through the current quarter (used for the
 * netTaxDue math — total credits applied to the cumulative tax due).
 */
function sumCumulativeCwt(
  certs: FilingPdfData["certificates"],
  currentQuarter: number,
): Decimal {
  return certs
    .filter((c) => c.quarter <= currentQuarter)
    .reduce((sum, c) => sum.plus(c.cwtWithheld), new Decimal(0));
}

/**
 * Build the overlay value map for 1701Q from the filing data. Returns a
 * map of coord-key -> value, where the value type matches the coord
 * (string for text, boolean for checkboxes).
 *
 * Math per BR-06 / RR No. 8-2018 / RMC No. 50-2018:
 *   - 1701Q is cumulative Jan 1 → end of Q{n}
 *   - Tax Due = 8% × max(0, cumulative_gross - 250K) for Q1 if PURE_SELF_EMPLOYMENT
 *   - For Q2 and Q3, the 250K was already consumed in Q1's computation,
 *     so Item 52 (Less 250K) = 0; the tax engine's effective taxable
 *     income is `cumulative_gross - 0` for Q2/Q3.
 *   - Mixed-income earners (MIXED_INCOME) get no 250K exemption at all.
 */
export function buildForm1701QValues(data: FilingPdfData): BirOverlayValues {
  const out: BirOverlayValues = {};
  const quarter = data.ret.quarter ?? 1;
  const incomeType = data.taxpayer.incomeType;
  const electedRate = data.taxYear.electedRate;
  const isPureSelf = incomeType === "PURE_SELF_EMPLOYMENT";

  // ---- Cumulative computations ----
  const cumulativeGross = sumCumulativeGross(data.certificates, quarter);
  const currentQtrCwt = sumCurrentQuarterCwt(data.certificates, quarter);
  const priorQtrCwt = sumPriorQuarterCwt(data.certificates, quarter);
  const cumulativeCwt = sumCumulativeCwt(data.certificates, quarter);
  const priorPayments = sumPriorQuarterPayments(data.allReturns, quarter);

  // The 250K exemption is applied once for the year, only in Q1, only for
  // pure self-employment. Q2 and Q3 don't re-apply it.
  const exemption250k = isPureSelf && quarter === 1 ? new Decimal(250000) : new Decimal(0);
  const taxableToDate = Decimal.max(cumulativeGross.minus(exemption250k), 0);
  const taxDue = taxableToDate.times(new Decimal("0.08")).toDecimalPlaces(2);
  const totalCredits = priorPayments.plus(cumulativeCwt);
  const netTaxDue = Decimal.max(taxDue.minus(totalCredits), 0);

  // Pull penalty rows for Schedule IV (surcharge/interest/compromise/total)
  const penalty = data.ret.penalties;

  // ============================================================
  // Part I — Background Information on Taxpayer/Filer
  // ============================================================

  // Item 1: For the Year (MM/YYYY) — Kuwenta uses the tax year as 4-digit
  out["part1_year"] = data.taxYear.year.toString();

  // Item 2: Quarter (Q1/Q2/Q3) — runtime picks the right checkbox
  const qKey = COORD_GROUPS_1701Q.quarter[quarter as 1 | 2 | 3];
  if (qKey) out[qKey] = true;

  // Item 3: Amended Return? — Kuwenta currently doesn't expose an
  // "amended" flag on the form, so we mark No by default.
  out["part1_amended_yes"] = false;
  out["part1_amended_no"] = true;

  // Item 4: Number of Sheet/s Attached — defaults to 0; SAWT goes in
  // the filing package, not on the form.
  out["part1_sheets_attached"] = "0";

  // Item 5: TIN (BIR format: NNN-NNN-NNN-NNN; we store 12-digit)
  out["part1_tin"] = data.taxpayer.tin;

  // Item 6: RDO Code
  out["part1_rdo_code"] = data.taxpayer.rdoCode;

  // Item 7: Taxpayer/Filer Type — alternative group
  const taxpayerTypeKey = COORD_GROUPS_1701Q.taxpayer_type[
    inferTaxpayerType(data.taxpayer.natureOfBusiness)
  ];
  out[taxpayerTypeKey] = true;

  // Item 8: ATC — alternative group (8% path: II015/II016/II017)
  const primaryAtc = pickPrimaryAtc(data);
  const atcKeyName = pickAtcKey(primaryAtc);
  if (atcKeyName) {
    out[COORD_GROUPS_1701Q.atc[atcKeyName]] = true;
  }

  // Item 9: Taxpayer/Filer's Name (BIR format: Last, First Middle)
  out["part1_taxpayer_name"] = data.taxpayer.fullName;

  // Item 10: Registered Address
  out["part1_registered_address"] = data.taxpayer.registeredAddress;

  // Item 10A: ZIP Code
  out["part1_zip_code"] = data.taxpayer.zipCode;

  // Item 11: Date of Birth (not in Kuwenta schema)
  out["part1_date_of_birth"] = "";

  // Item 12: Email Address
  out["part1_email"] = data.taxpayer.email ?? "";

  // Item 13: Citizenship (not in Kuwenta schema)
  out["part1_citizenship"] = "";

  // Item 14: Foreign Tax Number (not in Kuwenta schema)
  out["part1_foreign_tax_number"] = "";

  // Item 15: Claiming Foreign Tax Credits? (default No)
  out["part1_claiming_foreign_yes"] = false;
  out["part1_claiming_foreign_no"] = true;

  // Item 16: Tax Rate — mark the 8% checkbox whenever the taxpayer has
  // actively elected RATE_8PCT. This covers both the 8-return path
  // (election made on 2551Q Item 13, corIncludes2551Q === true) and the
  // 4-return path (election made here on 1701Q Item 16 because the COR
  // does not include 2551Q, corIncludes2551Q === false) per BR-02 / BR-14.
  // Graduated, Itemized and OSD are left unmarked unless explicitly elected.
  if (electedRate === "RATE_8PCT") {
    out[COORD_GROUPS_1701Q.tax_rate["8pct"]] = true;
    out[COORD_GROUPS_1701Q.tax_rate.graduated] = false;
    out[COORD_GROUPS_1701Q.tax_rate.itemized] = false;
    out[COORD_GROUPS_1701Q.tax_rate.osd] = false;
  } else if (electedRate === "GRADUATED") {
    out[COORD_GROUPS_1701Q.tax_rate["8pct"]] = false;
    out[COORD_GROUPS_1701Q.tax_rate.graduated] = true;
    out[COORD_GROUPS_1701Q.tax_rate.itemized] = false;
    out[COORD_GROUPS_1701Q.tax_rate.osd] = false;
  } else {
    // No active election: leave all tax-rate checkboxes unmarked.
    out[COORD_GROUPS_1701Q.tax_rate["8pct"]] = false;
    out[COORD_GROUPS_1701Q.tax_rate.graduated] = false;
  }

  // ============================================================
  // Part II — Spouse (out of scope; single-filer)
  // No coords to fill.
  // ============================================================

  // ============================================================
  // Part III — Total Tax Payable (page 1, Col A: Taxpayer/Filer)
  // ============================================================
  // Item 26: Tax Due (mirrors Schedule II Item 54 for the 8% path)
  out["part3_tax_due"] = formatBirAmount(taxDue);

  // Item 27: Less: Tax Credits/Payments (mirrors Schedule III Item 62)
  out["part3_less_tax_credits"] = formatBirAmount(totalCredits);

  // Item 28: Tax Payable/(Overpayment) (Item 26 Less Item 27)
  out["part3_tax_payable"] = formatBirAmount(netTaxDue);

  // Item 29: Add: Total Penalties (mirrors Schedule IV Item 67)
  if (penalty) {
    out["part3_total_penalties"] = formatBirAmount(penalty.totalPenalty);
  } else {
    out["part3_total_penalties"] = "0.00";
  }

  // Item 30: Total Amount Payable (Item 28 + Item 29)
  const totalPenalty = penalty?.totalPenalty ?? new Decimal(0);
  const totalAmountPayable = netTaxDue.plus(totalPenalty);
  out["part3_total_amount_payable"] = formatBirAmount(totalAmountPayable);

  // Item 31: Aggregate Amount Payable (Sum of 30A and 30B) — Kuwenta
  // single-filer, so the aggregate is just the A column.
  out["part3_aggregate_amount_payable"] = formatBirAmount(totalAmountPayable);

  // ============================================================
  // Part IV — Details of Payment (we have no payment data in FilingPdfData)
  // ============================================================
  out["part4_cash_bank_debit"] = "";
  out["part4_check"] = "";
  out["part4_tax_debit_memo"] = "";
  out["part4_others"] = "";

  // ============================================================
  // Part V / Schedule I — Graduated IT Rate
  // ============================================================
  // Schedule I is the graduated path and must be LEFT BLANK when the taxpayer
  // elected the 8% flat rate (BR-02 / BR-14). Only Schedule II is populated
  // under the 8% path.
  const isGraduated = electedRate === "GRADUATED";
  if (isGraduated) {
    out["sched1_sales"] = formatBirAmount(cumulativeGross);
    out["sched1_cost_of_sales"] = "0.00";
    out["sched1_gross_income"] = formatBirAmount(cumulativeGross);
    out["sched1_itemized_deductions"] = "0.00";
    out["sched1_osd"] = "0.00";
    out["sched1_net_income_this_quarter"] = formatBirAmount(cumulativeGross);
    out["sched1_prev_quarter_taxable"] = formatBirAmount(priorPayments);
    out["sched1_non_operating_income"] = "0.00";
    out["sched1_gpp_income"] = "0.00";
    out["sched1_total_taxable_to_date"] = formatBirAmount(cumulativeGross);
    out["sched1_tax_due"] = "";
  } else {
    out["sched1_sales"] = "";
    out["sched1_cost_of_sales"] = "";
    out["sched1_gross_income"] = "";
    out["sched1_itemized_deductions"] = "";
    out["sched1_osd"] = "";
    out["sched1_net_income_this_quarter"] = "";
    out["sched1_prev_quarter_taxable"] = "";
    out["sched1_non_operating_income"] = "";
    out["sched1_gpp_income"] = "";
    out["sched1_total_taxable_to_date"] = "";
    out["sched1_tax_due"] = "";
  }

  // ============================================================
  // Part V / Schedule II — 8% IT Rate (PRIMARY Kuwenta path)
  // ============================================================
  // Item 47: Sales/Revenues/Receipts/Fees (cumulative Jan 1 → Q{n})
  out["sched2_sales"] = formatBirAmount(cumulativeGross);

  // Item 48: Add: Non-Operating Income (Kuwenta doesn't track this
  // separately today — all income comes through 2307 certs and is in
  // Item 47).
  out["sched2_non_operating_income"] = "0.00";

  // Item 49: Total Income for the quarter (Sum of 47 and 48)
  out["sched2_total_income_quarter"] = formatBirAmount(cumulativeGross);

  // Item 50: Add: Total Taxable Income/(Loss) Previous Quarter
  // (Item 51 of previous quarter). For Q1 this is 0. For Q{n>1} this
  // is the cumulative gross through Q{n-1} (which equals the prior Q's
  // Item 51 since prior Q's Item 52 was the 250K deduction — see
  // Item 51 math below).
  const priorQtrGross = sumCumulativeGross(
    data.certificates,
    quarter - 1,
  );
  out["sched2_prev_quarter_taxable"] = formatBirAmount(priorQtrGross);

  // Item 51: Cumulative Taxable Income/(Loss) as of This Quarter
  // (Sum of Items 49 and 50). For the 8% path with no non-op income
  // and Item 48 = 0, this equals Item 47.
  out["sched2_cumulative_taxable"] = formatBirAmount(cumulativeGross);

  // Item 52: Less: Allowable reduction from gross sales/receipts
  // (₱250,000). Applied only on Q1, only for pure self-employment.
  out["sched2_less_250k"] = formatBirAmount(exemption250k);

  // Item 53: Taxable Income/(Loss) To Date (Item 51 Less Item 52)
  out["sched2_taxable_to_date"] = formatBirAmount(taxableToDate);

  // Item 54: TAX DUE (Item 53 x 8% Tax Rate) — also drawn on Part III Item 26
  out["sched2_tax_due"] = formatBirAmount(taxDue);

  // ============================================================
  // Part V / Schedule III — Tax Credits/Payments
  // ============================================================
  // Item 55: Prior Year's Excess Credits
  out["sched3_prior_year_excess_credits"] = "0.00";

  // Item 56: Tax Payment/s for the Previous Quarter/s (sum of prior
  // 1701Q netTaxDue from allReturns)
  out["sched3_prev_quarter_payments"] = formatBirAmount(priorPayments);

  // Item 57: Creditable Tax Withheld for the Previous Quarter/s
  // (CWT on 2307s from prior quarters — these have been applied to
  // the prior 1701Q filings, but the form requires this line for
  // audit-trail purposes)
  out["sched3_prev_quarter_cwt"] = formatBirAmount(priorQtrCwt);

  // Item 58: Creditable Tax Withheld per BIR Form No. 2307 for this Quarter
  out["sched3_current_quarter_cwt"] = formatBirAmount(currentQtrCwt);

  // Item 59: Tax Paid in Return Previously Filed (only if Amended Return)
  out["sched3_prev_return_payment"] = "0.00";

  // Item 60: Foreign Tax Credits
  out["sched3_foreign_tax_credits"] = "0.00";

  // Item 61: Other Tax Credits/Payments
  out["sched3_other_credits"] = "0.00";

  // Item 62: Total Tax Credits/Payments (Sum of 55 to 61)
  out["sched3_total_credits"] = formatBirAmount(totalCredits);

  // Item 63: Tax Payable/(Overpayment) (Item 54 Less Item 62)
  out["sched3_tax_payable_overpayment"] = formatBirAmount(netTaxDue);

  // ============================================================
  // Part V / Schedule IV — Penalties (RA 11976 reduced rates:
  // 10% surcharge, 6% interest, RDO-specific compromise)
  // ============================================================
  if (penalty) {
    out["sched4_surcharge"] = formatBirAmount(penalty.surcharge);
    out["sched4_interest"] = formatBirAmount(penalty.interest);
    out["sched4_compromise"] = formatBirAmount(penalty.compromisePenalty);
    out["sched4_total_penalties"] = formatBirAmount(penalty.totalPenalty);
  } else {
    out["sched4_surcharge"] = "0.00";
    out["sched4_interest"] = "0.00";
    out["sched4_compromise"] = "0.00";
    out["sched4_total_penalties"] = "0.00";
  }

  // Item 68: Total Amount Payable (Item 63 + Item 67)
  out["sched4_total_amount_payable"] = formatBirAmount(totalAmountPayable);

  return out;
}

/**
 * Format a Decimal (or number/string) as a Philippine-peso amount with
 * thousands separators and 2 decimal places. Mirrors 1701A's
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
 * Spacing between TIN digit boxes for BIR Form 1701Q (measured from the
 * official PDF: hyphen separators at 247.3 / 305.1 / 362.9 pt).
 */
const TIN_DIGIT_SPACING_1701Q = 14;

/**
 * Draw a TIN value character-by-character into the printed digit boxes.
 * Strips non-digits, then draws each digit at coord.x + i * spacing.
 * The coord.x is the left edge of the first digit box.
 */
function drawTin(
  page: PDFPage,
  font: PDFFont,
  tin: BirOverlayValue,
  coord: { x: number; y: number; fontSize: number },
  spacing: number,
  color = { r: 0, g: 0, b: 0 },
): void {
  if (tin == null || tin === "" || typeof tin === "boolean") return;
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
 * Improvements for issue #212 follow-up:
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
 * Render the 1701Q return as a flat PDF: load the official BIR template,
 * walk the value map, draw each value at its coord, then flatten.
 */
export async function renderForm1701QOverlay(data: FilingPdfData): Promise<BirOverlayResult> {
  const pdfBytes = await loadOfficialBirPdf("1701Q.pdf");
  const doc = await PDFDocument.load(pdfBytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();

  const values = buildForm1701QValues(data);
  const drawnKeys: string[] = [];

  for (const [key, value] of Object.entries(values)) {
    const coord = COORDS_1701Q[key];
    if (!coord) continue;
    const page = pages[coord.page - 1];
    if (!page) continue;
    if (key.endsWith("_tin")) {
      drawTin(page, font, value, coord, TIN_DIGIT_SPACING_1701Q);
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
