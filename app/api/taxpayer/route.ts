import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/session'
import { prisma } from '@/lib/prisma'
import { initializeTaxYear, reconcileTaxYearReturns } from '@/lib/tax-year'
import { recascadeTaxYear } from '@/lib/computation/recascade'
import { taxpayerSchema, taxpayerUpdateSchema } from '@/lib/validation/schemas'

function composeFullName(
  firstName: string,
  lastName: string,
  middleInitial?: string
): string {
  const suffix = middleInitial ? ` ${middleInitial.trim()}.` : ''
  return `${lastName.trim()}, ${firstName.trim()}${suffix}`
}

export async function GET(req: NextRequest) {
  const session = await requireAuth(req)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const profile = await prisma.taxpayerProfile.findUnique({
      where: { userId: session.sub },
      include: {
        atcCodes: { include: { atc: true } },
        taxYears: {
          orderBy: { year: 'desc' },
          take: 1,
          include: {
            returns: { orderBy: { sequenceOrder: 'asc' } },
          },
        },
      },
    })

    if (!profile) {
      return NextResponse.json({ profile: null })
    }

    return NextResponse.json({ profile })
  } catch (err) {
    console.error('Get taxpayer error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const session = await requireAuth(req)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const result = taxpayerSchema.safeParse(body)
    if (!result.success) {
      const flat = result.error.flatten()
      return NextResponse.json(
        {
          error: 'Validation failed',
          formErrors: flat.formErrors,
          fieldErrors: flat.fieldErrors,
        },
        { status: 400 }
      )
    }

    const data = result.data

    const existingProfile = await prisma.taxpayerProfile.findUnique({
      where: { userId: session.sub },
    })

    if (existingProfile) {
      return NextResponse.json(
        { error: 'Taxpayer profile already exists' },
        { status: 409 }
      )
    }

    const tinTaken = await prisma.taxpayerProfile.findUnique({
      where: { tin: data.tin },
    })
    if (tinTaken) {
      return NextResponse.json({ error: 'TIN already registered' }, { status: 409 })
    }

    const validAtcCodes = await prisma.aTCCode.findMany({
      where: { code: { in: data.atcCodes }, isActive: true },
    })
    if (validAtcCodes.length !== data.atcCodes.length) {
      return NextResponse.json(
        { error: 'One or more ATC codes are invalid or inactive' },
        { status: 400 }
      )
    }

    const profile = await prisma.$transaction(async (tx) => {
      const created = await tx.taxpayerProfile.create({
        data: {
          userId: session.sub,
          tin: data.tin,
          firstName: data.firstName,
          lastName: data.lastName,
          middleInitial: data.middleInitial,
          fullName: composeFullName(data.firstName, data.lastName, data.middleInitial),
          rdoCode: data.rdoCode,
          phoneNumber: data.phoneNumber,
          email: data.email,
          registeredAddress: data.registeredAddress,
          zipCode: data.zipCode,
          natureOfBusiness: data.natureOfBusiness,
          citizenship: data.citizenship,
          civilStatus: data.civilStatus,
          claimingForeignTaxCredits: data.claimingForeignTaxCredits,
          // Only persist a foreign tax number when the filer actually claims
          // foreign tax credits; otherwise store null so the PDF field stays
          // blank rather than echoing a stale/irrelevant value.
          foreignTaxNumber: data.claimingForeignTaxCredits
            ? (data.foreignTaxNumber ?? null)
            : null,
          incomeType: data.incomeType,
          corIncludes2551Q: data.corIncludes2551Q,
          isNewRegistrant: data.isNewRegistrant,
        },
      })

      await tx.taxpayerATC.createMany({
        data: data.atcCodes.map((code) => ({
          taxpayerId: created.id,
          atcCode: code,
        })),
      })

      // Initialize tax year + returns inside the same transaction
      const holidays = await tx.publicHoliday.findMany({
        where: { year: data.taxYear },
      })
      await initializeTaxYear(
        created.id,
        data.taxYear,
        data.corIncludes2551Q,
        holidays.map((h) => h.date),
        tx,
        data.isNewRegistrant,
        data.incomeType
      )

      return created
    })

    const fullProfile = await prisma.taxpayerProfile.findUnique({
      where: { id: profile.id },
      include: {
        atcCodes: { include: { atc: true } },
        taxYears: {
          include: {
            returns: { orderBy: { sequenceOrder: 'asc' } },
          },
        },
      },
    })

    return NextResponse.json({ profile: fullProfile }, { status: 201 })
  } catch (err) {
    console.error('Create taxpayer error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  // Forward the request so the JWT is read from the request cookies — this
  // keeps the handler testable outside a Next.js request scope (#241).
  const session = await requireAuth(req)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const result = taxpayerUpdateSchema.safeParse(body)
    if (!result.success) {
      const flat = result.error.flatten()
      return NextResponse.json(
        {
          error: 'Validation failed',
          formErrors: flat.formErrors,
          fieldErrors: flat.fieldErrors,
        },
        { status: 400 }
      )
    }

    const data = result.data

    const existingProfile = await prisma.taxpayerProfile.findUnique({
      where: { userId: session.sub },
    })
    if (!existingProfile) {
      return NextResponse.json({ error: 'Taxpayer profile not found' }, { status: 404 })
    }

    if (data.tin && data.tin !== existingProfile.tin) {
      const tinTaken = await prisma.taxpayerProfile.findUnique({
        where: { tin: data.tin },
      })
      if (tinTaken) {
        return NextResponse.json({ error: 'TIN already registered' }, { status: 409 })
      }
    }

    // Cross-field FTC rule, checked against the merged (existing + patch)
    // values because a partial payload may carry only one side of the pair.
    const claimingForeignTaxCredits =
      data.claimingForeignTaxCredits ?? existingProfile.claimingForeignTaxCredits
    const foreignTaxNumber =
      data.foreignTaxNumber !== undefined
        ? data.foreignTaxNumber
        : existingProfile.foreignTaxNumber
    if (claimingForeignTaxCredits && !foreignTaxNumber?.trim()) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          formErrors: [],
          fieldErrors: {
            foreignTaxNumber: [
              'Foreign tax number is required when claiming foreign tax credits',
            ],
          },
        },
        { status: 400 }
      )
    }

    // ATC replacement is validated before opening the transaction so an
    // invalid code set fails fast with a 400, mirroring the POST path.
    if (data.atcCodes) {
      const validAtcCodes = await prisma.aTCCode.findMany({
        where: { code: { in: data.atcCodes }, isActive: true },
      })
      if (validAtcCodes.length !== data.atcCodes.length) {
        return NextResponse.json(
          { error: 'One or more ATC codes are invalid or inactive' },
          { status: 400 }
        )
      }
    }

    // Structural changes: incomeType drives 1701A↔1701 routing (and the
    // ₱250k exemption), corIncludes2551Q drives the 8- vs 4-return path.
    // Both reshape the active tax year's return slots, so they are refused
    // once any return has progressed past the editable stage.
    const nextIncomeType = data.incomeType ?? existingProfile.incomeType
    const nextCorIncludes2551Q = data.corIncludes2551Q ?? existingProfile.corIncludes2551Q
    const incomeTypeChanged = nextIncomeType !== existingProfile.incomeType
    const corChanged = nextCorIncludes2551Q !== existingProfile.corIncludes2551Q
    const structuralChange = incomeTypeChanged || corChanged

    const activeTaxYear = await prisma.taxYear.findFirst({
      where: { taxpayerId: existingProfile.id },
      orderBy: { year: 'desc' },
      include: { returns: { select: { status: true } } },
    })

    if (structuralChange && activeTaxYear) {
      const hasLockedReturn = activeTaxYear.returns.some(
        (r) => r.status === 'GENERATED' || r.status === 'FILED'
      )
      if (hasLockedReturn) {
        return NextResponse.json(
          {
            error:
              'Cannot change income type or COR 2551Q coverage once a return for the active tax year has been generated or filed. Non-structural profile fields (name, address, contact) remain editable.',
          },
          { status: 409 }
        )
      }
    }

    const firstName = data.firstName ?? existingProfile.firstName ?? ''
    const lastName = data.lastName ?? existingProfile.lastName ?? ''
    const middleInitial =
      data.middleInitial !== undefined
        ? data.middleInitial
        : existingProfile.middleInitial

    await prisma.$transaction(async (tx) => {
      await tx.taxpayerProfile.update({
        where: { userId: session.sub },
        data: {
          ...(data.tin && { tin: data.tin }),
          ...(data.firstName && { firstName: data.firstName }),
          ...(data.lastName && { lastName: data.lastName }),
          ...(data.middleInitial !== undefined && { middleInitial: data.middleInitial }),
          fullName: composeFullName(firstName, lastName, middleInitial ?? undefined),
          ...(data.rdoCode && { rdoCode: data.rdoCode }),
          ...(data.phoneNumber !== undefined && { phoneNumber: data.phoneNumber }),
          ...(data.email !== undefined && { email: data.email }),
          ...(data.registeredAddress && { registeredAddress: data.registeredAddress }),
          ...(data.zipCode && { zipCode: data.zipCode }),
          ...(data.natureOfBusiness && { natureOfBusiness: data.natureOfBusiness }),
          ...(data.citizenship && { citizenship: data.citizenship }),
          ...(data.civilStatus && { civilStatus: data.civilStatus }),
          ...(data.claimingForeignTaxCredits !== undefined && {
            claimingForeignTaxCredits: data.claimingForeignTaxCredits,
          }),
          // Only persist a foreign tax number when the filer actually claims
          // foreign tax credits (same rule as POST); otherwise store null.
          ...((data.claimingForeignTaxCredits !== undefined ||
            data.foreignTaxNumber !== undefined) && {
            foreignTaxNumber: claimingForeignTaxCredits
              ? (foreignTaxNumber ?? null)
              : null,
          }),
          ...(data.incomeType && { incomeType: data.incomeType }),
          ...(data.corIncludes2551Q !== undefined && { corIncludes2551Q: data.corIncludes2551Q }),
          ...(data.isNewRegistrant !== undefined && { isNewRegistrant: data.isNewRegistrant }),
        },
      })

      // Replace the ATC code set wholesale when provided.
      if (data.atcCodes) {
        await tx.taxpayerATC.deleteMany({ where: { taxpayerId: existingProfile.id } })
        await tx.taxpayerATC.createMany({
          data: data.atcCodes.map((code) => ({
            taxpayerId: existingProfile.id,
            atcCode: code,
          })),
        })
      }

      // Reconcile return slots and recompute the tax year after structural
      // changes. recascadeTaxYear reads taxpayer.incomeType, so it must run
      // after the profile update above, inside the same transaction.
      if (structuralChange && activeTaxYear) {
        const holidays = await tx.publicHoliday.findMany({
          where: { year: activeTaxYear.year },
        })
        await reconcileTaxYearReturns(
          activeTaxYear.id,
          nextCorIncludes2551Q,
          nextIncomeType,
          holidays.map((h) => h.date),
          tx
        )
        await recascadeTaxYear({ taxYearId: activeTaxYear.id, tx })
      }

      await tx.auditLog.create({
        data: {
          userId: session.sub,
          action: 'TAXPAYER_PROFILE_UPDATED',
          entityType: 'TaxpayerProfile',
          entityId: existingProfile.id,
          metadata: {
            changedFields: Object.keys(data),
            structuralChange,
            ...(incomeTypeChanged && {
              incomeType: { from: existingProfile.incomeType, to: nextIncomeType },
            }),
            ...(corChanged && {
              corIncludes2551Q: {
                from: existingProfile.corIncludes2551Q,
                to: nextCorIncludes2551Q,
              },
            }),
            ...(data.atcCodes && { atcCodesReplaced: true }),
          },
        },
      })
    })

    const updated = await prisma.taxpayerProfile.findUnique({
      where: { userId: session.sub },
      include: {
        atcCodes: { include: { atc: true } },
        taxYears: {
          orderBy: { year: 'desc' },
          include: {
            returns: { orderBy: { sequenceOrder: 'asc' } },
          },
        },
      },
    })

    return NextResponse.json({ profile: updated, restructured: structuralChange })
  } catch (err) {
    console.error('Update taxpayer error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
