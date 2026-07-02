import { NextRequest, NextResponse } from 'next/server'
import Decimal from 'decimal.js'
import { requireAuth } from '@/lib/auth/session'
import { prisma } from '@/lib/prisma'
import { recascadeTaxYear } from '@/lib/computation/recascade'
import { generateIncomeRecognitionJournal } from '@/lib/journal/generator'
import { certificateUpdateSchema } from '@/lib/validation/schemas'

async function getCertificateForUser(id: string, userId: string) {
  const profile = await prisma.taxpayerProfile.findUnique({
    where: { userId },
    include: {
      taxYears: {
        include: {
          certificates: {
            where: { id },
            include: { atc: true },
          },
        },
      },
    },
  })

  return profile?.taxYears.flatMap((ty) => ty.certificates)[0] ?? null
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAuth()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const certificate = await getCertificateForUser(id, session.sub)
    if (!certificate) {
      return NextResponse.json({ error: 'Certificate not found' }, { status: 404 })
    }

    return NextResponse.json({ certificate })
  } catch (err) {
    console.error('Get certificate error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAuth()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const existing = await getCertificateForUser(id, session.sub)
    if (!existing) {
      return NextResponse.json({ error: 'Certificate not found' }, { status: 404 })
    }

    const body = await req.json()
    const result = certificateUpdateSchema.safeParse(body)
    if (!result.success) {
      return NextResponse.json({ error: result.error.format() }, { status: 400 })
    }

    const data = result.data

    let atc = existing.atc
    if (data.atcCode) {
      const found = await prisma.aTCCode.findUnique({
        where: { code: data.atcCode },
      })
      if (!found || !found.isActive) {
        return NextResponse.json({ error: 'Invalid or inactive ATC code' }, { status: 400 })
      }
      atc = found
    }

    const month1 = data.month1Amount !== undefined ? new Decimal(String(data.month1Amount)) : existing.month1Amount
    const month2 = data.month2Amount !== undefined ? new Decimal(String(data.month2Amount)) : existing.month2Amount
    const month3 = data.month3Amount !== undefined ? new Decimal(String(data.month3Amount)) : existing.month3Amount
    const quarterlyTotal = month1.plus(month2).plus(month3)
    const cwtWithheld = data.cwtWithheld !== undefined ? new Decimal(String(data.cwtWithheld)) : existing.cwtWithheld

    const expectedCwt = quarterlyTotal.times(atc.ewtRate)
    const discrepancy = cwtWithheld.minus(expectedCwt).abs()
    const cwtValidated = discrepancy.lessThanOrEqualTo(1)

    const previousCertificateContext = {
      id: existing.id,
      quarter: existing.quarter,
      payorName: existing.payorName,
      payorTin: existing.payorTin,
      atcCode: existing.atcCode,
      quarterlyTotal: existing.quarterlyTotal,
      cwtWithheld: existing.cwtWithheld,
      createdAt: existing.createdAt,
      updatedAt: existing.updatedAt,
    }

    const certificate = await prisma.$transaction(async (tx) => {
      const updated = await tx.form2307.update({
        where: { id },
        data: {
          ...(data.quarter !== undefined && { quarter: data.quarter }),
          ...(data.payorTin !== undefined && { payorTin: data.payorTin }),
          ...(data.payorName !== undefined && { payorName: data.payorName }),
          ...(data.atcCode !== undefined && { atcCode: data.atcCode }),
          ...(data.month1Amount !== undefined && { month1Amount: month1 }),
          ...(data.month2Amount !== undefined && { month2Amount: month2 }),
          ...(data.month3Amount !== undefined && { month3Amount: month3 }),
          quarterlyTotal,
          cwtWithheld,
          cwtValidated,
          cwtDiscrepancy: cwtValidated ? null : discrepancy,
        },
        include: { atc: true },
      })

      await recascadeTaxYear({ taxYearId: existing.taxYearId, tx })
      await generateIncomeRecognitionJournal(
        existing.taxYearId,
        id,
        '2307_AMENDED',
        previousCertificateContext,
        tx
      )

      return updated
    })

    return NextResponse.json({ certificate })
  } catch (err) {
    console.error('Update certificate error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAuth()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const existing = await getCertificateForUser(id, session.sub)
    if (!existing) {
      return NextResponse.json({ error: 'Certificate not found' }, { status: 404 })
    }

    await prisma.$transaction(async (tx) => {
      await generateIncomeRecognitionJournal(
        existing.taxYearId,
        id,
        '2307_DELETED',
        undefined,
        tx
      )
      await tx.form2307.delete({ where: { id } })
      await recascadeTaxYear({ taxYearId: existing.taxYearId, tx })
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Delete certificate error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
