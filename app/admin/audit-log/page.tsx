'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
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
import { EmptyState } from '@/components/ui/empty-state'

interface AuditLogEntry {
  id: string
  userId: string
  username: string
  action: string
  entityType: string | null
  entityId: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
}

interface AuditLogFilters {
  userId: string | null
  username: string | null
  action: string | null
  entityType: string | null
  entityId: string | null
  from: string | null
  to: string | null
  limit: number
}

interface AuditLogOptions {
  users: { id: string; username: string; role: 'ADMIN' | 'TAXPAYER' }[]
  actions: string[]
  entityTypes: string[]
}

const LIMIT_OPTIONS = [100, 250, 500, 1000]
const UNFILTERED: AuditLogFilters = {
  userId: null,
  username: null,
  action: null,
  entityType: null,
  entityId: null,
  from: null,
  to: null,
  limit: 500,
}

function toDateInputValue(value: string | null): string {
  if (!value) return ''
  // datetime-local needs YYYY-MM-DDTHH:MM
  return new Date(value).toISOString().slice(0, 16)
}

function fromDateInputValue(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

function buildAuditLogUrl(filters: AuditLogFilters): string {
  const params = new URLSearchParams()
  if (filters.userId) params.set('userId', filters.userId)
  if (filters.username) params.set('username', filters.username)
  if (filters.action) params.set('action', filters.action)
  if (filters.entityType) params.set('entityType', filters.entityType)
  if (filters.entityId) params.set('entityId', filters.entityId)
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  params.set('limit', String(filters.limit))
  return `/api/admin/audit-log?${params.toString()}`
}

function filtersEqual(a: AuditLogFilters, b: AuditLogFilters): boolean {
  return (
    a.userId === b.userId &&
    a.username === b.username &&
    a.action === b.action &&
    a.entityType === b.entityType &&
    a.entityId === b.entityId &&
    a.from === b.from &&
    a.to === b.to &&
    a.limit === b.limit
  )
}

export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([])
  const [options, setOptions] = useState<AuditLogOptions>({
    users: [],
    actions: [],
    entityTypes: [],
  })
  const [filters, setFilters] = useState<AuditLogFilters>(UNFILTERED)
  const [pendingFilters, setPendingFilters] = useState<AuditLogFilters>(UNFILTERED)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (filtersEqual(filters, pendingFilters)) return
    const controller = new AbortController()
    void (async () => {
      setLoading(true)
      setError('')
      try {
        const res = await fetch(buildAuditLogUrl(pendingFilters), {
          signal: controller.signal,
        })
        const data = await res.json()
        if (controller.signal.aborted) return
        if (!res.ok) {
          setError(data.error || 'Failed to load audit log')
          return
        }
        setLogs(data.logs ?? [])
        setOptions(data.options ?? { users: [], actions: [], entityTypes: [] })
        setFilters(pendingFilters)
      } catch (err) {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : 'Failed to load audit log')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFilters])

  const hasActiveFilter = useMemo(
    () =>
      Boolean(
        pendingFilters.userId ||
          pendingFilters.username ||
          pendingFilters.action ||
          pendingFilters.entityType ||
          pendingFilters.entityId ||
          pendingFilters.from ||
          pendingFilters.to
      ),
    [pendingFilters]
  )

  function applyFilters() {
    setPendingFilters((prev) => ({ ...prev }))
  }

  function clearFilters() {
    setPendingFilters({ ...UNFILTERED, limit: pendingFilters.limit })
  }

  function buildExportUrl(f: AuditLogFilters): string {
    const params = new URLSearchParams()
    if (f.userId) params.set('userId', f.userId)
    if (f.username) params.set('username', f.username)
    if (f.action) params.set('action', f.action)
    if (f.entityType) params.set('entityType', f.entityType)
    if (f.entityId) params.set('entityId', f.entityId)
    if (f.from) params.set('from', f.from)
    if (f.to) params.set('to', f.to)
    return `/api/admin/audit-log/export?${params.toString()}`
  }

  function exportCsv() {
    if (typeof window === 'undefined') return
    window.open(buildExportUrl(filters), '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Audit Log</h1>
          <p className="text-muted-foreground">
            System audit trail for elections, filings, and Stellar anchors.
          </p>
        </div>
        <Link href="/admin">
          <Button variant="outline">← Back to Admin</Button>
        </Link>
      </div>

      <div className="rounded-md border bg-muted/20 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              User
            </label>
            <Select
              value={pendingFilters.userId ?? '__ALL__'}
              onValueChange={(value) => {
                setPendingFilters((prev) => ({
                  ...prev,
                  userId: value === '__ALL__' ? null : value,
                  username: null,
                }))
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="All users" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__ALL__">All users</SelectItem>
                {options.users.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.username} ({user.role.toLowerCase()})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Actor (username)
            </label>
            <Input
              type="text"
              value={pendingFilters.username ?? ''}
              placeholder="e.g. admin"
              onChange={(e) =>
                setPendingFilters((prev) => ({
                  ...prev,
                  username: e.target.value || null,
                  userId: e.target.value ? null : prev.userId,
                }))
              }
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Action contains
            </label>
            <Select
              value={pendingFilters.action ?? '__ALL__'}
              onValueChange={(value) =>
                setPendingFilters((prev) => ({
                  ...prev,
                  action: value === '__ALL__' ? null : value,
                }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Any action" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__ALL__">Any action</SelectItem>
                {options.actions.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Entity type
            </label>
            <Select
              value={pendingFilters.entityType ?? '__ALL__'}
              onValueChange={(value) =>
                setPendingFilters((prev) => ({
                  ...prev,
                  entityType: value === '__ALL__' ? null : value,
                }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Any entity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__ALL__">Any entity</SelectItem>
                {options.entityTypes.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Entity ID
            </label>
            <Input
              type="text"
              value={pendingFilters.entityId ?? ''}
              placeholder="Exact entity ID"
              onChange={(e) =>
                setPendingFilters((prev) => ({
                  ...prev,
                  entityId: e.target.value || null,
                }))
              }
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              From
            </label>
            <Input
              type="datetime-local"
              value={toDateInputValue(pendingFilters.from)}
              onChange={(e) =>
                setPendingFilters((prev) => ({
                  ...prev,
                  from: fromDateInputValue(e.target.value),
                }))
              }
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              To
            </label>
            <Input
              type="datetime-local"
              value={toDateInputValue(pendingFilters.to)}
              onChange={(e) =>
                setPendingFilters((prev) => ({
                  ...prev,
                  to: fromDateInputValue(e.target.value),
                }))
              }
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Limit
            </label>
            <Select
              value={String(pendingFilters.limit)}
              onValueChange={(value) =>
                setPendingFilters((prev) => ({ ...prev, limit: Number(value) }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LIMIT_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n} entries
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={applyFilters} disabled={loading}>
            {loading ? 'Filtering…' : 'Apply filters'}
          </Button>
          {hasActiveFilter && (
            <Button variant="ghost" onClick={clearFilters}>
              Clear filters
            </Button>
          )}
          <Button
            variant="outline"
            onClick={exportCsv}
            disabled={logs.length === 0}
            title="Download the current filter as CSV"
          >
            Export CSV
          </Button>
          <span className="ml-auto self-center text-xs text-muted-foreground">
            Showing {logs.length} entr{logs.length === 1 ? 'y' : 'ies'}
          </span>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading ? null : logs.length === 0 ? (
        <EmptyState
          title="No audit log entries match"
          description="Try adjusting the filters or export the current view once events are recorded."
          actions={
            hasActiveFilter && (
              <Button variant="ghost" onClick={clearFilters}>Clear filters</Button>
            )
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead>Metadata</TableHead>
            </TableRow>
          </TableHeader>
            <TableBody>
              {logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell>
                    {new Date(log.createdAt).toLocaleString('en-PH')}
                  </TableCell>
                  <TableCell>{log.username}</TableCell>
                  <TableCell>
                    {log.action}
                    {log.action === 'ELECTION_CONFIRMED' && log.metadata && (
                      <span className="ml-2 text-xs font-medium text-muted-foreground">
                        (
                        {(log.metadata as { electedRate?: string }).electedRate ?? 'no-rate'}
                        )
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {log.entityType ? `${log.entityType} (${log.entityId ?? '—'})` : '—'}
                  </TableCell>
                  <TableCell className="max-w-md truncate font-mono text-xs">
                    {log.metadata ? JSON.stringify(log.metadata) : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
        </Table>
      )}
    </div>
  )
}
