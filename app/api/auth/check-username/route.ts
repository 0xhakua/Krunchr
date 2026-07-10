import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const querySchema = z.object({
  username: z.string().min(3, 'Username must be at least 3 characters').max(30),
})

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const username = searchParams.get('username') ?? ''

  const result = querySchema.safeParse({ username })
  if (!result.success) {
    return NextResponse.json(
      {
        available: false,
        error: result.error.flatten().fieldErrors.username?.[0],
      },
      { status: 400 }
    )
  }

  try {
    const existing = await prisma.user.findUnique({
      where: { username: username.toLowerCase() },
    })

    return NextResponse.json({
      available: existing === null,
      username: username.toLowerCase(),
    })
  } catch (dbErr) {
    console.error('[check-username] prisma.user.findUnique failed', {
      username,
      errorName: dbErr instanceof Error ? dbErr.name : typeof dbErr,
      errorMessage: dbErr instanceof Error ? dbErr.message : String(dbErr),
    })
    return NextResponse.json(
      { available: false, error: 'Database unavailable' },
      { status: 503 }
    )
  }
}
