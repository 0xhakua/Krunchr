'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { AdminSkeleton } from '../loading'

interface SystemHealth {
  ok: boolean
  stellar: {
    ok: boolean
    network: string
    horizonUrl: string
    reachable: boolean
    configured: boolean
    latencyMs: number | null
    message: string
  }
  storage: {
    ok: boolean
    type: string
    path: string
    writable: boolean
    freeBytes: number | null
    totalBytes: number | null
    message: string
  }
  database: {
    ok: boolean
    message: string
    migrations: { applied: number; pending: number; status: 'ok' | 'pending' | 'unknown' } | null
  }
  checkedAt: string
}

const STATUS_BG = {
  ok: 'bg-green-100 text-green-800',
  warn: 'bg-amber-100 text-amber-800',
  bad: 'bg-red-100 text-red-800',
}

function badgeFor(ok: boolean, warnOnly = false) {
  if (ok) return <Badge className={STATUS_BG.ok}>OK</Badge>
  if (warnOnly) return <Badge className={STATUS_BG.warn}>Warning</Badge>
  return <Badge className={STATUS_BG.bad}>Down</Badge>
}

function formatBytes(bytes: number | null): string {
  if (bytes === null || Number.isNaN(bytes)) return 'n/a'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let n = bytes / 1024
  let unitIndex = 0
  while (n >= 1024 && unitIndex < units.length - 1) {
    n /= 1024
    unitIndex++
  }
  return `${n.toFixed(2)} ${units[unitIndex]}`
}

function formatLatency(ms: number | null): string {
  if (ms === null) return 'n/a'
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

function formatCheckedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-PH')
  } catch {
    return iso
  }
}

const REFRESH_MS = 30_000

export default function SystemHealthPage() {
  const [health, setHealth] = useState<SystemHealth | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [lastAutoRefreshAt, setLastAutoRefreshAt] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const aliveRef = useRef(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/system-health', { cache: 'no-store' })
      const data = await res.json()
      if (!aliveRef.current) return
      if (!res.ok) {
        setError(data.error || 'Failed to load system health')
        return
      }
      setHealth(data)
    } catch (err) {
      if (!aliveRef.current) return
      setError(err instanceof Error ? err.message : 'Failed to load system health')
    } finally {
      if (aliveRef.current) setLoading(false)
    }
  }, [])

  const scheduleAutoRefreshRef = useRef<() => void>(() => {})

  const scheduleAutoRefresh = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      void (async () => {
        await load()
        setLastAutoRefreshAt(new Date().toISOString())
        scheduleAutoRefreshRef.current()
      })()
    }, REFRESH_MS)
  }, [load])

  useEffect(() => {
    scheduleAutoRefreshRef.current = scheduleAutoRefresh
  }, [scheduleAutoRefresh])

  useEffect(() => {
    aliveRef.current = true
    void (async () => {
      await load()
      if (!aliveRef.current) return
      setLastAutoRefreshAt(new Date().toISOString())
      scheduleAutoRefresh()
    })()
    return () => {
      aliveRef.current = false
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [load, scheduleAutoRefresh])

  return (
    <PageShell>
      <PageHeader
        title="System Health"
        description={
          <>
            Stellar Horizon, storage backend, and database reachability. Auto-refreshes
            every {REFRESH_MS / 1000}s.
          </>
        }
        actions={
          <div className="flex items-center gap-2">
            <Link href="/admin">
              <Button variant="outline">← Back to Admin</Button>
            </Link>
            <Button variant="outline" onClick={load} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh now'}
            </Button>
          </div>
        }
      />

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          <strong>Error:</strong> {error}
        </div>
      )}

      {loading ? (
        <AdminSkeleton />
      ) : health ? (
        <>
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Overall</CardTitle>
                {badgeFor(health.ok)}
              </div>
              <CardDescription>
                Last checked {formatCheckedAt(health.checkedAt)}
                {lastAutoRefreshAt && lastAutoRefreshAt !== health.checkedAt && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    (auto-refresh scheduled)
                  </span>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {health.ok
                  ? 'All subsystems are healthy.'
                  : 'One or more subsystems are degraded. See the details below.'}
              </p>
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Stellar</CardTitle>
                  {badgeFor(health.stellar.ok, !health.stellar.configured)}
                </div>
                <CardDescription>Anchoring endpoint</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Row label="Network" value={health.stellar.network} />
                <Row label="Horizon URL" value={health.stellar.horizonUrl} />
                <Row
                  label="Reachable"
                  value={health.stellar.reachable ? 'Yes' : 'No'}
                />
                <Row
                  label="Latency"
                  value={formatLatency(health.stellar.latencyMs)}
                />
                <Row
                  label="Signing key configured"
                  value={health.stellar.configured ? 'Yes' : 'No'}
                />
                <Row label="Message" value={health.stellar.message} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Storage</CardTitle>
                  {badgeFor(health.storage.ok)}
                </div>
                <CardDescription>PDF / filing package backend</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Row label="Type" value={health.storage.type} />
                <Row label="Path" value={health.storage.path} />
                <Row
                  label="Free space"
                  value={formatBytes(health.storage.freeBytes)}
                />
                <Row
                  label="Total size"
                  value={formatBytes(health.storage.totalBytes)}
                />
                <Row
                  label="Writable"
                  value={health.storage.writable ? 'Yes' : 'No'}
                />
                <Row label="Message" value={health.storage.message} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Database</CardTitle>
                  {badgeFor(health.database.ok)}
                </div>
                <CardDescription>PostgreSQL via Prisma</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Row
                  label="Status"
                  value={health.database.ok ? 'Reachable' : 'Down'}
                />
                <Row
                  label="Migrations"
                  value={
                    health.database.migrations
                      ? `${health.database.migrations.applied} applied` +
                        (health.database.migrations.pending > 0
                          ? `, ${health.database.migrations.pending} pending`
                          : '') +
                        (health.database.migrations.status === 'unknown'
                          ? ' (status unknown)'
                          : '')
                      : 'n/a'
                  }
                />
                <Row label="Message" value={health.database.message} />
              </CardContent>
            </Card>
          </div>
        </>
      ) : (
        <EmptyState
          title="No health data"
          description="System health checks Stellar, storage, and database status. Click Refresh now to run a check."
          actions={
            <Button variant="outline" onClick={load} disabled={loading}>
              Refresh now
            </Button>
          }
        />
      )}
    </PageShell>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="font-mono text-sm break-all">{value}</span>
    </div>
  )
}
