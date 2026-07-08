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

// Actual line-item numbering on BIR Form 1701A January 2018 ENCS v5.
// See docs/client-guides/1701A Jan 2018 v5 with rates.pdf for the authoritative layout.
// Fields marked CRITICAL are the ones the client first asked for (Part I header +
// Part II tax summary + Part IV.C tax credits/overpayment).
type LineItemDef = {
  key: string;
  number: number;
  // We match by label substring (label-driven, not number-driven) so 2-digit
  // numbers that pdfjs splits into separate text items still resolve correctly.
  expectedSubstring: string;
  critical?: boolean;
  defaultX: number;
  group: "Part I" | "Part II" | "Part III" | "Part IV.A" | "Part IV.B" | "Part IV.C" | "Part V";
  // Optional: page number the item lives on. Filters out matches that hit the
  // same label on a different page (e.g., Part I "Citizenship" vs Part V
  // Spouse "Citizenship", or Part I "Taxpayer's Name" vs Part I "Taxpayer Type").
  page?: number;
  // Optional: yMax filters candidate matches to those with y < yMax. Used to
  // disambiguate labels that appear in both Part IV.A (Schedule I, y > 600)
  // and Part IV.B (Schedule II, 380 < y < 600). Without this, label-driven
  // matching always picks the Part IV.A occurrence.
  yMax?: number;
  // Optional: yMin filters candidate matches to those with y > yMin. Used to
  // disambiguate Part I labels (top of page 1, y > 500) from Part V Spouse
  // labels (top of page 2, y < 200) that share the same text.
  yMin?: number;
  // Optional: explicit y position that overrides the matched label y. Used
  // for items 50/51 which have no label text after the line number.
  explicitY?: number;
};

