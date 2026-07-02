import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/session'
import { prisma } from '@/lib/prisma'
import { recascadeTaxYear } from '@/lib/computation/recascade'
import { canElect } from '@/lib/election-rules'
import { electionSchema } from '@/lib/validation/schemas'

type ElectionPath = 'ITEM_13_2551Q_Q1' | 'ITEM_16_1701Q_Q1' | 'FORM_1905'
type ElectionMethod = ElectionPath

function getDefaultElectionPath(corIncludes2551Q: boolean): ElectionPath {
  return corIncludes2551Q ? 'ITEM_13_2551Q_Q1' : 'ITEM_16_1701Q_Q1'
}

/**
 * Resolve the user's chosen election method to the actual BIR line item path.
 *
 * Form 1905 is an RDO-driven COR update; when recorded it pre-populates
 * Item 13 (COR includes 2551Q) or Item 16 (COR does not include 2551Q).
 */
function resolveElectionPath(
  electionMethod: ElectionMethod | undefined,
  corIncludes2551Q: boolean
): { path: ElectionPath; method: ElectionMethod } {
  const defaultPath = getDefaultElectionPath(corIncludes2551Q)
  const method = electionMethod ?? defaultPath

  if (method === 'FORM_1905') {
    return { path: defaultPath, method }
  }

  return { path: method, method }
}

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
      return NextResponse.json({ error: 'No active tax year' }, { status: 400 })
    }

    const taxYear = profile.taxYears[0]
    const firstReturn = taxYear.returns[0]
    const canElect = !firstReturn || firstReturn.status !== 'FILED'

    const defaultPath = getDefaultElectionPath(profile.corIncludes2551Q)

    return NextResponse.json({
      electionStatus: taxYear.electionStatus,
      electedRate: taxYear.electedRate,
      electionPath: (taxYear.electionPath as ElectionPath | null) ?? defaultPath,
      electionMethod: (taxYear.electionMethod as ElectionMethod | null) ?? defaultPath,
      electionDate: taxYear.electionDate,
      electionLockedAt: taxYear.electionLockedAt,
      osdElection: taxYear.osdElection,
      canElect,
      defaultElectionPath: defaultPath,
      firstReturnFiled: !canElect,
    })
  } catch (err) {
    console.error('Get election error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const session = await requireAuth()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const result = electionSchema.safeParse(body)
    if (!result.success) {
      return NextResponse.json({ error: result.error.format() }, { status: 400 })
    }

    const { electedRate, electionPath, disclosuresAcknowledged, osdElection } = result.data

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
    const { path: resolvedElectionPath, method: resolvedElectionMethod } = resolveElectionPath(
      electionPath,
      profile.corIncludes2551Q
    )

    const firstReturn = taxYear.returns[0]
    const decision = canElect({
      electionLockedAt: taxYear.electionLockedAt,
      firstReturnStatus: firstReturn?.status ?? null,
    })
    if (!decision.allowed) {
      return NextResponse.json({ error: decision.reason }, { status: 409 })
    }

    if (electedRate === 'RATE_8PCT' && !disclosuresAcknowledged) {
      return NextResponse.json(
        { error: 'All disclosures must be acknowledged to elect the 8% rate' },
        { status: 400 }
      )
    }

    const electionStatus = electedRate === 'RATE_8PCT' ? 'ELECTED_8PCT' : 'ELECTED_GRADUATED'
    const now = new Date()

    await prisma.$transaction(async (tx) => {
      await tx.taxYear.update({
        where: { id: taxYear.id },
        data: {
          electionStatus,
          electedRate,
          electionPath: resolvedElectionPath,
          electionMethod: resolvedElectionMethod,
          electionDate: now,
          electionLockedAt: now,
          osdElection,
        },
      })

      await tx.auditLog.create({
        data: {
          userId: session.sub,
          // Rate-agnostic action string: the elected rate is recorded in
          // metadata.electedRate so the audit log viewer can still filter
          // and group by rate. See #116.
          action: 'ELECTION_CONFIRMED',
          entityType: 'TaxYear',
          entityId: taxYear.id,
          metadata: {
            electedRate,
            electionPath: resolvedElectionPath,
            electionMethod: resolvedElectionMethod,
            disclosuresAcknowledged,
            osdElection,
          },
        },
      })

      await recascadeTaxYear({ taxYearId: taxYear.id, tx })
    })

    return NextResponse.json({
      electionStatus,
      electedRate,
      electionPath: resolvedElectionPath,
      electionMethod: resolvedElectionMethod,
      electionDate: now,
      electionLockedAt: now,
      osdElection,
    })
  } catch (err) {
    console.error('Record election error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
