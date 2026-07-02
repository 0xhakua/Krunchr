'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { AdminSkeleton } from './loading'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface AdminUser {
  id: string
  username: string
  role: 'ADMIN' | 'TAXPAYER'
  isActive: boolean
  createdAt: string
  taxpayer: {
    tin: string
    fullName: string
    rdoCode: string
    incomeType: string
    corIncludes2551Q: boolean
  } | null
}

interface SystemHealthSummary {
  ok: boolean
  stellar: { ok: boolean; network: string; reachable: boolean; message: string }
  storage: { ok: boolean; type: string; writable: boolean; message: string }
  database: { ok: boolean; message: string }
}

interface ResetResult {
  userId: string
  username: string
  tempPassword: string
  message: string
}

export default function AdminPage() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [health, setHealth] = useState<SystemHealthSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [resetResult, setResetResult] = useState<ResetResult | null>(null)
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadUsers() {
      setLoading(true)
      try {
        const res = await fetch('/api/admin/users')
        const data = await res.json()
        if (cancelled) return
        if (!res.ok) {
          setError(data.error || 'Failed to load users')
          return
        }
        setUsers(data.users ?? [])
      } catch {
        if (!cancelled) setError('Failed to load users')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    async function loadHealth() {
      try {
        const res = await fetch('/api/admin/system-health')
        const data = await res.json()
        if (cancelled) return
        if (res.ok) {
          setHealth({
            ok: data.ok,
            stellar: data.stellar,
            storage: data.storage,
            database: data.database,
          })
        }
      } catch {
        /* leave health null on transient network errors */
      }
    }

    loadUsers()
    loadHealth()
    return () => {
      cancelled = true
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
    }
  }, [])

  const fetchUsers = async (q = '') => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/admin/users?q=${encodeURIComponent(q)}`)
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to load users')
        return
      }
      setUsers(data.users ?? [])
    } catch {
      setError('Failed to load users')
    } finally {
      setLoading(false)
    }
  }

  const handleSearchChange = (value: string) => {
    setSearch(value)
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }
    searchTimeoutRef.current = setTimeout(() => {
      void fetchUsers(value)
    }, 250)
  }

  const toggleActive = async (user: AdminUser) => {
    setActionLoading(user.id)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, isActive: !user.isActive }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to update user')
        return
      }
      setUsers((prev) =>
        prev.map((u) => (u.id === data.user.id ? { ...u, ...data.user } : u))
      )
    } catch {
      setError('Failed to update user')
    } finally {
      setActionLoading(null)
    }
  }

  const resetPassword = async (user: AdminUser) => {
    setActionLoading(user.id)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to reset password')
        return
      }
      setResetResult(data)
    } catch {
      setError('Failed to reset password')
    } finally {
      setActionLoading(null)
    }
  }

  const healthBadge = (ok: boolean) =>
    ok ? (
      <Badge className="bg-green-100 text-green-800">OK</Badge>
    ) : (
      <Badge className="bg-red-100 text-red-800">Degraded</Badge>
    )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Admin Panel</h1>
          <p className="text-muted-foreground">Manage taxpayers and system activity.</p>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Link href="/admin/audit-log">
          <Card className="hover:bg-muted/50 transition-colors h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Audit Log</CardTitle>
              <CardDescription>System activity trail</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" size="sm">View</Button>
            </CardContent>
          </Card>
        </Link>
        <Link href="/admin/atc">
          <Card className="hover:bg-muted/50 transition-colors h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">ATC Codes</CardTitle>
              <CardDescription>Withholding tax codes</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" size="sm">Manage</Button>
            </CardContent>
          </Card>
        </Link>
        <Link href="/admin/holidays">
          <Card className="hover:bg-muted/50 transition-colors h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Holidays</CardTitle>
              <CardDescription>Deadline rolling calendar</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" size="sm">Manage</Button>
            </CardContent>
          </Card>
        </Link>
        <Link href="/admin/rdo-penalties">
          <Card className="hover:bg-muted/50 transition-colors h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">RDO Penalties</CardTitle>
              <CardDescription>Compromise fees by RDO</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" size="sm">Manage</Button>
            </CardContent>
          </Card>
        </Link>
        <Link href="/admin/system-health">
          <Card className="hover:bg-muted/50 transition-colors h-full">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">System Health</CardTitle>
                {health ? healthBadge(health.ok) : (
                  <Badge className="bg-muted text-muted-foreground">—</Badge>
                )}
              </div>
              <CardDescription>
                Stellar + storage status
              </CardDescription>
            </CardHeader>
            <CardContent>
              {health ? (
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Stellar</span>
                    {healthBadge(health.stellar.ok)}
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Storage</span>
                    {healthBadge(health.storage.ok)}
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Database</span>
                    {healthBadge(health.database.ok)}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Loading…</p>
              )}
            </CardContent>
          </Card>
        </Link>
      </div>

      <div className="flex items-center gap-2">
        <Input
          placeholder="Search by username, TIN, or name"
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="max-w-sm"
        />
      </div>

      {loading ? (
        <AdminSkeleton />
      ) : users.length === 0 ? (
        <EmptyState
          title="No users found"
          description="Taxpayer accounts will appear here once they complete onboarding."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Username</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>TIN</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>RDO</TableHead>
              <TableHead>Income Type</TableHead>
              <TableHead>COR 2551Q</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id} className={!user.isActive ? 'opacity-60' : undefined}>
                <TableCell>{user.username}</TableCell>
                <TableCell>
                  <Badge
                    className={
                      user.role === 'ADMIN'
                        ? 'bg-purple-100 text-purple-800'
                        : 'bg-blue-100 text-blue-800'
                    }
                  >
                    {user.role}
                  </Badge>
                </TableCell>
                <TableCell>
                  {user.isActive ? (
                    <Badge className="bg-green-100 text-green-800">Active</Badge>
                  ) : (
                    <Badge className="bg-red-100 text-red-800">Inactive</Badge>
                  )}
                </TableCell>
                <TableCell>{user.taxpayer?.tin ?? '—'}</TableCell>
                <TableCell>{user.taxpayer?.fullName ?? '—'}</TableCell>
                <TableCell>{user.taxpayer?.rdoCode ?? '—'}</TableCell>
                <TableCell>{user.taxpayer?.incomeType ?? '—'}</TableCell>
                <TableCell>
                  {user.taxpayer ? (user.taxpayer.corIncludes2551Q ? 'Yes' : 'No') : '—'}
                </TableCell>
                <TableCell>
                  {new Date(user.createdAt).toLocaleDateString('en-PH')}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={actionLoading === user.id}
                      onClick={() => toggleActive(user)}
                    >
                      {user.isActive ? 'Deactivate' : 'Activate'}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={actionLoading === user.id || !user.isActive}
                      onClick={() => resetPassword(user)}
                    >
                      Reset Password
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={!!resetResult} onOpenChange={(open) => !open && setResetResult(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Temporary Password Generated</DialogTitle>
            <DialogDescription>
              Share this password securely with {resetResult?.username}. They will be prompted to
              change it on next login.
            </DialogDescription>
          </DialogHeader>
          {resetResult && (
            <div className="space-y-4 py-4">
              <div className="rounded-md bg-muted p-4 font-mono text-sm break-all">
                {resetResult.tempPassword}
              </div>
              <Button
                onClick={() => {
                  void navigator.clipboard.writeText(resetResult.tempPassword)
                }}
                variant="outline"
                className="w-full"
              >
                Copy to clipboard
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