const LINE_ITEM_DEFS: LineItemDef[] = [
  // ---- Part I: Background Information (items 1-19) — all on page 1, y > 500 ----
  { key: "part1_year", number: 1, expectedSubstring: "For the Year", group: "Part I", defaultX: 360, page: 1, yMin: 500 },
  { key: "part1_amended_yes", number: 2, expectedSubstring: "Amended Return?", group: "Part I", defaultX: 283, page: 1, yMin: 500 },
  { key: "part1_short_period_yes", number: 3, expectedSubstring: "Short Period Return?", group: "Part I", defaultX: 473, page: 1, yMin: 500 },
  { key: "part1_tin", number: 4, expectedSubstring: "Taxpayer Identification Number", group: "Part I", defaultX: 285, critical: true, page: 1, yMin: 500 },
  { key: "part1_rdo_code", number: 5, expectedSubstring: "RDO Code", group: "Part I", defaultX: 340, critical: true, page: 1, yMin: 500 },
  { key: "part1_atc", number: 7, expectedSubstring: "Alphanumeric Tax Code", group: "Part I", defaultX: 285, critical: true, page: 1, yMin: 500 },
  // Item 6 is a conditional checkbox pair — the runtime overlay function picks
  // ONE of these two coords to mark based on TaxpayerProfile.taxpayerType:
  //   - "single_proprietor" / "single proprietor" → mark single_proprietor checkbox
  //   - "professional"                              → mark professional checkbox
  // Both share the same y (the "6 Taxpayer Type" row baseline) but have
  // different x positions landing on each checkbox square.
  { key: "part1_taxpayer_type_single_proprietor", number: 6, expectedSubstring: "Taxpayer Type", group: "Part I", defaultX: 375, page: 1, yMin: 500 },
  { key: "part1_taxpayer_type_professional", number: 6, expectedSubstring: "Taxpayer Type", group: "Part I", defaultX: 535, page: 1, yMin: 500 },
  // Use the more specific "Taxpayer's Name" (with U+0027 apostrophe) to avoid
  // matching "Taxpayer Type" which appears earlier in the form.
  { key: "part1_taxpayer_name", number: 8, expectedSubstring: "Taxpayer's Name", group: "Part I", defaultX: 285, critical: true, page: 1, yMin: 500 },
  { key: "part1_registered_address", number: 9, expectedSubstring: "Registered Address", group: "Part I", defaultX: 285, critical: true, page: 1, yMin: 500 },
  { key: "part1_zip_code", number: 9, expectedSubstring: "ZIP Code", group: "Part I", defaultX: 555, page: 1, yMin: 500 },
  { key: "part1_date_of_birth", number: 10, expectedSubstring: "Date of Birth", group: "Part I", defaultX: 130, page: 1, yMin: 500 },
  { key: "part1_email", number: 11, expectedSubstring: "Email Address", group: "Part I", defaultX: 400, page: 1, yMin: 500 },
  { key: "part1_citizenship", number: 12, expectedSubstring: "Citizenship", group: "Part I", defaultX: 200, page: 1, yMin: 500 },
  { key: "part1_claiming_foreign_yes", number: 13, expectedSubstring: "Claiming Foreign Tax Credits?", group: "Part I", defaultX: 322, page: 1, yMin: 500 },
  { key: "part1_foreign_tax_number", number: 14, expectedSubstring: "Foreign Tax Number", group: "Part I", defaultX: 455, page: 1, yMin: 500 },
  { key: "part1_contact_number", number: 15, expectedSubstring: "Contact Number", group: "Part I", defaultX: 200, page: 1, yMin: 500 },
  { key: "part1_civil_status", number: 16, expectedSubstring: "Civil Status", group: "Part I", defaultX: 380, page: 1, yMin: 500 },
  { key: "part1_filing_status", number: 18, expectedSubstring: "Filing Status", group: "Part I", defaultX: 410, page: 1, yMin: 500 },
  { key: "part1_tax_rate", number: 19, expectedSubstring: "Tax Rate", group: "Part I", defaultX: 200, page: 1, yMin: 500 },

  // ---- Part II: Tax Computation Summary (items 20-31) — all on page 1 ----
  { key: "part2_tax_due", number: 20, expectedSubstring: "Tax Due", group: "Part II", defaultX: 440, critical: true, page: 1 },
  { key: "part2_surcharge", number: 25, expectedSubstring: "Surcharge", group: "Part II", defaultX: 450, critical: true, page: 1 },
  { key: "part2_interest", number: 26, expectedSubstring: "Interest", group: "Part II", defaultX: 450, critical: true, page: 1 },
  { key: "part2_compromise", number: 27, expectedSubstring: "Compromise", group: "Part II", defaultX: 450, critical: true, page: 1 },
  { key: "part2_total_penalties", number: 28, expectedSubstring: "Total Penalties", group: "Part II", defaultX: 450, critical: true, page: 1 },
  { key: "part2_total_amount_payable", number: 29, expectedSubstring: "Total Amount Payable", group: "Part II", defaultX: 450, critical: true, page: 1 },
  { key: "part2_aggregate", number: 30, expectedSubstring: "Aggregate Amount Payable", group: "Part II", defaultX: 450, critical: true, page: 1 },
  { key: "part2_attachments", number: 31, expectedSubstring: "Number of Attachments", group: "Part II", defaultX: 575, page: 1 },

  // ---- Part III: Payment Details (items 32-35) — all on page 1 ----
  { key: "part3_cash_amount", number: 32, expectedSubstring: "Cash/Bank Debit Memo", group: "Part III", defaultX: 560, page: 1 },
  { key: "part3_check_amount", number: 33, expectedSubstring: "Check", group: "Part III", defaultX: 560, page: 1 },
  { key: "part3_tax_debit_amount", number: 34, expectedSubstring: "Tax Debit Memo", group: "Part III", defaultX: 560, page: 1 },
  { key: "part3_others_amount", number: 35, expectedSubstring: "Others", group: "Part III", defaultX: 560, page: 1 },

  // ---- Part IV.B: 8% Income Tax Rate (items 47-56) — the primary Kuwenta path ----
  { key: "part4b_sales", number: 47, expectedSubstring: "Sales/Revenues/Receipts/Fees", group: "Part IV.B", defaultX: 440, critical: true, page: 2, yMax: 600 },
  { key: "part4b_less_returns", number: 48, expectedSubstring: "Less: Sales Returns, Allowances and Discounts", group: "Part IV.B", defaultX: 440, critical: true, page: 2, yMax: 600 },
  { key: "part4b_net_sales", number: 49, expectedSubstring: "Net Sales/Revenues/Receipts/Fees", group: "Part IV.B", defaultX: 440, critical: true, page: 2, yMax: 600 },
  { key: "part4b_other_income_1", number: 50, expectedSubstring: "", group: "Part IV.B", defaultX: 440, critical: true, page: 2, explicitY: 509.47 },
  { key: "part4b_other_income_2", number: 51, expectedSubstring: "", group: "Part IV.B", defaultX: 440, critical: true, page: 2, explicitY: 491.23 },
  { key: "part4b_total_other", number: 52, expectedSubstring: "Total Other Non-operating Income", group: "Part IV.B", defaultX: 440, critical: true, page: 2 },
  { key: "part4b_total_taxable", number: 53, expectedSubstring: "Total Taxable Income", group: "Part IV.B", defaultX: 440, critical: true, page: 2, yMax: 600 },
  { key: "part4b_less_250k", number: 54, expectedSubstring: "Allowable reduction from gross sales/receipts", group: "Part IV.B", defaultX: 440, critical: true, page: 2 },
  { key: "part4b_taxable_loss", number: 55, expectedSubstring: "Taxable Income/(Loss)", group: "Part IV.B", defaultX: 440, critical: true, page: 2 },
  { key: "part4b_tax_due", number: 56, expectedSubstring: "x 8% Income Tax Rate", group: "Part IV.B", defaultX: 440, critical: true, page: 2, yMax: 600 },

  // ---- Part IV.C: Tax Credits / Payments (items 57-65) — all on page 2 ----
  { key: "part4c_prior_year_credits", number: 57, expectedSubstring: "Prior Year's Excess Credits", group: "Part IV.C", defaultX: 440, critical: true, page: 2 },
  { key: "part4c_q1q3_payments", number: 58, expectedSubstring: "Payments for the First Three", group: "Part IV.C", defaultX: 440, critical: true, page: 2 },
  { key: "part4c_q1q3_cwt", number: 59, expectedSubstring: "Creditable Tax Withheld for the First Three", group: "Part IV.C", defaultX: 440, critical: true, page: 2 },
  { key: "part4c_q4_cwt", number: 60, expectedSubstring: "editable Tax Withheld per BIR Form No. 2307 for the 4", group: "Part IV.C", defaultX: 440, critical: true, page: 2 },
  { key: "part4c_prior_tax_paid", number: 61, expectedSubstring: "Paid in Return Previously Filed", group: "Part IV.C", defaultX: 440, critical: true, page: 2 },
  { key: "part4c_foreign_tax_credits", number: 62, expectedSubstring: "reign Tax Credits", group: "Part IV.C", defaultX: 440, critical: true, page: 2 },
  { key: "part4c_other_credits", number: 63, expectedSubstring: "her Tax Credits/Payments", group: "Part IV.C", defaultX: 440, critical: true, page: 2 },
  { key: "part4c_total_credits", number: 64, expectedSubstring: "Total Tax Credits/Payments", group: "Part IV.C", defaultX: 440, critical: true, page: 2 },
  { key: "part4c_net_tax_payable", number: 65, expectedSubstring: "Net Tax Payable", group: "Part IV.C", defaultX: 440, critical: true, page: 2 },
];

