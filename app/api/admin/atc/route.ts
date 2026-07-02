import { NextRequest, NextResponse } from 'next/server'
import Decimal from 'decimal.js'
import { Prisma } from '@prisma/client'
import { requireAuth } from '@/lib/auth/session'
import { prisma } from '@/lib/prisma'
import {
  atcCreateSchema,
  atcDeleteSchema,
  atcUpdateSchema,
} from '@/lib/validation/schemas'

const createSchema = atcCreateSchema
const updateSchema = atcUpdateSchema
const deleteSchema = atcDeleteSchema

function requireAdmin(session: Awaited<ReturnType<typeof requireAuth>>) {
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return null
}

export async function GET(req: NextRequest) {
  const session = await requireAuth()
  const denied = requireAdmin(session)
  if (denied) return denied

  try {
    const url = new URL(req.url)
    const q = url.searchParams.get('q')?.trim() ?? ''
    const includeInactive = url.searchParams.get('includeInactive') === 'true'
    const lookupOnly = url.searchParams.get('lookup') === 'true'

    const where: Prisma.ATCCodeWhereInput = {}
    if (q) {
      where.OR = [
        { code: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ]
    }
    if (!includeInactive && !lookupOnly) {
      where.isActive = true
    }

    const codes = await prisma.aTCCode.findMany({
      where,
      orderBy: { code: 'asc' },
    })

    const usagePairs = await Promise.all(
      codes.map((code) =>
        Promise.all([
          prisma.taxpayerATC.count({ where: { atcCode: code.code } }),
          prisma.form2307.count({ where: { atcCode: code.code } }),
        ])
      )
    )

    const annotated = codes.map((code, i) => {
      const [taxpayerCount, certificateCount] = usagePairs[i]
      return {
        ...code,
        usageCount: taxpayerCount + certificateCount,
        taxpayerCount,
        certificateCount,
      }
    })

    return NextResponse.json({ codes: annotated, q, includeInactive })
  } catch (err) {
    console.error('Admin list ATC error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const session = await requireAuth()
  const denied = requireAdmin(session)
  if (denied) return denied

  try {
    const body = await req.json()
    const result = createSchema.safeParse(body)
    if (!result.success) {
      return NextResponse.json({ error: result.error.format() }, { status: 400 })
    }

    const data = result.data
    const code = await prisma.aTCCode.create({
      data: {
        code: data.code.toUpperCase(),
        description: data.description,
        ewtRate: new Decimal(data.ewtRate),
        isActive: data.isActive,
      },
    })

    await prisma.auditLog.create({
      data: {
        userId: session!.sub,
        action: 'ATC_CREATED',
        entityType: 'ATCCode',
        entityId: code.code,
        metadata: { description: code.description, ewtRate: code.ewtRate.toString(), isActive: code.isActive },
      },
    })

    return NextResponse.json({ code }, { status: 201 })
  } catch (err) {
    console.error('Admin create ATC error:', err)
    if (err instanceof Error && err.message.includes('Unique constraint')) {
      return NextResponse.json({ error: 'ATC code already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const session = await requireAuth()
  const denied = requireAdmin(session)
  if (denied) return denied

  try {
    const body = await req.json()
    const result = updateSchema.safeParse(body)
    if (!result.success) {
      return NextResponse.json({ error: result.error.format() }, { status: 400 })
    }

    const data = result.data
    const existing = await prisma.aTCCode.findUnique({ where: { code: data.code } })
    if (!existing) {
      return NextResponse.json({ error: 'ATC code not found' }, { status: 404 })
    }

    const updateData: Partial<{ description: string; ewtRate: Decimal; isActive: boolean }> = {}
    if (data.description !== undefined) updateData.description = data.description
    if (data.ewtRate !== undefined) updateData.ewtRate = new Decimal(data.ewtRate)
    if (data.isActive !== undefined) updateData.isActive = data.isActive

    const code = await prisma.aTCCode.update({
      where: { code: data.code },
      data: updateData,
    })

    await prisma.auditLog.create({
      data: {
        userId: session!.sub,
        action: 'ATC_UPDATED',
        entityType: 'ATCCode',
        entityId: code.code,
        metadata: {
          description: code.description,
          ewtRate: code.ewtRate.toString(),
          isActive: code.isActive,
          previousIsActive: existing.isActive,
        },
      },
    })

    return NextResponse.json({ code })
  } catch (err) {
    console.error('Admin update ATC error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const session = await requireAuth()
  const denied = requireAdmin(session)
  if (denied) return denied

  try {
    const body = await req.json()
    const result = deleteSchema.safeParse(body)
    if (!result.success) {
      return NextResponse.json({ error: result.error.format() }, { status: 400 })
    }

    const { code } = result.data

    const [taxpayerCount, certificateCount] = await Promise.all([
      prisma.taxpayerATC.count({ where: { atcCode: code } }),
      prisma.form2307.count({ where: { atcCode: code } }),
    ])

    if (taxpayerCount > 0 || certificateCount > 0) {
      return NextResponse.json(
        { error: 'Cannot delete ATC code that is in use. Deactivate it instead.' },
        { status: 409 }
      )
    }

    await prisma.aTCCode.delete({ where: { code } })

    await prisma.auditLog.create({
      data: {
        userId: session!.sub,
        action: 'ATC_DELETED',
        entityType: 'ATCCode',
        entityId: code,
      },
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Admin delete ATC error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
