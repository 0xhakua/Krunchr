import { NextRequest, NextResponse } from 'next/server'
import Decimal from 'decimal.js'
import { requireAuth } from '@/lib/auth/session'
import { prisma } from '@/lib/prisma'
import { recascadeTaxYear } from '@/lib/computation/recascade'
import { checkAndRecordVatBreach } from '@/lib/computation/vat-threshold'
import { generateIncomeRecognitionJournal } from '@/lib/journal/generator'
import { certificateSchema } from '@/lib/validation/schemas'

export async function GET(req: NextRequest) {
  const session = await requireAuth(req)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const profile = await prisma.taxpayerProfile.findUnique({
      where: { userId: session.sub },
      include: {
        taxYears: {
          orderBy: { year: 'desc' },
          take: 1,
          include: {
            certificates: {
              include: { atc: true },
              orderBy: [{ quarter: 'asc' }, { payorName: 'asc' }],
            },
          },
        },
      },
    })

    if (!profile?.taxYears[0]) {
      return NextResponse.json({ certificates: [] })
    }

    return NextResponse.json({
      certificates: profile.taxYears[0].certificates.map((cert) => ({
        ...cert,
        cwtValidated: validateCwt(cert),
      })),
    })
  } catch (err) {
    console.error('List income error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const session = await requireAuth(req)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const result = certificateSchema.safeParse(body)
    if (!result.success) {
      return NextResponse.json({ error: result.error.format() }, { status: 400 })
    }

    const data = result.data
    const profile = await prisma.taxpayerProfile.findUnique({
      where: { userId: session.sub },
      include: {
        taxYears: {
          orderBy: { year: 'desc' },
          take: 1,
        },
      },
    })

    if (!profile?.taxYears[0]) {
      return NextResponse.json({ error: 'No active tax year' }, { status: 400 })
    }

    const taxYear = profile.taxYears[0]

    const atc = await prisma.aTCCode.findUnique({
      where: { code: data.atcCode },
    })
    if (!atc || !atc.isActive) {
      return NextResponse.json({ error: 'Invalid or inactive ATC code' }, { status: 400 })
    }

    const month1 = new Decimal(String(data.month1Amount))
    const month2 = new Decimal(String(data.month2Amount))
    const month3 = new Decimal(String(data.month3Amount))
    const quarterlyTotal = month1.plus(month2).plus(month3)
    const cwtWithheld = new Decimal(String(data.cwtWithheld))

    const expectedCwt = quarterlyTotal.times(atc.ewtRate)
    const discrepancy = cwtWithheld.minus(expectedCwt).abs()
    const cwtValidated = discrepancy.lessThanOrEqualTo(1)

    const certificate = await prisma.$transaction(async (tx) => {
      const created = await tx.form2307.create({
        data: {
          taxYearId: taxYear.id,
          quarter: data.quarter,
          payorTin: data.payorTin,
          payorName: data.payorName,
          atcCode: data.atcCode,
          month1Amount: month1,
          month2Amount: month2,
          month3Amount: month3,
          quarterlyTotal,
          cwtWithheld,
          cwtValidated,
          cwtDiscrepancy: cwtValidated ? null : discrepancy,
        },
        include: { atc: true },
      })

      await recascadeTaxYear({ taxYearId: taxYear.id, tx })
      await generateIncomeRecognitionJournal(taxYear.id, created.id, '2307_ADDED', undefined, tx)

      const vatCheck = await checkAndRecordVatBreach(taxYear.id, tx)

      return { created, vatCheck }
    })

    return NextResponse.json(
      {
        certificate: { ...certificate.created, cwtValidated },
        vatStatus: {
          ytdGross: certificate.vatCheck.ytdGross.toFixed(2),
          thresholdReached: certificate.vatCheck.thresholdReached,
          warningActive: certificate.vatCheck.warningActive,
          vatBreached: certificate.vatCheck.thresholdReached || certificate.vatCheck.alreadyBreached,
        },
      },
      { status: 201 }
    )
  } catch (err) {
    console.error('Create income error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

function validateCwt(cert: {
  quarterlyTotal: Decimal.Value
  cwtWithheld: Decimal.Value
  atc: { ewtRate: Decimal.Value }
}): boolean {
  const expected = new Decimal(String(cert.quarterlyTotal)).times(cert.atc.ewtRate)
  const actual = new Decimal(String(cert.cwtWithheld))
  return actual.minus(expected).abs().lessThanOrEqualTo(1)
}
