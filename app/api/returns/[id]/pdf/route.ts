import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/session'
import { loadFilingData, renderFilingPdf } from '@/lib/pdf/dispatcher'
import { readFile } from '@/lib/storage'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAuth()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const { searchParams } = new URL(req.url)
    const inline = searchParams.get('inline') === '1'
    const preview = searchParams.get('preview') === '1'

    const data = await loadFilingData(id, session.sub)
    if (!data) {
      return NextResponse.json({ error: 'Return not found' }, { status: 404 })
    }

    let pdfBuffer: Buffer | null = null
    let previewMode: 'stored' | 'regenerated' | null = null

    // Filed returns have a stored PDF whose SHA-256 was anchored on Stellar.
    // Always serve that exact file so the verifier can reproduce the hash.
    // We must NOT regenerate filed returns because pdf-lib overlay rendering is
    // non-deterministic: each render produces a different SHA-256, so a
    // regenerated PDF would never match the on-chain anchor.
    if (data.ret.status === 'FILED') {
      if (!data.ret.pdfPath) {
        if (preview) {
          // Preview mode: show a regenerated view when the stored copy is gone.
          pdfBuffer = await renderFilingPdf(id, session.sub)
          previewMode = 'regenerated'
        } else {
          return NextResponse.json(
            { error: 'Filing PDF is not stored for this return' },
            { status: 404 }
          )
        }
      } else {
        try {
          pdfBuffer = await readFile(data.ret.pdfPath)
          previewMode = preview ? 'stored' : null
        } catch (err) {
          const code = err instanceof Error ? (err as NodeJS.ErrnoException).code : null
          console.error(
            `Stored filing PDF missing for return ${id} at ${data.ret.pdfPath}`,
            code
          )
          if (preview) {
            pdfBuffer = await renderFilingPdf(id, session.sub)
            previewMode = 'regenerated'
          } else {
            return NextResponse.json(
              { error: 'Filing PDF not found in storage' },
              { status: 404 }
            )
          }
        }
      }
    } else {
      // Non-filed returns are preview/generated on demand.
      pdfBuffer = await renderFilingPdf(id, session.sub)
    }

    if (!pdfBuffer) {
      return NextResponse.json({ error: 'Failed to generate PDF' }, { status: 500 })
    }

    const form = data.ret.formType.replace('FORM_', '')
    const quarter = data.ret.quarter ? `Q${data.ret.quarter}` : 'Annual'
    const filename = `${form}-${quarter}-${data.taxYear.year}.pdf`

    const headers: Record<string, string> = {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${filename}"`,
    }
    if (previewMode) {
      headers['X-Kuwenta-Preview'] = previewMode
    }

    return new NextResponse(new Uint8Array(pdfBuffer), { headers })
  } catch (err) {
    console.error('Generate PDF error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
