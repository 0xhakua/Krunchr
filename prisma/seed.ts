import bcrypt from 'bcrypt'
import { prisma } from '../lib/prisma'
import { DEMO_ACCOUNTS, ensureSeedTaxpayer } from '../lib/seed-taxpayer'

async function main() {
  // Admin user
  const adminPassword = process.env.ADMIN_PASSWORD ?? 'admin1234!'
  const passwordHash = await bcrypt.hash(adminPassword, 12)
  await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      passwordHash,
      role: 'ADMIN',
    },
  })

  // Reference data first — TaxpayerATC inserts below depend on the ATCCode
  // rows existing (FK constraint). Inserting them in the wrong order fails
  // with `Foreign key constraint violated: TaxpayerATC_atcCode_fkey`.
  // See #107.

  // ATC Codes
  const atcCodes = [
    { code: 'WI071', description: 'Insurance Agents & Adjusters', ewtRate: 0.10 },
    { code: 'WI140', description: "Agent/Broker's Fees", ewtRate: 0.10 },
    { code: 'WI100', description: 'Professional fees — lawyers, CPAs, engineers', ewtRate: 0.10 },
    { code: 'WI160', description: 'Fees of directors who are not employees', ewtRate: 0.15 },
  ]
  for (const atc of atcCodes) {
    await prisma.aTCCode.upsert({
      where: { code: atc.code },
      update: {},
      create: atc,
    })
  }

  // RDO Penalty Schedules (sample)
  const rdoPenalties = [
    { rdoCode: '040', compromiseFee: 500 },
    { rdoCode: '044', compromiseFee: 500 },
    { rdoCode: '050', compromiseFee: 1000 },
  ]
  for (const rdo of rdoPenalties) {
    await prisma.rDOPenaltySchedule.upsert({
      where: { rdoCode: rdo.rdoCode },
      update: {},
      create: rdo,
    })
  }

  // Demo taxpayers. #245: usernames are now demo1/2/3 instead of the older
  // maria/juan/anna accounts that were left in a partial-seed state on some
  // deployed environments. ensureSeedTaxpayer is idempotent, so reseeding
  // backfills any missing TaxYear rows instead of skipping the account.
  for (const user of DEMO_ACCOUNTS) {
    await ensureSeedTaxpayer(user)
  }

  console.log('Seed complete.')
}

main().catch(console.error).finally(() => prisma.$disconnect())
