import { NextResponse } from 'next/server'
import JSZip from 'jszip'
import Decimal from 'decimal.js'
import { renderToBuffer } from '@react-pdf/renderer'
import { requireAuth } from '@/lib/auth/session'
import { prisma } from '@/lib/prisma'
import { determineReturnStatus } from '@/lib/computation/sequence'
import { readFile } from '@/lib/storage'
import { CoverSheet } from '@/lib/pdf/cover-sheet'
import { resolveTaxYearFromRequest, setActiveYearCookie } from '@/lib/active-year'

function escapeCsv(value: string | number): string {
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function formatReturnLabel(formType: string, quarter: number | null): string {
  const form = formType.replace('FORM_', '')
  return quarter ? `${form} Q${quarter}` : form
}

export async function GET(request: Request) {
  const session = await requireAuth()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const profile = await prisma.taxpayerProfile.findUnique({
      where: { userId: session.sub },
      include: {
        taxYears: {
          orderBy: { year: 'desc' },
          include: {
            certificates: true,
            returns: {
              orderBy: { sequenceOrder: 'asc' },
            },
          },
        },
      },
    })

    if (!profile || profile.taxYears.length === 0) {
      return NextResponse.json({ error: 'No active tax year' }, { status: 400 })
    }

    const taxYear = await resolveTaxYearFromRequest(request, profile.taxYears)
    if (!taxYear) {
      return NextResponse.json({ error: 'No active tax year' }, { status: 400 })
    }
    await setActiveYearCookie(taxYear.year)
    const returns = taxYear.returns.map((ret) => ({
      ...ret,
      status: determineReturnStatus(ret.sequenceOrder, taxYear.returns, profile.corIncludes2551Q),
    }))

    const filedReturns = returns.filter((r) => r.status === 'FILED')
    if (filedReturns.length === 0) {
      return NextResponse.json(
        { error: 'No filed returns to include in the package' },
        { status: 400 }
      )
    }

    const totalGross = taxYear.certificates.reduce(
      (sum, c) => sum.plus(c.quarterlyTotal),
      new Decimal('0')
    )
    const totalCwt = taxYear.certificates.reduce(
      (sum, c) => sum.plus(c.cwtWithheld),
      new Decimal('0')
    )

    const zip = new JSZip()

    // Cover sheet
    const coverBuffer = await renderToBuffer(
      CoverSheet({
        taxpayerName: profile.fullName,
        tin: profile.tin,
        rdoCode: profile.rdoCode,
        address: profile.registeredAddress,
        zipCode: profile.zipCode,
        taxYear: taxYear.year,
        electedRate: taxYear.electedRate,
        totalGross: totalGross.toFixed(2),
        totalCwt: totalCwt.toFixed(2),
        filedCount: filedReturns.length,
        totalCount: returns.length,
      })
    )
    zip.file('cover-sheet.pdf', coverBuffer)

    // SAWT CSV
    const aggregated = new Map<
      string,
      { quarter: number; payorTin: string; payorName: string; atcCode: string; gross: Decimal; cwt: Decimal }
    >()
    for (const cert of taxYear.certificates) {
      const key = `${cert.quarter}|${cert.payorTin}|${cert.payorName}|${cert.atcCode}`
      const existing = aggregated.get(key)
      if (existing) {
        existing.gross = existing.gross.plus(cert.quarterlyTotal)
        existing.cwt = existing.cwt.plus(cert.cwtWithheld)
      } else {
        aggregated.set(key, {
          quarter: cert.quarter,
          payorTin: cert.payorTin,
          payorName: cert.payorName,
          atcCode: cert.atcCode,
          gross: new Decimal(String(cert.quarterlyTotal)),
          cwt: new Decimal(String(cert.cwtWithheld)),
        })
      }
    }
    const rows = Array.from(aggregated.values())
    const header = ['Quarter', 'PayorTIN', 'PayorName', 'ATC', 'GrossIncome', 'CWTWithheld']
    const csv = [header.join(',')]
      .concat(
        rows.map((row) =>
          [
            row.quarter,
            escapeCsv(row.payorTin),
            escapeCsv(row.payorName),
            row.atcCode,
            row.gross.toFixed(2),
            row.cwt.toFixed(2),
          ].join(',')
        )
      )
      .join('\n')
    zip.file(`SAWT-${taxYear.year}.csv`, csv)

    // Filed return PDFs — serve the stored filing PDFs so their hashes match
    // the Stellar anchors. We must NOT regenerate filed returns because
    // pdf-lib overlay rendering is non-deterministic: each render produces a
    // different SHA-256, so a regenerated PDF would never match its anchor.
    const missingReturns: string[] = []
    for (const ret of filedReturns) {
      let pdfBuffer: Buffer | null = null
      if (!ret.pdfPath) {
        missingReturns.push(formatReturnLabel(ret.formType, ret.quarter))
        continue
      }
      try {
        pdfBuffer = await readFile(ret.pdfPath)
      } catch (err) {
        const code = err instanceof Error ? (err as NodeJS.ErrnoException).code : null
        console.error(`Stored filing PDF missing for return ${ret.id} at ${ret.pdfPath}`, code)
        missingReturns.push(formatReturnLabel(ret.formType, ret.quarter))
        continue
      }
      const form = ret.formType.replace('FORM_', '')
      const quarter = ret.quarter ? `Q${ret.quarter}` : 'Annual'
      zip.file(`${form}-${quarter}-${taxYear.year}.pdf`, pdfBuffer)
    }

    if (missingReturns.length > 0) {
      return NextResponse.json(
        {
          error: `Filing PDFs missing from storage: ${missingReturns.join(', ')}`,
          code: 'FILING_PDFS_MISSING',
          missing: missingReturns,
        },
        { status: 404 }
      )
    }

    const blob = await zip.generateAsync({ type: 'nodebuffer' })

    return new NextResponse(new Uint8Array(blob), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="filing-package-${taxYear.year}.zip"`,
      },
    })
  } catch (err) {
    console.error('Filing package download error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
