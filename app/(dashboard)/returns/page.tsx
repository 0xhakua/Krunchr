'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatPeso, formatDate } from '@/lib/format'
import { VatBreachBanner } from '@/components/dashboard/vat-breach-banner'

type ReturnItem = {
  id: string
  formType: 'FORM_2551Q' | 'FORM_1701Q' | 'FORM_1701A'
  quarter: number | null
  sequenceOrder: number
  status: 'BLOCKED' | 'PENDING' | 'GENERATED' | 'FILED'
  statutoryDueDate: string
  computedTaxDue: string | null
  netTaxDue: string | null
  overpaymentAmt: string | null
  filedDate: string | null
  penalties: {
    daysLate: number
    surcharge: string
    interest: string
    compromisePenalty: string
    totalPenalty: string
  } | null
  stellarReceipt: {
    stellarTxId: string
    payloadHash: string
    network: string
    explorerUrl: string
    status: 'PENDING' | 'CONFIRMED' | 'FAILED'
    anchoredAt: string
  } | null
  blockReason?: string
}

export default function ReturnsPage() {
  const [returns, setReturns] = useState<ReturnItem[]>([])
  const [vatBreached, setVatBreached] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function fetchReturns() {
      try {
        const res = await fetch('/api/returns')
        const data = await res.json()
        if (!cancelled) {
          if (!res.ok) {
            setError(data.error || 'Failed to load returns')
            return
          }
          setReturns(data.returns || [])
          setVatBreached(data.vatBreached ?? false)
        }
      } catch {
        if (!cancelled) setError('Failed to load returns')
      }
    }
    fetchReturns()
    return () => {
      cancelled = true
    }
  }, [])

  function statusColor(status: string) {
    switch (status) {
      case 'FILED':
        return 'bg-green-100 text-green-800'
      case 'PENDING':
      case 'GENERATED':
        return 'bg-amber-100 text-amber-800'
      default:
        return 'bg-red-100 text-red-800'
    }
  }

  async function generateReturn(id: string) {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/returns/${id}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to generate return')
        return
      }
      window.location.reload()
    } catch {
      setError('Failed to generate return')
    } finally {
      setLoading(false)
    }
  }

  async function fileReturn(id: string) {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/returns/${id}/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to file return')
        return
      }
      window.location.reload()
    } catch {
      setError('Failed to file return')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Filing Sequence</h1>
      {vatBreached && <VatBreachBanner />}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="grid gap-4">
        {returns.map((ret) => (
          <Card key={ret.id} className={ret.status === 'BLOCKED' ? 'opacity-70' : ''}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">
                  {ret.formType.replace('FORM_', '')} {ret.quarter ? `Q${ret.quarter}` : 'Annual'}
                </CardTitle>
                <Badge className={statusColor(ret.status)}>{ret.status}</Badge>
              </div>
              <CardDescription>Due {formatDate(ret.statutoryDueDate)}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Tax Due</p>
                  <p className="font-medium">{formatPeso(ret.computedTaxDue)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Net Due</p>
                  <p className="font-medium">{formatPeso(ret.netTaxDue)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Penalty</p>
                  <p className="font-medium">{formatPeso(ret.penalties?.totalPenalty ?? null)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Overpayment</p>
                  <p className="font-medium">{formatPeso(ret.overpaymentAmt)}</p>
                </div>
              </div>

              {ret.filedDate && (
                <p className="text-sm text-muted-foreground">Filed on {formatDate(ret.filedDate)}</p>
              )}

              {ret.status === 'FILED' && ret.stellarReceipt && (
                <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-muted-foreground">Stellar TX</p>
                    <span className="font-mono text-xs">{ret.stellarReceipt.stellarTxId.slice(0, 8)}…{ret.stellarReceipt.stellarTxId.slice(-8)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-muted-foreground">Network</p>
                    <span className="capitalize">{ret.stellarReceipt.network}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-muted-foreground">Status</p>
                    <span>{ret.stellarReceipt.status}</span>
                  </div>
                  {ret.stellarReceipt.explorerUrl && (
                    <a
                      href={ret.stellarReceipt.explorerUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-block text-xs text-primary hover:underline"
                    >
                      View on Stellar Explorer →
                    </a>
                  )}
                </div>
              )}

              {ret.blockReason && (
                <p className="text-sm font-medium text-red-600">{ret.blockReason}</p>
              )}

              <div className="flex gap-2">
                <Link href={`/returns/${ret.id}`}>
                  <Button variant="outline" size="sm">View</Button>
                </Link>
                {ret.status === 'PENDING' && (
                  <Button size="sm" onClick={() => generateReturn(ret.id)} disabled={loading}>
                    Generate
                  </Button>
                )}
                {ret.status === 'GENERATED' && (
                  <Button size="sm" onClick={() => fileReturn(ret.id)} disabled={loading}>
                    Mark as Filed
                  </Button>
                )}
                {ret.status === 'FILED' && (
                  <a href={`/api/returns/${ret.id}/pdf`} target="_blank" rel="noreferrer">
                    <Button variant="outline" size="sm">Download PDF</Button>
                  </a>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
