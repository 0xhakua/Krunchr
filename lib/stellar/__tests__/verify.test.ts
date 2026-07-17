import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const loadAccount = vi.fn()
  const transactionCall = vi.fn()
  const operationsCall = vi.fn()
  const operationsForTx = vi.fn(() => ({
    limit: () => ({ call: operationsCall }),
  }))
  const operations = vi.fn(() => ({ forTransaction: operationsForTx }))
  const transactions = vi.fn(() => ({ transaction: transactionCall }))
  const getSystemKeypair = vi.fn()
  return {
    loadAccount,
    transactionCall,
    operationsCall,
    operationsForTx,
    operations,
    transactions,
    getSystemKeypair,
  }
})

vi.mock('../client', () => ({
  horizon: {
    loadAccount: mocks.loadAccount,
    transactions: mocks.transactions,
    operations: mocks.operations,
  },
  getSystemKeypair: mocks.getSystemKeypair,
}))

const ORIGINAL_ENV = { ...process.env }

function setKeypair(publicKey: string | null) {
  if (publicKey) {
    mocks.getSystemKeypair.mockReturnValue({ publicKey: () => publicKey })
  } else {
    mocks.getSystemKeypair.mockImplementation(() => {
      throw new Error('STELLAR_SECRET_KEY is not configured')
    })
  }
}

describe('getStellarStatus', () => {
  beforeEach(() => {
    process.env.STELLAR_NETWORK = 'testnet'
    Object.values(mocks).forEach((m) => m.mockReset())
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.clearAllMocks()
  })

  it('reports unhealthy when STELLAR_SECRET_KEY is missing', async () => {
    setKeypair(null)
    const { getStellarStatus } = await import('../verify')
    const status = await getStellarStatus()
    expect(status.healthy).toBe(false)
    expect(status.error).toMatch(/STELLAR_SECRET_KEY/)
    expect(status.publicKey).toBeNull()
    expect(status.accountExists).toBeNull()
  })

  it('reports healthy when account loads', async () => {
    setKeypair('GABC123')
    mocks.loadAccount.mockResolvedValue({ sequenceNumber: () => '42' })
    const { getStellarStatus } = await import('../verify')
    const status = await getStellarStatus()
    expect(status.healthy).toBe(true)
    expect(status.publicKey).toBe('GABC123')
    expect(status.accountSequence).toBe('42')
    expect(status.accountExists).toBe(true)
    expect(status.network).toBe('testnet')
  })

  it('reports unhealthy when Horizon rejects the account', async () => {
    setKeypair('GABC123')
    mocks.loadAccount.mockRejectedValue(new Error('not found'))
    const { getStellarStatus } = await import('../verify')
    const status = await getStellarStatus()
    expect(status.healthy).toBe(false)
    expect(status.accountExists).toBe(false)
    expect(status.error).toBe('not found')
  })

  it('uses mainnet when STELLAR_NETWORK=mainnet', async () => {
    process.env.STELLAR_NETWORK = 'mainnet'
    setKeypair('GMAIN')
    mocks.loadAccount.mockResolvedValue({ sequenceNumber: () => '1' })
    const { getStellarStatus } = await import('../verify')
    const status = await getStellarStatus()
    expect(status.healthy).toBe(true)
    expect(status.network).toBe('mainnet')
  })
})

