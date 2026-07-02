import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/session'
import { hashPassword } from '@/lib/auth/password'
import { prisma } from '@/lib/prisma'
import { adminUsersPatchSchema, adminUsersResetSchema } from '@/lib/validation/schemas'

function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  let result = ''
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

export async function GET(req: NextRequest) {
  const session = await requireAuth()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const url = new URL(req.url)
    const q = url.searchParams.get('q')?.trim() ?? ''

    const where = q
      ? {
          OR: [
            { username: { contains: q, mode: 'insensitive' as const } },
            {
              taxpayer: {
                tin: { contains: q, mode: 'insensitive' as const },
              },
            },
            {
              taxpayer: {
                fullName: { contains: q, mode: 'insensitive' as const },
              },
            },
          ],
        }
      : undefined

    const users = await prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        username: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        taxpayer: true,
      },
    })

    return NextResponse.json({ users, q })
  } catch (err) {
    console.error('Admin list users error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const patchSchema = adminUsersPatchSchema

export async function PATCH(req: NextRequest) {
  const session = await requireAuth()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const body = await req.json()
    const result = patchSchema.safeParse(body)
    if (!result.success) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
    }

    const { userId, isActive } = result.data

    if (userId === session.sub) {
      return NextResponse.json({ error: 'Cannot deactivate your own account' }, { status: 400 })
    }

    const existing = await prisma.user.findUnique({ where: { id: userId } })
    if (!existing) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { isActive },
      select: {
        id: true,
        username: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        taxpayer: true,
      },
    })

    await prisma.auditLog.create({
      data: {
        userId: session.sub,
        action: isActive ? 'USER_REACTIVATED' : 'USER_DEACTIVATED',
        entityType: 'User',
        entityId: userId,
        metadata: {
          targetUsername: existing.username,
          previousIsActive: existing.isActive,
          newIsActive: isActive,
        },
      },
    })

    return NextResponse.json({ user: updated })
  } catch (err) {
    console.error('Admin toggle user active error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const resetSchema = adminUsersResetSchema

export async function POST(req: NextRequest) {
  const session = await requireAuth()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const body = await req.json()
    const result = resetSchema.safeParse(body)
    if (!result.success) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
    }

    const { userId } = result.data

    const existing = await prisma.user.findUnique({ where: { id: userId } })
    if (!existing) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const tempPassword = generateTempPassword()
    const passwordHash = await hashPassword(tempPassword)

    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    })

    await prisma.auditLog.create({
      data: {
        userId: session.sub,
        action: 'PASSWORD_RESET',
        entityType: 'User',
        entityId: userId,
        metadata: {
          targetUsername: existing.username,
          method: 'ADMIN_GENERATED_TEMPORARY',
        },
      },
    })

    return NextResponse.json({
      userId,
      username: existing.username,
      tempPassword,
      message: 'Temporary password generated. Share it securely with the user.',
    })
  } catch (err) {
    console.error('Admin reset password error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
