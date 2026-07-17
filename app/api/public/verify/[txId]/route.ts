import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { fetchPublicAnchor, getNetwork, getExplorerUrl } from '@/lib/stellar/verify'
import { badRequest } from '@/lib/api-error'

export const dynamic = 'force-dynamic'

const TX_ID_REGEX = /^[a-f0-9]{64}$/i

export interface PublicVerifyResponse {
  txId: string
  returnId: string
  network: 'testnet' | 'mainnet'
  sourceAccount: string | null
  ledgerCreatedAt: string | null
  onChainHash: string | null
  onChainTimestamp: string | null
  explorerUrl: string
  status: 'CONFIRMED' | 'NOT_FOUND'
  return: {
    formType: string | null
    quarter: number | null
    taxYear: number | null
  } | null
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ txId: string }> }
) {
  try {
    const { txId } = await params

    if (!txId || !TX_ID_REGEX.test(txId)) {
      return badRequest('Invalid Stellar transaction ID')
    }

    const anchor = await fetchPublicAnchor(txId)
    if (!anchor) {
      return NextResponse.json(
        {
          error: 'Transaction not found or does not contain a Kuwenta filing receipt',
          code: 'RECEIPT_NOT_FOUND',
        },
        { status: 404 }
      )
    }

    const taxReturn = await prisma.taxReturn.findUnique({
      where: { id: anchor.returnId },
      include: { taxYear: true },
    })

    const network = getNetwork()
    const response: PublicVerifyResponse = {
      txId,
      returnId: anchor.returnId,
      network,
      sourceAccount: anchor.sourceAccount,
      ledgerCreatedAt: anchor.ledgerCreatedAt,
      onChainHash: anchor.payloadHash,
      onChainTimestamp: anchor.anchoredAt,
      explorerUrl: getExplorerUrl(txId),
      status: 'CONFIRMED',
      return: taxReturn
        ? {
            formType: taxReturn.formType,
            quarter: taxReturn.quarter,
            taxYear: taxReturn.taxYear.year,
          }
        : null,
    }

    return NextResponse.json(response)
  } catch (err) {
    console.error('Public verify error:', err)
    const message = err instanceof Error ? err.message : 'Verification failed'
    return NextResponse.json({ error: message, code: 'VERIFICATION_FAILED' }, { status: 500 })
  }
}
