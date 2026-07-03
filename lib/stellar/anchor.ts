import crypto from 'crypto'
import {
  horizon,
  networkPassphrase,
  getSystemKeypair,
} from './client'
import { TransactionBuilder, Operation, BASE_FEE } from '@stellar/stellar-sdk'
import { writeFile, readFile } from '../storage'
import { renderFilingPdf } from '../pdf/dispatcher'

export interface AnchorResult {
  stellarTxId: string
  payloadHash: string
  explorerUrl: string
  status: 'PENDING' | 'CONFIRMED' | 'FAILED'
}

export interface ParsedAnchorPayload {
  payloadHash: string
  filedDate: string
}

const HASH_KEY_PREFIX = 'kuwenta:ph:'
const TIMESTAMP_KEY_PREFIX = 'kuwenta:ts:'
const MANAGE_DATA_NAME_MAX_BYTES = 64

function getExplorerUrl(txId: string): string {
  const network = process.env.STELLAR_NETWORK === 'mainnet' ? 'public' : 'testnet'
  return `https://stellar.expert/explorer/${network}/tx/${txId}`
}

function computePayloadHash(pdfBuffer: Buffer): string {
  return crypto.createHash('sha256').update(pdfBuffer).digest('hex')
}

function buildDataKey(prefix: string, returnId: string): string {
  const key = `${prefix}${returnId}`
  if (Buffer.byteLength(key, 'utf8') <= MANAGE_DATA_NAME_MAX_BYTES) {
    return key
  }
  // Truncate to the byte limit; simple ASCII slice is safe for our prefixes/CUIDs.
  return key.slice(0, MANAGE_DATA_NAME_MAX_BYTES)
}

function assertHashHex(value: string): void {
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error('payloadHash must be a 64-character lower/upper-case hex string')
  }
}

/**
 * Encode the anchor payload into two Stellar manageData values.
 *
 * Stellar manageData values are limited to 64 bytes each. A SHA-256 hex string
 * alone is exactly 64 bytes, so we store it in a dedicated entry and write the
 * ISO filing timestamp to a second entry. Both keys share the same returnId so
 * verification can pair them.
 */
export function encodeAnchorPayload(
  returnId: string,
  payloadHash: string,
  filedDate: string
): { hashKey: string; hashValue: string; timestampKey: string; timestampValue: string } {
  assertHashHex(payloadHash)
  if (Number.isNaN(Date.parse(filedDate))) {
    throw new Error('filedDate must be a valid ISO timestamp')
  }
  return {
    hashKey: buildDataKey(HASH_KEY_PREFIX, returnId),
    hashValue: payloadHash,
    timestampKey: buildDataKey(TIMESTAMP_KEY_PREFIX, returnId),
    timestampValue: filedDate,
  }
}

/**
 * Recover the payload hash and filing timestamp from manageData operations.
 *
 * Accepts either Stellar SDK operation objects (value as Buffer) or Horizon
 * JSON operations (value as base64 string).
 */
export function parseAnchorOperations(
  operations: ReadonlyArray<{ type?: string; name?: string; value?: Buffer | string }>
): ParsedAnchorPayload | null {
  const decodeValue = (raw: Buffer | string | undefined): string | null => {
    if (raw === undefined || raw === null) return null
    if (Buffer.isBuffer(raw)) return raw.toString('utf8')
    if (typeof raw === 'string') {
      // Horizon returns manageData values as base64 strings.
      try {
        return Buffer.from(raw, 'base64').toString('utf8')
      } catch {
        return raw
      }
    }
    return null
  }

  let payloadHash: string | null = null
  let filedDate: string | null = null

  for (const op of operations) {
    if (op.type !== 'manageData') continue
    const name = op.name ?? ''
    const value = decodeValue(op.value)
    if (value === null) continue

    if (name.startsWith(HASH_KEY_PREFIX)) {
      payloadHash = value
    } else if (name.startsWith(TIMESTAMP_KEY_PREFIX)) {
      filedDate = value
    }
  }

  if (!payloadHash || !filedDate) return null
  return { payloadHash, filedDate }
}

/**
 * Anchor a filing receipt on Stellar using two manageData operations.
 *
 * The hash is stored under `kuwenta:ph:{returnId}` and the ISO filing
 * timestamp under `kuwenta:ts:{returnId}`. Splitting the data avoids the
 * 64-byte value limit that previously truncated the timestamp off the hash.
 *
 * A Stellar failure must NOT prevent the return from being marked as filed.
 * This function catches all Stellar errors and returns a FAILED status so the
 * caller can persist a StellarReceipt record and surface a retry option.
 */
export async function anchorFilingReceipt(
  returnId: string,
  pdfBuffer: Buffer
): Promise<AnchorResult> {
  const payloadHash = computePayloadHash(pdfBuffer)

  try {
    const keypair = getSystemKeypair()
    const account = await horizon.loadAccount(keypair.publicKey())

    const filedDate = new Date().toISOString()
    const hashKey = buildDataKey(HASH_KEY_PREFIX, returnId)
    const timestampKey = buildDataKey(TIMESTAMP_KEY_PREFIX, returnId)

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase,
    })
      .addOperation(
        Operation.manageData({
          name: hashKey,
          value: payloadHash,
        })
      )
      .addOperation(
        Operation.manageData({
          name: timestampKey,
          value: filedDate,
        })
      )
      .setTimeout(60)
      .build()

    tx.sign(keypair)
    const result = await horizon.submitTransaction(tx)

    return {
      stellarTxId: result.hash,
      payloadHash,
      explorerUrl: getExplorerUrl(result.hash),
      status: 'CONFIRMED',
    }
  } catch (err) {
    console.error('Stellar anchor failed for return', returnId, err)
    return {
      stellarTxId: `failed-${returnId}`,
      payloadHash,
      explorerUrl: '',
      status: 'FAILED',
    }
  }
}

export async function storeFilingPackage(
  taxYearId: string,
  returnId: string,
  pdfBuffer: Buffer
): Promise<string> {
  const localPath = `returns/${taxYearId}/${returnId}/generated.pdf`
  return writeFile(localPath, pdfBuffer)
}

/**
 * Retry anchoring for a return whose previous Stellar receipt failed.
 *
 * Reads the previously stored PDF and re-submits the manageData operation.
 * If the PDF is missing (common on ephemeral deployment filesystems such as
 * Railway), it is regenerated from the tax return data before anchoring.
 * Throws a descriptive error if the PDF cannot be read or regenerated so the
 * caller can surface a meaningful message instead of a generic 500.
 */
export async function retryAnchorFilingReceipt(
  returnId: string,
  userId: string,
  pdfPath: string
): Promise<AnchorResult> {
  let pdfBuffer: Buffer
  try {
    pdfBuffer = await readFile(pdfPath)
  } catch (err) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      const regenerated = await renderFilingPdf(returnId, userId)
      if (!regenerated) {
        throw new Error(
          `Filing PDF not found at path: ${pdfPath} and could not be regenerated from the return data`
        )
      }
      pdfBuffer = regenerated
    } else {
      throw new Error(
        `Failed to read filing PDF for retry: ${err instanceof Error ? err.message : 'unknown error'}`
      )
    }
  }
  return anchorFilingReceipt(returnId, pdfBuffer)
}
