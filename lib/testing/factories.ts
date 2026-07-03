import { prisma } from './db'
import { initializeTaxYear } from '../tax-year'
import bcrypt from 'bcrypt'

export function d(value: string | number) {
  return value
}

export async function createUser(overrides: Partial<{ username: string; password: string; role: 'ADMIN' | 'TAXPAYER'; isActive: boolean }> = {}) {
  const username = overrides.username ?? `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const passwordHash = await bcrypt.hash(overrides.password ?? 'Test1234!', 12)
  return prisma.user.create({
    data: {
      username,
      passwordHash,
      role: overrides.role ?? 'TAXPAYER',
      isActive: overrides.isActive ?? true,
    },
  })
}

export async function createTaxpayerProfile(
  userId: string,
  overrides: Partial<{
    tin: string
    firstName: string
    lastName: string
    middleInitial: string
    fullName: string
    rdoCode: string
    registeredAddress: string
    zipCode: string
    natureOfBusiness: string
    incomeType: 'PURE_SELF_EMPLOYMENT' | 'MIXED_INCOME'
    corIncludes2551Q: boolean
    isNewRegistrant: boolean
  }> = {}
) {
  const firstName = overrides.firstName ?? 'Test'
  const lastName = overrides.lastName ?? 'Taxpayer'
  const middleInitial = overrides.middleInitial ?? ''
  const fullName =
    overrides.fullName ??
    `${lastName}, ${firstName}${middleInitial ? ` ${middleInitial}.` : ''}`
  return prisma.taxpayerProfile.create({
    data: {
      userId,
      tin: overrides.tin ?? `123-456-789-${String(Math.floor(Math.random() * 900) + 100).padStart(3, '0')}`,
      firstName,
      lastName,
      middleInitial,
      fullName,
      rdoCode: overrides.rdoCode ?? '040',
      registeredAddress: overrides.registeredAddress ?? '123 Test St',
      zipCode: overrides.zipCode ?? '1200',
      natureOfBusiness: overrides.natureOfBusiness ?? 'Consulting',
      incomeType: overrides.incomeType ?? 'PURE_SELF_EMPLOYMENT',
      corIncludes2551Q: overrides.corIncludes2551Q ?? true,
      isNewRegistrant: overrides.isNewRegistrant ?? false,
    },
  })
}

export async function createTaxYear(
  taxpayerId: string,
  year: number,
  overrides: Partial<{
    electedRate: 'RATE_8PCT' | 'GRADUATED' | null
    electionStatus: 'NOT_ELECTED' | 'ELECTED_8PCT' | 'ELECTED_GRADUATED'
    electionPath: string | null
    electionMethod: string | null
    electionLockedAt: Date | null
  }> = {}
) {
  return prisma.taxYear.create({
    data: {
      taxpayerId,
      year,
      electedRate: overrides.electedRate ?? 'RATE_8PCT',
      electionStatus: overrides.electionStatus ?? 'ELECTED_8PCT',
      electionPath: overrides.electionPath ?? null,
      electionMethod: overrides.electionMethod ?? null,
      electionLockedAt: overrides.electionLockedAt ?? null,
    },
  })
}

export async function createTaxpayerWithYear(overrides: {
  year?: number
  incomeType?: 'PURE_SELF_EMPLOYMENT' | 'MIXED_INCOME'
  corIncludes2551Q?: boolean
  isNewRegistrant?: boolean
  electedRate?: 'RATE_8PCT' | 'GRADUATED' | null
} = {}) {
  const user = await createUser()
  const profile = await createTaxpayerProfile(user.id, {
    incomeType: overrides.incomeType,
    corIncludes2551Q: overrides.corIncludes2551Q,
    isNewRegistrant: overrides.isNewRegistrant,
  })
  const taxYear = await createTaxYear(profile.id, overrides.year ?? 2026, {
    electedRate: overrides.electedRate,
  })
  await initializeTaxYear(
    profile.id,
    overrides.year ?? 2026,
    overrides.corIncludes2551Q ?? true,
    [],
    prisma,
    overrides.isNewRegistrant ?? false,
    overrides.incomeType ?? 'PURE_SELF_EMPLOYMENT'
  )
  return { user, profile, taxYear }
}

export async function createATCCode(
  overrides: Partial<{ code: string; description: string; ewtRate: number }> = {}
) {
  const code = overrides.code ?? `WI${Math.floor(Math.random() * 900) + 100}`
  return prisma.aTCCode.upsert({
    where: { code },
    update: {},
    create: {
      code,
      description: overrides.description ?? 'Test ATC Code',
      ewtRate: overrides.ewtRate ?? 0.1,
    },
  })
}

export async function createRDOPenaltySchedule(
  overrides: Partial<{ rdoCode: string; compromiseFee: number }> = {}
) {
  const rdoCode = overrides.rdoCode ?? '040'
  return prisma.rDOPenaltySchedule.upsert({
    where: { rdoCode },
    update: {},
    create: {
      rdoCode,
      compromiseFee: overrides.compromiseFee ?? 500,
    },
  })
}

export async function createForm2307(
  taxYearId: string,
  atcCode: string,
  overrides: Partial<{
    quarter: number
    payorTin: string
    payorName: string
    month1Amount: number | string
    month2Amount: number | string
    month3Amount: number | string
    quarterlyTotal: number | string
    cwtWithheld: number | string
  }> = {}
) {
  const quarter = overrides.quarter ?? 1
  const quarterlyTotal = Number(overrides.quarterlyTotal ?? 100000)
  const cwtWithheld = Number(overrides.cwtWithheld ?? quarterlyTotal * 0.1)

  return prisma.form2307.create({
    data: {
      taxYearId,
      quarter,
      payorTin: overrides.payorTin ?? '123-456-789-000',
      payorName: overrides.payorName ?? 'Test Payor',
      atcCode,
      month1Amount: Number(overrides.month1Amount ?? quarterlyTotal / 3),
      month2Amount: Number(overrides.month2Amount ?? quarterlyTotal / 3),
      month3Amount: Number(overrides.month3Amount ?? quarterlyTotal / 3),
      quarterlyTotal,
      cwtWithheld,
    },
  })
}

export async function createPriorYearCredit(
  taxYearId: string,
  overrides: Partial<{
    amount: number | string
    originYear: number
    originForm: string
    priorDisposition: string
  }> = {}
) {
  return prisma.priorYearCredit.create({
    data: {
      taxYearId,
      amount: Number(overrides.amount ?? 5000),
      originYear: overrides.originYear ?? 2025,
      originForm: overrides.originForm ?? 'FORM_1701A',
      priorDisposition: overrides.priorDisposition ?? 'CARRY_OVER',
    },
  })
}

export async function createOverpayment(
  taxYearId: string,
  overrides: Partial<{
    amount: number | string
    disposition: 'CARRY_OVER' | 'REFUND' | 'TAX_CREDIT_CERTIFICATE'
  }> = {}
) {
  return prisma.overpayment.create({
    data: {
      taxYearId,
      amount: Number(overrides.amount ?? 3000),
      disposition: overrides.disposition ?? 'CARRY_OVER',
    },
  })
}

export async function seedReferenceData() {
  await prisma.aTCCode.createMany({
    data: [
      { code: 'WI071', description: 'Insurance Agents & Adjusters', ewtRate: 0.1 },
      { code: 'WI140', description: "Agent/Broker's Fees", ewtRate: 0.1 },
      { code: 'WI100', description: 'Professional fees', ewtRate: 0.1 },
    ],
    skipDuplicates: true,
  })

  await prisma.rDOPenaltySchedule.createMany({
    data: [
      { rdoCode: '040', compromiseFee: 500 },
      { rdoCode: '044', compromiseFee: 500 },
      { rdoCode: '050', compromiseFee: 1000 },
    ],
    skipDuplicates: true,
  })
}
