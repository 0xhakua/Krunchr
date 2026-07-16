import { describe, it, expect } from 'vitest'
import bcrypt from 'bcrypt'
import { prisma } from '@/lib/testing/db'
import { seedReferenceData } from '@/lib/testing/factories'
import { ensureSeedTaxpayer, type SeedTaxpayer } from '@/lib/seed-taxpayer'

function buildSeedTaxpayer(overrides: {
  username: string
  tin: string
  corIncludes2551Q?: boolean
}): SeedTaxpayer {
  return {
    username: overrides.username,
    password: 'Test1234!',
    profile: {
      tin: overrides.tin,
      firstName: 'Test',
      lastName: 'Taxpayer',
      middleInitial: '',
      fullName: 'Taxpayer, Test',
      rdoCode: '040',
      phoneNumber: '+639171234567',
      email: `${overrides.username}@example.com`,
      registeredAddress: '1 Test St',
      zipCode: '1200',
      natureOfBusiness: 'Consulting',
      citizenship: 'Filipino',
      civilStatus: 'Single',
      claimingForeignTaxCredits: false,
      foreignTaxNumber: null,
      incomeType: 'PURE_SELF_EMPLOYMENT',
      corIncludes2551Q: overrides.corIncludes2551Q ?? true,
      atcCodes: ['WI100'],
      taxYear: 2026,
    },
  }
}

describe('ensureSeedTaxpayer (#243)', () => {
  it('creates user, profile, ATC links, and the full 8-return tax year on a fresh run', async () => {
    await seedReferenceData()
    await ensureSeedTaxpayer(buildSeedTaxpayer({ username: 'fresh', tin: '900-000-000-001' }))

    const user = await prisma.user.findUnique({ where: { username: 'fresh' } })
    expect(user).not.toBeNull()

    const profile = await prisma.taxpayerProfile.findUnique({
      where: { userId: user!.id },
      include: { atcCodes: true, taxYears: { include: { returns: true } } },
    })
    expect(profile).not.toBeNull()
    expect(profile!.atcCodes).toHaveLength(1)
    expect(profile!.taxYears).toHaveLength(1)
    // 8-return path: 4 × 2551Q + 3 × 1701Q + 1701A
    expect(profile!.taxYears[0].returns).toHaveLength(8)
  })

  it('uses the 4-return path when the seed profile has corIncludes2551Q: false', async () => {
    await seedReferenceData()
    await ensureSeedTaxpayer(
      buildSeedTaxpayer({ username: 'nocor', tin: '900-000-000-002', corIncludes2551Q: false })
    )

    const user = await prisma.user.findUnique({ where: { username: 'nocor' } })
    const taxYear = await prisma.taxYear.findFirst({
      where: { taxpayer: { userId: user!.id } },
      include: { returns: true },
    })
    // 4-return path: 3 × 1701Q + 1701A
    expect(taxYear).not.toBeNull()
    expect(taxYear!.returns).toHaveLength(4)
  })

  it('backfills the tax year when an earlier partial seed left the profile without one', async () => {
    await seedReferenceData()
    const seed = buildSeedTaxpayer({ username: 'stuck', tin: '900-000-000-003' })

    // Simulate the #243 partial-seed state: user + profile exist (created by
    // a seed run that crashed before tax-year init, e.g. the #107 ATC
    // ordering bug), but there is no TaxYear and no return slots.
    const hashed = await bcrypt.hash(seed.password, 12)
    const user = await prisma.user.create({
      data: { username: seed.username, passwordHash: hashed, role: 'TAXPAYER' },
    })
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { atcCodes, taxYear: _taxYear, ...profileData } = seed.profile
    const profile = await prisma.taxpayerProfile.create({
      data: { userId: user.id, ...profileData },
    })
    await prisma.taxpayerATC.createMany({
      data: atcCodes.map((code) => ({ taxpayerId: profile.id, atcCode: code })),
    })

    await ensureSeedTaxpayer(seed)

    const healed = await prisma.taxpayerProfile.findUnique({
      where: { userId: user.id },
      include: { taxYears: { include: { returns: true } } },
    })
    expect(healed!.taxYears).toHaveLength(1)
    expect(healed!.taxYears[0].year).toBe(2026)
    expect(healed!.taxYears[0].returns).toHaveLength(8)

    // The pre-existing profile row must be reused, not duplicated.
    const profileCount = await prisma.taxpayerProfile.count({
      where: { userId: user.id },
    })
    expect(profileCount).toBe(1)
  })

  it('is a no-op on reseed once the account is fully seeded', async () => {
    await seedReferenceData()
    const seed = buildSeedTaxpayer({ username: 'twice', tin: '900-000-000-004' })

    await ensureSeedTaxpayer(seed)
    await ensureSeedTaxpayer(seed)

    const user = await prisma.user.findUnique({ where: { username: 'twice' } })
    const profile = await prisma.taxpayerProfile.findUnique({
      where: { userId: user!.id },
      include: { atcCodes: true, taxYears: { include: { returns: true } } },
    })
    expect(profile!.atcCodes).toHaveLength(1)
    expect(profile!.taxYears).toHaveLength(1)
    expect(profile!.taxYears[0].returns).toHaveLength(8)
  })
})
