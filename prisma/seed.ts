import bcrypt from 'bcrypt'
import { prisma } from '../lib/prisma'
import { initializeTaxYear } from '../lib/tax-year'

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

  // Test taxpayers
  const testUsers = [
    {
      username: 'maria',
      password: 'Test1234!',
      profile: {
        tin: '123-456-789-001',
        firstName: 'Maria',
        lastName: 'Dela Cruz',
        middleInitial: 'S',
        fullName: 'Dela Cruz, Maria S.',
        rdoCode: '040',
        phoneNumber: '+639171234567',
        email: 'maria.delacruz@example.com',
        registeredAddress: '123 Mabini St, Makati City',
        zipCode: '1200',
        natureOfBusiness: 'Insurance Agent / Freelance Broker',
        incomeType: 'PURE_SELF_EMPLOYMENT' as const,
        corIncludes2551Q: true,
        atcCodes: ['WI071', 'WI140'],
        taxYear: 2026,
      },
    },
    {
      username: 'juan',
      password: 'Test1234!',
      profile: {
        tin: '123-456-789-002',
        firstName: 'Juan',
        lastName: 'Santos',
        middleInitial: '',
        fullName: 'Santos, Juan',
        rdoCode: '044',
        phoneNumber: '+639181234567',
        email: 'juan.santos@example.com',
        registeredAddress: '456 Rizal Ave, Quezon City',
        zipCode: '1100',
        natureOfBusiness: 'Software Consultant',
        incomeType: 'MIXED_INCOME' as const,
        corIncludes2551Q: true,
        atcCodes: ['WI100'],
        taxYear: 2026,
      },
    },
    {
      username: 'anna',
      password: 'Test1234!',
      profile: {
        tin: '123-456-789-003',
        firstName: 'Anna',
        lastName: 'Reyes',
        middleInitial: 'M',
        fullName: 'Reyes, Anna M.',
        rdoCode: '050',
        phoneNumber: '+639191234567',
        email: 'anna.reyes@example.com',
        registeredAddress: '789 Bonifacio St, Pasig City',
        zipCode: '1600',
        natureOfBusiness: 'Virtual Assistant',
        incomeType: 'PURE_SELF_EMPLOYMENT' as const,
        corIncludes2551Q: false,
        atcCodes: ['WI100'],
        taxYear: 2026,
      },
    },
  ]

  for (const user of testUsers) {
    const hashed = await bcrypt.hash(user.password, 12)
    const createdUser = await prisma.user.upsert({
      where: { username: user.username },
      update: {},
      create: {
        username: user.username,
        passwordHash: hashed,
        role: 'TAXPAYER',
      },
    })

    const existingProfile = await prisma.taxpayerProfile.findUnique({
      where: { userId: createdUser.id },
    })

    if (!existingProfile) {
      const { atcCodes: profileAtcCodes, taxYear, ...profileData } = user.profile
      const profile = await prisma.taxpayerProfile.create({
        data: {
          userId: createdUser.id,
          ...profileData,
        },
      })

      await prisma.taxpayerATC.createMany({
        data: profileAtcCodes.map((code) => ({
          taxpayerId: profile.id,
          atcCode: code,
        })),
      })

      const holidays = await prisma.publicHoliday.findMany({
        where: { year: taxYear },
      })

      await initializeTaxYear(
        profile.id,
        taxYear,
        profileData.corIncludes2551Q,
        holidays.map((h) => h.date),
        prisma,
        false,
        profileData.incomeType
      )
    }
  }

  console.log('Seed complete.')
}

main().catch(console.error).finally(() => prisma.$disconnect())
