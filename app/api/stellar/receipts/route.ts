import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/session'
import { prisma } from '@/lib/prisma'

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
          include: {
            returns: {
              orderBy: { sequenceOrder: 'asc' },
              include: {
                stellarReceipt: true,
              },
            },
          },
        },
      },
    })

    const receipts = (profile?.taxYears ?? []).flatMap((taxYear) =>
      taxYear.returns
        .filter((ret) => ret.stellarReceipt)
        .map((ret) => ({
          id: ret.stellarReceipt!.id,
          returnId: ret.id,
          taxYear: taxYear.year,
          formType: ret.formType,
          quarter: ret.quarter,
          sequenceOrder: ret.sequenceOrder,
          stellarTxId: ret.stellarReceipt!.stellarTxId,
          payloadHash: ret.stellarReceipt!.payloadHash,
          network: ret.stellarReceipt!.network,
          explorerUrl: ret.stellarReceipt!.explorerUrl,
          status: ret.stellarReceipt!.status,
          anchoredAt: ret.stellarReceipt!.anchoredAt.toISOString(),
        }))
    )

    return NextResponse.json({ receipts })
  } catch (err) {
    console.error('List stellar receipts error:', err)
    const message = err instanceof Error ? err.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
