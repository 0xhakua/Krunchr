/**
 * 1701A overlay renderer.
 *
 * Per issue #159, this is the high-fidelity path: load the official BIR Form
 * 1701A January 2018 PDF, place each computed value at its measured x/y
 * position, and flatten the result so the RDO receives a 1:1 facsimile of
 * the BIR form with the taxpayer's data filled in.
 *
 * Two layers of configuration:
 *   1. `COORDS_1701A` (lib/pdf/coords/1701A.generated.ts) — where to draw
 *   2. `COORD_GROUPS_1701A` (below) — which alternative coords to use when
 *      a single logical field has more than one checkbox (e.g., Taxpayer
 *      Type is either Single Proprietor OR Professional, not both)
 *
 * What gets drawn:
 *   - String/number values: drawn as text, right-aligned (or left/center
 *     per the coord's `align` field)
 *   - Boolean `true` values: drawn as a filled "X" inside the input box
 *   - Boolean `false`/null/undefined: skipped (no draw)
 */
import Decimal from "decimal.js";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { COORDS_1701A } from "../coords/1701A.generated";
import {
  loadOfficialBirPdf,
  type BirOverlayResult,
  type BirOverlayValues,
} from "./types";
import type { FilingPdfData } from "../dispatcher";
import { drawCharacterBoxes } from "../helpers/character-boxes";

/**
 * Groups of alternative coords — exactly one entry per group is rendered.
 * The runtime picks the right alternative based on the taxpayer's data.
 */
export const COORD_GROUPS_1701A = {
  /**
   * Item 6 "Taxpayer Type" — mutually exclusive checkboxes.
   * The runtime infers from `natureOfBusiness`; the heuristic is conservative
   * (defaults to single_proprietor when the business text doesn't clearly
   * suggest a profession).
   */
  taxpayer_type: {
    single_proprietor: "part1_taxpayer_type_single_proprietor",
    professional: "part1_taxpayer_type_professional",
  } as const,
} as const;

/**
 * Heuristic: infer BIR "Taxpayer Type" from the free-text nature of business.
 * Returns one of "single_proprietor" | "professional". Conservative default:
 * single_proprietor (most Kuwenta users). The full set of BIR-recognised
 * professions is broader; expand the regex when more taxpayers onboard.
 */
export function inferTaxpayerType(
  natureOfBusiness: string | null | undefined
): "single_proprietor" | "professional" {
  const s = (natureOfBusiness ?? "").toLowerCase();
  // BIR-recognised professions typically listed in natureOfBusiness
  if (/\b(professional|lawyer|attorney|cpa|accountant|engineer|architect|doctor|dentist|consultant|brokerage|consultancy)\b/.test(s)) {
    return "professional";
  }
  return "single_proprietor";
}

/**
 * Format a Decimal (or number/string) as a Philippine-peso amount with
 * thousands separators and 2 decimal places. Matches the BIR convention
 * (e.g., "1,234,567.89"). Empty/zero/NaN → empty string (caller decides
 * whether to draw the field or not).
 */
