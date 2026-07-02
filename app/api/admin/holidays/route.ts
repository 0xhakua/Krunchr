import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { requireAuth } from '@/lib/auth/session'
import { prisma } from '@/lib/prisma'
import { getDueDatesForYear } from '@/lib/computation/due-dates'
import {
  holidaysBulkImportSchema,
  holidaysBulkRowSchema,
  holidaysCreateSchema,
  holidaysDeleteSchema,
} from '@/lib/validation/schemas'

const createSchema = holidaysCreateSchema
const deleteSchema = holidaysDeleteSchema
const bulkRowSchema = holidaysBulkRowSchema
const bulkImportSchema = holidaysBulkImportSchema

function requireAdmin(session: Awaited<ReturnType<typeof requireAuth>>) {
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return null
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ',') {
        row.push(field)
        field = ''
      } else if (ch === '\n' || ch === '\r') {
        if (field.length || row.length) {
          row.push(field)
          field = ''
          rows.push(row)
          row = []
        }
        if (ch === '\r' && text[i + 1] === '\n') i++
      } else {
        field += ch
      }
    }
  }
  if (field.length || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

export async function GET(req: NextRequest) {
  const session = await requireAuth()
  const denied = requireAdmin(session)
  if (denied) return denied

  try {
    const url = new URL(req.url)
    const yearParam = url.searchParams.get('year')?.trim()
    const includeRollPreview = url.searchParams.get('preview') === 'true'

    const where: Prisma.PublicHolidayWhereInput = {}
    if (yearParam) {
      const yearNum = Number(yearParam)
      if (Number.isInteger(yearNum) && yearNum > 1900 && yearNum < 2999) {
        where.year = yearNum
      }
    }

    const holidays = await prisma.publicHoliday.findMany({
      where,
      orderBy: { date: 'asc' },
    })

    const years = await prisma.publicHoliday.findMany({
      distinct: ['year'],
      select: { year: true },
      orderBy: { year: 'asc' },
    })

    let rollPreview: Array<{
      formType: string
      quarter: number | null
      statutoryDueDate: string
      adjustedDueDate: string
    }> | null = null
    if (includeRollPreview && yearParam) {
      const yearNum = Number(yearParam)
      if (Number.isInteger(yearNum) && yearNum > 1900 && yearNum < 2999) {
        // Use every configured holiday so that due dates which fall in
        // the following calendar year (e.g. 1701A for tax year N is due
        // April 15 of N+1) still roll correctly.
        const allHolidays = await prisma.publicHoliday.findMany({
          select: { date: true },
        })
        const calendar = getDueDatesForYear(
          yearNum,
          true,
          allHolidays.map((h) => h.date)
        )
        rollPreview = calendar.map((entry) => ({
          formType: entry.formType,
          quarter: entry.quarter,
          statutoryDueDate: entry.statutoryDueDate.toISOString(),
          adjustedDueDate: entry.adjustedDueDate.toISOString(),
        }))
      }
    }

    return NextResponse.json({
      holidays,
      years: years.map((y) => y.year),
      rollPreview,
    })
  } catch (err) {
    console.error('Admin list holidays error:', err)
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

    const { date, name } = result.data
    const parsedDate = new Date(date)
    const year = parsedDate.getFullYear()

    const holiday = await prisma.publicHoliday.create({
      data: {
        date: parsedDate,
        name,
        year,
      },
    })

    await prisma.auditLog.create({
      data: {
        userId: session!.sub,
        action: 'HOLIDAY_CREATED',
        entityType: 'PublicHoliday',
        entityId: holiday.id,
        metadata: { date: holiday.date.toISOString(), name: holiday.name, year: holiday.year },
      },
    })

    return NextResponse.json({ holiday }, { status: 201 })
  } catch (err) {
    console.error('Admin create holiday error:', err)
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

    const { id } = result.data
    const holiday = await prisma.publicHoliday.delete({ where: { id } })

    await prisma.auditLog.create({
      data: {
        userId: session!.sub,
        action: 'HOLIDAY_DELETED',
        entityType: 'PublicHoliday',
        entityId: holiday.id,
        metadata: { date: holiday.date.toISOString(), name: holiday.name, year: holiday.year },
      },
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Admin delete holiday error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const session = await requireAuth()
  const denied = requireAdmin(session)
  if (denied) return denied

  try {
    const contentType = req.headers.get('content-type') ?? ''
    let rows: Array<{ date: string; name: string; year?: number | string }>
    let mode: 'insert' | 'upsert' = 'insert'

    if (contentType.includes('text/csv') || contentType.includes('text/plain')) {
      const text = await req.text()
      const matrix = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ''))
      if (matrix.length === 0) {
        return NextResponse.json({ error: 'Empty CSV' }, { status: 400 })
      }
      const header = matrix[0].map((h) => h.trim().toLowerCase())
      const dateIdx = header.indexOf('date')
      const nameIdx = header.indexOf('name')
      const yearIdx = header.indexOf('year')
      if (dateIdx === -1 || nameIdx === -1) {
        return NextResponse.json(
          { error: 'CSV must include "date" and "name" columns (in any order).' },
          { status: 400 }
        )
      }
      const parsed: Array<{ date: string; name: string; year?: number | string }> =
        matrix.slice(1).map((r) => {
          const obj: Record<string, string> = {}
          for (let i = 0; i < header.length; i++) obj[header[i]] = (r[i] ?? '').trim()
          const rawYear = yearIdx === -1 ? '' : obj.year
          const parsedYear = rawYear === '' ? undefined : Number(rawYear)
          return {
            date: obj.date ?? '',
            name: obj.name ?? '',
            year: parsedYear !== undefined && Number.isFinite(parsedYear) ? parsedYear : undefined,
          }
        })
      rows = parsed
    } else {
      const json = await req.json()
      const result = bulkImportSchema.safeParse(json)
      if (!result.success) {
        return NextResponse.json({ error: result.error.format() }, { status: 400 })
      }
      rows = result.data.rows
      mode = result.data.mode
    }

    let inserted = 0
    let updated = 0
    let skipped = 0
    const errors: Array<{ row: number; error: string }> = []
    const seenDates = new Set<string>()

    if (mode === 'insert' && rows.length > 0) {
      const dates = rows
        .map((r) => (typeof r.date === 'string' ? r.date : null))
        .filter((d): d is string => Boolean(d))
      if (dates.length > 0) {
        const dateObjs = dates.map((d) => new Date(d))
        const existing = await prisma.publicHoliday.findMany({
          where: { date: { in: dateObjs } },
          select: { date: true },
        })
        for (const e of existing) {
          const local = new Date(e.date)
          const key = `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}-${String(local.getUTCDate()).padStart(2, '0')}`
          seenDates.add(key)
        }
      }
    }

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      const parsed = bulkRowSchema.safeParse(r)
      if (!parsed.success) {
        errors.push({ row: i + 1, error: parsed.error.issues[0]?.message ?? 'Invalid row' })
        continue
      }
      const { date, name, year } = parsed.data
      const dateKey = date
      if (mode === 'insert' && seenDates.has(dateKey)) {
        skipped++
        continue
      }
      seenDates.add(dateKey)
      const dateObj = new Date(date)
      try {
        if (mode === 'upsert') {
          const existing = await prisma.publicHoliday.findFirst({
            where: { date: dateObj },
          })
          if (existing) {
            await prisma.publicHoliday.update({
              where: { id: existing.id },
              data: { name, year },
            })
            updated++
            continue
          }
        }
        await prisma.publicHoliday.create({
          data: { date: dateObj, name, year },
        })
        inserted++
      } catch (err) {
        errors.push({
          row: i + 1,
          error: err instanceof Error ? err.message : 'Insert failed',
        })
      }
    }

    if (inserted > 0 || updated > 0) {
      await prisma.auditLog.create({
        data: {
          userId: session!.sub,
          action: 'HOLIDAY_BULK_IMPORTED',
          entityType: 'PublicHoliday',
          entityId: 'bulk',
          metadata: { mode, inserted, updated, skipped, errors: errors.length },
        },
      })
    }

    return NextResponse.json({ inserted, updated, skipped, errors })
  } catch (err) {
    console.error('Admin bulk import holidays error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
