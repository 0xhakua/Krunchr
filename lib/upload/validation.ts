/**
 * File upload validation helpers for Form 2307 imports.
 *
 * Enforces an allow-list of MIME types and extensions, verifies file magic
 * numbers/signatures where possible, and rejects oversized uploads before
 * any parsing logic runs.
 */

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 // 10 MB

export type AllowedFileType = 'image/jpeg' | 'image/png' | 'application/pdf' | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export interface ValidatedFile {
  buffer: Buffer
  originalName: string
  mimeType: AllowedFileType
  byteLength: number
}

export const ALLOWED_MIME_TYPES: AllowedFileType[] = [
  'image/jpeg',
  'image/png',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]

const EXTENSION_BY_MIME: Record<AllowedFileType, string[]> = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'application/pdf': ['.pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
}

export class UploadValidationError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message)
    this.name = 'UploadValidationError'
  }
}

function extensionForFilename(filename: string): string {
  const idx = filename.lastIndexOf('.')
  return idx === -1 ? '' : filename.slice(idx).toLowerCase()
}

function matchesExtension(filename: string, mimeType: AllowedFileType): boolean {
  const ext = extensionForFilename(filename)
  return ext !== '' && EXTENSION_BY_MIME[mimeType].includes(ext)
}

function hasValidMagicNumber(buffer: Buffer, mimeType: AllowedFileType): boolean {
  if (buffer.length < 4) return false

  switch (mimeType) {
    case 'image/jpeg':
      return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
    case 'image/png':
      return (
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47
      )
    case 'application/pdf':
      return (
        buffer[0] === 0x25 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x44 &&
        buffer[3] === 0x46
      )
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      // DOCX is a ZIP archive; verify the generic ZIP signature. The MIME
      // type allow-list already narrows this to Office Open XML documents.
      return buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04
    default:
      return false
  }
}

/**
 * Validate an uploaded file for the 2307 import endpoint.
 *
 * @throws {UploadValidationError} when the file fails validation
 */
export function validateUploadFile(
  file: { name?: string; type: string; size: number; arrayBuffer(): Promise<ArrayBuffer> }
): Promise<ValidatedFile> {
  return (async () => {
    if (!ALLOWED_MIME_TYPES.includes(file.type as AllowedFileType)) {
      throw new UploadValidationError(
        `Unsupported file type: ${file.type}. Allowed: JPG, PNG, PDF, DOCX.`,
        'UNSUPPORTED_TYPE'
      )
    }

    const mimeType = file.type as AllowedFileType
    const originalName = file.name ?? 'upload'

    if (!matchesExtension(originalName, mimeType)) {
      throw new UploadValidationError(
        `File extension does not match the declared MIME type (${mimeType}).`,
        'EXTENSION_MISMATCH'
      )
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      throw new UploadValidationError(
        `File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum allowed is 10 MB.`,
        'FILE_TOO_LARGE'
      )
    }

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    if (buffer.length === 0) {
      throw new UploadValidationError('Uploaded file is empty.', 'EMPTY_FILE')
    }

    if (!hasValidMagicNumber(buffer, mimeType)) {
      throw new UploadValidationError(
        'File signature does not match the declared type. Possible extension spoofing.',
        'INVALID_SIGNATURE'
      )
    }

    return { buffer, originalName, mimeType, byteLength: buffer.length }
  })()
}
