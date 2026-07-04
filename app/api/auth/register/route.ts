import { NextRequest, NextResponse } from 'next/server'
import { signToken, hashPassword, setSessionCookie } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { registerSchema } from '@/lib/validation/schemas'
import { isRateLimited, resetRateLimit } from '@/lib/rate-limit'

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000 // 15 minutes
const RATE_LIMIT_MAX_ATTEMPTS = 5

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }
  // NextRequest is based on the Web Request API and does not expose a remote address.
  return 'unknown'
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req)

  try {
    if (isRateLimited(`register:${ip}`, RATE_LIMIT_MAX_ATTEMPTS, RATE_LIMIT_WINDOW_MS)) {
      return NextResponse.json(
        {
          error: 'Too many registration attempts. Please try again later.',
          code: 'RATE_LIMITED',
        },
        { status: 429 }
      )
    }

    const body = await req.json()
    const result = registerSchema.safeParse(body)
    if (!result.success) {
      return NextResponse.json(
        {
          error: 'Invalid input',
          details: result.error.flatten().fieldErrors,
        },
        { status: 400 }
      )
    }

    const { username, password } = result.data

    let existing
    try {
      existing = await prisma.user.findUnique({
        where: { username: username.toLowerCase() },
      })
    } catch (dbErr) {
      console.error('[register] prisma.user.findUnique failed', {
        username,
        errorName: dbErr instanceof Error ? dbErr.name : typeof dbErr,
        errorMessage: dbErr instanceof Error ? dbErr.message : String(dbErr),
      })
      return NextResponse.json(
        {
          error: 'Registration temporarily unavailable',
          code: 'DB_UNAVAILABLE',
        },
        { status: 503 }
      )
    }

    if (existing) {
      return NextResponse.json(
        { error: 'Username already taken', code: 'USERNAME_TAKEN' },
        { status: 409 }
      )
    }

    let passwordHash: string
    try {
      passwordHash = await hashPassword(password)
    } catch (hashErr) {
      console.error('[register] hashPassword failed', {
        username,
        errorName: hashErr instanceof Error ? hashErr.name : typeof hashErr,
        errorMessage: hashErr instanceof Error ? hashErr.message : String(hashErr),
      })
      return NextResponse.json(
        { error: 'Registration temporarily unavailable' },
        { status: 500 }
      )
    }

    let user
    try {
      user = await prisma.user.create({
        data: {
          username: username.toLowerCase(),
          passwordHash,
          role: 'TAXPAYER',
          isActive: true,
        },
      })
    } catch (dbErr) {
      console.error('[register] prisma.user.create failed', {
        username,
        errorName: dbErr instanceof Error ? dbErr.name : typeof dbErr,
        errorMessage: dbErr instanceof Error ? dbErr.message : String(dbErr),
      })
      return NextResponse.json(
        {
          error: 'Registration temporarily unavailable',
          code: 'DB_UNAVAILABLE',
        },
        { status: 503 }
      )
    }

    let token: string
    try {
      token = await signToken({
        sub: user.id,
        username: user.username,
        role: user.role,
      })
    } catch (authErr) {
      console.error('[register] signToken failed', {
        username,
        errorName: authErr instanceof Error ? authErr.name : typeof authErr,
        errorMessage: authErr instanceof Error ? authErr.message : String(authErr),
      })
      return NextResponse.json(
        {
          error: 'Registration temporarily unavailable',
          code: 'AUTH_CONFIG_MISSING',
        },
        { status: 503 }
      )
    }

    await setSessionCookie(token)

    // Successful registration clears the rate-limit bucket for this IP.
    resetRateLimit(`register:${ip}`)

    return NextResponse.json(
      {
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
        },
      },
      { status: 201 }
    )
  } catch (err) {
    console.error('[register] unexpected error', {
      errorName: err instanceof Error ? err.name : typeof err,
      errorMessage: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
