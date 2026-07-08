import { PDFPage, PDFFont } from 'pdf-lib'

export interface DrawCharacterBoxesOptions {
  page: PDFPage
  value: string | number | null | undefined
  startX: number
  startY: number
  boxWidth?: number
  fontSize?: number
  font: PDFFont
}

const DEFAULT_BOX_WIDTH = 11
const DEFAULT_FONT_SIZE = 8

/**
 * Draws a value into BIR printed character boxes, one character per box.
 *
 * Each non-dash character is drawn centered horizontally within its own box.
 * Dash characters (`-`) are skipped because they are pre-printed on the form;
 * the box index is still advanced so subsequent characters remain aligned.
 */
export function drawCharacterBoxes(options: DrawCharacterBoxesOptions): void {
  const {
    page,
    value,
    startX,
    startY,
    boxWidth = DEFAULT_BOX_WIDTH,
    fontSize = DEFAULT_FONT_SIZE,
    font,
  } = options

  const text = value == null ? '' : String(value)
  if (text.length === 0) return

  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (char === '-') continue

    const boxX = startX + index * boxWidth
    const charWidth = font.widthOfTextAtSize(char, fontSize)
    const x = boxX + (boxWidth - charWidth) / 2

    page.drawText(char, { x, y: startY, size: fontSize, font })
  }
}
