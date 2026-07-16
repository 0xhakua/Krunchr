import bcrypt from 'bcrypt'
import type { IncomeType } from '@prisma/client'
import { prisma } from './prisma'
import { initializeTaxYear } from './tax-year'

/**
 * One seeded taxpayer account and the profile data that goes with it.
 * Shared by prisma/seed.ts so the shape stays in one place.
 */
export type SeedTaxpayer = {
  username: string
  password: string
  profile: {
    tin: string
    firstName: string
    lastName: string
    middleInitial: string
    fullName: string
    rdoCode: string
    phoneNumber: string
    email: string
    registeredAddress: string
    zipCode: string
    natureOfBusiness: string
    citizenship: string
    civilStatus: string
    claimingForeignTaxCredits: boolean
    foreignTaxNumber: string | null
    incomeType: IncomeType
    corIncludes2551Q: boolean
    atcCodes: string[]
    taxYear: number
  }
}

/**
 * Idempotently seed one taxpayer: user, profile, ATC links, and tax year.
 *
 * #243: an earlier seed run could leave a TaxpayerProfile behind with no
 * TaxYear (e.g. the #107 ATC-ordering crash killed the seed between profile
 * creation and tax-year init). Because the old seed only initialized the tax
 * year inside the `if (!existingProfile)` branch, every later reseed skipped
 * the account and the dashboard rendered the onboarding empty state for a
 * fully-onboarded user. Two defences:
 *
 * 1. Everything runs in one transaction, so a mid-seed failure rolls the
 *    profile back too — the partial state can no longer be persisted.
 * 2. When the profile already exists we still check for the seed-year
 *    TaxYear and backfill it (with its return slots) when missing, using the
 *    profile's stored corIncludes2551Q/incomeType so profile edits (#241)
 *    win over the seed literals.
 */
export async function ensureSeedTaxpayer(user: SeedTaxpayer): Promise<void> {
  const hashed = await bcrypt.hash(user.password, 12)
  const { atcCodes: profileAtcCodes, taxYear, ...profileData } = user.profile

  await prisma.$transaction(async (tx) => {
    const createdUser = await tx.user.upsert({
      where: { username: user.username },
      update: {},
      create: {
        username: user.username,
        passwordHash: hashed,
        role: 'TAXPAYER',
      },
    })

    let profile = await tx.taxpayerProfile.findUnique({
      where: { userId: createdUser.id },
    })

    if (!profile) {
      const createdProfile = await tx.taxpayerProfile.create({
        data: {
          userId: createdUser.id,
          ...profileData,
        },
      })

      await tx.taxpayerATC.createMany({
        data: profileAtcCodes.map((code) => ({
          taxpayerId: createdProfile.id,
          atcCode: code,
        })),
      })

      profile = createdProfile
    }

    // TypeScript cannot prove that the mutable `profile` variable is non-null
    // after the conditional assignment above, so guard it explicitly.
    if (!profile) {
      throw new Error(`Invariant: TaxpayerProfile could not be created for ${user.username}`)
    }

    const existingTaxYear = await tx.taxYear.findUnique({
      where: { taxpayerId_year: { taxpayerId: profile.id, year: taxYear } },
    })

    if (!existingTaxYear) {
      const holidays = await tx.publicHoliday.findMany({
        where: { year: taxYear },
      })

      await initializeTaxYear(
        profile.id,
        taxYear,
        profile.corIncludes2551Q,
        holidays.map((h) => h.date),
        tx,
        false,
        profile.incomeType
      )
    }
  })
}
