'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
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
import { formatPeso, formatDate } from '@/lib/format'

type JournalLine = {
  lineOrder: number
  accountCode: string
  accountName: string
  debit: string
  credit: string
}

type JournalEntry = {
  id: string
  entryNumber: string
  subsection: string
  triggerEvent: string
  triggerEntityId: string | null
  quarter: number | null
  entryDate: string
  regulationRef: string | null
  workflowMenu: string | null
  isMemo: boolean
  lines: JournalLine[]
}

const SUBSECTIONS = ['9A', '9B', '9C', '9D', '9E', '9F', '9G']
type QuarterFilter = 'ALL' | '1' | '2' | '3' | '4'

function subsectionLabel(subsection: string): string {
  const labels: Record<string, string> = {
    '9A': 'Income Recognition',
    '9B': 'Quarterly Percentage Tax',
    '9C': 'Quarterly Income Tax',
    '9D': 'Prior Year Carry-Over',
    '9E': 'Annual Income Tax',
    '9F': 'Overpayment Disposition',
    '9G': 'Year-End Closing',
  }
  return labels[subsection] ?? subsection
}

function entryColor(entry: JournalEntry): string {
  if (entry.isMemo) return 'bg-gray-100 text-gray-800'
  const hasDebit = entry.lines.some((l) => Number(l.debit) > 0)
  const hasCredit = entry.lines.some((l) => Number(l.credit) > 0)
  if (hasDebit && !hasCredit) return 'bg-blue-100 text-blue-800'
  if (hasCredit && !hasDebit) return 'bg-green-100 text-green-800'
  return 'bg-gray-100 text-gray-800'
}

function buildJournalUrl(params: {
  subsection: string
  quarter: QuarterFilter
  accountName: string
}): string {
  const base = params.subsection === 'ALL' ? '/api/journal' : `/api/journal/${params.subsection}`
  const search = new URLSearchParams()
  if (params.quarter !== 'ALL') search.set('quarter', params.quarter)
  const trimmedAccount = params.accountName.trim()
  if (trimmedAccount.length > 0) search.set('accountName', trimmedAccount)
  const qs = search.toString()
  return qs.length > 0 ? `${base}?${qs}` : base
}

export default function JournalPage() {
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [taxYear, setTaxYear] = useState<number | null>(null)
  const [subsection, setSubsection] = useState<string>('ALL')
  const [quarter, setQuarter] = useState<QuarterFilter>('ALL')
  const [accountName, setAccountName] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function loadEntries() {
    setLoading(true)
    setError('')
    try {
      const url = buildJournalUrl({ subsection, quarter, accountName })
      const res = await fetch(url)
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to load journal entries')
        return
      }
      setTaxYear(data.taxYear ?? null)
      setEntries(data.entries ?? [])
    } catch {
      setError('Failed to load journal entries')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false

    const url = buildJournalUrl({ subsection, quarter, accountName })
    fetch(url)
      .then(async (res) => {
        const data = await res.json()
        if (cancelled) return
        if (!res.ok) {
          setError(data.error || 'Failed to load journal entries')
          return
        }
        setError('')
        setTaxYear(data.taxYear ?? null)
        setEntries(data.entries ?? [])
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load journal entries')
      })

    return () => {
      cancelled = true
    }
  }, [subsection, quarter, accountName])

  async function regenerate() {
    setRegenerating(true)
    setError('')
    setMessage('')
    try {
      const res = await fetch('/api/journal/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to regenerate journal entries')
        return
      }
      setMessage('Journal entries regenerated.')
      await loadEntries()
    } catch {
      setError('Failed to regenerate journal entries')
    } finally {
      setRegenerating(false)
    }
  }

  function downloadXlsx() {
    window.open('/api/journal/export', '_blank')
  }

  function clearFilters() {
    setSubsection('ALL')
    setQuarter('ALL')
    setAccountName('')
  }

  const grouped = useMemo(() => {
    const map = new Map<string, JournalEntry[]>()
    for (const entry of entries) {
      const list = map.get(entry.subsection) ?? []
      list.push(entry)
      map.set(entry.subsection, list)
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [entries])

  const filtersActive =
    subsection !== 'ALL' || quarter !== 'ALL' || accountName.trim().length > 0

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Journal Entries</h1>
          <p className="text-muted-foreground">
            {taxYear ? `Accounting journal for taxable year ${taxYear}` : 'No active tax year'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={downloadXlsx}>Download XLSX</Button>
          <Button onClick={regenerate} disabled={regenerating}>
            {regenerating ? 'Regenerating…' : 'Regenerate'}
          </Button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Sub-section
          </label>
          <Select value={subsection} onValueChange={(value) => value && setSubsection(value)}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Filter by subsection" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All sub-sections</SelectItem>
              {SUBSECTIONS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s} — {subsectionLabel(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Quarter
          </label>
          <Select value={quarter} onValueChange={(value) => value && setQuarter(value as QuarterFilter)}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="All quarters" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All (incl. annual)</SelectItem>
              <SelectItem value="1">Q1 only</SelectItem>
              <SelectItem value="2">Q2 only</SelectItem>
              <SelectItem value="3">Q3 only</SelectItem>
              <SelectItem value="4">Q4 only</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Account name
          </label>
          <Input
            type="text"
            placeholder="e.g. CWT Receivable, Service Income"
            value={accountName}
            onChange={(e) => setAccountName(e.target.value)}
          />
        </div>
        {filtersActive && (
          <Button variant="ghost" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {message && <p className="text-sm text-green-600">{message}</p>}

      {loading ? (
        <p className="text-muted-foreground">Loading journal entries…</p>
      ) : entries.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No journal entries match</CardTitle>
            <CardDescription>
              {filtersActive
                ? 'Try removing a filter or click Regenerate to rebuild the journal from current data.'
                : 'Journal entries are generated when you add income, file returns, or set overpayment dispositions. Click Regenerate to build them from existing data.'}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-6">
          {grouped.map(([subsectionKey, groupEntries]) => (
            <Card key={subsectionKey}>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">
                  {subsectionKey} — {subsectionLabel(subsectionKey)}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Entry #</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Quarter</TableHead>
                      <TableHead>Trigger</TableHead>
                      <TableHead>Lines</TableHead>
                      <TableHead>Type</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groupEntries.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell className="font-medium">{entry.entryNumber}</TableCell>
                        <TableCell>{formatDate(entry.entryDate)}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {entry.quarter != null ? `Q${entry.quarter}` : '—'}
                        </TableCell>
                        <TableCell>{entry.triggerEvent}</TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            {entry.lines.map((line) => (
                              <div key={line.lineOrder} className="text-sm">
                                {Number(line.debit) > 0 && (
                                  <span className="text-blue-700">
                                    Dr. {line.accountName} {formatPeso(line.debit)}
                                  </span>
                                )}
                                {Number(line.credit) > 0 && (
                                  <span className="text-green-700">
                                    Cr. {line.accountName} {formatPeso(line.credit)}
                                  </span>
                                )}
                                {Number(line.debit) === 0 && Number(line.credit) === 0 && (
                                  <span className="text-gray-600">
                                    {line.accountName} (memo)
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className={entryColor(entry)}>
                            {entry.isMemo ? 'Memo' : 'Journal'}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
