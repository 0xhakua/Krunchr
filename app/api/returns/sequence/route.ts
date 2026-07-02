import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/session'
import { prisma } from '@/lib/prisma'
import { determineReturnStatus, getDependencies, getReturnBlockReason } from '@/lib/computation/sequence'

export async function GET() {
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
      return NextResponse.json({ sequence: [], vatBreached: false })
    }

    const taxYear = profile.taxYears[0]
    const dependencies = getDependencies(profile.corIncludes2551Q)

    const sequence = taxYear.returns.map((ret) => ({
      ...ret,
      status: determineReturnStatus(
        ret.sequenceOrder,
        taxYear.returns,
        profile.corIncludes2551Q,
        taxYear.vatBreached
      ),
      dependencies: dependencies[ret.sequenceOrder] ?? [],
      blockReason: getReturnBlockReason(ret, taxYear.vatBreached),
    }))

    return NextResponse.json({
      sequence,
      corIncludes2551Q: profile.corIncludes2551Q,
      vatBreached: taxYear.vatBreached,
    })
  } catch (err) {
    console.error('Get sequence error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
