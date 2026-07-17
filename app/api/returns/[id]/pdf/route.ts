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

    const data = await loadFilingData(id, session.sub)
    if (!data) {
      return NextResponse.json({ error: 'Return not found' }, { status: 404 })
    }

    let pdfBuffer: Buffer | null = null

    // Filed returns have a stored PDF whose SHA-256 was anchored on Stellar.
    // Always serve that exact file so the verifier can reproduce the hash.
    // We must NOT regenerate filed returns because pdf-lib overlay rendering is
    // non-deterministic: each render produces a different SHA-256, so a
    // regenerated PDF would never match the on-chain anchor.
    if (data.ret.status === 'FILED') {
      if (!data.ret.pdfPath) {
        return NextResponse.json(
          { error: 'Filing PDF is not stored for this return' },
          { status: 404 }
        )
      }
      try {
        pdfBuffer = await readFile(data.ret.pdfPath)
      } catch (err) {
        const code = err instanceof Error ? (err as NodeJS.ErrnoException).code : null
        console.error(`Stored filing PDF missing for return ${id} at ${data.ret.pdfPath}`, code)
        return NextResponse.json(
          { error: 'Filing PDF not found in storage' },
          { status: 404 }
        )
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

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${filename}"`,
      },
    })
  } catch (err) {
    console.error('Generate PDF error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
