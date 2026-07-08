import { describe, it, expect, vi } from 'vitest'
import { PDFPage, PDFFont } from 'pdf-lib'
import { drawCharacterBoxes } from '../character-boxes'

function createMocks() {
  const drawText = vi.fn()
  const widthOfTextAtSize = vi.fn(() => 5)

  const page = { drawText } as unknown as PDFPage
  const font = { widthOfTextAtSize } as unknown as PDFFont

  return { page, font, drawText, widthOfTextAtSize }
}

describe('drawCharacterBoxes', () => {
  it('draws each digit in its own centered box', () => {
    const { page, font, drawText } = createMocks()

    drawCharacterBoxes({
      page,
      value: '12',
      startX: 100,
      startY: 200,
      boxWidth: 11,
      fontSize: 8,
      font,
    })

    expect(drawText).toHaveBeenCalledTimes(2)
    expect(drawText).toHaveBeenNthCalledWith(1, '1', {
      x: 100 + (11 - 5) / 2,
      y: 200,
      size: 8,
      font,
    })
    expect(drawText).toHaveBeenNthCalledWith(2, '2', {
      x: 100 + 11 + (11 - 5) / 2,
      y: 200,
      size: 8,
      font,
    })
  })

  it('skips dashes and advances the box index', () => {
    const { page, font, drawText } = createMocks()

    drawCharacterBoxes({
      page,
      value: '12-34',
      startX: 50,
      startY: 75,
      boxWidth: 11,
      fontSize: 8,
      font,
    })

    expect(drawText).toHaveBeenCalledTimes(4)
    expect(drawText).not.toHaveBeenCalledWith('-', expect.any(Object))

    // Dash occupies box index 2, so '3' is drawn at index 3
    expect(drawText).toHaveBeenNthCalledWith(
      3,
      '3',
      expect.objectContaining({
        x: 50 + 3 * 11 + (11 - 5) / 2,
        y: 75,
      })
    )
  })

  it('defaults to an 8pt font and 11pt box width', () => {
    const { page, font, drawText } = createMocks()

    drawCharacterBoxes({
      page,
      value: '9',
      startX: 10,
      startY: 20,
      font,
    })

    expect(drawText).toHaveBeenCalledWith('9', {
      x: 10 + (11 - 5) / 2,
      y: 20,
      size: 8,
      font,
    })
  })

  it('is a no-op for null, undefined, and empty values', () => {
    const { page, font, drawText } = createMocks()

    drawCharacterBoxes({ page, value: null, startX: 0, startY: 0, font })
    drawCharacterBoxes({ page, value: undefined, startX: 0, startY: 0, font })
    drawCharacterBoxes({ page, value: '', startX: 0, startY: 0, font })

    expect(drawText).not.toHaveBeenCalled()
  })

  it('handles numeric values by converting them to strings', () => {
    const { page, font, drawText } = createMocks()

    drawCharacterBoxes({
      page,
      value: 42,
      startX: 0,
      startY: 0,
      boxWidth: 11,
      fontSize: 8,
      font,
    })

    expect(drawText).toHaveBeenCalledTimes(2)
    expect(drawText).toHaveBeenNthCalledWith(1, '4', expect.any(Object))
    expect(drawText).toHaveBeenNthCalledWith(2, '2', expect.any(Object))
  })
})
