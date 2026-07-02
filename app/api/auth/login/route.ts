import { NextRequest, NextResponse } from 'next/server'
import { signToken, verifyPassword, setSessionCookie } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { loginSchema } from '@/lib/validation/schemas'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const result = loginSchema.safeParse(body)
    if (!result.success) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
    }

    const { username, password } = result.data

    let user
    try {
      user = await prisma.user.findUnique({ where: { username } })
    } catch (dbErr) {
      // Surface the Prisma error so Railway's logs tell us whether the DB is
      // unreachable, the table is missing, or the connection string is wrong.
      // Previously this fell into the generic 500 with no actionable info.
      console.error('[login] prisma.user.findUnique failed', {
        username,
        errorName: dbErr instanceof Error ? dbErr.name : typeof dbErr,
        errorMessage: dbErr instanceof Error ? dbErr.message : String(dbErr),
      })
      return NextResponse.json(
        {
          error: 'Login temporarily unavailable',
          code: 'DB_UNAVAILABLE',
        },
        { status: 503 }
      )
    }

    if (!user) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    if (!user.isActive) {
      return NextResponse.json(
        { error: 'Account deactivated. Contact an administrator.', code: 'ACCOUNT_DEACTIVATED' },
        { status: 403 }
      )
    }

    const valid = await verifyPassword(password, user.passwordHash)
    if (!valid) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    let token
    try {
      token = await signToken({
        sub: user.id,
        username: user.username,
        role: user.role,
      })
    } catch (authErr) {
      // Most likely cause: JWT_SECRET is missing or too short.
      console.error('[login] signToken failed', {
        username,
        errorName: authErr instanceof Error ? authErr.name : typeof authErr,
        errorMessage: authErr instanceof Error ? authErr.message : String(authErr),
      })
      return NextResponse.json(
        {
          error: 'Login temporarily unavailable',
          code: 'AUTH_CONFIG_MISSING',
        },
        { status: 503 }
      )
    }

    await setSessionCookie(token)

    return NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
    })
  } catch (err) {
    console.error('[login] unexpected error', {
      errorName: err instanceof Error ? err.name : typeof err,
      errorMessage: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