async function loadPdf(pdfPath: string) {
  const data = await fs.readFile(pdfPath);
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const workerAbs = path.resolve(
    process.cwd(),
    "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
  );
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerAbs).href;
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(data),
  });
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
      // like "Total Other Non-operating Income" into 6+ text items separated
      // by spaces. We include at most 25 items to bound the search.
      const baselineY = it.transform[5];
      const parts: string[] = [];
      let lastX = it.transform[4];
      for (let j = i + 1; j < Math.min(i + 25, items.length); j++) {
        const next = items[j];
        if (Math.abs(next.transform[5] - baselineY) > 3) break;
        // If there's a large horizontal gap (>40pt) it's probably a separate
        // visual block (e.g., a "Less Item X" cross-reference) — stop.
        if (next.transform[4] - lastX > 40) break;
        parts.push(next.str);
        lastX = next.transform[4] + (next.width ?? 0);
      }
      const fullLabel = parts.join("").replace(/\s+/g, " ").trim();
      if (fullLabel.length < 3) continue;
      // Use the first text item's position for the coord (which is the
      // line-item number — its baseline is the row baseline).
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

  // Label-driven matching: each def has a substring we expect to find in some
  // candidate's labelText. This is robust against 2-digit numbers being split
  // into separate text items by pdfjs. We also normalize apostrophes (U+2019
  // "right single quote" used by BIR vs U+0027 ASCII apostrophe) to plain "'".
  // Items with explicitY skip label matching entirely (used for blank rows like
  // 50/51 that have no label text).
  // Items with yMax filter candidates to those below a raw-y threshold (used to
  // disambiguate labels duplicated in Part IV.A vs IV.B).
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
      .replace(/\s+/g, " ");
  for (const def of defs) {
    if (def.explicitY !== undefined) {
      out[def.key] = {
        key: def.key,
        label: `${def.group} item ${def.number}`,
        page: 2, // Part IV.B is on page 2
        x: def.defaultX,
        y: def.explicitY,
        fontSize: 9,
        maxWidth: 100,
        align: "right",
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
      y: pick.y,
      fontSize: 9,
      maxWidth: 100,
      align: "right",
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
  // Try the napi-rs canvas + pdfjs render first.
  await import("pdfjs-dist/legacy/build/pdf.mjs");
  // Use a canvas factory based on @napi-rs/canvas
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
      // The Node legacy build expects canvas + canvasContext on the render params.
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
    const target = path.join(outDir, `1701A-coords-check-page${p}.png`);
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
  // Canvas uses top-left origin (y down). Coords are in PDF user space
  // (bottom-left, y up), so flip y.
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
    c.font = "bold 12px sans-serif";
    c.fillStyle = "blue";
    c.fillText(c2.key, cx + 12, cy + 4);
  }
}

// Minimal shape we use from a canvas 2D context. Both `canvas` and
// `@napi-rs/canvas` satisfy this; the actual types are not compatible
// across both, so we keep our own minimal contract.
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
    // White background
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, w, h);
    // Faint form outline (page border)
    ctx.strokeStyle = "#ddd";
    ctx.lineWidth = 1;
    ctx.strokeRect(2, 2, w - 4, h - 4);
    // Faint horizontal grid every 20pt
    ctx.strokeStyle = "#f0f0f0";
    for (let yy = 0; yy < h; yy += 20 * scale) {
      ctx.beginPath();
      ctx.moveTo(0, yy);
      ctx.lineTo(w, yy);
      ctx.stroke();
    }
    // Mark all coord positions as red dots
    drawDotsOnCanvas(ctx, coords, page, scale, pageHeight);
    // Page label
    ctx.fillStyle = "black";
    ctx.font = "bold 18px sans-serif";
    ctx.fillText(`1701A Schematic — page ${page} (no PDF render available)`, 20, 30);
    ctx.font = "12px sans-serif";
    ctx.fillText("Open the original 1701A PDF alongside this PNG to compare dot positions to actual form lines.", 20, 50);
    const buf = canvas.toBuffer("image/png");
    const target = path.join(outDir, `1701A-schematic-page${page}.png`);
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
    console.error("Usage: tsx scripts/extract-1701a-coords.ts <pdf-path>");
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
    console.log(`  ${c.key.padEnd(32)} page=${c.page}  x=${c.x.toFixed(1).padStart(7)}  y=${c.y.toFixed(1).padStart(7)}  src=${JSON.stringify(c.sourceText)}`);
  }

  // Try PNG render with the actual PDF
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

  // Always also produce a marked-up PDF for the user to open in their PDF viewer
  // eslint-disable-next-line no-console
  console.log("\n--- Marked-up PDF (actual form with red dots) ---");
  const pdfOut = path.join(outDir, "1701A-coords-check.pdf");
  const written = await renderMarkedUpPdf(resolved, coords, pdfOut);
  // eslint-disable-next-line no-console
  console.log(`  ${written}`);

  // Write the coord map as TypeScript
  const tsBody =
    `import type { BirFormCoord } from "./types";\n\n` +
    `// AUTO-GENERATED by scripts/extract-1701a-coords.ts.\n` +
    `// Visual verification: see tmp/1701A-coords-check.pdf (and .png if render succeeded).\n` +
    `// Coordinates are pdf-lib convention: origin = bottom-left, y counts up.\n` +
    `// Page size: 612 x 936 pt (US Letter). Reviewed: pending visual check.\n\n` +
    `export const COORDS_1701A: Record<string, BirFormCoord> = ${JSON.stringify(
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
  await fs.writeFile(path.resolve("lib/pdf/coords/1701A.generated.ts"), tsBody, "utf8");
  // eslint-disable-next-line no-console
  console.log(`\nWrote lib/pdf/coords/1701A.generated.ts`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
