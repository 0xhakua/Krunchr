import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/session'
import { prisma } from '@/lib/prisma'
import { initializeTaxYear } from '@/lib/tax-year'
import { taxpayerSchema } from '@/lib/validation/schemas'

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
          fullName: data.fullName,
          rdoCode: data.rdoCode,
          registeredAddress: data.registeredAddress,
          zipCode: data.zipCode,
          natureOfBusiness: data.natureOfBusiness,
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
  const session = await requireAuth()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const result = taxpayerSchema.partial().safeParse(body)
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

    const updated = await prisma.taxpayerProfile.update({
      where: { userId: session.sub },
      data: {
        ...(data.tin && { tin: data.tin }),
        ...(data.fullName && { fullName: data.fullName }),
        ...(data.rdoCode && { rdoCode: data.rdoCode }),
        ...(data.registeredAddress && { registeredAddress: data.registeredAddress }),
        ...(data.zipCode && { zipCode: data.zipCode }),
        ...(data.natureOfBusiness && { natureOfBusiness: data.natureOfBusiness }),
        ...(data.incomeType && { incomeType: data.incomeType }),
        ...(data.corIncludes2551Q !== undefined && { corIncludes2551Q: data.corIncludes2551Q }),
        ...(data.isNewRegistrant !== undefined && { isNewRegistrant: data.isNewRegistrant }),
      },
      include: {
        atcCodes: { include: { atc: true } },
        taxYears: {
          include: {
            returns: { orderBy: { sequenceOrder: 'asc' } },
          },
        },
      },
    })

    return NextResponse.json({ profile: updated })
  } catch (err) {
    console.error('Update taxpayer error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
