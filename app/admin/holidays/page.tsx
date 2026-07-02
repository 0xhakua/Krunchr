'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { AdminSkeleton } from '../loading'

interface PublicHoliday {
  id: string
  date: string
  name: string
  year: number
}

interface RollPreviewEntry {
  formType: string
  quarter: number | null
  statutoryDueDate: string
  adjustedDueDate: string
}

interface BulkSummary {
  inserted: number
  updated: number
  skipped: number
  errors: Array<{ row: number; error: string }>
}

const ALL_YEARS = '__ALL__'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function wasRolled(statutory: string, adjusted: string): boolean {
  return new Date(statutory).getTime() !== new Date(adjusted).getTime()
}

export default function AdminHolidaysPage() {
  const [holidays, setHolidays] = useState<PublicHoliday[]>([])
  const [years, setYears] = useState<number[]>([])
  const [rollPreview, setRollPreview] = useState<RollPreviewEntry[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const [yearFilter, setYearFilter] = useState<string>(ALL_YEARS)
  const [date, setDate] = useState('')
  const [name, setName] = useState('')

  const [csvBusy, setCsvBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [csvSummary, setCsvSummary] = useState<BulkSummary | null>(null)

  async function loadHolidays() {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (yearFilter !== ALL_YEARS) params.set('year', yearFilter)
      params.set('preview', 'true')
      const res = await fetch(`/api/admin/holidays?${params.toString()}`)
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to load holidays')
        return
      }
      setHolidays(data.holidays ?? [])
      setYears(data.years ?? [])
      setRollPreview(data.rollPreview ?? null)
    } catch {
      setError('Failed to load holidays')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void (async () => {
      await loadHolidays()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yearFilter])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setMessage('')

    try {
      const res = await fetch('/api/admin/holidays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, name }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to add holiday')
        return
      }
      setMessage('Holiday added.')
      setDate('')
      setName('')
      await loadHolidays()
    } catch {
      setError('Failed to add holiday')
    }
  }

  async function handleDelete(id: string, holidayName: string) {
    if (!confirm(`Remove holiday "${holidayName}"?`)) return

    setError('')
    setMessage('')
    try {
      const res = await fetch('/api/admin/holidays', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to delete holiday')
        return
      }
      setMessage('Holiday removed.')
      await loadHolidays()
    } catch {
      setError('Failed to delete holiday')
    }
  }

  async function handleCsvUpload(file: File) {
    setCsvBusy(true)
    setCsvSummary(null)
    setError('')
    setMessage('')
    try {
      const res = await fetch('/api/admin/holidays', {
        method: 'PUT',
        headers: { 'Content-Type': 'text/csv' },
        body: file,
      })
      const data = (await res.json()) as BulkSummary & { error?: string }
      if (!res.ok) {
        setError(data.error || 'CSV import failed')
        return
      }
      setCsvSummary(data)
      setMessage(
        `Imported ${data.inserted} new holiday(s)` +
          (data.updated ? `, updated ${data.updated}` : '') +
          (data.skipped ? `, skipped ${data.skipped}` : '') +
          (data.errors?.length ? `, ${data.errors.length} error(s)` : '') +
          '.'
      )
      await loadHolidays()
    } catch {
      setError('CSV import failed')
    } finally {
      setCsvBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const totalHolidays = useMemo(() => holidays.length, [holidays])

  return (
    <PageShell>
      <PageHeader
        title="Holiday Calendar"
        description="Public holidays used to roll statutory filing deadlines."
        actions={
          <Link href="/admin">
            <Button variant="outline">← Back to Admin</Button>
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <form
          onSubmit={handleSubmit}
          className="rounded-md border bg-muted/10 p-4 space-y-4"
        >
          <h2 className="text-base font-semibold">Add a single holiday</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="date">Date</Label>
              <Input
                id="date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">Holiday name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Independence Day"
                required
              />
            </div>
          </div>
          <Button type="submit">Add Holiday</Button>
        </form>

        <div className="rounded-md border bg-muted/10 p-4 space-y-4">
          <h2 className="text-base font-semibold">Bulk import (CSV)</h2>
          <p className="text-sm text-muted-foreground">
            Required columns: <code>date</code>, <code>name</code>. Optional:{' '}
            <code>year</code> (auto-derived from <code>date</code> if omitted).
          </p>
          <Input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            disabled={csvBusy}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleCsvUpload(file)
            }}
          />
          {csvSummary && (
            <div className="text-xs text-muted-foreground space-y-1">
              <p>
                Inserted: {csvSummary.inserted} · Updated: {csvSummary.updated} ·
                Skipped: {csvSummary.skipped} · Errors: {csvSummary.errors.length}
              </p>
              {csvSummary.errors.length > 0 && (
                <ul className="list-disc pl-5">
                  {csvSummary.errors.slice(0, 5).map((err, idx) => (
                    <li key={idx}>
                      Row {err.row}: {err.error}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div className="w-48 space-y-1">
          <Label htmlFor="yearFilter">Filter by year</Label>
          <Select
            value={yearFilter}
            onValueChange={(value) => setYearFilter(value ?? ALL_YEARS)}
          >
            <SelectTrigger id="yearFilter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_YEARS}>All years</SelectItem>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground">
          {totalHolidays} holiday{totalHolidays === 1 ? '' : 's'} configured
          {yearFilter !== ALL_YEARS ? ` for ${yearFilter}` : ''}.
        </p>
      </div>

      {message && <p className="text-sm text-green-600">{message}</p>}
      {!message && error && <p className="text-sm text-red-600">{error}</p>}

      {loading ? (
        <AdminSkeleton />
      ) : holidays.length === 0 ? (
        <EmptyState
          title="No holidays configured"
          description="Add public holidays so statutory filing deadlines roll correctly when they fall on a weekend or holiday."
        />
      ) : (
        <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Year</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {holidays.map((holiday) => (
              <TableRow key={holiday.id}>
                <TableCell>{formatDate(holiday.date)}</TableCell>
                <TableCell>{holiday.name}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{holiday.year}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleDelete(holiday.id, holiday.name)}
                  >
                    Remove
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
      )}

      {rollPreview && rollPreview.length > 0 && (
        <div className="rounded-md border bg-muted/10 p-4 space-y-3">
          <h2 className="text-base font-semibold">
            Statutory due-date preview for {yearFilter}
          </h2>
          <p className="text-xs text-muted-foreground">
            Holidays listed above roll every BIR deadline for the selected year.
            Dates marked <strong>Rolled</strong> fell on a weekend or holiday.
          </p>
          <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Form</TableHead>
                <TableHead>Quarter</TableHead>
                <TableHead>Statutory</TableHead>
                <TableHead>Adjusted</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rollPreview.map((entry) => {
                const rolled = wasRolled(entry.statutoryDueDate, entry.adjustedDueDate)
                return (
                  <TableRow key={`${entry.formType}-${entry.quarter ?? 'A'}`}>
                    <TableCell className="font-medium">{entry.formType}</TableCell>
                    <TableCell>{entry.quarter ?? '—'}</TableCell>
                    <TableCell>{formatDateTime(entry.statutoryDueDate)}</TableCell>
                    <TableCell>{formatDateTime(entry.adjustedDueDate)}</TableCell>
                    <TableCell>
                      {rolled ? (
                        <Badge className="bg-amber-100 text-amber-800">Rolled</Badge>
                      ) : (
                        <Badge className="bg-green-100 text-green-800">Same</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          </div>
        </div>
      )}
    </PageShell>
  )
}
