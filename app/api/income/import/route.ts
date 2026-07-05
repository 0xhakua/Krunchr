import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/session'
import { prisma } from '@/lib/prisma'
import { isRateLimited } from '@/lib/rate-limit'
import { validateUploadFile } from '@/lib/upload/validation'
import { extract2307Fields } from '@/lib/ocr/2307-parser'

const MAX_IMPORTS_PER_HOUR = 20

export async function POST(req: NextRequest) {
  const session = await requireAuth(req)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitKey = `income-import:${session.sub}`
  if (isRateLimited(rateLimitKey, MAX_IMPORTS_PER_HOUR, 60 * 60 * 1000)) {
    return NextResponse.json(
      { error: 'Import limit reached. Please try again later.', code: 'RATE_LIMITED' },
      { status: 429 }
    )
  }

  let validatedFile: Awaited<ReturnType<typeof validateUploadFile>> | undefined

  try {
    const formData = await req.formData()
    const file = formData.get('file')

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // File objects from formData carry the name and type we need for validation.
    validatedFile = await validateUploadFile(
      file as unknown as {
        name?: string
        type: string
        size: number
        arrayBuffer(): Promise<ArrayBuffer>
      }
    )

    const extracted = await extract2307Fields(validatedFile)

    await prisma.auditLog.create({
      data: {
        userId: session.sub,
        action: '2307_IMPORT_ATTEMPTED',
        entityType: 'Form2307',
        metadata: {
          fileName: validatedFile.originalName,
          mimeType: validatedFile.mimeType,
          byteLength: validatedFile.byteLength,
          confidence: extracted.confidence,
          foundFields: Object.keys(extracted).filter(
            (k) =>
              k !== 'confidence' &&
              k !== 'warnings' &&
              extracted[k as keyof typeof extracted] !== undefined
          ),
          warnings: extracted.warnings,
        },
      },
    })

    return NextResponse.json({ extracted })
  } catch (err) {
    if (err instanceof Error && err.name === 'UploadValidationError') {
      return NextResponse.json(
        { error: err.message, code: (err as { code?: string }).code },
        { status: 400 }
      )
    }

    console.error('Import 2307 error:', err)

    // Log failures caused by parsing or unexpected server errors so the audit
    // trail captures both successful and failed import attempts.
    try {
      await prisma.auditLog.create({
        data: {
          userId: session.sub,
          action: '2307_IMPORT_FAILED',
          entityType: 'Form2307',
          metadata: {
            fileName: validatedFile?.originalName,
            mimeType: validatedFile?.mimeType,
            byteLength: validatedFile?.byteLength,
            error: err instanceof Error ? err.message : String(err),
          },
        },
      })
    } catch (logErr) {
      console.error('Failed to write import audit log:', logErr)
    }

    return NextResponse.json(
      { error: 'Failed to process the uploaded file. Please check the file and try again.' },
      { status: 500 }
    )
  }
}
