import { prisma } from '../lib/prisma'
import { DEMO_ACCOUNTS, ensureSeedTaxpayer } from '../lib/seed-taxpayer'

/**
 * One-off script to create fresh demo accounts without re-running the full
 * `prisma/seed.ts` flow.
 *
 * #245: useful for deployed environments where the original `maria`/`juan`/
 * `anna` seeded accounts are stuck in a partial-seed state and you want new,
 * manually-onboarded-style demo accounts (`demo1`/`demo2`/`demo3`) ready to
 * log in. The script is idempotent — running it twice is a no-op.
 *
 * Usage:
 *   pnpm tsx scripts/create-demo-accounts.ts
 * Or on Railway:
 *   railway run -- pnpm tsx scripts/create-demo-accounts.ts
 */
async function main() {
  for (const account of DEMO_ACCOUNTS) {
    await ensureSeedTaxpayer(account)
    console.log(`Ensured demo account: ${account.username}`)
  }
  console.log('Demo accounts ready.')
}

main()
  .catch((err) => {
    console.error('Failed to create demo accounts:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
