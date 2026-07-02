import { NextRequest, NextResponse } from 'next/server'
import Decimal from 'decimal.js'
import { requireAuth } from '@/lib/auth/session'
import { prisma } from '@/lib/prisma'
import {
  rdoDeleteSchema,
  rdoUpdateSchema,
  rdoUpsertSchema,
} from '@/lib/validation/schemas'

const upsertSchema = rdoUpsertSchema
const updateSchema = rdoUpdateSchema
const deleteSchema = rdoDeleteSchema

function requireAdmin(session: Awaited<ReturnType<typeof requireAuth>>) {
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return null
}

export async function GET() {
  const session = await requireAuth()
  const denied = requireAdmin(session)
  if (denied) return denied

  try {
    const schedules = await prisma.rDOPenaltySchedule.findMany({
      orderBy: { rdoCode: 'asc' },
    })
    return NextResponse.json({ schedules })
  } catch (err) {
    console.error('Admin list RDO penalties error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const session = await requireAuth()
  const denied = requireAdmin(session)
  if (denied) return denied

  try {
    const body = await req.json()
    const result = upsertSchema.safeParse(body)
    if (!result.success) {
      return NextResponse.json(
        { error: result.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 }
      )
    }

    const { rdoCode, compromiseFee } = result.data
    const fee = new Decimal(compromiseFee)

    const existing = await prisma.rDOPenaltySchedule.findUnique({
      where: { rdoCode },
    })

    const schedule = await prisma.rDOPenaltySchedule.upsert({
      where: { rdoCode },
      create: {
        rdoCode,
        compromiseFee: fee,
      },
      update: {
        compromiseFee: fee,
      },
    })

    await prisma.auditLog.create({
      data: {
        userId: session!.sub,
        action: existing ? 'RDO_PENALTY_UPDATED' : 'RDO_PENALTY_CREATED',
        entityType: 'RDOPenaltySchedule',
        entityId: schedule.id,
        metadata: {
          rdoCode: schedule.rdoCode,
          compromiseFee: schedule.compromiseFee.toString(),
          previousCompromiseFee: existing?.compromiseFee.toString() ?? null,
        },
      },
    })

    return NextResponse.json({ schedule }, { status: existing ? 200 : 201 })
  } catch (err) {
    console.error('Admin upsert RDO penalty error:', err)
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
      return NextResponse.json(
        { error: result.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 }
      )
    }

    const { id, compromiseFee } = result.data
    const existing = await prisma.rDOPenaltySchedule.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'RDO schedule not found' }, { status: 404 })
    }

    const schedule = await prisma.rDOPenaltySchedule.update({
      where: { id },
      data: { compromiseFee: new Decimal(compromiseFee) },
    })

    await prisma.auditLog.create({
      data: {
        userId: session!.sub,
        action: 'RDO_PENALTY_UPDATED',
        entityType: 'RDOPenaltySchedule',
        entityId: schedule.id,
        metadata: {
          rdoCode: schedule.rdoCode,
          compromiseFee: schedule.compromiseFee.toString(),
          previousCompromiseFee: existing.compromiseFee.toString(),
        },
      },
    })

    return NextResponse.json({ schedule })
  } catch (err) {
    console.error('Admin update RDO penalty error:', err)
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
      return NextResponse.json(
        { error: result.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 }
      )
    }

    const { id } = result.data
    const existing = await prisma.rDOPenaltySchedule.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'RDO schedule not found' }, { status: 404 })
    }

    await prisma.rDOPenaltySchedule.delete({ where: { id } })

    await prisma.auditLog.create({
      data: {
        userId: session!.sub,
        action: 'RDO_PENALTY_DELETED',
        entityType: 'RDOPenaltySchedule',
        entityId: id,
        metadata: {
          rdoCode: existing.rdoCode,
          compromiseFee: existing.compromiseFee.toString(),
        },
      },
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Admin delete RDO penalty error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
