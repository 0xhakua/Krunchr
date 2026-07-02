import { NextResponse } from 'next/server'
import Decimal from 'decimal.js'
import { requireAuth } from '@/lib/auth/session'
import { prisma } from '@/lib/prisma'
import { generateOverpaymentJournal } from '@/lib/journal/generator'
import {
  overpaymentDispositionSchema,
  overpaymentSettlementSchema,
} from '@/lib/validation/schemas'

const dispositionSchema = overpaymentDispositionSchema
const settlementSchema = overpaymentSettlementSchema

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ taxYear: string }> }
) {
  const session = await requireAuth()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { taxYear: yearParam } = await params
    const year = Number(yearParam)
    if (!Number.isFinite(year)) {
      return NextResponse.json({ error: 'Invalid tax year' }, { status: 400 })
    }

    const profile = await prisma.taxpayerProfile.findUnique({
      where: { userId: session.sub },
      include: {
        taxYears: {
          where: { year },
          take: 1,
          include: {
            overpayment: true,
            returns: {
              where: { formType: 'FORM_1701A' },
            },
          },
        },
      },
    })

    const taxYear = profile?.taxYears[0]
    if (!taxYear) {
      return NextResponse.json({ error: 'Tax year not found' }, { status: 404 })
    }

    const annualReturn = taxYear.returns[0]
    const computedOverpayment = annualReturn?.overpaymentAmt
      ? new Decimal(annualReturn.overpaymentAmt.toString())
      : new Decimal('0')

    return NextResponse.json({
      overpayment: taxYear.overpayment,
      computedOverpayment: computedOverpayment.toFixed(2),
      annualReturnId: annualReturn?.id ?? null,
    })
  } catch (err) {
    console.error('Get overpayment error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ taxYear: string }> }
) {
  const session = await requireAuth()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { taxYear: yearParam } = await params
    const year = Number(yearParam)
    if (!Number.isFinite(year)) {
      return NextResponse.json({ error: 'Invalid tax year' }, { status: 400 })
    }

    const body = await req.json()
    const result = dispositionSchema.safeParse(body)
    if (!result.success) {
      return NextResponse.json({ error: result.error.format() }, { status: 400 })
    }

    const { disposition } = result.data

    const profile = await prisma.taxpayerProfile.findUnique({
      where: { userId: session.sub },
      include: {
        taxYears: {
          where: { year },
          take: 1,
          include: {
            returns: {
              where: { formType: 'FORM_1701A' },
            },
          },
        },
      },
    })

    const taxYear = profile?.taxYears[0]
    if (!taxYear) {
      return NextResponse.json({ error: 'Tax year not found' }, { status: 404 })
    }

    const annualReturn = taxYear.returns[0]
    if (!annualReturn) {
      return NextResponse.json(
        { error: 'Annual return 1701A not found' },
        { status: 404 }
      )
    }

    const overpaymentAmt = annualReturn.overpaymentAmt
      ? new Decimal(annualReturn.overpaymentAmt.toString())
      : new Decimal('0')

    if (overpaymentAmt.lessThanOrEqualTo(0)) {
      return NextResponse.json(
        { error: 'No overpayment available for disposition' },
        { status: 400 }
      )
    }

    const overpayment = await prisma.overpayment.upsert({
      where: { taxYearId: taxYear.id },
      update: {
        disposition,
        electedAt: new Date(),
      },
      create: {
        taxYearId: taxYear.id,
        amount: overpaymentAmt,
        disposition,
        electedAt: new Date(),
      },
    })

    await generateOverpaymentJournal(taxYear.id, overpayment.id)

    await prisma.auditLog.create({
      data: {
        userId: session.sub,
        action: 'OVERPAYMENT_DISPOSITION_SET',
        entityType: 'TaxYear',
        entityId: taxYear.id,
        metadata: {
          year,
          disposition,
          amount: overpaymentAmt.toFixed(2),
        },
      },
    })

    return NextResponse.json({ overpayment })
  } catch (err) {
    console.error('Set overpayment disposition error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ taxYear: string }> }
) {
  const session = await requireAuth()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { taxYear: yearParam } = await params
    const year = Number(yearParam)
    if (!Number.isFinite(year)) {
      return NextResponse.json({ error: 'Invalid tax year' }, { status: 400 })
    }

    const body = await req.json()
    const result = settlementSchema.safeParse(body)
    if (!result.success) {
      return NextResponse.json({ error: result.error.format() }, { status: 400 })
    }

    const { event, reference, tccNumber, appliedAt } = result.data
    const occurredAt = appliedAt ? new Date(appliedAt) : new Date()

    const profile = await prisma.taxpayerProfile.findUnique({
      where: { userId: session.sub },
      include: {
        taxYears: {
          where: { year },
          take: 1,
          include: { overpayment: true },
        },
      },
    })

    const taxYear = profile?.taxYears[0]
    if (!taxYear?.overpayment) {
      return NextResponse.json(
        { error: 'No overpayment disposition on file' },
        { status: 404 }
      )
    }

    const overpayment = taxYear.overpayment
    let updateData: Record<string, unknown> = {}
    let action: string | null = null

    if (event === 'REFUND_RECEIVED') {
      if (overpayment.disposition !== 'REFUND') {
        return NextResponse.json(
          { error: 'Refund-received event requires REFUND disposition' },
          { status: 400 }
        )
      }
      updateData = { refundReceivedAt: occurredAt, refundReference: reference ?? null }
      action = 'OVERPAYMENT_REFUND_RECEIVED'
    } else if (event === 'TCC_APPLIED') {
      if (overpayment.disposition !== 'TAX_CREDIT_CERTIFICATE') {
        return NextResponse.json(
          { error: 'TCC-applied event requires TAX_CREDIT_CERTIFICATE disposition' },
          { status: 400 }
        )
      }
      updateData = {
        tccAppliedAt: occurredAt,
        ...(tccNumber ? { tccNumber } : {}),
      }
      action = 'OVERPAYMENT_TCC_APPLIED'
    } else {
      // CARRY_OVER_APPLIED is normally recorded automatically when a next-year
      // PriorYearCredit is created; this branch exists for manual reconciliation.
      if (overpayment.disposition !== 'CARRY_OVER') {
        return NextResponse.json(
          { error: 'Carry-over-applied event requires CARRY_OVER disposition' },
          { status: 400 }
        )
      }
      updateData = { carryOverAppliedAt: occurredAt }
      action = 'OVERPAYMENT_CARRY_OVER_APPLIED'
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.overpayment.update({
        where: { id: overpayment.id },
        data: updateData,
      })
      await tx.journalEntry.deleteMany({
        where: { taxYearId: taxYear.id, subsection: '9F' },
      })
      await generateOverpaymentJournal(taxYear.id, overpayment.id, tx)
      return result
    })

    await prisma.auditLog.create({
      data: {
        userId: session.sub,
        action,
        entityType: 'Overpayment',
        entityId: overpayment.id,
        metadata: {
          year,
          amount: overpayment.amount.toString(),
          ...(reference ? { reference } : {}),
          ...(tccNumber ? { tccNumber } : {}),
        },
      },
    })

    return NextResponse.json({ overpayment: updated })
  } catch (err) {
    console.error('Patch overpayment settlement error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