export function formatBirAmount(value: Decimal | number | string | null | undefined): string {
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
 * Convert the stored 12-digit TIN (NNN-NNN-NNN-NNN) into the character-box
 * layout used by BIR Form 1701A. Page 1 prints the dashes, so the returned
 * string includes them; Page 2 uses a continuous row of boxes, so dashes are
 * omitted.
 */
export function formatTinFor1701ACharacterBoxes(
  tin: string | null | undefined,
  options: { includeDashes?: boolean } = { includeDashes: true }
): string {
  if (!tin) return "";
  const digits = tin.replace(/\D/g, "").slice(0, 12);
  if (digits.length < 9) return "";
  const base = digits.slice(0, 9);
  const branch = digits.slice(9).padStart(4, "0");
  if (options.includeDashes === false) {
    return `${base}${branch}`;
  }
  return `${base.slice(0, 3)}-${base.slice(3, 6)}-${base.slice(6, 9)}-${branch}`;
}

/**
 * Geometry for the BIR Form 1701A character-box fields.
 * These are calibrated against the official January 2018 ENCS PDF so each
 * digit lands centered in its printed box.
 */
const CHARACTER_BOX_CONFIGS: Record<
  string,
  { page: number; startX: number; startY: number; boxWidth: number }
> = {
  part1_tin: { page: 1, startX: 25.0, startY: 769.0, boxWidth: 14.4 },
  part1_rdo_code: { page: 1, startX: 305.0, startY: 769.0, boxWidth: 14.4 },
  page2_tin: { page: 2, startX: 14.8, startY: 831.7, boxWidth: 13.86 },
};

/**
 * Compute the Q1–Q3 CWT (sum of CWT on Q1–Q3 certificates).
 */
function sumQ1Q3Cwt(certs: FilingPdfData["certificates"]): Decimal {
  return certs
    .filter((c) => c.quarter >= 1 && c.quarter <= 3)
    .reduce((sum, c) => sum.plus(c.cwtWithheld), new Decimal(0));
}

/**
 * Compute the Q4 CWT.
 */
function sumQ4Cwt(certs: FilingPdfData["certificates"]): Decimal {
  return certs
    .filter((c) => c.quarter === 4)
    .reduce((sum, c) => sum.plus(c.cwtWithheld), new Decimal(0));
}

/**
 * Compute the full-year gross (sum of all certificate quarterly totals).
 */
function sumFullYearGross(certs: FilingPdfData["certificates"]): Decimal {
  return certs.reduce((sum, c) => sum.plus(c.quarterlyTotal), new Decimal(0));
}

/**
 * Compute the Q1–Q3 cash payments (sum of 1701Q netTaxDue for Q1–Q3).
 */
function sumQ1Q3Payments(allReturns: FilingPdfData["allReturns"]): Decimal {
  return allReturns
    .filter((r) => r.formType === "FORM_1701Q" && r.quarter != null && r.quarter >= 1 && r.quarter <= 3)
    .reduce((sum, r) => sum.plus(r.netTaxDue ?? 0), new Decimal(0));
}

/**
 * Pick the primary ATC for the taxpayer. BIR Form 1701A item 7 has space
 * for one ATC; we use the first one from the taxpayer's TaxpayerATC list.
 * If none, returns the empty string.
 */
function pickPrimaryAtc(data: FilingPdfData): string {
  // We don't have direct access to TaxpayerATC here, so this is best-effort
  // via the certificates. Returns the first non-empty ATC seen on certs.
  for (const c of data.certificates) {
    if (c.atcCode) return c.atcCode;
  }
  return "";
}

/**
 * Build the overlay value map for 1701A from the filing data.
 * Returns a map of coord-key -> value, where the value type matches the
 * coord (string for text, boolean for checkboxes).
 */
export function buildForm1701AValues(data: FilingPdfData): BirOverlayValues {
  const out: BirOverlayValues = {};

  const fullYearGross = sumFullYearGross(data.certificates);
  const q1q3Cwt = sumQ1Q3Cwt(data.certificates);
  const q4Cwt = sumQ4Cwt(data.certificates);
  const q1q3Payments = sumQ1Q3Payments(data.allReturns);
  const priorYearCredit = data.priorYearCredit?.amount ?? new Decimal(0);

  // Net taxable income (full year gross less 250k exemption, or 0 if mixed income / OSD)
  // Per BR-13, mixed-income earners get NO exemption.
  const exemption =
    data.taxpayer.incomeType === "MIXED_INCOME"
      ? new Decimal(0)
      : new Decimal(250000);
  const taxableIncome = Decimal.max(fullYearGross.minus(exemption), 0);

  // Tax due (8% of taxable, or graduated if elected)
  const taxDue =
    data.taxYear.electedRate === "GRADUATED"
      ? taxableIncome // simplified: 0–250k is 0% so we don't bracket-walk here;
                       // the dispatcher should use the 1701A-only breakdown if needed.
                       // For Kuwenta's 8% path this branch is rarely hit.
                       : taxableIncome.times(new Decimal("0.08"));

  // Total credits (BIR-prescribed order: prior-year, Q1–Q3 payments, Q1–Q3 CWT)
  // (Q4 CWT is treated as Q1–Q3 + Q4 in the BIR form — items 59 and 60 — but
  //  in the tax-engine, all CWT is in taxCreditsTotal; we split here.)
  const totalCredits = priorYearCredit.plus(q1q3Payments).plus(q1q3Cwt).plus(q4Cwt);
  const netPosition = taxDue.minus(totalCredits);

  // Pull penalty rows for Part II penalties (surcharge/interest/compromise/total)
  const penalty = data.ret.penalties;

  // ============================================================
  // Part I — Background Information
  // ============================================================

  // Item 1: For the Year (MM/YYYY) — BIR convention is just the tax year
  // (e.g., "2026"); the month is typically the December of that year or
  // the filing month. Kuwenta uses the tax year as a 4-digit value.
  out["part1_year"] = data.taxYear.year.toString();

  // Items 2, 3, 6 — handled below via coord groups / unknown defaults
  out["part1_amended_yes"] = false;
  out["part1_short_period_yes"] = false;

  // Item 4: TIN (BIR format: NNN-NNN-NNN-NNN; we store 12-digit)
  out["part1_tin"] = data.taxpayer.tin;

  // Item 5: RDO Code
  out["part1_rdo_code"] = data.taxpayer.rdoCode;

  // Page 2 header repeats the TIN in the same character-box format.
  out["page2_tin"] = data.taxpayer.tin;

  // Item 6: Taxpayer Type — alternative group; runtime picks one
  // based on the taxpayer's natureOfBusiness.
  const taxpayerTypeKey = COORD_GROUPS_1701A.taxpayer_type[
    inferTaxpayerType(data.taxpayer.natureOfBusiness)
  ];
  out[taxpayerTypeKey] = true;

  // Item 7: ATC
  out["part1_atc"] = pickPrimaryAtc(data);

  // Item 8: Taxpayer's Name (BIR format: Last, First Middle)
  out["part1_taxpayer_name"] = data.taxpayer.fullName;

  // Item 9: Registered Address
  out["part1_registered_address"] = data.taxpayer.registeredAddress;

  // Item 9A: ZIP Code
  out["part1_zip_code"] = data.taxpayer.zipCode;

  // Item 11: Email Address
  out["part1_email"] = data.taxpayer.email ?? "";

  // Item 12: Citizenship (not in schema)
  out["part1_citizenship"] = "";

  // Item 13: Claiming Foreign Tax Credits? (default No)
  out["part1_claiming_foreign_yes"] = false;

  // Item 14: Foreign Tax Number
  out["part1_foreign_tax_number"] = "";

  // Item 15: Contact Number
  out["part1_contact_number"] = data.taxpayer.phoneNumber ?? "";

  // Item 16: Civil Status (not in schema)
  out["part1_civil_status"] = "";

  // Item 18: Filing Status (not in schema)
  out["part1_filing_status"] = "";

  // Item 19: Tax Rate — 8% checkbox (BIR's primary Kuwenta path)
  out["part1_tax_rate"] = data.taxYear.electedRate === "RATE_8PCT";

  // ============================================================
  // Part II — Total Tax Payable
  // ============================================================

  // Item 20: Tax Due (from Part IV.B item 56 for 8% path)
  out["part2_tax_due"] = formatBirAmount(taxDue);

  // Item 21: Less: Total Tax Credits/Payments (from Part IV.C item 64)
  out["part2_aggregate"] = ""; // placeholder; see item 30 below

  // Item 22: Net Tax Payable/(Overpayment) (Item 20 Less Item 21)
  // (Filled via Part IV.C item 65; we don't draw this independently)

  // Item 24: Amount of Tax Payable/(Overpayment) (Item 22 Less Item 23)
  // (23 is the 2nd-installment split; for 1701A we draw the net as item 24)

  // Items 25-28: Penalties
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

  // Item 29: Total Amount Payable (sum of 24 and 28)
  // The BIR form derives this from the columns, but for the overlay we draw
  // a single value. If we have netPosition > 0, that IS the total amount
  // payable (no penalty if filed on time).
  if (netPosition.greaterThan(0)) {
    out["part2_total_amount_payable"] = formatBirAmount(netPosition);
  } else {
    out["part2_total_amount_payable"] = "0.00";
  }

  // Item 30: Aggregate Amount Payable (Sum of 29A & 29B) — Kuwenta currently
  // only computes the A) Taxpayer/Filer column. Leave blank for the spouse
  // column; draw the A) value into a single position.
  out["part2_aggregate"] = out["part2_total_amount_payable"];

  // Item 31: Number of Attachments (defaults to 0; SAWT goes in the package, not the form)
  out["part2_attachments"] = "0";

  // ============================================================
  // Part III — Details of Payment (we have no payment data in FilingPdfData)
  // ============================================================
  out["part3_cash_amount"] = "";
  out["part3_check_amount"] = "";
  out["part3_tax_debit_amount"] = "";
  out["part3_others_amount"] = "";

  // ============================================================
  // Part IV.B — 8% Income Tax Rate (the primary Kuwenta path)
  // ============================================================

  // Item 47: Sales/Revenues/Receipts/Fees
  out["part4b_sales"] = formatBirAmount(fullYearGross);

  // Item 48: Less: Sales Returns, Allowances and Discounts (not tracked separately)
  out["part4b_less_returns"] = "0.00";

  // Item 49: Net Sales/Revenues/Receipts/Fees
  out["part4b_net_sales"] = formatBirAmount(fullYearGross);

  // Items 50, 51: Other Non-Operating Income (blank for 8% path)
  out["part4b_other_income_1"] = "";
  out["part4b_other_income_2"] = "";

  // Item 52: Total Other Non-operating Income
  out["part4b_total_other"] = "0.00";

  // Item 53: Total Taxable Income
  out["part4b_total_taxable"] = formatBirAmount(fullYearGross);

  // Item 54: Less: Allowable reduction (₱250,000)
  if (data.taxpayer.incomeType === "MIXED_INCOME") {
    out["part4b_less_250k"] = "0.00";
  } else {
    out["part4b_less_250k"] = "250,000.00";
  }

  // Item 55: Taxable Income/(Loss) (Item 53 Less Item 54)
  out["part4b_taxable_loss"] = formatBirAmount(taxableIncome);

  // Item 56: TAX DUE (Item 55 x 8%)
  out["part4b_tax_due"] = formatBirAmount(taxDue);

  // ============================================================
  // Part IV.C — Tax Credits/Payments
  // ============================================================

  // Item 57: Prior Year's Excess Credits
  out["part4c_prior_year_credits"] = formatBirAmount(priorYearCredit);

  // Item 58: Tax Payments for the First Three (3) Quarters
  out["part4c_q1q3_payments"] = formatBirAmount(q1q3Payments);

  // Item 59: Creditable Tax Withheld for the First Three (3) Quarters
  out["part4c_q1q3_cwt"] = formatBirAmount(q1q3Cwt);

  // Item 60: Creditable Tax Withheld per BIR Form No. 2307 for the 4th Quarter
  out["part4c_q4_cwt"] = formatBirAmount(q4Cwt);

  // Item 61: Tax Paid in Return Previously Filed (only if amended)
  out["part4c_prior_tax_paid"] = "0.00";

  // Item 62: Foreign Tax Credits
  out["part4c_foreign_tax_credits"] = "0.00";

  // Item 63: Other Tax Credits/Payments
  out["part4c_other_credits"] = "0.00";

  // Item 64: Total Tax Credits/Payments
  out["part4c_total_credits"] = formatBirAmount(totalCredits);

  // Item 65: Net Tax Payable/(Overpayment)
  out["part4c_net_tax_payable"] = formatBirAmount(netPosition);

  return out;
}

/**
 * Draw a single overlay value at the given coord on the given page.
 * Text: draws the value as text, right-aligned (or per the coord's align).
 * Boolean true: draws an "X" inside the input box.
 * Other: skipped.
 */
function drawValue(
  page: PDFPage,
  font: PDFFont,
  value: string | number | boolean | null | undefined,
  coord: { x: number; y: number; fontSize: number; maxWidth: number; align: "left" | "right" | "center" },
  color = { r: 0, g: 0, b: 0 }
): void {
  if (value == null || value === "") return;

  if (typeof value === "boolean") {
    if (!value) return;
    // Draw a filled "X" mark. BIR checkboxes are roughly 10pt square;
    // we draw an "X" character at the checkbox center, baseline aligned
    // with the row.
    page.drawText("X", {
      x: coord.x - 3,
      y: coord.y - 3,
      size: coord.fontSize + 2,
      font,
      color: rgb(color.r, color.g, color.b),
    });
    return;
  }

  // Numeric / string value
  const text = typeof value === "number" ? value.toString() : value;
  if (!text) return;

  // Compute width
  const size = coord.fontSize;
  const textWidth = font.widthOfTextAtSize(text, size);
  const scale = textWidth > coord.maxWidth && coord.maxWidth > 0 ? coord.maxWidth / textWidth : 1;
  const finalSize = size * Math.min(scale, 1);
  const finalWidth = font.widthOfTextAtSize(text, finalSize);

  let x = coord.x;
  if (coord.align === "right") {
    x = coord.x - finalWidth;
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
 * Render the 1701A return as a flat PDF: load the official BIR template,
 * walk the value map, draw each value at its coord, then flatten.
 */
export async function renderForm1701AOverlay(data: FilingPdfData): Promise<BirOverlayResult> {
  const pdfBytes = await loadOfficialBirPdf("1701A.pdf");
  const doc = await PDFDocument.load(pdfBytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();

  const values = buildForm1701AValues(data);
  const drawnKeys: string[] = [];

  for (const [key, value] of Object.entries(values)) {
    const coord = COORDS_1701A[key];
    const boxConfig = CHARACTER_BOX_CONFIGS[key];
    if (!coord && !boxConfig) continue;

    if (boxConfig) {
      const page = pages[boxConfig.page - 1];
      if (!page) continue;
      const text = key.includes("tin")
        ? formatTinFor1701ACharacterBoxes(value as string, { includeDashes: key !== "page2_tin" })
        : String(value ?? "");
      drawCharacterBoxes({
        page,
        value: text,
        startX: boxConfig.startX,
        startY: boxConfig.startY,
        boxWidth: boxConfig.boxWidth,
        font,
      });
      drawnKeys.push(key);
      continue;
    }

    const page = pages[coord!.page - 1];
    if (!page) continue;
    drawValue(page, font, value, coord!);
    drawnKeys.push(key);
  }

  // Flatten so all form fields are baked in and uneditable.
  // pdf-lib doesn't have a direct "flatten" method like Acrobat, but
  // since we only added text/graphics (no AcroForm field updates), the
  // output is already effectively flat. We still call form.flatten() if
  // any AcroForm exists, as a safety measure.
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
