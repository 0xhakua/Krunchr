/**
 * Shared types and constants for BIR-form overlay rendering.
 *
 * The overlay approach (per issue #159):
 * - Load the official BIR PDF (e.g., public/bir-forms/1701A.pdf) from disk.
 * - Walk a Record<key, value> built from the filing's data.
 * - For each key, look up the coord in the form's coord map and draw the
 *   value at that position with pdf-lib (page.drawText for text, a small
 *   filled rectangle for checkboxes).
 * - Flatten the PDF so the overlaid values cannot be edited.
 *
 * Coordinates are in PDF user space (origin bottom-left, y up). See
 * lib/pdf/coords/types.ts and the per-form COORDS_*.generated.ts files.
 */

/**
 * A value to overlay at a coord. Strings and numbers are drawn as text.
 * `true` draws a filled checkbox square. `false`/empty/null/undefined are
 * skipped (no draw).
 */
export type BirOverlayValue = string | number | boolean | null | undefined;

/**
 * A map of coord-key -> value. Keys are the same keys used in the per-form
 * COORDS_*.generated.ts file.
 */
export type BirOverlayValues = Record<string, BirOverlayValue>;

/**
 * The result of an overlay render. Always flattened (no AcroForm fields).
 */
export interface BirOverlayResult {
  bytes: Uint8Array;
  pageCount: number;
  /** Keys that were actually drawn (after filter). Useful for debug/audit logs. */
  drawnKeys: string[];
}

/**
 * Drawing options. Defaults are tuned for 1701A Jan 2018 — a US-Letter page
 * with a 9pt font and right-aligned amounts.
 */
export interface BirOverlayOptions {
  /** Default font size if the coord doesn't specify one. */
  defaultFontSize?: number;
  /** Padding (pt) between the value and the printed label inside the input box. */
  cellPadding?: number;
  /** Color for text and checkbox fill. */
  color?: { r: number; g: number; b: number };
}

/**
 * Group of alternative coords for a single logical field. The runtime picks
 * one of the alternative keys based on the taxpayer's data and sets the
 * corresponding value to `true`; the other alternatives are not drawn.
 *
 * Example: the BIR 1701A "Taxpayer Type" field has two checkboxes
 * (Single Proprietor, Professional). At runtime, exactly one is marked.
 */
export type BirCoordGroup<T extends string> = Record<T, string>;

/**
 * Loads a PDF from the bundled public/bir-forms/ directory.
 * Works in both Next.js dev (file on disk) and production (file on disk).
 */
export async function loadOfficialBirPdf(filename: string): Promise<Uint8Array> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const fullPath = path.join(process.cwd(), "public", "bir-forms", filename);
  const buf = await fs.readFile(fullPath);
  return new Uint8Array(buf);
}
