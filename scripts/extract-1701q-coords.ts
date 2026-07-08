/**
 * Coordinate extraction for BIR Form 1701Q (January 2018 ENCS) overlay.
 *
 * Mirrors scripts/extract-1701a-coords.ts. Loads the official BIR PDF with
 * pdfjs-dist, finds line-item numbers (1-68), and maps each to a BirFormCoord
 * (page, x, y, fontSize, maxWidth, align) by label-driven matching. The
 * y-coordinate of each item is taken from the row baseline of the line-item
 * number; the x-coordinate is hand-tuned to land inside the input box.
 *
 * Output:
 *   - lib/pdf/coords/1701Q.generated.ts   (the runtime coord map)
 *   - tmp/1701Q-coords-check.pdf          (PDF with red dots at each coord)
 *   - tmp/1701Q-coords-check-page{1,2}.png (rendered verification PNGs)
 *
 * Usage:
 *   pnpm tsx scripts/extract-1701q-coords.ts public/bir-forms/1701Q.pdf
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import * as napiCanvas from "@napi-rs/canvas";

type PdfJsTextItem = {
  str: string;
  dir: string;
  width: number;
  height: number;
  transform: number[];
  fontName: string;
  hasEOL: boolean;
};

type LineItem = {
  key: string;
  label: string;
  page: number;
  x: number;
  y: number;
  fontSize: number;
  maxWidth: number;
  align: "left" | "right";
  sourceText: string;
};

// Actual line-item numbering on BIR Form 1701Q January 2018 ENCS.
// See docs/client-guides/1701Q Jan 2018 final rev2_copy.pdf for the
// authoritative layout. Fields marked CRITICAL are the ones the client
// first asked for in the issue body:
//   - Part I header (TIN/RDO/Name/Address/ATC/Year/Quarter)
//   - Schedule II 8% path (Items 47-54)
//   - Schedule III credits/payments (Items 55-63)
//   - Schedule IV penalties (Items 64-68)
//   - Part III (Page 1) Total Tax Payable (Items 26-31)
//   - Part IV (Page 1) Details of Payment (Items 32-35)
//   - Quarter selector (Q1/Q2/Q3) and Item 16 8% election checkboxes
type LineItemDef = {
  key: string;
  number: number;
  // We match by label substring (label-driven, not number-driven) so 2-digit
  // numbers that pdfjs splits into separate text items still resolve correctly.
  expectedSubstring: string;
  critical?: boolean;
  defaultX: number;
  group:
    | "Part I"
    | "Part II" // Spouse — out of scope (single-filer)
    | "Part III"
    | "Part IV"
    | "Schedule I"
    | "Schedule II"
    | "Schedule III"
    | "Schedule IV";
  // Optional: page number the item lives on.
  page?: number;
  // Optional: yMax filters candidate matches to those with y < yMax.
  yMax?: number;
  // Optional: yMin filters candidate matches to those with y > yMin.
  yMin?: number;
  // Optional: explicit y position that overrides the matched label y.
  explicitY?: number;
  // Optional: horizontal text alignment for this field (default: "right").
  align?: "left" | "right" | "center";
  // Optional: vertical offset (pt) added to the matched/ explicit y to land
  // in the input line instead of on the printed label.
  yOffset?: number;
};

const LINE_ITEM_DEFS: LineItemDef[] = [
  // ---- Part I: Background Information on Taxpayer/Filer (items 1-16) ----
  // All on page 1, y > 600.
  { key: "part1_year", number: 1, expectedSubstring: "For the Year", group: "Part I", defaultX: 80, page: 1, yMin: 600, align: "left" },
  { key: "part1_quarter_first", number: 2, expectedSubstring: "Quarter", group: "Part I", defaultX: 185, page: 1, yMin: 600, critical: true },
  { key: "part1_quarter_second", number: 2, expectedSubstring: "Quarter", group: "Part I", defaultX: 232, page: 1, yMin: 600, critical: true },
  { key: "part1_quarter_third", number: 2, expectedSubstring: "Quarter", group: "Part I", defaultX: 285, page: 1, yMin: 600, critical: true },
  // After hand-tuning (review of tmp/1701Q-coords-check-page1.png): the "Yes"
  // label sits at x=441; nudging +5pt puts the X mark inside the checkbox.
  { key: "part1_amended_yes", number: 3, expectedSubstring: "Amended Return?", group: "Part I", defaultX: 446, page: 1, yMin: 600 },
  { key: "part1_amended_no", number: 3, expectedSubstring: "Amended Return?", group: "Part I", defaultX: 480, page: 1, yMin: 600 },
  // Item 4 (Sheets Attached) is unusual: the line number "4" sits at y=831 (the
  // row of items 1-3) but the label "Number of Sheet/s Attached" is split
  // across y=836 and y=827. Label-driven matching can't see "Sheet" on the
  // item-number's baseline, so we use explicitY for the value row.
  { key: "part1_sheets_attached", number: 4, expectedSubstring: "", group: "Part I", defaultX: 555, page: 1, explicitY: 836 },
  { key: "part1_tin", number: 5, expectedSubstring: "Taxpayer Identification Number", group: "Part I", defaultX: 205, critical: true, page: 1, yMin: 700, yOffset: 0.4, align: "left" },
  { key: "part1_rdo_code", number: 6, expectedSubstring: "RDO Code", group: "Part I", defaultX: 340, critical: true, page: 1, yMin: 700 },
  // Item 7 = Taxpayer/Filer Type — mutually exclusive checkboxes. The label
  // "Taxpayer/Filer Type" sits at y=782 (below the TIN row at y=798). After
  // hand-tuning: the label-driven match was returning y=798.6 (TIN row);
  // explicitY pins the four checkboxes to the actual Item 7 row.
  { key: "part1_taxpayer_type_single_proprietor", number: 7, expectedSubstring: "", group: "Part I", defaultX: 110, page: 1, explicitY: 782 },
  { key: "part1_taxpayer_type_professional", number: 7, expectedSubstring: "", group: "Part I", defaultX: 220, page: 1, explicitY: 782 },
  { key: "part1_taxpayer_type_estate", number: 7, expectedSubstring: "", group: "Part I", defaultX: 320, page: 1, explicitY: 782 },
  { key: "part1_taxpayer_type_trust", number: 7, expectedSubstring: "", group: "Part I", defaultX: 410, page: 1, explicitY: 782 },
  // Item 8 = ATC — under the 8% path, the three 8% ATCs are II015 / II017 / II016.
  // All three are listed on the same row of checkboxes; we map all three coords
  // and the runtime picks one based on the taxpayer's ATC.
  { key: "part1_atc_ii015", number: 8, expectedSubstring: "Alphanumeric Tax Code", group: "Part I", defaultX: 200, critical: true, page: 1, yMin: 700 },
  { key: "part1_atc_ii017", number: 8, expectedSubstring: "Alphanumeric Tax Code", group: "Part I", defaultX: 350, critical: true, page: 1, yMin: 700 },
  { key: "part1_atc_ii016", number: 8, expectedSubstring: "Alphanumeric Tax Code", group: "Part I", defaultX: 510, critical: true, page: 1, yMin: 700 },
  // Use the more specific "Taxpayer/Filer's Name" (with U+0027 apostrophe) to
  // avoid matching "Taxpayer" alone (which would also match the Type row).
  // yMax: 750 excludes the "Taxpayer/Filer Type" row (y=782) and pins the
  // match to the "Taxpayer/Filer's Name" row (y=737).
  // Item 9: Taxpayer/Filer's Name — left-align inside the input line, raised
  // above the printed label so it does not overlap.
  { key: "part1_taxpayer_name", number: 9, expectedSubstring: "Taxpayer/Filer", group: "Part I", defaultX: 285, critical: true, page: 1, yMin: 700, yMax: 750, yOffset: 12, align: "left" },
  { key: "part1_registered_address", number: 10, expectedSubstring: "Registered Address", group: "Part I", defaultX: 285, critical: true, page: 1, yMin: 600, yOffset: 12, align: "left" },
  { key: "part1_zip_code", number: 10, expectedSubstring: "ZIP Code", group: "Part I", defaultX: 555, page: 1, yMin: 600 },
  { key: "part1_date_of_birth", number: 11, expectedSubstring: "Date of Birth", group: "Part I", defaultX: 130, page: 1, yMin: 600 },
  { key: "part1_email", number: 12, expectedSubstring: "Email Address", group: "Part I", defaultX: 400, page: 1, yMin: 600 },
  { key: "part1_citizenship", number: 13, expectedSubstring: "Citizenship", group: "Part I", defaultX: 200, page: 1, yMin: 600 },
  // After hand-tuning: +15pt clears the "Foreign Tax Number" label and lands
  // in the input box.
  { key: "part1_foreign_tax_number", number: 14, expectedSubstring: "Foreign Tax Number", group: "Part I", defaultX: 470, page: 1, yMin: 600 },
  // After hand-tuning: +10pt puts the X mark on the Yes checkbox square
  // (the "Yes" label sits at x=524).
  { key: "part1_claiming_foreign_yes", number: 15, expectedSubstring: "Claiming Foreign Tax Credits?", group: "Part I", defaultX: 534, page: 1, yMin: 600 },
  { key: "part1_claiming_foreign_no", number: 15, expectedSubstring: "Claiming Foreign Tax Credits?", group: "Part I", defaultX: 570, page: 1, yMin: 600 },
  // Item 16 = Tax Rate. The checkbox squares are to the left of the labels;
  // measured label positions: 8% x=78.6/y=574.1, Graduated x=79.1/y=598.5,
  // Itemized x=247.3/y=598.5, OSD x=377.5/y=598.5.
  { key: "part1_tax_rate_8pct", number: 16, expectedSubstring: "", group: "Part I", defaultX: 70, critical: true, page: 1, explicitY: 574.1, align: "left" },
  { key: "part1_tax_rate_graduated", number: 16, expectedSubstring: "", group: "Part I", defaultX: 70, page: 1, explicitY: 598.5, align: "left" },
  { key: "part1_tax_rate_itemized", number: 16, expectedSubstring: "", group: "Part I", defaultX: 240, page: 1, explicitY: 598.5, align: "left" },
  { key: "part1_tax_rate_osd", number: 16, expectedSubstring: "", group: "Part I", defaultX: 370, page: 1, explicitY: 598.5, align: "left" },

  // ---- Part II: Spouse — out of scope (single-filer). Items 17-25 skipped. ----

  // ---- Part III: Total Tax Payable (items 26-31) — all on page 1, y < 350 ----
  { key: "part3_tax_due", number: 26, expectedSubstring: "Tax Due", group: "Part III", defaultX: 460, critical: true, page: 1, yMax: 350 },
  { key: "part3_less_tax_credits", number: 27, expectedSubstring: "Less: Tax Credits/Payments", group: "Part III", defaultX: 460, critical: true, page: 1, yMax: 350 },
  { key: "part3_tax_payable", number: 28, expectedSubstring: "Tax Payable/(Overpayment)", group: "Part III", defaultX: 460, critical: true, page: 1, yMax: 350 },
  { key: "part3_total_penalties", number: 29, expectedSubstring: "Total Penalties", group: "Part III", defaultX: 460, critical: true, page: 1, yMax: 350 },
  { key: "part3_total_amount_payable", number: 30, expectedSubstring: "Total Amount Payable/(Overpayment)", group: "Part III", defaultX: 460, critical: true, page: 1, yMax: 350 },
  { key: "part3_aggregate_amount_payable", number: 31, expectedSubstring: "Aggregate Amount Payable", group: "Part III", defaultX: 460, page: 1, yMax: 350 },

  // ---- Part IV: Details of Payment (items 32-35) — all on page 1, y < 200 ----
  { key: "part4_cash_bank_debit", number: 32, expectedSubstring: "Cash/Bank Debit Memo", group: "Part IV", defaultX: 560, page: 1, yMax: 200 },
  { key: "part4_check", number: 33, expectedSubstring: "Check", group: "Part IV", defaultX: 560, page: 1, yMax: 200 },
  { key: "part4_tax_debit_memo", number: 34, expectedSubstring: "Tax Debit Memo", group: "Part IV", defaultX: 560, page: 1, yMax: 200 },
  { key: "part4_others", number: 35, expectedSubstring: "Others", group: "Part IV", defaultX: 560, page: 1, yMax: 200 },

  // ---- Part V / Schedule I: For Graduated IT Rate (items 36-46) — page 2 ----
  // Out of scope for the 8% path. Mapped for completeness so the form is
  // re-renderable from any taxpayer profile; the dispatcher renders only the
  // 8% path in practice.
  { key: "sched1_sales", number: 36, expectedSubstring: "Sales/Revenues/Receipts/Fees", group: "Schedule I", defaultX: 460, page: 2, yMax: 770 },
  { key: "sched1_cost_of_sales", number: 37, expectedSubstring: "Cost of Sales/Services", group: "Schedule I", defaultX: 460, page: 2, yMax: 770 },
  { key: "sched1_gross_income", number: 38, expectedSubstring: "Gross Income/(Loss)", group: "Schedule I", defaultX: 460, page: 2, yMax: 770 },
  { key: "sched1_itemized_deductions", number: 39, expectedSubstring: "Total Allowable Itemized Deductions", group: "Schedule I", defaultX: 460, page: 2, yMax: 770 },
  { key: "sched1_osd", number: 40, expectedSubstring: "Optional Standard Deduction", group: "Schedule I", defaultX: 460, page: 2, yMax: 770 },
  { key: "sched1_net_income_this_quarter", number: 41, expectedSubstring: "Net Income/(Loss) This Quarter", group: "Schedule I", defaultX: 460, page: 2, yMax: 770 },
  { key: "sched1_prev_quarter_taxable", number: 42, expectedSubstring: "Taxable Income/(Loss) Previous Quarter", group: "Schedule I", defaultX: 460, page: 2, yMax: 770 },
  { key: "sched1_non_operating_income", number: 43, expectedSubstring: "Non-Operating Income", group: "Schedule I", defaultX: 460, page: 2, yMax: 770 },
  { key: "sched1_gpp_income", number: 44, expectedSubstring: "General Professional Partnership", group: "Schedule I", defaultX: 460, page: 2, yMax: 770 },
  { key: "sched1_total_taxable_to_date", number: 45, expectedSubstring: "Total Taxable Income/(Loss) To Date", group: "Schedule I", defaultX: 460, page: 2, yMax: 770 },
  { key: "sched1_tax_due", number: 46, expectedSubstring: "TAX DUE", group: "Schedule I", defaultX: 460, page: 2, yMin: 560, yMax: 600 },

  // ---- Part V / Schedule II: For 8% IT Rate (items 47-54) — page 2 ----
  // PRIMARY Kuwenta path. Cumulative Jan 1 → end-of-quarter, not standalone
  // quarterly. The 250K exemption is conditional on incomeType.
  { key: "sched2_sales", number: 47, expectedSubstring: "Sales/Revenues/Receipts/Fees", group: "Schedule II", defaultX: 460, critical: true, page: 2, yMin: 530, yMax: 580 },
  { key: "sched2_non_operating_income", number: 48, expectedSubstring: "Non-Operating Income", group: "Schedule II", defaultX: 460, critical: true, page: 2, yMin: 510, yMax: 560 },
  { key: "sched2_total_income_quarter", number: 49, expectedSubstring: "Total Income", group: "Schedule II", defaultX: 460, critical: true, page: 2, yMin: 490, yMax: 540 },
  { key: "sched2_prev_quarter_taxable", number: 50, expectedSubstring: "Total Taxable Income/(Loss) Previous Quarter", group: "Schedule II", defaultX: 460, critical: true, page: 2, yMin: 470, yMax: 530 },
  { key: "sched2_cumulative_taxable", number: 51, expectedSubstring: "Cumulative Taxable Income", group: "Schedule II", defaultX: 460, critical: true, page: 2, yMin: 450, yMax: 510 },
  // Item 52 = Less: ₱250,000 reduction. The label is split across multiple
  // lines ("Allowable reduction from gross sales/receipts and other non-
  // operating income of purely self-employed individuals and/or professionals
  // in the amount of P 250,000") on baselines y=474 and y=466, but the
  // line-item number "52" is at y=470 alongside "Less:". Use explicitY.
  { key: "sched2_less_250k", number: 52, expectedSubstring: "", group: "Schedule II", defaultX: 460, critical: true, page: 2, explicitY: 470 },
  { key: "sched2_taxable_to_date", number: 53, expectedSubstring: "Taxable Income/(Loss) To Date", group: "Schedule II", defaultX: 460, critical: true, page: 2, yMin: 420, yMax: 480 },
  { key: "sched2_tax_due", number: 54, expectedSubstring: "x", group: "Schedule II", defaultX: 460, critical: true, page: 2, yMin: 400, yMax: 460 },

  // ---- Part V / Schedule III: Tax Credits/Payments (items 55-63) — page 2 ----
  { key: "sched3_prior_year_excess_credits", number: 55, expectedSubstring: "Prior Year", group: "Schedule III", defaultX: 460, critical: true, page: 2, yMin: 380, yMax: 430 },
  { key: "sched3_prev_quarter_payments", number: 56, expectedSubstring: "Tax Payment", group: "Schedule III", defaultX: 460, critical: true, page: 2, yMin: 360, yMax: 410 },
  { key: "sched3_prev_quarter_cwt", number: 57, expectedSubstring: "Creditable Tax Withheld for the", group: "Schedule III", defaultX: 460, critical: true, page: 2, yMin: 340, yMax: 400 },
  { key: "sched3_current_quarter_cwt", number: 58, expectedSubstring: "Creditable Tax Withheld per BIR Form No. 2307", group: "Schedule III", defaultX: 460, critical: true, page: 2, yMin: 320, yMax: 380 },
  { key: "sched3_prev_return_payment", number: 59, expectedSubstring: "Amended Return", group: "Schedule III", defaultX: 460, page: 2, yMin: 300, yMax: 360 },
  { key: "sched3_foreign_tax_credits", number: 60, expectedSubstring: "Foreign Tax Credits", group: "Schedule III", defaultX: 460, page: 2, yMin: 280, yMax: 340 },
  { key: "sched3_other_credits", number: 61, expectedSubstring: "Other Tax Credits/Payments", group: "Schedule III", defaultX: 460, page: 2, yMin: 260, yMax: 320 },
  { key: "sched3_total_credits", number: 62, expectedSubstring: "Total Tax Credits/Payments", group: "Schedule III", defaultX: 460, critical: true, page: 2, yMin: 240, yMax: 320 },
  { key: "sched3_tax_payable_overpayment", number: 63, expectedSubstring: "Tax Payable/(Overpayment)", group: "Schedule III", defaultX: 460, critical: true, page: 2, yMax: 300 },

  // ---- Part V / Schedule IV: Penalties (items 64-68) — page 2 ----
  { key: "sched4_surcharge", number: 64, expectedSubstring: "Surcharge", group: "Schedule IV", defaultX: 460, critical: true, page: 2, yMin: 220, yMax: 260 },
  { key: "sched4_interest", number: 65, expectedSubstring: "Interest", group: "Schedule IV", defaultX: 460, critical: true, page: 2, yMin: 200, yMax: 240 },
  { key: "sched4_compromise", number: 66, expectedSubstring: "Compromise", group: "Schedule IV", defaultX: 460, critical: true, page: 2, yMin: 180, yMax: 220 },
  { key: "sched4_total_penalties", number: 67, expectedSubstring: "Total Penalties", group: "Schedule IV", defaultX: 460, critical: true, page: 2, yMin: 160, yMax: 210 },
  { key: "sched4_total_amount_payable", number: 68, expectedSubstring: "Total Amount", group: "Schedule IV", defaultX: 460, critical: true, page: 2, yMax: 200 },
];

async function loadPdf(pdfPath: string) {
  const data = await fs.readFile(pdfPath);
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const workerAbs = path.resolve(
    process.cwd(),
    "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
  );
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerAbs).href;
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(data) });
  return await loadingTask.promise;
}

function pdfjsCoordToPdfLib(item: PdfJsTextItem, _pageHeight: number) {
  // pdfjs-dist returns text positions in PDF user space (origin bottom-left, y up),
  // which is the same coordinate system pdf-lib uses. No conversion needed.
  // transform[4] = x (horizontal position of text origin / baseline start)
  // transform[5] = y (vertical position of the text baseline in PDF user space)
  return { x: item.transform[4], y: item.transform[5], height: item.height };
}

async function findLineItemLabels(pdf: Awaited<ReturnType<typeof loadPdf>>) {
  const matches: Array<{
    page: number;
    number: number;
    labelText: string;
    x: number;
    y: number;
    height: number;
  }> = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = tc.items as unknown as PdfJsTextItem[];

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const trimmed = it.str.trim();
      if (!/^\d{1,2}$/.test(trimmed)) continue;
      const num = parseInt(trimmed, 10);
      if (num < 1 || num > 75) continue;
      // Concatenate ALL text items on the same baseline (within 5pt) into one
      // full label. The full label is needed because BIR splits long labels
      // into many text items. We include at most 30 items to bound the search.
      const baselineY = it.transform[5];
      const parts: string[] = [];
      let lastX = it.transform[4];
      for (let j = i + 1; j < Math.min(i + 30, items.length); j++) {
        const next = items[j];
        if (Math.abs(next.transform[5] - baselineY) > 3) break;
        // If there's a large horizontal gap (>40pt) it's probably a separate
        // visual block — stop.
        if (next.transform[4] - lastX > 40) break;
        parts.push(next.str);
        lastX = next.transform[4] + (next.width ?? 0);
      }
      const fullLabel = parts.join("").replace(/\s+/g, " ").trim();
      if (fullLabel.length < 3) continue;
      const coord = pdfjsCoordToPdfLib(it, viewport.height);
      matches.push({
        page: p,
        number: num,
        labelText: fullLabel,
        x: coord.x,
        y: coord.y,
        height: coord.height,
      });
    }
  }
  return matches;
}

function buildCoordMap(
  matches: Awaited<ReturnType<typeof findLineItemLabels>>,
  defs: LineItemDef[],
) {
  const out: Record<string, LineItem> = {};
  const unmatched: Array<{ def: LineItemDef; reason: string }> = [];

  // Label-driven matching with apostrophe normalization (BIR uses U+2019 in
  // some places, our defs use U+0027). See extract-1701a-coords.ts for the
  // full discussion of why this is more robust than number-driven matching.
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
      .replace(/\s+/g, " ");
  for (const def of defs) {
    const align = def.align ?? "right";
    if (def.explicitY !== undefined) {
      out[def.key] = {
        key: def.key,
        label: `${def.group} item ${def.number}`,
        page: def.page ?? 1,
        x: def.defaultX,
        y: def.explicitY + (def.yOffset ?? 0),
        fontSize: 9,
        maxWidth: 100,
        align,
        sourceText: "(no label - blank input row)",
      };
      continue;
    }
    const sub = normalize(def.expectedSubstring);
    const candidates = matches
      .map((m) => ({ m, label: normalize(m.labelText) }))
      .filter((x) => x.label.includes(sub))
      .filter((x) => (def.page === undefined ? true : x.m.page === def.page))
      .filter((x) => (def.yMax === undefined ? true : x.m.y < def.yMax))
      .filter((x) => (def.yMin === undefined ? true : x.m.y > def.yMin))
      .sort((a, b) => {
        const aStart = a.label.indexOf(sub);
        const bStart = b.label.indexOf(sub);
        if (aStart !== bStart) return aStart - bStart;
        return a.label.length - b.label.length;
      });
    if (candidates.length === 0) {
      unmatched.push({ def, reason: `no label candidate contains "${def.expectedSubstring}"` });
      continue;
    }
    const pick = candidates[0].m;
    out[def.key] = {
      key: def.key,
      label: `${def.group} item ${def.number}`,
      page: pick.page,
      x: def.defaultX,
      y: pick.y + (def.yOffset ?? 0),
      fontSize: 9,
      maxWidth: 100,
      align,
      sourceText: pick.labelText,
    };
  }
  return { coords: out, unmatched };
}

async function renderPngWithDots(
  pdf: Awaited<ReturnType<typeof loadPdf>>,
  coords: Record<string, LineItem>,
  outDir: string,
) {
  function makeCanvas(w: number, h: number) {
    const c = napiCanvas.createCanvas(w, h);
    return {
      canvas: c,
      context: c.getContext("2d") as unknown as MiniCtx,
    };
  }
  const scale = 2;
  const results: string[] = [];
  let renderOk = true;
  let renderError: unknown = null;
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale });
    const { canvas, context } = makeCanvas(viewport.width, viewport.height);
    try {
      await page.render({
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport,
        canvas: canvas as unknown as HTMLCanvasElement,
      } as Parameters<typeof page.render>[0]).promise;
    } catch (err) {
      renderOk = false;
      renderError = err;
      break;
    }
    drawDotsOnCanvas(context, coords, p, scale, viewport.height);
    const buf = canvas.toBuffer("image/png");
    const target = path.join(outDir, `1701Q-coords-check-page${p}.png`);
    await fs.writeFile(target, buf);
    results.push(target);
  }
  if (!renderOk) {
    // eslint-disable-next-line no-console
    console.warn("pdfjs render failed, falling back to schematic PNG:", renderError);
    return { ok: false as const, error: renderError };
  }
  return { ok: true as const, files: results };
}

function drawDotsOnCanvas(
  ctx: unknown,
  coords: Record<string, LineItem>,
  pageNumber: number,
  scale: number,
  viewportHeight: number,
) {
  const c = ctx as unknown as MiniCtx;
  for (const c2 of Object.values(coords)) {
    if (c2.page !== pageNumber) continue;
    const cx = c2.x * scale;
    const cy = (viewportHeight - c2.y) * scale;
    c.beginPath();
    c.arc(cx, cy, 7, 0, Math.PI * 2);
    c.fillStyle = "rgba(255, 0, 0, 0.85)";
    c.fill();
    c.lineWidth = 1.5;
    c.strokeStyle = "black";
    c.stroke();
    c.font = "bold 10px sans-serif";
    c.fillStyle = "blue";
    c.fillText(c2.key, cx + 10, cy + 4);
  }
}

type MiniCtx = {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  font: string;
  beginPath: () => void;
  arc: (x: number, y: number, r: number, s: number, e: number) => void;
  fill: () => void;
  stroke: () => void;
  fillRect: (x: number, y: number, w: number, h: number) => void;
  strokeRect: (x: number, y: number, w: number, h: number) => void;
  moveTo: (x: number, y: number) => void;
  lineTo: (x: number, y: number) => void;
  fillText: (s: string, x: number, y: number) => void;
};

async function renderSchematicPng(
  coords: Record<string, LineItem>,
  pageHeight: number,
  outDir: string,
) {
  const scale = 2;
  const pageWidth = 612;
  const grouped: Record<number, LineItem[]> = {};
  for (const c of Object.values(coords)) {
    grouped[c.page] = grouped[c.page] ?? [];
    grouped[c.page].push(c);
  }
  const written: string[] = [];
  for (const [pageStr, items] of Object.entries(grouped)) {
    const page = parseInt(pageStr, 10);
    const w = pageWidth * scale;
    const h = pageHeight * scale;
    const canvas = napiCanvas.createCanvas(w, h);
    const ctx = canvas.getContext("2d") as unknown as MiniCtx;
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#ddd";
    ctx.lineWidth = 1;
    ctx.strokeRect(2, 2, w - 4, h - 4);
    ctx.strokeStyle = "#f0f0f0";
    for (let yy = 0; yy < h; yy += 20 * scale) {
      ctx.beginPath();
      ctx.moveTo(0, yy);
      ctx.lineTo(w, yy);
      ctx.stroke();
    }
    drawDotsOnCanvas(ctx, coords, page, scale, pageHeight);
    ctx.fillStyle = "black";
    ctx.font = "bold 18px sans-serif";
    ctx.fillText(`1701Q Schematic — page ${page} (no PDF render available)`, 20, 30);
    ctx.font = "12px sans-serif";
    ctx.fillText("Open the original 1701Q PDF alongside this PNG to compare dot positions to actual form lines.", 20, 50);
    const buf = canvas.toBuffer("image/png");
    const target = path.join(outDir, `1701Q-schematic-page${page}.png`);
    await fs.writeFile(target, buf);
    written.push(target);
  }
  return written;
}

async function renderMarkedUpPdf(
  pdfPath: string,
  coords: Record<string, LineItem>,
  outPath: string,
) {
  const data = await fs.readFile(pdfPath);
  const doc = await PDFDocument.load(data);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  for (const item of Object.values(coords)) {
    const page = pages[item.page - 1];
    page.drawCircle({ x: item.x, y: item.y, size: 4, color: rgb(1, 0, 0), opacity: 0.85 });
    page.drawText(item.key, {
      x: item.x + 6,
      y: item.y - 3,
      size: 7,
      font,
      color: rgb(0, 0, 1),
    });
  }
  const bytes = await doc.save();
  await fs.writeFile(outPath, bytes);
  return outPath;
}

async function main() {
  const pdfPath = process.argv[2];
  if (!pdfPath) {
    console.error("Usage: tsx scripts/extract-1701q-coords.ts <pdf-path>");
    process.exit(2);
  }
  const resolved = path.resolve(pdfPath);
  const outDir = path.resolve("tmp");
  await fs.mkdir(outDir, { recursive: true });

  // eslint-disable-next-line no-console
  console.log(`Loading ${resolved} ...`);
  const pdf = await loadPdf(resolved);
  // eslint-disable-next-line no-console
  console.log(`Pages: ${pdf.numPages}`);

  const matches = await findLineItemLabels(pdf);
  // eslint-disable-next-line no-console
  console.log(`Found ${matches.length} candidate line-item labels.`);

  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const { coords, unmatched } = buildCoordMap(matches, LINE_ITEM_DEFS);
  const mappedCount = Object.keys(coords).length;
  // eslint-disable-next-line no-console
  console.log(`\nMapped ${mappedCount}/${LINE_ITEM_DEFS.length} line items.`);
  if (unmatched.length > 0) {
    // eslint-disable-next-line no-console
    console.log("\nUnmatched definitions:");
    for (const u of unmatched) {
      // eslint-disable-next-line no-console
      console.log(`  - ${u.def.key} (item ${u.def.number}, ${u.def.group}): ${u.reason}`);
    }
  }

  // eslint-disable-next-line no-console
  console.log("\n--- Coordinate map (pdf-lib coords, origin bottom-left) ---");
  for (const c of Object.values(coords)) {
    // eslint-disable-next-line no-console
    console.log(`  ${c.key.padEnd(46)} page=${c.page}  x=${c.x.toFixed(1).padStart(7)}  y=${c.y.toFixed(1).padStart(7)}  src=${JSON.stringify(c.sourceText)}`);
  }

  // eslint-disable-next-line no-console
  console.log("\n--- Attempting actual PDF render + dot overlay (PNG) ---");
  const renderResult = await renderPngWithDots(pdf, coords, outDir);
  if (renderResult.ok) {
    // eslint-disable-next-line no-console
    console.log("PNG render OK:");
    for (const f of renderResult.files) {
      // eslint-disable-next-line no-console
      console.log(`  ${f}`);
    }
  } else {
    // eslint-disable-next-line no-console
    console.log("PNG render failed, generating schematic PNG (no PDF render, text labels at extracted positions + dots):");
    const files = await renderSchematicPng(coords, viewport.height, outDir);
    for (const f of files) {
      // eslint-disable-next-line no-console
      console.log(`  ${f}`);
    }
  }

  // eslint-disable-next-line no-console
  console.log("\n--- Marked-up PDF (actual form with red dots) ---");
  const pdfOut = path.join(outDir, "1701Q-coords-check.pdf");
  const written = await renderMarkedUpPdf(resolved, coords, pdfOut);
  // eslint-disable-next-line no-console
  console.log(`  ${written}`);

  const tsBody =
    `import type { BirFormCoord } from "./types";\n\n` +
    `// AUTO-GENERATED by scripts/extract-1701q-coords.ts.\n` +
    `// Visual verification: see tmp/1701Q-coords-check.pdf (and .png if render succeeded).\n` +
    `// Coordinates are pdf-lib convention: origin = bottom-left, y counts up.\n` +
    `// Page size: 612 x 936 pt (US Letter). Reviewed: pending visual check.\n\n` +
    `export const COORDS_1701Q: Record<string, BirFormCoord> = ${JSON.stringify(
      Object.fromEntries(
        Object.entries(coords).map(([k, v]) => [
          k,
          {
            page: v.page,
            x: v.x,
            y: Math.round(v.y * 100) / 100,
            fontSize: v.fontSize,
            maxWidth: v.maxWidth,
            align: v.align,
          },
        ]),
      ),
      null,
      2,
    )};\n`;
  await fs.mkdir(path.resolve("lib/pdf/coords"), { recursive: true });
  await fs.writeFile(path.resolve("lib/pdf/coords/1701Q.generated.ts"), tsBody, "utf8");
  // eslint-disable-next-line no-console
  console.log(`\nWrote lib/pdf/coords/1701Q.generated.ts`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
