import { horizon, getSystemKeypair } from './client'
import { HASH_KEY_PREFIX, TIMESTAMP_KEY_PREFIX } from './anchor'

export interface StellarStatus {
  healthy: boolean
  network: 'testnet' | 'mainnet'
  horizonUrl: string
  latencyMs: number | null
  accountExists: boolean | null
  accountSequence: string | null
  publicKey: string | null
  error: string | null
  checkedAt: string
}

export interface OnChainAnchor {
  returnId: string
  dataKey: string
  dataValue: string | null
  payloadHash: string | null
  anchoredAt: string | null
  sourceAccount: string
  transactionHash: string
  ledgerCreatedAt: string | null
}

export interface VerifyResult {
  valid: boolean
  reason: string | null
  txId: string
  returnId: string
  storedHash: string | null
  onChainHash: string | null
  onChainTimestamp: string | null
  onChainKey: string | null
  network: 'testnet' | 'mainnet'
  sourceAccount: string | null
  ledgerCreatedAt: string | null
  explorerUrl: string
  checkedAt: string
}

export function getNetwork(): 'testnet' | 'mainnet' {
  return process.env.STELLAR_NETWORK === 'mainnet' ? 'mainnet' : 'testnet'
}

export function getExplorerUrl(txId: string): string {
  const network = getNetwork()
  // Stellar Expert uses 'public' for mainnet and 'testnet' for testnet.
  const explorerNetwork = network === 'mainnet' ? 'public' : network
  return `https://stellar.expert/explorer/${explorerNetwork}/tx/${txId}`
}

function dataKeyFor(returnId: string): string {
  return `kuwenta:ph:${returnId}`.substring(0, 64)
}

function parseManageDataValue(raw: string | null | undefined): {
  payloadHash: string | null
  anchoredAt: string | null
} {
  if (!raw) return { payloadHash: null, anchoredAt: null }
  const idx = raw.indexOf(':')
  if (idx === -1) {
    return { payloadHash: raw, anchoredAt: null }
  }
  const payloadHash = raw.substring(0, idx)
  const anchoredAt = raw.substring(idx + 1)
  return { payloadHash, anchoredAt }
}

function decodeHorizonValue(raw: string): string {
  // Horizon returns manageData values as base64-encoded strings. Try decoding
  // when the raw value is not already a plain hex hash, ISO timestamp, or the
  // legacy single-entry `hash:timestamp` format.
  const looksDecoded = (value: string) =>
    /^[a-f0-9]{64}$/i.test(value) ||
    /^[a-f0-9]{64}:\d{4}-\d{2}-\d{2}T/.test(value) ||
    /^\d{4}-\d{2}-\d{2}T/.test(value)

  if (looksDecoded(raw)) return raw

  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf-8')
    if (looksDecoded(decoded)) return decoded
  } catch {
    // fall through to raw value
  }
  return raw
}

function bufferToUtf8(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return decodeHorizonValue(value)
  if (Buffer.isBuffer(value)) return value.toString('utf-8')
  if (value instanceof Uint8Array) return Buffer.from(value).toString('utf-8')
  if (typeof value === 'object' && value !== null && 'toString' in value) {
    return String((value as { toString: () => string }).toString())
  }
  return ''
}

/**
 * Reports the Stellar network connection health. Used by `/api/stellar/status`
 * and the admin system-health panel.
 *
 * A successful run requires the system keypair to be configured (for the
 * loadAccount call) and Horizon to be reachable. If either fails the result
 * has `healthy: false` and a descriptive `error`.
 */
