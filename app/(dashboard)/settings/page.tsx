import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { prisma } from '@/lib/prisma'
import SettingsForm from './settings-form'

export default async function SettingsPage() {
  const session = await getSession()
  if (!session) {
    redirect('/login')
  }

  const profile = await prisma.taxpayerProfile.findUnique({
    where: { userId: session.sub },
    include: {
      atcCodes: true,
      taxYears: {
        orderBy: { year: 'desc' },
        take: 1,
        include: { returns: { select: { status: true } } },
      },
    },
  })

  // Settings edits an existing profile — without one there is nothing to
  // edit, so send the user to onboarding instead.
  if (!profile) {
    redirect('/onboarding')
  }

  const atcCodes = await prisma.aTCCode.findMany({
    where: { isActive: true },
    orderBy: { code: 'asc' },
  })

  const activeTaxYear = profile.taxYears[0] ?? null
  // Mirrors the PUT /api/taxpayer guardrail (#241): once any return in the
  // active tax year is GENERATED/FILED, structural fields are locked. The
  // server still enforces this with a 409 — the UI flag is for UX only.
  const structuralLocked = activeTaxYear
    ? activeTaxYear.returns.some((r) => r.status === 'GENERATED' || r.status === 'FILED')
    : false

  return (
    <SettingsForm
      profile={{
        tin: profile.tin,
        firstName: profile.firstName ?? '',
        lastName: profile.lastName ?? '',
        middleInitial: profile.middleInitial ?? '',
        rdoCode: profile.rdoCode,
        phoneNumber: profile.phoneNumber ?? '',
        email: profile.email ?? '',
        registeredAddress: profile.registeredAddress,
        zipCode: profile.zipCode,
        natureOfBusiness: profile.natureOfBusiness,
        citizenship: profile.citizenship ?? 'Filipino',
        civilStatus: profile.civilStatus ?? '',
        claimingForeignTaxCredits: profile.claimingForeignTaxCredits,
        foreignTaxNumber: profile.foreignTaxNumber ?? '',
        incomeType: profile.incomeType,
        corIncludes2551Q: profile.corIncludes2551Q,
        isNewRegistrant: profile.isNewRegistrant,
        selectedAtcCodes: profile.atcCodes.map((a) => a.atcCode),
      }}
      atcCodes={atcCodes.map((a) => ({
        code: a.code,
        description: a.description,
        ewtRate: Number(a.ewtRate),
      }))}
      activeTaxYear={activeTaxYear?.year ?? null}
      structuralLocked={structuralLocked}
    />
  )
}
