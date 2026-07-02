'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EmptyState } from '@/components/ui/empty-state'
import { AdminSkeleton } from '../loading'

interface RDOPenaltySchedule {
  id: string
  rdoCode: string
  compromiseFee: string
  updatedAt: string
}

interface NewRow {
  rdoCode: string
  compromiseFee: string
}

const EMPTY_NEW: NewRow = { rdoCode: '', compromiseFee: '' }

export default function AdminRdoPenaltiesPage() {
  const [schedules, setSchedules] = useState<RDOPenaltySchedule[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [saving, setSaving] = useState(false)

  const [newRow, setNewRow] = useState<NewRow>(EMPTY_NEW)
  const [adding, setAdding] = useState(false)
  const [showAddRow, setShowAddRow] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function loadSchedules() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/rdo-penalties')
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to load RDO penalty schedules')
        return
      }
      setSchedules(data.schedules ?? [])
    } catch {
      setError('Failed to load RDO penalty schedules')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void (async () => {
      await loadSchedules()
    })()
  }, [])

  function startEdit(schedule: RDOPenaltySchedule) {
    setEditingId(schedule.id)
    setEditValue(schedule.compromiseFee)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditValue('')
  }

  async function saveEdit(id: string) {
    if (!editValue) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const res = await fetch('/api/admin/rdo-penalties', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, compromiseFee: editValue }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to update RDO schedule')
        return
      }
      setMessage(`RDO schedule updated.`)
      cancelEdit()
      await loadSchedules()
    } catch {
      setError('Failed to update RDO schedule')
    } finally {
      setSaving(false)
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!newRow.rdoCode || !newRow.compromiseFee) return
    setAdding(true)
    setError('')
    setMessage('')
    try {
      const res = await fetch('/api/admin/rdo-penalties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rdoCode: newRow.rdoCode,
          compromiseFee: newRow.compromiseFee,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to add RDO schedule')
        return
      }
      setMessage(`RDO schedule saved.`)
      setNewRow(EMPTY_NEW)
      setShowAddRow(false)
      await loadSchedules()
    } catch {
      setError('Failed to add RDO schedule')
    } finally {
      setAdding(false)
    }
  }

  async function handleDelete(schedule: RDOPenaltySchedule) {
    if (
      !confirm(
        `Delete RDO ${schedule.rdoCode}? Taxpayers in this RDO will fall back to the default compromise fee.`
      )
    ) {
      return
    }
    setDeletingId(schedule.id)
    setError('')
    setMessage('')
    try {
      const res = await fetch('/api/admin/rdo-penalties', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: schedule.id }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to delete RDO schedule')
        return
      }
      setMessage(`RDO ${schedule.rdoCode} removed.`)
      await loadSchedules()
    } catch {
      setError('Failed to delete RDO schedule')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">RDO Penalty Schedule</h1>
          <p className="text-muted-foreground">
            Compromise penalty amount per RDO for late-filed returns.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin">
            <Button variant="outline">← Back to Admin</Button>
          </Link>
          {!showAddRow && (
            <Button onClick={() => setShowAddRow(true)}>Add RDO</Button>
          )}
        </div>
      </div>

      {message && <p className="text-sm text-green-600">{message}</p>}
      {!message && error && <p className="text-sm text-red-600">{error}</p>}

      {showAddRow && (
        <form
          onSubmit={handleAdd}
          className="rounded-md border bg-muted/20 p-4 space-y-3"
        >
          <h2 className="text-base font-semibold">Add a new RDO</h2>
          <div className="grid gap-3 sm:grid-cols-3 items-end">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="newRdoCode">
                RDO Code
              </label>
              <Input
                id="newRdoCode"
                value={newRow.rdoCode}
                onChange={(e) => setNewRow({ ...newRow, rdoCode: e.target.value.toUpperCase() })}
                placeholder="e.g. 039"
                required
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="newFee">
                Compromise Fee (₱)
              </label>
              <div className="flex gap-2">
                <Input
                  id="newFee"
                  value={newRow.compromiseFee}
                  onChange={(e) => setNewRow({ ...newRow, compromiseFee: e.target.value })}
                  placeholder="500.00"
                  pattern="^\d+(\.\d{1,2})?$"
                  required
                />
                <Button type="submit" disabled={adding}>
                  {adding ? 'Saving…' : 'Save'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setNewRow(EMPTY_NEW)
                    setShowAddRow(false)
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </form>
      )}

      {loading ? (
        <AdminSkeleton />
      ) : schedules.length === 0 ? (
        <EmptyState
          title="No RDO penalty schedules configured"
          description="Add a schedule to override the default compromise fee for a specific RDO."
          actions={
            !showAddRow && (
              <Button onClick={() => setShowAddRow(true)}>Add RDO</Button>
            )
          }
        />
      ) : (
        <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>RDO Code</TableHead>
              <TableHead>Compromise Fee (₱)</TableHead>
              <TableHead>Last Updated</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {schedules.map((schedule) => {
              const isEditing = editingId === schedule.id
              return (
                <TableRow key={schedule.id} className={isEditing ? 'bg-muted/40' : undefined}>
                  <TableCell className="font-medium">{schedule.rdoCode}</TableCell>
                  <TableCell>
                    {isEditing ? (
                      <div className="flex items-center gap-2">
                        <span>₱</span>
                        <Input
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          pattern="^\d+(\.\d{1,2})?$"
                          className="max-w-[160px]"
                          autoFocus
                        />
                        <Button
                          size="sm"
                          onClick={() => saveEdit(schedule.id)}
                          disabled={saving || !editValue}
                        >
                          {saving ? 'Saving…' : 'Save'}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={cancelEdit}
                          disabled={saving}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <span>
                        ₱
                        {Number(schedule.compromiseFee).toLocaleString('en-PH', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {new Date(schedule.updatedAt).toLocaleDateString('en-PH')}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {!isEditing && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => startEdit(schedule)}
                        >
                          Edit
                        </Button>
                      )}
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDelete(schedule)}
                        disabled={deletingId === schedule.id}
                      >
                        {deletingId === schedule.id ? '…' : 'Delete'}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        </div>
      )}
    </div>
  )
}
