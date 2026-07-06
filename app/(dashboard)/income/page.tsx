'use client'

import Decimal from 'decimal.js'
import { useEffect, useRef, useState } from 'react'
import { extractApiErrorMessage } from '@/lib/api-error'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { InfoTooltip } from '@/components/ui/info-tooltip'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { UploadCloud } from 'lucide-react'

type ATCCode = {
  code: string
  description: string
  ewtRate: number
}

type Certificate = {
  id: string
  quarter: number
  payorTin: string
  payorName: string
  atcCode: string
  atc: ATCCode
  month1Amount: string
  month2Amount: string
  month3Amount: string
  quarterlyTotal: string
  cwtWithheld: string
  cwtValidated: boolean
  cwtDiscrepancy: string | null
}

const emptyForm = {
  quarter: 1,
  payorTin: '',
  payorName: '',
  atcCode: '',
  month1Amount: '',
  month2Amount: '',
  month3Amount: '',
  cwtWithheld: '',
}

export default function IncomePage() {
  const [certificates, setCertificates] = useState<Certificate[]>([])
  const [atcCodes, setAtcCodes] = useState<ATCCode[]>([])
  const [totals, setTotals] = useState({
    totalGross: '0.00',
    totalCwt: '0.00',
    vatThreshold: '3000000',
    vatThresholdPercent: 0,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Certificate | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [importLoading, setImportLoading] = useState(false)
  const [importWarnings, setImportWarnings] = useState<string[]>([])
  const [activeTab, setActiveTab] = useState('manual')
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function loadData() {
    try {
      const [certsRes, atcRes, totalsRes] = await Promise.all([
        fetch('/api/income'),
        fetch('/api/atc'),
        fetch('/api/income/totals'),
      ])
      const certsData = await certsRes.json()
      const atcData = await atcRes.json()
      const totalsData = await totalsRes.json()
      setCertificates(certsData.certificates || [])
      setAtcCodes(atcData.codes || [])
      setTotals(totalsData)
    } catch {
      setError('Failed to load income data')
    }
  }

  useEffect(() => {
    let cancelled = false
    async function fetchData() {
      try {
        const [certsRes, atcRes, totalsRes] = await Promise.all([
          fetch('/api/income'),
          fetch('/api/atc'),
          fetch('/api/income/totals'),
        ])
        const certsData = await certsRes.json()
        const atcData = await atcRes.json()
        const totalsData = await totalsRes.json()
        if (!cancelled) {
          setCertificates(certsData.certificates || [])
          setAtcCodes(atcData.codes || [])
          setTotals(totalsData)
        }
      } catch {
        if (!cancelled) {
          setError('Failed to load income data')
        }
      }
    }
    fetchData()
    return () => {
      cancelled = true
    }
  }, [])

  function formatPeso(value: string | number) {
    return `₱${Number(value).toLocaleString('en-PH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`
  }

  function updateForm(field: string, value: string | number) {
    setForm((prev) => {
      const next = { ...prev, [field]: value }
      if (['atcCode', 'month1Amount', 'month2Amount', 'month3Amount'].includes(field)) {
        const atc = atcCodes.find((a) => a.code === next.atcCode)
        if (atc) {
          const total = new Decimal(String(next.month1Amount || 0))
            .plus(new Decimal(String(next.month2Amount || 0)))
            .plus(new Decimal(String(next.month3Amount || 0)))
          next.cwtWithheld = total.times(atc.ewtRate).toDecimalPlaces(2).toFixed(2)
        }
      }
      return next
    })
  }

  function fieldError(name: string): string | null {
    const arr = fieldErrors[name]
    return Array.isArray(arr) && arr.length > 0 ? arr[0] : null
  }

  function startEdit(cert: Certificate) {
    setEditing(cert)
    setForm({
      quarter: cert.quarter,
      payorTin: cert.payorTin,
      payorName: cert.payorName,
      atcCode: cert.atcCode,
      month1Amount: cert.month1Amount,
      month2Amount: cert.month2Amount,
      month3Amount: cert.month3Amount,
      cwtWithheld: cert.cwtWithheld,
    })
    setError('')
    setFieldErrors({})
    setActiveTab('manual')
    setOpen(true)
  }

  function startAdd() {
    setEditing(null)
    setForm(emptyForm)
    setError('')
    setFieldErrors({})
    setImportWarnings([])
    setActiveTab('manual')
    setOpen(true)
  }

  function startDuplicate(cert: Certificate) {
    setEditing(null)
    const nextQuarter = cert.quarter < 4 ? cert.quarter + 1 : cert.quarter
    const atc = atcCodes.find((a) => a.code === cert.atcCode)
    const total = new Decimal(String(cert.month1Amount || 0))
      .plus(new Decimal(String(cert.month2Amount || 0)))
      .plus(new Decimal(String(cert.month3Amount || 0)))
    const cwtWithheld = atc
      ? total.times(atc.ewtRate).toDecimalPlaces(2).toFixed(2)
      : cert.cwtWithheld
    setForm({
      quarter: nextQuarter,
      payorTin: cert.payorTin,
      payorName: cert.payorName,
      atcCode: cert.atcCode,
      month1Amount: cert.month1Amount,
      month2Amount: cert.month2Amount,
      month3Amount: cert.month3Amount,
      cwtWithheld,
    })
    setError('')
    setFieldErrors({})
    setImportWarnings([])
    setActiveTab('manual')
    setOpen(true)
  }

  async function processImportFile(file: File) {
    setImportLoading(true)
    setError('')
    setImportWarnings([])
    // Defence in depth: even though the server returns within ~60s, an
    // unexpected server stall (reverse proxy, slow OCR, etc.) would
    // otherwise trap the spinner forever. See issue #199.
    const IMPORT_TIMEOUT_MS = 70_000
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), IMPORT_TIMEOUT_MS)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/income/import', {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      })
      const data = await res.json()
      if (!res.ok) {
        setError(extractApiErrorMessage(data, 'Import failed'))
        return
      }
      const extracted = data.extracted as {
        payorTin?: string
        payorName?: string
        atcCode?: string
        quarter?: number
        month1Amount?: string
        month2Amount?: string
        month3Amount?: string
        cwtWithheld?: string
        warnings?: string[]
      }
      // OCR commonly drops a letter from a 2-letter ATC prefix
      // (e.g. "WI071" → "W071"). Fall back to a one-character-tolerance
      // match against the available codes so the dropdown still
      // populates instead of forcing the user to pick manually.
      const atc =
        atcCodes.find((a) => a.code === extracted.atcCode) ??
        atcCodes.find((a) =>
          a.code.length === (extracted.atcCode?.length ?? 0) + 1 &&
          [...a.code].some((_, i) => a.code.slice(0, i) + a.code.slice(i + 1) === extracted.atcCode)
        )
      const month1 = extracted.month1Amount || ''
      const month2 = extracted.month2Amount || ''
      const month3 = extracted.month3Amount || ''
      let cwtWithheld = extracted.cwtWithheld || ''
      if (!cwtWithheld && atc && month1 && month2 && month3) {
        const total = new Decimal(month1).plus(month2).plus(month3)
        cwtWithheld = total.times(atc.ewtRate).toDecimalPlaces(2).toFixed(2)
      }
      setForm({
        quarter: extracted.quarter || form.quarter,
        payorTin: extracted.payorTin || '',
        payorName: extracted.payorName || '',
        // Use the matched `atc.code` (the canonical value from the DB),
        // not the raw `extracted.atcCode` — the OCR commonly drops a
        // letter (e.g. "WI071" → "W071") and the server-side
        // `findUnique({ where: { code } })` rejects the raw form with
        // "Invalid or inactive ATC code" (issue #199 follow-up).
        atcCode: atc ? atc.code : '',
        month1Amount: month1,
        month2Amount: month2,
        month3Amount: month3,
        cwtWithheld,
      })
      setImportWarnings(extracted.warnings || [])
      setActiveTab('manual')
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setError(
          `Import is taking too long (>${IMPORT_TIMEOUT_MS / 1000}s). The server may be unavailable — please try a smaller or PDF version of the certificate.`
        )
      } else {
        setError('Import failed')
      }
    } finally {
      clearTimeout(timeoutId)
      setImportLoading(false)
    }
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) processImportFile(file)
    if (e.target) e.target.value = ''
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file) processImportFile(file)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setFieldErrors({})

    const payload = {
      ...form,
      month1Amount: Number(form.month1Amount),
      month2Amount: Number(form.month2Amount),
      month3Amount: Number(form.month3Amount),
      cwtWithheld: Number(form.cwtWithheld),
    }

    try {
      const url = editing ? `/api/income/${editing.id}` : '/api/income'
      const method = editing ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(extractApiErrorMessage(data, 'Failed to save certificate'))
        if (data && typeof data === 'object' && data.fieldErrors && typeof data.fieldErrors === 'object') {
          setFieldErrors(data.fieldErrors as Record<string, string[]>)
        }
        return
      }

      setOpen(false)
      await loadData()
    } catch {
      setError('Failed to save certificate')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this certificate?')) return
    try {
      const res = await fetch(`/api/income/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Failed to delete certificate')
        return
      }
      await loadData()
    } catch {
      setError('Failed to delete certificate')
    }
  }

  const grouped = certificates.reduce(
    (acc, cert) => {
      if (!acc[cert.quarter]) acc[cert.quarter] = []
      acc[cert.quarter].push(cert)
      return acc
    },
    {} as Record<number, Certificate[]>
  )

  const groupedByPayor = certificates.reduce(
    (acc, cert) => {
      if (!acc[cert.quarter]) acc[cert.quarter] = {}
      const payorKey = `${cert.payorTin}::${cert.payorName}`
      if (!acc[cert.quarter][payorKey]) {
        acc[cert.quarter][payorKey] = {
          payorName: cert.payorName,
          payorTin: cert.payorTin,
          certs: [],
        }
      }
      acc[cert.quarter][payorKey].certs.push(cert)
      return acc
    },
    {} as Record<
      number,
      Record<string, { payorName: string; payorTin: string; certs: Certificate[] }>
    >
  )

  const consolidatedRows = (() => {
    const map = new Map<
      string,
      { quarter: number; payorName: string; payorTin: string; atcCode: string; gross: number; cwt: number }
    >()
    for (const cert of certificates) {
      const key = `${cert.quarter}|${cert.payorTin}|${cert.payorName}|${cert.atcCode}`
      const existing = map.get(key)
      if (existing) {
        existing.gross += Number(cert.quarterlyTotal)
        existing.cwt += Number(cert.cwtWithheld)
      } else {
        map.set(key, {
          quarter: cert.quarter,
          payorName: cert.payorName,
          payorTin: cert.payorTin,
          atcCode: cert.atcCode,
          gross: Number(cert.quarterlyTotal),
          cwt: Number(cert.cwtWithheld),
        })
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.quarter !== b.quarter) return a.quarter - b.quarter
      const p = a.payorName.localeCompare(b.payorName)
      if (p !== 0) return p
      return a.atcCode.localeCompare(b.atcCode)
    })
  })()

  const certificateForm = (
    <form onSubmit={handleSubmit} className="space-y-4">
      {importWarnings.length > 0 && (
        <div className="space-y-1 rounded-md border border-amber-200 bg-amber-50 p-3">
          {importWarnings.map((warning, idx) => (
            <p key={idx} className="text-sm text-amber-700">
              {warning}
            </p>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="quarter">Quarter</Label>
          <Select
            value={String(form.quarter)}
            onValueChange={(v) => updateForm('quarter', Number(v))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4].map((q) => (
                <SelectItem key={q} value={String(q)}>Q{q}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {fieldError('quarter') && (
            <p className="text-sm text-red-600">{fieldError('quarter')}</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="atcCode">ATC Code</Label>
          <Select
            value={form.atcCode}
            onValueChange={(v) => v && updateForm('atcCode', v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select ATC" />
            </SelectTrigger>
            <SelectContent>
              {atcCodes.map((atc) => (
                <SelectItem key={atc.code} value={atc.code}>
                  {atc.code} — {atc.description}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {fieldError('atcCode') && (
            <p className="text-sm text-red-600">{fieldError('atcCode')}</p>
          )}
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="payorName">Payor Name</Label>
        <Input
          id="payorName"
          value={form.payorName}
          onChange={(e) => updateForm('payorName', e.target.value)}
          required
        />
        {fieldError('payorName') && (
          <p className="text-sm text-red-600">{fieldError('payorName')}</p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="payorTin">Payor TIN</Label>
        <Input
          id="payorTin"
          value={form.payorTin}
          onChange={(e) => updateForm('payorTin', e.target.value)}
          required
        />
        {fieldError('payorTin') && (
          <p className="text-sm text-red-600">{fieldError('payorTin')}</p>
        )}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {['month1Amount', 'month2Amount', 'month3Amount'].map((field, i) => (
          <div key={field} className="space-y-2">
            <Label htmlFor={field}>Month {i + 1}</Label>
            <Input
              id={field}
              type="number"
              step="0.01"
              value={field === 'month1Amount' ? form.month1Amount : field === 'month2Amount' ? form.month2Amount : form.month3Amount}
              onChange={(e) => updateForm(field, e.target.value)}
              required
            />
            {fieldError(field) && (
              <p className="text-sm text-red-600">{fieldError(field)}</p>
            )}
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <Label htmlFor="cwtWithheld">CWT Withheld</Label>
        <Input
          id="cwtWithheld"
          type="number"
          step="0.01"
          value={form.cwtWithheld}
          onChange={(e) => updateForm('cwtWithheld', e.target.value)}
          required
        />
        {fieldError('cwtWithheld') && (
          <p className="text-sm text-red-600">{fieldError('cwtWithheld')}</p>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? 'Saving...' : 'Save Certificate'}
      </Button>
    </form>
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Income (BIR Form 2307)</h1>
        <Button onClick={startAdd}>Add Certificate</Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{editing ? 'Edit Certificate' : form.quarter !== emptyForm.quarter || form.payorTin ? 'Add Certificate (pre-filled)' : 'Add Certificate'}</DialogTitle>
              <DialogDescription>
                {editing
                  ? 'Update quarterly 2307 details. CWT is validated against the ATC rate.'
                  : 'Enter quarterly 2307 details, import from a file, or duplicate an existing certificate. CWT is validated against the ATC rate.'}
              </DialogDescription>
            </DialogHeader>
            {editing ? (
              certificateForm
            ) : (
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="manual">Manual Entry</TabsTrigger>
                  <TabsTrigger value="import">Import File</TabsTrigger>
                </TabsList>
                <TabsContent value="manual">{certificateForm}</TabsContent>
                <TabsContent value="import">
                  <div className="space-y-4 pt-2">
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      onDrop={handleDrop}
                      onDragOver={handleDragOver}
                      role="button"
                      tabIndex={0}
                      aria-label="Upload certificate file"
                      className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-muted-foreground/25 p-8 transition-colors hover:border-muted-foreground/50 hover:bg-muted/50 cursor-pointer"
                    >
                      <UploadCloud className="h-10 w-10 text-muted-foreground" />
                      <div className="text-center">
                        <p className="text-sm font-medium">Drag and drop a file here</p>
                        <p className="text-xs text-muted-foreground">JPG, PNG, PDF, or DOCX up to 10 MB</p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click() }}
                      >
                        Browse files
                      </Button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".jpg,.jpeg,.png,.pdf,.docx"
                        onChange={handleImportFile}
                        className="hidden"
                      />
                    </div>
                    {importLoading && <p className="text-sm text-muted-foreground">Reading file...</p>}
                    {error && <p className="text-sm text-red-600">{error}</p>}
                  </div>
                </TabsContent>
              </Tabs>
            )}
          </DialogContent>
        </Dialog>
      </div>

      <p className="text-sm text-muted-foreground">
        Upload your BIR Form 2307 certificates (per payor, per quarter). Kuwenta uses these
        to compute tax due, apply CWT credits, and update your filing sequence automatically.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">YTD Gross Income</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatPeso(totals.totalGross)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">YTD CWT Withheld</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatPeso(totals.totalCwt)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-1.5">
              VAT Threshold
              <InfoTooltip side="top">
                Kuwenta supports non-VAT taxpayers. If your annual gross exceeds ₱3,000,000,
                you must register for VAT and the 8% option is no longer available.
              </InfoTooltip>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{totals.vatThresholdPercent.toFixed(1)}%</p>
            <p className="text-xs text-muted-foreground">of ₱{Number(totals.vatThreshold).toLocaleString()}</p>
          </CardContent>
        </Card>
      </div>

      {error && !open && <p className="text-sm text-red-600">{error}</p>}

      {[1, 2, 3, 4].map((quarter) => (
        <Card key={quarter}>
          <CardHeader>
            <CardTitle>Quarter {quarter}</CardTitle>
            <CardDescription>
              {grouped[quarter]?.length ?? 0} certificate(s) ·{' '}
              {Object.keys(groupedByPayor[quarter] ?? {}).length} payor(s)
            </CardDescription>
          </CardHeader>
          <CardContent>
            {grouped[quarter]?.length ? (
              <div className="space-y-6">
                {Object.entries(groupedByPayor[quarter] ?? {})
                  .sort(([, a], [, b]) => a.payorName.localeCompare(b.payorName))
                  .map(([payorKey, payorGroup]) => (
                    <div key={payorKey} className="space-y-2">
                      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-1">
                        <div>
                          <p className="font-medium">{payorGroup.payorName}</p>
                          <p className="text-xs text-muted-foreground">TIN {payorGroup.payorTin}</p>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {payorGroup.certs.length} certificate(s)
                        </p>
                      </div>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>ATC</TableHead>
                            <TableHead className="text-right">Gross</TableHead>
                            <TableHead className="text-right">CWT</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {payorGroup.certs.map((cert) => (
                            <TableRow key={cert.id}>
                              <TableCell>{cert.atcCode}</TableCell>
                              <TableCell className="text-right">{formatPeso(cert.quarterlyTotal)}</TableCell>
                              <TableCell className="text-right">{formatPeso(cert.cwtWithheld)}</TableCell>
                              <TableCell>
                                {cert.cwtValidated ? (
                                  <Badge variant="default">Validated</Badge>
                                ) : (
                                  <Badge variant="destructive">Mismatch</Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-right space-x-2">
                                <Button variant="outline" size="sm" onClick={() => startDuplicate(cert)}>
                                  Duplicate
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => startEdit(cert)}>
                                  Edit
                                </Button>
                                <Button variant="destructive" size="sm" onClick={handleDelete.bind(null, cert.id)}>
                                  Delete
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ))}
              </div>
            ) : (
              <EmptyState
                title={`No certificates for Quarter ${quarter}`}
                description="Add a BIR Form 2307 certificate to record income and CWT for this quarter."
                actions={
                  <Button onClick={startAdd}>Add Certificate</Button>
                }
                className="py-8"
              />
            )}
          </CardContent>
        </Card>
      ))}

      {/* Consolidated Income Summary */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <div>
            <CardTitle>Consolidated Income Summary</CardTitle>
            <CardDescription>
              One row per quarter × payor × ATC. Exportable as PDF (attachable to 1701A).
            </CardDescription>
          </div>
          <a
            href="/api/income/summary/export"
            target="_blank"
            rel="noreferrer"
            className="shrink-0"
          >
            <Button variant="outline" type="button">
              Export PDF
            </Button>
          </a>
        </CardHeader>
        <CardContent>
          {consolidatedRows.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[60px]">Q</TableHead>
                  <TableHead>Payor</TableHead>
                  <TableHead>ATC</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">CWT</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {consolidatedRows.map((row, idx) => (
                  <TableRow key={`${row.quarter}-${row.payorTin}-${row.atcCode}-${idx}`}>
                    <TableCell>Q{row.quarter}</TableCell>
                    <TableCell>
                      <div className="font-medium">{row.payorName}</div>
                      <div className="text-xs text-muted-foreground">{row.payorTin}</div>
                    </TableCell>
                    <TableCell>{row.atcCode}</TableCell>
                    <TableCell className="text-right">{formatPeso(row.gross)}</TableCell>
                    <TableCell className="text-right">{formatPeso(row.cwt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState
              title="No certificates on file"
              description="Once you add 2307 certificates, a consolidated income summary will appear here."
              actions={
                <Button onClick={startAdd}>Add Certificate</Button>
              }
              className="py-8"
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
