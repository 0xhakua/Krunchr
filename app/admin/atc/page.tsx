'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

interface ATCCode {
  code: string
  description: string
  ewtRate: string
  isActive: boolean
  createdAt: string
  updatedAt: string
  usageCount?: number
  taxpayerCount?: number
  certificateCount?: number
}

type DraftState = {
  description: string
  ewtRate: string
  isActive: boolean
}

export default function AdminAtcPage() {
  const [codes, setCodes] = useState<ATCCode[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  // Filter state
  const [query, setQuery] = useState('')
  const [includeInactive, setIncludeInactive] = useState(false)

  // Create-form state
  const [code, setCode] = useState('')
  const [description, setDescription] = useState('')
  const [ewtRate, setEwtRate] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)

  // Inline edit state
  const [editingCode, setEditingCode] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftState | null>(null)
  const [saving, setSaving] = useState(false)
  const [toggling, setToggling] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  async function loadCodes(opts?: { q?: string; includeInactive?: boolean }) {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      const q = opts?.q ?? query
      const ii = opts?.includeInactive ?? includeInactive
      if (q) params.set('q', q)
      if (ii) params.set('includeInactive', 'true')
      const res = await fetch(`/api/admin/atc?${params.toString()}`)
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to load ATC codes')
        return
      }
      setCodes(data.codes ?? [])
    } catch {
      setError('Failed to load ATC codes')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void (async () => {
      await loadCodes()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const handle = setTimeout(() => {
      void (async () => {
        await loadCodes()
      })()
    }, 200)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, includeInactive])

  function resetCreateForm() {
    setCode('')
    setDescription('')
    setEwtRate('')
    setIsActive(true)
  }

  function startCreate() {
    resetCreateForm()
    setDialogOpen(true)
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setMessage('')

    try {
      const res = await fetch('/api/admin/atc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, description, ewtRate, isActive }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to create ATC code')
        return
      }
      setMessage(`ATC code ${data.code.code} created.`)
      resetCreateForm()
      setDialogOpen(false)
      await loadCodes()
    } catch {
      setError('Failed to create ATC code')
    }
  }

  function startEdit(atc: ATCCode) {
    setEditingCode(atc.code)
    setDraft({
      description: atc.description,
      ewtRate: atc.ewtRate,
      isActive: atc.isActive,
    })
  }

  function cancelEdit() {
    setEditingCode(null)
    setDraft(null)
  }

  async function saveEdit(code: string) {
    if (!draft) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const res = await fetch('/api/admin/atc', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, ...draft }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to update ATC code')
        return
      }
      setMessage(`ATC code ${code} updated.`)
      cancelEdit()
      await loadCodes()
    } catch {
      setError('Failed to update ATC code')
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(atc: ATCCode) {
    setToggling(atc.code)
    setError('')
    setMessage('')
    try {
      const res = await fetch('/api/admin/atc', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: atc.code, isActive: !atc.isActive }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to toggle ATC code')
        return
      }
      setMessage(`ATC code ${atc.code} ${!atc.isActive ? 'activated' : 'deactivated'}.`)
      await loadCodes()
    } catch {
      setError('Failed to toggle ATC code')
    } finally {
      setToggling(null)
    }
  }

  async function handleDelete(atc: ATCCode) {
    if (!confirm(`Delete ATC code ${atc.code}? This is only allowed if no records reference it.`)) {
      return
    }
    setDeleting(atc.code)
    setError('')
    setMessage('')
    try {
      const res = await fetch('/api/admin/atc', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: atc.code }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to delete ATC code')
        return
      }
      setMessage(`ATC code ${atc.code} deleted.`)
      await loadCodes()
    } catch {
      setError('Failed to delete ATC code')
    } finally {
      setDeleting(null)
    }
  }

  const visibleCodes = useMemo(() => codes, [codes])

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">ATC Codes</h1>
          <p className="text-muted-foreground">
            Manage Alphanumeric Tax Codes and withholding rates.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin">
            <Button variant="outline">← Back to Admin</Button>
          </Link>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger>
              <Button onClick={startCreate}>Add ATC Code</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add ATC Code</DialogTitle>
                <DialogDescription>
                  Create a new ATC code for taxpayers to select.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="newCode">ATC Code</Label>
                  <Input
                    id="newCode"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    placeholder="WI071"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="newDescription">Description</Label>
                  <Input
                    id="newDescription"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Insurance Agents & Adjusters"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="newEwtRate">EWT Rate (decimal)</Label>
                  <Input
                    id="newEwtRate"
                    value={ewtRate}
                    onChange={(e) => setEwtRate(e.target.value)}
                    placeholder="0.10"
                    pattern="^\d+(\.\d{1,4})?$"
                    required
                  />
                  <p className="text-xs text-muted-foreground">Example: 0.10 for 10%, 0.15 for 15%</p>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="newIsActive"
                    checked={isActive}
                    onCheckedChange={(checked) => setIsActive(checked === true)}
                  />
                  <Label htmlFor="newIsActive">Active</Label>
                </div>
                {error && <p className="text-sm text-red-600">{error}</p>}
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      resetCreateForm()
                      setDialogOpen(false)
                    }}
                  >
                    Cancel
                  </Button>
                  <Button type="submit">Create</Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
        <div className="flex-1 space-y-1">
          <Label htmlFor="atcFilter">Search</Label>
          <Input
            id="atcFilter"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by code or description"
          />
        </div>
        <div className="flex items-center gap-2 pb-1">
          <Checkbox
            id="includeInactive"
            checked={includeInactive}
            onCheckedChange={(checked) => setIncludeInactive(checked === true)}
          />
          <Label htmlFor="includeInactive">Show inactive</Label>
        </div>
        <p className="text-xs text-muted-foreground sm:ml-2">
          {visibleCodes.length} of {visibleCodes.length}
        </p>
      </div>

      {message && <p className="text-sm text-green-600">{message}</p>}
      {!message && error && <p className="text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="text-muted-foreground">Loading ATC codes…</p>
      ) : visibleCodes.length === 0 ? (
        <p className="text-muted-foreground">
          {query || includeInactive
            ? 'No ATC codes match the current filter.'
            : 'No ATC codes found.'}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>EWT Rate</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Usage</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleCodes.map((atc) => {
              const isEditing = editingCode === atc.code
              return (
                <TableRow key={atc.code} className={isEditing ? 'bg-muted/40' : undefined}>
                  <TableCell className="font-medium">{atc.code}</TableCell>
                  <TableCell>
                    {isEditing && draft ? (
                      <Input
                        value={draft.description}
                        onChange={(e) =>
                          setDraft({ ...draft, description: e.target.value })
                        }
                      />
                    ) : (
                      atc.description
                    )}
                  </TableCell>
                  <TableCell>
                    {isEditing && draft ? (
                      <Input
                        value={draft.ewtRate}
                        onChange={(e) => setDraft({ ...draft, ewtRate: e.target.value })}
                        pattern="^\d+(\.\d{1,4})?$"
                      />
                    ) : (
                      Number(atc.ewtRate).toFixed(4)
                    )}
                  </TableCell>
                  <TableCell>
                    {isEditing && draft ? (
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={`edit-active-${atc.code}`}
                          checked={draft.isActive}
                          onCheckedChange={(checked) =>
                            setDraft({ ...draft, isActive: checked === true })
                          }
                        />
                        <Label htmlFor={`edit-active-${atc.code}`}>Active</Label>
                      </div>
                    ) : atc.isActive ? (
                      <Badge className="bg-green-100 text-green-800">Active</Badge>
                    ) : (
                      <Badge className="bg-gray-100 text-gray-800">Inactive</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">
                    {atc.usageCount ?? 0}
                    <span className="ml-1 text-xs">
                      ({atc.taxpayerCount ?? 0} tax / {atc.certificateCount ?? 0} cert)
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    {isEditing ? (
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={cancelEdit}
                          disabled={saving}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => saveEdit(atc.code)}
                          disabled={saving}
                        >
                          {saving ? 'Saving…' : 'Save'}
                        </Button>
                      </div>
                    ) : (
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => startEdit(atc)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleActive(atc)}
                          disabled={toggling === atc.code}
                        >
                          {toggling === atc.code
                            ? '…'
                            : atc.isActive
                              ? 'Deactivate'
                              : 'Reactivate'}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDelete(atc)}
                          disabled={deleting === atc.code || (atc.usageCount ?? 0) > 0}
                          title={
                            (atc.usageCount ?? 0) > 0
                              ? 'Cannot delete: code is in use. Deactivate instead.'
                              : undefined
                          }
                        >
                          {deleting === atc.code ? '…' : 'Delete'}
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
