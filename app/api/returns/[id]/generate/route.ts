import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/session'
import { prisma } from '@/lib/prisma'
import { determineReturnStatus } from '@/lib/computation/sequence'
import { recascadeTaxYear } from '@/lib/computation/recascade'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAuth()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params

    const profile = await prisma.taxpayerProfile.findUnique({
      where: { userId: session.sub },
      include: {
        taxYears: {
          orderBy: { year: 'desc' },
          take: 1,
          include: {
            returns: {
              orderBy: { sequenceOrder: 'asc' },
            },
          },
        },
      },
    })

    if (!profile?.taxYears[0]) {
      return NextResponse.json({ error: 'No active tax year' }, { status: 400 })
    }

    const taxYear = profile.taxYears[0]
    const ret = taxYear.returns.find((r) => r.id === id)
    if (!ret) {
      return NextResponse.json({ error: 'Return not found' }, { status: 404 })
    }

    // BR-12: a VAT-threshold breach takes the taxpayer out of the 8% flat-rate
    // scope, so Form 1701A can no longer be generated in Kuwenta.
    if (taxYear.vatBreached && ret.formType === 'FORM_1701A') {
      return NextResponse.json(
        {
          error:
            'VAT threshold breached. Krunchr only supports non-VAT taxpayers. Register for VAT with the BIR and file Form 1701A outside the system.',
          code: 'VAT_BREACH_1701A_BLOCKED',
        },
        { status: 422 }
      )
    }

    const status = determineReturnStatus(
      ret.sequenceOrder,
      taxYear.returns,
      profile.corIncludes2551Q,
      taxYear.vatBreached
    )

    if (status === 'BLOCKED') {
      return NextResponse.json(
        { error: 'Predecessor returns must be filed first' },
        { status: 409 }
      )
    }

    if (ret.status === 'FILED') {
      return NextResponse.json({ error: 'Return already filed' }, { status: 409 })
    }

    // Mixed-income earners must file Form 1701, not 1701A
    if (ret.formType === 'FORM_1701A' && profile.incomeType === 'MIXED_INCOME') {
      return NextResponse.json(
        { error: 'Mixed-income earners must use Form 1701 as the annual return' },
        { status: 409 }
      )
    }

    // Ensure computations are up to date before generating
    await recascadeTaxYear({ taxYearId: taxYear.id })

    await prisma.taxReturn.update({
      where: { id: ret.id },
      data: {
        status: 'GENERATED',
        generatedAt: new Date(),
      },
    })

    return NextResponse.json({ success: true, status: 'GENERATED' })
  } catch (err) {
    console.error('Generate return error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
