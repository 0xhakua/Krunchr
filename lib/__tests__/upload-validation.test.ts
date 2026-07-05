import { describe, expect, it } from 'vitest'
import {
  MAX_UPLOAD_BYTES,
  UploadValidationError,
  validateUploadFile,
} from '@/lib/upload/validation'

function makeFile(overrides: {
  name?: string
  type?: string
  size?: number
  buffer?: Buffer
}): {
  name: string
  type: string
  size: number
  arrayBuffer(): Promise<ArrayBuffer>
} {
  const name = overrides.name ?? 'test.jpg'
  const type = overrides.type ?? 'image/jpeg'
  const size = overrides.size ?? 1024
  const buffer = overrides.buffer ?? Buffer.from([0xff, 0xd8, 0xff, 0x00])
  return {
    name,
    type,
    size,
    async arrayBuffer() {
      const dst = new ArrayBuffer(buffer.length)
      new Uint8Array(dst).set(buffer)
      return dst
    },
  }
}

describe('validateUploadFile', () => {
  it('accepts a valid JPEG', async () => {
    const file = makeFile({
      name: 'receipt.jpg',
      type: 'image/jpeg',
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00]),
    })
    const result = await validateUploadFile(file)
    expect(result.mimeType).toBe('image/jpeg')
    expect(result.originalName).toBe('receipt.jpg')
    expect(result.byteLength).toBe(4)
  })

  it('accepts a valid PNG', async () => {
    const file = makeFile({
      name: 'receipt.png',
      type: 'image/png',
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    })
    const result = await validateUploadFile(file)
    expect(result.mimeType).toBe('image/png')
  })

  it('accepts a valid PDF', async () => {
    const file = makeFile({
      name: 'form.pdf',
      type: 'application/pdf',
      buffer: Buffer.from([0x25, 0x50, 0x44, 0x46]),
    })
    const result = await validateUploadFile(file)
    expect(result.mimeType).toBe('application/pdf')
  })

  it('accepts a valid DOCX', async () => {
    const file = makeFile({
      name: 'form.docx',
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    })
    const result = await validateUploadFile(file)
    expect(result.mimeType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  })

  it('rejects unsupported MIME types', async () => {
    const file = makeFile({ name: 'malware.exe', type: 'application/x-msdownload' })
    await expect(validateUploadFile(file)).rejects.toThrow(UploadValidationError)
    await expect(validateUploadFile(file)).rejects.toThrow('Unsupported file type')
  })

  it('rejects extension mismatch', async () => {
    const file = makeFile({
      name: 'receipt.png',
      type: 'image/jpeg',
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00]),
    })
    await expect(validateUploadFile(file)).rejects.toThrow('extension does not match')
  })

  it('rejects oversized files', async () => {
    const file = makeFile({ size: MAX_UPLOAD_BYTES + 1 })
    await expect(validateUploadFile(file)).rejects.toThrow('too large')
  })

  it('rejects files with invalid magic numbers', async () => {
    const file = makeFile({
      name: 'receipt.jpg',
      type: 'image/jpeg',
      buffer: Buffer.from([0x00, 0x00, 0x00, 0x00]),
    })
    await expect(validateUploadFile(file)).rejects.toThrow('signature does not match')
  })

  it('rejects empty files', async () => {
    const file = makeFile({ name: 'empty.jpg', type: 'image/jpeg', buffer: Buffer.from([]) })
    await expect(validateUploadFile(file)).rejects.toThrow('empty')
  })
})
