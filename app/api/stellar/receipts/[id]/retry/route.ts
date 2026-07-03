import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/session'
import { prisma } from '@/lib/prisma'
import { retryAnchorFilingReceipt } from '@/lib/stellar/anchor'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAuth(req)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params

    const receipt = await prisma.stellarReceipt.findUnique({
      where: { id },
      include: {
        taxReturn: {
          include: {
            taxYear: {
              include: {
                taxpayer: true,
              },
            },
          },
        },
      },
    })

    if (!receipt) {
      return NextResponse.json({ error: 'Receipt not found' }, { status: 404 })
    }

    if (receipt.taxReturn.taxYear.taxpayer.userId !== session.sub) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (receipt.status === 'CONFIRMED') {
      return NextResponse.json(
        { error: 'Receipt is already confirmed' },
        { status: 409 }
      )
    }

    if (!receipt.taxReturn.pdfPath) {
      return NextResponse.json(
        { error: 'Filing PDF not available for retry' },
        { status: 400 }
      )
    }

    const result = await retryAnchorFilingReceipt(
      receipt.taxReturn.id,
      session.sub,
      receipt.taxReturn.pdfPath
    )

    const updated = await prisma.$transaction(async (tx) => {
      const rec = await tx.stellarReceipt.update({
        where: { id: receipt.id },
        data: {
          stellarTxId: result.stellarTxId,
          payloadHash: result.payloadHash,
          explorerUrl: result.explorerUrl,
          network: process.env.STELLAR_NETWORK === 'mainnet' ? 'mainnet' : 'testnet',
          status: result.status,
          anchoredAt: new Date(),
        },
      })

      await tx.auditLog.create({
        data: {
          userId: session.sub,
          action: 'STELLAR_ANCHOR_RETRY',
          entityType: 'StellarReceipt',
          entityId: receipt.id,
          metadata: {
            returnId: receipt.taxReturn.id,
            stellarTxId: result.stellarTxId,
            status: result.status,
          },
        },
      })

      return rec
    })

    return NextResponse.json({ receipt: updated })
  } catch (err) {
    console.error('Retry stellar receipt error:', err)
    const message = err instanceof Error ? err.message : 'Retry failed'
    // A missing or unrecoverable PDF is a client-addressable state issue,
    // not an unexpected server error. Surface it as 404 so callers can
    // re-file the return to regenerate the PDF if needed.
    const status = message.includes('Filing PDF not found') ? 404 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