export async function getStellarStatus(): Promise<StellarStatus> {
  const network = getNetwork()
  const horizonUrl =
    process.env.STELLAR_HORIZON_URL ?? 'https://horizon-testnet.stellar.org'
  const checkedAt = new Date().toISOString()
  const base: StellarStatus = {
    healthy: false,
    network,
    horizonUrl,
    latencyMs: null,
    accountExists: null,
    accountSequence: null,
    publicKey: null,
    error: null,
    checkedAt,
  }

  let publicKey: string
  try {
    const keypair = getSystemKeypair()
    publicKey = keypair.publicKey()
  } catch (err) {
    return {
      ...base,
      error: err instanceof Error ? err.message : 'System keypair unavailable',
    }
  }

  const startedAt = Date.now()
  try {
    const account = await horizon.loadAccount(publicKey)
    return {
      ...base,
      healthy: true,
      publicKey,
      accountExists: true,
      accountSequence: account.sequenceNumber(),
      latencyMs: Date.now() - startedAt,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Horizon unreachable'
    return {
      ...base,
      publicKey,
      latencyMs: Date.now() - startedAt,
      accountExists: false,
      error: message,
    }
  }
}

/**
 * Fetches the on-chain anchor record for a given TX hash. Looks up the
 * transaction, then locates the manageData operation whose name matches the
 * `kuwenta:ph:{returnId}` convention used by `anchorFilingReceipt`.
 *
 * Supports both the current two-entry format (separate `kuwenta:ph:` and
 * `kuwenta:ts:` operations) and the legacy single-entry format where the hash
 * value was encoded as `{hash}:{timestamp}`.
 */
export async function fetchOnChainAnchor(
  txId: string,
  returnId: string
): Promise<OnChainAnchor | null> {
  try {
    const tx = await horizon.transactions().transaction(txId).call()
    const operations = await horizon
      .operations()
      .forTransaction(txId)
      .limit(200)
      .call()
    const targetKey = dataKeyFor(returnId)
    const records = operations.records as Array<{
      type?: string
      name?: string
      value?: unknown
      source_account?: string
    }>
    const match = records.find(
      (op) => isManageData(op) && op.name === targetKey
    )
    if (!match) return null
    const dataValue = bufferToUtf8(match.value)
    const parsed = parseManageDataValue(dataValue)

    // Current anchor format stores the timestamp in a separate manageData entry.
    const timestampKey = `${TIMESTAMP_KEY_PREFIX}${returnId}`.substring(0, 64)
    const timestampOp = records.find(
      (op) => isManageData(op) && op.name === timestampKey
    )
    const anchoredAt = timestampOp
      ? bufferToUtf8(timestampOp.value)
      : parsed.anchoredAt

    const sourceAccount = match.source_account ?? tx.source_account
    return {
      returnId,
      dataKey: targetKey,
      dataValue: dataValue || null,
      payloadHash: parsed.payloadHash,
      anchoredAt,
      sourceAccount,
      transactionHash: tx.hash,
      ledgerCreatedAt: tx.created_at ?? null,
    }
  } catch {
    return null
  }
}

function isManageData(op: { type?: string; name?: string }): boolean {
  return op.type === 'manageData' || op.type === 'manage_data'
}

function returnIdFromHashKey(name: string): string | null {
  if (!name.startsWith(HASH_KEY_PREFIX)) return null
  return name.slice(HASH_KEY_PREFIX.length)
}

/**
 * Fetches a public anchor record from a Stellar transaction without needing the
 * returnId up front. Scans the transaction's manageData operations for a
 * `kuwenta:ph:` entry, extracts the returnId from the key, and pairs it with the
 * matching `kuwenta:ts:` timestamp entry.
 *
 * This is intended for the public verifier page: anyone with the transaction
 * hash can confirm a filing was anchored and read its hash + timestamp.
 */
export async function fetchPublicAnchor(txId: string): Promise<OnChainAnchor | null> {
  try {
    const tx = await horizon.transactions().transaction(txId).call()
    const operations = await horizon
      .operations()
      .forTransaction(txId)
      .limit(200)
      .call()

    const records = operations.records as Array<{ type?: string; name?: string; value?: unknown; source_account?: string }>

    const hashOp = records.find(
      (op) => isManageData(op) && op.name?.startsWith(HASH_KEY_PREFIX)
    )
    if (!hashOp || !hashOp.name) return null

    const returnId = returnIdFromHashKey(hashOp.name)
    if (!returnId) return null

    const timestampOp = records.find(
      (op) =>
        isManageData(op) &&
        op.name === `${TIMESTAMP_KEY_PREFIX}${returnId}`.substring(0, 64)
    )

    const dataValue = bufferToUtf8(hashOp.value)
    const parsed = parseManageDataValue(dataValue)
    const timestampValue = timestampOp ? bufferToUtf8(timestampOp.value) : null
    const sourceAccount = hashOp.source_account ?? tx.source_account

    return {
      returnId,
      dataKey: hashOp.name,
      dataValue: dataValue || null,
      payloadHash: (parsed.payloadHash ?? dataValue) || null,
      anchoredAt: timestampValue ?? parsed.anchoredAt,
      sourceAccount,
      transactionHash: tx.hash,
      ledgerCreatedAt: tx.created_at ?? null,
    }
  } catch {
    return null
  }
}

/**
 * Verifies that a Kuwenta filing receipt stored in our DB is still anchored on
 * Stellar and that the on-chain hash matches the locally recorded hash.
 */
export async function verifyReceiptOnChain(
  txId: string,
  returnId: string,
  storedHash: string
): Promise<VerifyResult> {
  const network = getNetwork()
  const explorerUrl = getExplorerUrl(txId)
  const checkedAt = new Date().toISOString()
  const base: VerifyResult = {
    valid: false,
    reason: null,
    txId,
    returnId,
    storedHash,
    onChainHash: null,
    onChainTimestamp: null,
    onChainKey: null,
    network,
    sourceAccount: null,
    ledgerCreatedAt: null,
    explorerUrl,
    checkedAt,
  }

  try {
    const tx = await horizon.transactions().transaction(txId).call()
    const anchor = await fetchOnChainAnchor(txId, returnId)
    if (!anchor) {
      return {
        ...base,
        reason: 'No matching kuwenta:ph manageData operation on-chain',
        sourceAccount: tx.source_account,
        ledgerCreatedAt: tx.created_at ?? null,
      }
    }
    const matches = anchor.payloadHash === storedHash
    return {
      ...base,
      valid: matches,
      reason: matches
        ? null
        : `On-chain hash ${anchor.payloadHash ?? '(missing)'} does not match stored hash`,
      onChainHash: anchor.payloadHash,
      onChainTimestamp: anchor.anchoredAt,
      onChainKey: anchor.dataKey,
      sourceAccount: anchor.sourceAccount,
      ledgerCreatedAt: tx.created_at ?? null,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Verification failed'
    return {
      ...base,
      reason: message,
    }
  }
}