describe('verifyReceiptOnChain', () => {
  beforeEach(() => {
    process.env.STELLAR_NETWORK = 'testnet'
    Object.values(mocks).forEach((m) => m.mockReset())
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.clearAllMocks()
  })

  it('returns valid=true when on-chain hash matches stored hash', async () => {
    mocks.transactionCall.mockReturnValue({
      call: () =>
        Promise.resolve({
          hash: 'abc',
          source_account: 'GSRC',
          created_at: '2026-06-29T00:00:00Z',
        }),
    })
    mocks.operationsCall.mockResolvedValue({
      records: [
        {
          type: 'manageData',
          name: 'kuwenta:ph:RET1',
          value: Buffer.from('deadbeef:2026-06-29T00:00:00Z'),
          source_account: 'GSRC',
        },
      ],
    })

    const { verifyReceiptOnChain } = await import('../verify')
    const result = await verifyReceiptOnChain('abc', 'RET1', 'deadbeef')
    expect(result.valid).toBe(true)
    expect(result.reason).toBeNull()
    expect(result.onChainHash).toBe('deadbeef')
    expect(result.onChainTimestamp).toBe('2026-06-29T00:00:00Z')
    expect(result.ledgerCreatedAt).toBe('2026-06-29T00:00:00Z')
  })

  it('returns valid=false with mismatch reason when hashes differ', async () => {
    mocks.transactionCall.mockReturnValue({
      call: () =>
        Promise.resolve({
          hash: 'abc',
          source_account: 'GSRC',
          created_at: '2026-06-29T00:00:00Z',
        }),
    })
    mocks.operationsCall.mockResolvedValue({
      records: [
        {
          type: 'manageData',
          name: 'kuwenta:ph:RET1',
          value: Buffer.from('beef:2026-06-29T00:00:00Z'),
          source_account: 'GSRC',
        },
      ],
    })

    const { verifyReceiptOnChain } = await import('../verify')
    const result = await verifyReceiptOnChain('abc', 'RET1', 'deadbeef')
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/does not match/)
    expect(result.onChainHash).toBe('beef')
  })

  it('returns reason when no matching manageData op is found', async () => {
    mocks.transactionCall.mockReturnValue({
      call: () =>
        Promise.resolve({
          hash: 'abc',
          source_account: 'GSRC',
          created_at: '2026-06-29T00:00:00Z',
        }),
    })
    mocks.operationsCall.mockResolvedValue({ records: [] })

    const { verifyReceiptOnChain } = await import('../verify')
    const result = await verifyReceiptOnChain('abc', 'RET1', 'deadbeef')
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/No matching/)
  })

  it('returns valid=true when Horizon returns base64-encoded manageData values', async () => {
    const hash = 'deadbeef'.repeat(8)
    const timestamp = '2026-06-29T00:00:00Z'
    mocks.transactionCall.mockReturnValue({
      call: () =>
        Promise.resolve({
          hash: 'abc',
          source_account: 'GSRC',
          created_at: '2026-06-29T00:00:00Z',
        }),
    })
    mocks.operationsCall.mockResolvedValue({
      records: [
        {
          type: 'manageData',
          name: 'kuwenta:ph:RET1',
          value: Buffer.from(hash, 'utf8').toString('base64'),
          source_account: 'GSRC',
        },
        {
          type: 'manageData',
          name: 'kuwenta:ts:RET1',
          value: Buffer.from(timestamp, 'utf8').toString('base64'),
          source_account: 'GSRC',
        },
      ],
    })

    const { verifyReceiptOnChain } = await import('../verify')
    const result = await verifyReceiptOnChain('abc', 'RET1', hash)
    expect(result.valid).toBe(true)
    expect(result.onChainHash).toBe(hash)
    expect(result.onChainTimestamp).toBe(timestamp)
  })

  it('returns valid=true for legacy single-entry format with base64-encoded value', async () => {
    const hash = 'deadbeef'.repeat(8)
    const timestamp = '2026-06-29T00:00:00Z'
    mocks.transactionCall.mockReturnValue({
      call: () =>
        Promise.resolve({
          hash: 'abc',
          source_account: 'GSRC',
          created_at: '2026-06-29T00:00:00Z',
        }),
    })
    mocks.operationsCall.mockResolvedValue({
      records: [
        {
          type: 'manageData',
          name: 'kuwenta:ph:RET1',
          value: Buffer.from(`${hash}:${timestamp}`, 'utf8').toString('base64'),
          source_account: 'GSRC',
        },
      ],
    })

    const { verifyReceiptOnChain } = await import('../verify')
    const result = await verifyReceiptOnChain('abc', 'RET1', hash)
    expect(result.valid).toBe(true)
    expect(result.onChainHash).toBe(hash)
    expect(result.onChainTimestamp).toBe(timestamp)
  })

  it('handles a value that is already a string', async () => {
    mocks.transactionCall.mockReturnValue({
      call: () =>
        Promise.resolve({
          hash: 'abc',
          source_account: 'GSRC',
          created_at: '2026-06-29T00:00:00Z',
        }),
    })
    mocks.operationsCall.mockResolvedValue({
      records: [
        {
          type: 'manageData',
          name: 'kuwenta:ph:RET1',
          value: 'cafe:2026-06-29T00:00:00Z',
          source_account: 'GSRC',
        },
      ],
    })

    const { verifyReceiptOnChain } = await import('../verify')
    const result = await verifyReceiptOnChain('abc', 'RET1', 'cafe')
    expect(result.valid).toBe(true)
    expect(result.onChainHash).toBe('cafe')
  })
})
