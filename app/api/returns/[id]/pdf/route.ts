import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/session'
import { loadFilingData, renderFilingPdf } from '@/lib/pdf/dispatcher'

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

    const pdfBuffer = await renderFilingPdf(id, session.sub)
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
