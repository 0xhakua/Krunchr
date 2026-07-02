'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState } from '@/components/ui/empty-state'
import { SawtSkeleton } from './loading'
import { FileDown, Package, ClipboardList, Copy, Check } from 'lucide-react'

type SawtRow = {
  quarter: number
  payorTin: string
  payorName: string
  atcCode: string
  gross: string
  cwt: string
}

type ReturnMeta = {
  id: string
  formType: string
  quarter: number | null
  label: string
  status: string
  stellarTxId: string | null
  penalties: {
    daysLate: number
    surcharge: string
    interest: string
    compromisePenalty: string
    totalPenalty: string
  } | null
}

type Attachment = {
  name: string
  status: string
}

type FilingPackage = {
  taxYear: number
  taxpayer: {
    fullName: string
    tin: string
    rdoCode: string
    registeredAddress: string
    zipCode: string
  }
  electedRate: 'RATE_8PCT' | 'GRADUATED' | null
  totalGross: string
  totalCwt: string
  totalPenalty: string
  filedCount: number
  totalCount: number
  returns: ReturnMeta[]
  attachments: Attachment[]
}

type Tab = 'sawt' | 'attachments' | 'package'

export default function SawtPage() {
  const [tab, setTab] = useState<Tab>('sawt')
  const [sawt, setSawt] = useState<SawtRow[]>([])
  const [pkg, setPkg] = useState<FilingPackage | null>(null)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function fetchData() {
      try {
        const [sawtRes, pkgRes, attRes] = await Promise.all([
          fetch('/api/sawt'),
          fetch('/api/filing-package'),
          fetch('/api/sawt/attachments'),
        ])
        const sawtJson = await sawtRes.json()
        const pkgJson = await pkgRes.json()
        const attJson = await attRes.json()
        if (cancelled) return
        if (!sawtRes.ok) {
          setError(sawtJson.error || 'Failed to load SAWT')
          return
        }
        if (!pkgRes.ok) {
          setError(pkgJson.error || 'Failed to load filing package')
          return
        }
        if (!attRes.ok) {
          setError(attJson.error || 'Failed to load attachments checklist')
          return
        }
        setSawt(sawtJson.sawt || [])
        setPkg(pkgJson)
        setAttachments(attJson.attachments || [])
      } catch {
        if (!cancelled) setError('Failed to load SAWT data')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchData()
    return () => {
      cancelled = true
    }
  }, [])

  function statusColor(status: string) {
    if (status === 'Available' || status === 'FILED') return 'bg-green-100 text-green-800'
    if (status === 'NOT REQUIRED') return 'bg-blue-100 text-blue-800'
    return 'bg-amber-100 text-amber-800'
  }

  if (loading) return <SawtSkeleton />
  if (error) return <p className="p-6 text-red-600">{error}</p>

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">SAWT & Filing Package</h1>
          <p className="text-muted-foreground">Tax Year {pkg?.taxYear}</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              await navigator.clipboard.writeText('csubmission@bir.gov.ph')
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            }}
          >
            {copied ? (
              <><Check className="mr-2 h-4 w-4" /> Copied</>
            ) : (
              <><Copy className="mr-2 h-4 w-4" /> Copy BIR Email</>
            )}
          </Button>
          <Link href="/api/sawt/export?format=dat">
            <Button variant="outline" size="sm">
              <FileDown className="mr-2 h-4 w-4" /> Download SAWT DAT
            </Button>
          </Link>
          <Link href="/api/sawt/export?format=csv">
            <Button variant="outline" size="sm">
              <FileDown className="mr-2 h-4 w-4" /> Download SAWT CSV
            </Button>
          </Link>
          <Link href="/api/filing-package/download">
            <Button variant="outline" size="sm">
              <Package className="mr-2 h-4 w-4" /> Download ZIP
            </Button>
          </Link>
        </div>
      </div>

      <div className="flex gap-2 border-b pb-2">
        {[
          { key: 'sawt', label: 'SAWT Alphalist', icon: ClipboardList },
          { key: 'attachments', label: 'Attachments Checklist', icon: ClipboardList },
          { key: 'package', label: 'Filing Package', icon: Package },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as Tab)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-t-md ${
              tab === t.key ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground'
            }`}
          >
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'sawt' && (
        <Card>
          <CardHeader>
            <CardTitle>SAWT Alphalist</CardTitle>
            <CardDescription>
              Aggregated by payor, ATC, and quarter for BIR eSubmission.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {sawt.length === 0 ? (
              <EmptyState
                title="No SAWT rows yet"
                description="Add 2307 certificates and they will be aggregated here for BIR eSubmission."
                actions={
                  <Link href="/income">
                    <Button variant="outline">Add 2307 Certificate</Button>
                  </Link>
                }
                className="py-8"
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Quarter</TableHead>
                    <TableHead>Payor TIN</TableHead>
                    <TableHead>Payor Name</TableHead>
                    <TableHead>ATC</TableHead>
                    <TableHead className="text-right">Gross Income</TableHead>
                    <TableHead className="text-right">CWT</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sawt.map((row, idx) => (
                    <TableRow key={idx}>
                      <TableCell>Q{row.quarter}</TableCell>
                      <TableCell>{row.payorTin}</TableCell>
                      <TableCell>{row.payorName}</TableCell>
                      <TableCell>{row.atcCode}</TableCell>
                      <TableCell className="text-right">₱{Number(row.gross).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right">₱{Number(row.cwt).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {tab === 'attachments' && (
        <Card>
          <CardHeader>
            <CardTitle>Attachments Checklist</CardTitle>
            <CardDescription>Status of required supporting documents.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {attachments.map((att, idx) => (
              <div key={idx} className="flex items-center justify-between">
                <span>{att.name}</span>
                <Badge className={statusColor(att.status)}>{att.status}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {tab === 'package' && pkg && (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>YTD Gross</CardDescription>
                <CardTitle className="text-2xl">₱{Number(pkg.totalGross).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>YTD CWT</CardDescription>
                <CardTitle className="text-2xl">₱{Number(pkg.totalCwt).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Returns Filed</CardDescription>
                <CardTitle className="text-2xl">{pkg.filedCount}/{pkg.totalCount}</CardTitle>
              </CardHeader>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Cover Sheet Preview</CardTitle>
              <CardDescription>
                Information included in the downloadable filing package ZIP.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Taxpayer</p>
                  <p className="font-medium">{pkg.taxpayer.fullName}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">TIN</p>
                  <p className="font-medium">{pkg.taxpayer.tin}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">RDO</p>
                  <p className="font-medium">{pkg.taxpayer.rdoCode}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Rate Election</p>
                  <p className="font-medium">
                    {pkg.electedRate === 'RATE_8PCT' ? '8% Flat Rate' : 'Graduated Rate'}
                  </p>
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <p className="text-sm text-muted-foreground">Address</p>
                  <p className="font-medium">{pkg.taxpayer.registeredAddress} {pkg.taxpayer.zipCode}</p>
                </div>
              </div>
              <hr />
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <p className="text-sm text-muted-foreground">Total Gross Receipts</p>
                  <p className="font-semibold">₱{Number(pkg.totalGross).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total CWT Withheld</p>
                  <p className="font-semibold">₱{Number(pkg.totalCwt).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Penalties</p>
                  <p className="font-semibold">₱{Number(pkg.totalPenalty).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Penalty Summary</CardTitle>
              <CardDescription>Late-filing penalties computed per return.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Return</TableHead>
                    <TableHead className="text-right">Days Late</TableHead>
                    <TableHead className="text-right">Surcharge</TableHead>
                    <TableHead className="text-right">Interest</TableHead>
                    <TableHead className="text-right">Compromise</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pkg.returns.map((ret) => (
                    <TableRow key={ret.id}>
                      <TableCell>{ret.label}</TableCell>
                      <TableCell className="text-right">
                        {ret.penalties?.daysLate ?? 0}
                      </TableCell>
                      <TableCell className="text-right">
                        ₱{Number(ret.penalties?.surcharge ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right">
                        ₱{Number(ret.penalties?.interest ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right">
                        ₱{Number(ret.penalties?.compromisePenalty ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        ₱{Number(ret.penalties?.totalPenalty ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Included Returns</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Return</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Stellar TX</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pkg.returns.map((ret) => (
                    <TableRow key={ret.id}>
                      <TableCell>{ret.label}</TableCell>
                      <TableCell>
                        <Badge className={statusColor(ret.status)}>{ret.status}</Badge>
                      </TableCell>
                      <TableCell className="break-all text-muted-foreground">
                        {ret.stellarTxId ?? '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
