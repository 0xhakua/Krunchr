/**
 * Coordinate extraction for BIR Form 2551Q (January 2018 ENCS) overlay.
 *
 * Mirrors scripts/extract-1701a-coords.ts. Loads the official BIR PDF with
 * pdfjs-dist, finds line-item numbers (1-28), and maps each to a BirFormCoord
 * by label-driven matching. The y-coordinate is taken from the row baseline of
 * the line-item number; the x-coordinate is hand-tuned to land inside the
 * input box.
 *
 * Output:
 *   - lib/pdf/coords/2551Q.generated.ts  (the runtime coord map)
 *   - tmp/2551Q-coords-check.pdf         (PDF with red dots at each coord)
 *   - tmp/2551Q-coords-check-page{1,2}.png (rendered verification PNGs)
 *
 * Usage:
 *   pnpm tsx scripts/extract-2551q-coords.ts public/bir-forms/2551Q.pdf
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

// Actual line-item numbering on BIR Form 2551Q January 2018 ENCS.
// See docs/client-guides/2551Q Jan 2018 ENCS final rev 3_copy.pdf for the
// authoritative layout. Fields marked CRITICAL are the ones the client
// first asked for (Part I header + Part II total tax payable + penalties).
type LineItemDef = {
  key: string;
  number: number;
  // We match by label substring (label-driven, not number-driven) so 2-digit
  // numbers that pdfjs splits into separate text items still resolve correctly.
  expectedSubstring: string;
  critical?: boolean;
  defaultX: number;
  group:
    | "Header"
    | "Part I"
    | "Part II"
    | "Part III"
    | "Schedule 1"
    | "Schedule 1 Total";
  // Optional: page number the item lives on.
  page?: number;
  // Optional: yMax filters candidate matches to those with y < yMax.
  yMax?: number;
  // Optional: yMin filters candidate matches to those with y > yMin.
  yMin?: number;
  // Optional: explicit y position that overrides the matched label y.
  explicitY?: number;
};

const LINE_ITEM_DEFS: LineItemDef[] = [
  // ---- Header (items 1-5) — all on page 1, y > 780 ----
  // Item 1 (For the Year, Calendar/Fiscal) — both checkboxes
  { key: "header_calendar", number: 1, expectedSubstring: "For the", group: "Header", defaultX: 130, page: 1, yMin: 780 },
  { key: "header_fiscal", number: 1, expectedSubstring: "For the", group: "Header", defaultX: 205, page: 1, yMin: 780 },
  // Item 2: Year Ended (MM/YYYY) — value goes in the input box on the right
  { key: "header_year_ended", number: 2, expectedSubstring: "Year Ended", group: "Header", defaultX: 360, page: 1, yMin: 780 },
  // Item 3: Quarter (1st/2nd/3rd/4th) — 4 checkboxes
  { key: "header_quarter_1st", number: 3, expectedSubstring: "Quarter", group: "Header", defaultX: 252, page: 1, yMin: 780, critical: true },
  { key: "header_quarter_2nd", number: 3, expectedSubstring: "Quarter", group: "Header", defaultX: 293, page: 1, yMin: 780, critical: true },
  { key: "header_quarter_3rd", number: 3, expectedSubstring: "Quarter", group: "Header", defaultX: 337, page: 1, yMin: 780, critical: true },
  { key: "header_quarter_4th", number: 3, expectedSubstring: "Quarter", group: "Header", defaultX: 378, page: 1, yMin: 780, critical: true },
  // Item 4: Amended Return? — "4" at y=814 but "Yes/No" labels at y=797 (multi-line).
  // The line item number "4" shares the row with items 1-3 (y=814), but the
  // Yes/No checkboxes are on the next row (y=797). Use explicitY for both.
  { key: "header_amended_yes", number: 4, expectedSubstring: "", group: "Header", defaultX: 444, page: 1, explicitY: 797 },
  { key: "header_amended_no", number: 4, expectedSubstring: "", group: "Header", defaultX: 485, page: 1, explicitY: 797 },
  // Item 5: Number of Sheet/s Attached — number "5" at y=814, but the label
  // "Number of Sheet/s Attached" spans y=814 and y=801. Use explicitY for
  // the value row.
  { key: "header_sheets_attached", number: 5, expectedSubstring: "", group: "Header", defaultX: 555, page: 1, explicitY: 801 },

  // ---- Part I — Background Information (items 6-13) — all on page 1 ----
  { key: "part1_tin", number: 6, expectedSubstring: "Taxpayer Identification Number", group: "Part I", defaultX: 285, critical: true, page: 1, yMin: 700 },
  { key: "part1_rdo_code", number: 7, expectedSubstring: "RDO Code", group: "Part I", defaultX: 540, critical: true, page: 1, yMin: 700 },
  { key: "part1_taxpayer_name", number: 8, expectedSubstring: "Taxpayer", group: "Part I", defaultX: 285, critical: true, page: 1, yMin: 700, yMax: 760 },
  { key: "part1_registered_address", number: 9, expectedSubstring: "Registered", group: "Part I", defaultX: 285, critical: true, page: 1, yMin: 600, yMax: 740 },
  { key: "part1_zip_code", number: 9, expectedSubstring: "ZIP Code", group: "Part I", defaultX: 555, page: 1, yMin: 600, yMax: 720 },
  // After hand-tuning (review of tmp/2551Q-coords-check-page1.png): the
  // "Contact Number" label sits at x=36-191; nudging +10pt (200 → 210)
  // clears the label and lands inside the input box.
  { key: "part1_contact_number", number: 10, expectedSubstring: "Contact Number", group: "Part I", defaultX: 210, page: 1, yMin: 600, yMax: 700 },
  { key: "part1_email", number: 11, expectedSubstring: "Email Address", group: "Part I", defaultX: 400, page: 1, yMin: 600, yMax: 700 },
  // Item 12: Special Law or International Tax Treaty? (Yes/No)
  // The label "Special Law or International Tax Treaty?" sits at y=635 while
  // the "12" number and the "Yes/No" checkboxes are at y=639 — different
  // baselines (4pt apart). Label-driven matching can't see the full label.
  // Use explicitY for the Yes/No checkboxes; "If yes, specify" matches fine.
  { key: "part1_treaty_yes", number: 12, expectedSubstring: "", group: "Part I", defaultX: 200, page: 1, explicitY: 639 },
  { key: "part1_treaty_no", number: 12, expectedSubstring: "", group: "Part I", defaultX: 243, page: 1, explicitY: 639 },
  { key: "part1_treaty_specify", number: 12, expectedSubstring: "If yes, specify", group: "Part I", defaultX: 555, page: 1, yMin: 600, yMax: 660 },
  // Item 13: What income tax rates are you availing? (Q1 only — never Q2/Q3/Q4 per BR-02)
  // The two rate-choice checkboxes are on different baselines (Graduated at
  // y=603, 8% at y=598), and the row is split across 4 baselines (613, 603, 598, 593).
  // Use explicitY for each checkbox.
  { key: "part1_tax_rate_8pct", number: 13, expectedSubstring: "", group: "Part I", defaultX: 355, critical: true, page: 1, explicitY: 598 },
  { key: "part1_tax_rate_graduated", number: 13, expectedSubstring: "", group: "Part I", defaultX: 185, page: 1, explicitY: 603 },

  // ---- Part II — Total Tax Payable (items 14-24) — all on page 1 ----
  { key: "part2_total_tax_due", number: 14, expectedSubstring: "Total Tax Due", group: "Part II", defaultX: 540, critical: true, page: 1, yMax: 580 },
  { key: "part2_cwt_withheld", number: 15, expectedSubstring: "Creditable Percentage Tax Withheld", group: "Part II", defaultX: 540, critical: true, page: 1, yMax: 540 },
  { key: "part2_amended_payment", number: 16, expectedSubstring: "Amended Return", group: "Part II", defaultX: 540, page: 1, yMax: 520 },
  { key: "part2_other_credits", number: 17, expectedSubstring: "Other Tax Credit/Payment", group: "Part II", defaultX: 540, page: 1, yMax: 500 },
  { key: "part2_total_credits", number: 18, expectedSubstring: "Total Tax Credit", group: "Part II", defaultX: 540, page: 1, yMax: 480 },
  { key: "part2_tax_still_payable", number: 19, expectedSubstring: "Tax Still", group: "Part II", defaultX: 540, critical: true, page: 1, yMax: 470 },
  { key: "part2_surcharge", number: 20, expectedSubstring: "Surcharge", group: "Part II", defaultX: 540, critical: true, page: 1, yMax: 440 },
  { key: "part2_interest", number: 21, expectedSubstring: "Interest", group: "Part II", defaultX: 540, critical: true, page: 1, yMax: 420 },
  { key: "part2_compromise", number: 22, expectedSubstring: "Compromise", group: "Part II", defaultX: 540, critical: true, page: 1, yMax: 400 },
  { key: "part2_total_penalties", number: 23, expectedSubstring: "Total Penalties", group: "Part II", defaultX: 540, critical: true, page: 1, yMax: 380 },
  { key: "part2_total_amount_payable", number: 24, expectedSubstring: "TOTAL AMOUNT PAYABLE", group: "Part II", defaultX: 540, critical: true, page: 1, yMax: 360 },

  // ---- Part III — Details of Payment (items 25-28) — all on page 1, y < 200 ----
  { key: "part3_cash_bank_debit", number: 25, expectedSubstring: "Cash/Bank Debit Memo", group: "Part III", defaultX: 540, page: 1, yMax: 200 },
  { key: "part3_check", number: 26, expectedSubstring: "Check", group: "Part III", defaultX: 540, page: 1, yMax: 200 },
  { key: "part3_tax_debit_memo", number: 27, expectedSubstring: "Tax Debit", group: "Part III", defaultX: 540, page: 1, yMax: 200 },
  { key: "part3_others", number: 28, expectedSubstring: "Others", group: "Part III", defaultX: 540, page: 1, yMax: 200 },

  // ---- Schedule 1 — Computation of Tax (items 1-7) — all on page 2 ----
  // 6 ATC lines (Items 1-6) — each has 3 fields: ATC, Taxable Amount, Tax Due.
  // Under 8% election, all Tax Due values = 0.00 per BR-04. The form is still
  // mapped for completeness; the runtime draws 0.00 unless the elected rate
  // is non-8% (rare Kuwenta case).
  { key: "sched1_item1_atc", number: 1, expectedSubstring: "", group: "Schedule 1", defaultX: 100, page: 2, explicitY: 762 },
  { key: "sched1_item1_taxable", number: 1, expectedSubstring: "", group: "Schedule 1", defaultX: 230, page: 2, explicitY: 762 },
  { key: "sched1_item1_tax_due", number: 1, expectedSubstring: "", group: "Schedule 1", defaultX: 480, page: 2, explicitY: 762 },
  { key: "sched1_item2_atc", number: 2, expectedSubstring: "", group: "Schedule 1", defaultX: 100, page: 2, explicitY: 743 },
  { key: "sched1_item2_taxable", number: 2, expectedSubstring: "", group: "Schedule 1", defaultX: 230, page: 2, explicitY: 743 },
  { key: "sched1_item2_tax_due", number: 2, expectedSubstring: "", group: "Schedule 1", defaultX: 480, page: 2, explicitY: 743 },
  { key: "sched1_item3_atc", number: 3, expectedSubstring: "", group: "Schedule 1", defaultX: 100, page: 2, explicitY: 725 },
  { key: "sched1_item3_taxable", number: 3, expectedSubstring: "", group: "Schedule 1", defaultX: 230, page: 2, explicitY: 725 },
  { key: "sched1_item3_tax_due", number: 3, expectedSubstring: "", group: "Schedule 1", defaultX: 480, page: 2, explicitY: 725 },
  { key: "sched1_item4_atc", number: 4, expectedSubstring: "", group: "Schedule 1", defaultX: 100, page: 2, explicitY: 707 },
  { key: "sched1_item4_taxable", number: 4, expectedSubstring: "", group: "Schedule 1", defaultX: 230, page: 2, explicitY: 707 },
  { key: "sched1_item4_tax_due", number: 4, expectedSubstring: "", group: "Schedule 1", defaultX: 480, page: 2, explicitY: 707 },
  { key: "sched1_item5_atc", number: 5, expectedSubstring: "", group: "Schedule 1", defaultX: 100, page: 2, explicitY: 689 },
  { key: "sched1_item5_taxable", number: 5, expectedSubstring: "", group: "Schedule 1", defaultX: 230, page: 2, explicitY: 689 },
  { key: "sched1_item5_tax_due", number: 5, expectedSubstring: "", group: "Schedule 1", defaultX: 480, page: 2, explicitY: 689 },
  { key: "sched1_item6_atc", number: 6, expectedSubstring: "", group: "Schedule 1", defaultX: 100, page: 2, explicitY: 670 },
  { key: "sched1_item6_taxable", number: 6, expectedSubstring: "", group: "Schedule 1", defaultX: 230, page: 2, explicitY: 670 },
  { key: "sched1_item6_tax_due", number: 6, expectedSubstring: "", group: "Schedule 1", defaultX: 480, page: 2, explicitY: 670 },
  // Item 7: Total Tax Due (Sum of Items 1 to 6) (To Part II, Item 14)
  // Under 8% election, this is always ₱0.00 (BR-04). The label is split
  // across two baselines (y=652 and y=649 — "Total Tax Due" + "(Sum of
  // Items 1 to 6)(To Part II Item 14)"). Use explicitY.
  { key: "sched1_total_tax_due", number: 7, expectedSubstring: "", group: "Schedule 1 Total", defaultX: 540, critical: true, page: 2, explicitY: 652 },
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
      const baselineY = it.transform[5];
      const parts: string[] = [];
      let lastX = it.transform[4];
      for (let j = i + 1; j < Math.min(i + 30, items.length); j++) {
        const next = items[j];
        if (Math.abs(next.transform[5] - baselineY) > 3) break;
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
        page: def.page ?? 1,
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
    const target = path.join(outDir, `2551Q-coords-check-page${p}.png`);
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
    ctx.fillText(`2551Q Schematic — page ${page} (no PDF render available)`, 20, 30);
    ctx.font = "12px sans-serif";
    ctx.fillText("Open the original 2551Q PDF alongside this PNG to compare dot positions to actual form lines.", 20, 50);
    const buf = canvas.toBuffer("image/png");
    const target = path.join(outDir, `2551Q-schematic-page${page}.png`);
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
    console.error("Usage: tsx scripts/extract-2551q-coords.ts <pdf-path>");
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
  const pdfOut = path.join(outDir, "2551Q-coords-check.pdf");
  const written = await renderMarkedUpPdf(resolved, coords, pdfOut);
  // eslint-disable-next-line no-console
  console.log(`  ${written}`);

  const tsBody =
    `import type { BirFormCoord } from "./types";\n\n` +
    `// AUTO-GENERATED by scripts/extract-2551q-coords.ts.\n` +
    `// Visual verification: see tmp/2551Q-coords-check.pdf (and .png if render succeeded).\n` +
    `// Coordinates are pdf-lib convention: origin = bottom-left, y counts up.\n` +
    `// Page size: 612 x 936 pt (US Letter). Reviewed: pending visual check.\n\n` +
    `export const COORDS_2551Q: Record<string, BirFormCoord> = ${JSON.stringify(
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
  await fs.writeFile(path.resolve("lib/pdf/coords/2551Q.generated.ts"), tsBody, "utf8");
  // eslint-disable-next-line no-console
  console.log(`\nWrote lib/pdf/coords/2551Q.generated.ts`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
