import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/session'
import { prisma } from '@/lib/prisma'
import { computePenaltyBase, computePenaltyDetail } from '@/lib/computation/penalty-base'
import type { IncomeTypeValue } from '@/lib/computation/constants'
import { penaltiesSimulateSchema } from '@/lib/validation/schemas'

const simulateSchema = penaltiesSimulateSchema

export async function POST(req: Request) {
  const session = await requireAuth()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const result = simulateSchema.safeParse(body)
    if (!result.success) {
      return NextResponse.json({ error: result.error.format() }, { status: 400 })
    }

    const { returnId, filedDate } = result.data

    const profile = await prisma.taxpayerProfile.findUnique({
      where: { userId: session.sub },
      include: {
        taxYears: {
          orderBy: { year: 'desc' },
          take: 1,
          include: {
            taxpayer: true,
            certificates: true,
            priorYearCredit: true,
            returns: {
              orderBy: { sequenceOrder: 'asc' },
            },
          },
        },
      },
    })

    if (!profile?.taxYears[0]) {
      return NextResponse.json({ error: 'No active tax year' }, { status: 404 })
    }

    const taxYear = profile.taxYears[0]
    const ret = taxYear.returns.find((r) => r.id === returnId)
    if (!ret) {
      return NextResponse.json({ error: 'Return not found' }, { status: 404 })
    }

    const incomeType = taxYear.taxpayer.incomeType as IncomeTypeValue
    const rdoCode = taxYear.taxpayer.rdoCode

    const penaltyBase = computePenaltyBase(ret, taxYear, incomeType)
    const penalties = await computePenaltyDetail(
      penaltyBase,
      ret.statutoryDueDate,
      rdoCode,
      new Date(filedDate)
    )

    return NextResponse.json({
      returnId: ret.id,
      filedDate,
      penalties,
    })
  } catch (err) {
    console.error('Simulate penalty error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
