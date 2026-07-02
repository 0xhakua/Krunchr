'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { ReturnDetailSkeleton } from './loading'
import { formatPeso, formatDate } from '@/lib/format'
import { ArrowLeft, FileText, RefreshCw } from 'lucide-react'

type Money = { raw: string; formatted: string }

type ReturnDetail = {
  id: string
  formType: 'FORM_2551Q' | 'FORM_1701Q' | 'FORM_1701A'
  quarter: number | null
  sequenceOrder: number
  status: 'BLOCKED' | 'PENDING' | 'GENERATED' | 'FILED'
  statutoryDueDate: string
  computedTaxDue: string | null
  taxCreditsTotal: string | null
  netTaxDue: string | null
  overpaymentAmt: string | null
  filedDate: string | null
  generatedAt: string | null
  penalties: {
    daysLate: number
    surcharge: string
    interest: string
    compromisePenalty: string
    totalPenalty: string
  } | null
  stellarReceipt: {
    stellarTxId: string
    status: string
    explorerUrl: string
  } | null
}

type SourceIncomeRow = {
  quarter: number
  payorName: string
  payorTin: string
  atcCode: string
  atcDescription: string
  quarterlyTotal: Money
  cwtWithheld: Money
}

type CreditStep = {
  order: number
  type: string
  description: string
  amount: Money
}

type ComputationDetail =
  | {
      returnId: string
      formType: 'FORM_2551Q'
      quarter: number
      electedRate: 'RATE_8PCT' | 'GRADUATED' | null
      grossReceipts: Money
      taxDue: Money
      explanation: string
      penalties: {
        daysLate: number
        surcharge: Money
        interest: Money
        compromise: Money
        total: Money
      }
      sourceIncome: SourceIncomeRow[]
    }
  | {
      returnId: string
      formType: 'FORM_1701Q'
      quarter: number
      incomeType: string
      cumulativeGross: Money
      exemption: Money
      taxableIncome: Money
      taxDueAt8Percent: Money
      priorQuartersTaxPaid: Money
      cwtApplied: Money
      netTaxDue: Money
      overpayment: Money
      creditApplicationSequence: CreditStep[]
      penalties: {
        daysLate: number
        surcharge: Money
        interest: Money
        compromise: Money
        total: Money
      }
      sourceIncome: SourceIncomeRow[]
    }
  | {
      returnId: string
      formType: 'FORM_1701A'
      incomeType: string
      fullYearGross: Money
      exemption: Money
      taxableIncome: Money
      taxDue: Money
      priorYearCredit: Money
      quarterlyPayments: Money
      cwtWithheld: Money
      totalCredits: Money
      netTaxDue: Money
      overpayment: Money
      creditApplicationSequence: CreditStep[]
      penalties: {
        daysLate: number
        surcharge: Money
        interest: Money
        compromise: Money
        total: Money
      }
      sourceIncome: SourceIncomeRow[]
    }

export default function ReturnDetailPage() {
  const params = useParams()
  const id = params.id as string

  const [ret, setRet] = useState<ReturnDetail | null>(null)
  const [computation, setComputation] = useState<ComputationDetail | null>(null)
  const [taxYear, setTaxYear] = useState<number | null>(null)
  const [disposition, setDisposition] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [recalcLoading, setRecalcLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [previewLoading, setPreviewLoading] = useState(true)

  const [simDate, setSimDate] = useState(() => new Date().toISOString().split('T')[0])
  const [simulated, setSimulated] = useState<{
    filedDate: string
    penalties: ComputationDetail['penalties']
  } | null>(null)
  const [simLoading, setSimLoading] = useState(false)
  const [simError, setSimError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function fetchReturn() {
      try {
        const res = await fetch(`/api/returns/${id}`)
        const data = await res.json()
        if (cancelled) return
        if (!res.ok) {
          setError(data.error || 'Failed to load return')
          return
        }
        setRet(data.return)
        setTaxYear(data.taxYear ?? null)

        if (
          data.return.formType === 'FORM_1701A' &&
          Number(data.return.overpaymentAmt) > 0
        ) {
          await loadDisposition(data.taxYear)
        }
      } catch {
        if (!cancelled) setError('Failed to load return')
      }
    }

    async function fetchComputation() {
      try {
        const res = await fetch(`/api/computation/${id}`)
        const data = await res.json()
        if (cancelled) return
        if (res.ok) {
          setComputation(data)
        }
      } catch {
        // Non-fatal: the page still works with the summary card
      }
    }

    async function loadDisposition(year: number) {
      try {
        const res = await fetch(`/api/overpayment/${year}`)
        const data = await res.json()
        if (cancelled) return
        if (res.ok && data.overpayment?.disposition) {
          setDisposition(data.overpayment.disposition)
        }
      } catch {
        // Non-fatal: the user can still select a disposition
      }
    }

    fetchReturn()
    fetchComputation()

    return () => {
      cancelled = true
    }
  }, [id])

  function statusIntent(status: string) {
    switch (status) {
      case 'FILED':
        return 'status-success'
      case 'PENDING':
      case 'GENERATED':
        return 'status-warning'
      default:
        return 'status-danger'
    }
  }

  async function generateReturn() {
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

  async function fileReturn() {
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

  async function recalculate() {
    setRecalcLoading(true)
    setError('')
    try {
      const res = await fetch('/api/computation/recascade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Failed to recalculate')
        return
      }
      window.location.reload()
    } catch {
      setError('Failed to recalculate')
    } finally {
      setRecalcLoading(false)
    }
  }

  async function runSimulation() {
    setSimLoading(true)
    setSimError('')
    setError('')
    try {
      const res = await fetch('/api/penalties/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnId: id, filedDate: simDate }),
      })
      const data = await res.json()
      if (!res.ok) {
        setSimError(data.error || 'Failed to simulate penalty')
        return
      }
      setSimulated({ filedDate: data.filedDate, penalties: data.penalties })
    } catch {
      setSimError('Failed to simulate penalty')
    } finally {
      setSimLoading(false)
    }
  }

  async function saveDisposition() {
    if (!taxYear || !disposition) return
    setLoading(true)
    setError('')
    setMessage('')
    try {
      const res = await fetch(`/api/overpayment/${taxYear}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disposition }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to save disposition')
        return
      }
      setMessage('Overpayment disposition saved.')
    } catch {
      setError('Failed to save disposition')
    } finally {
      setLoading(false)
    }
  }

  if (!ret) {
    return (
      <PageShell>
        <ReturnDetailSkeleton />
      </PageShell>
    )
  }

  return (
    <PageShell>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" aria-hidden="true" />
            {ret.formType.replace('FORM_', '')} {ret.quarter ? `Q${ret.quarter}` : 'Annual'}
          </span>
        }
        description={
          <>
            Statutory due date {formatDate(ret.statutoryDueDate)}
            {ret.filedDate ? ` · Filed on ${formatDate(ret.filedDate)}` : ''}
          </>
        }
        actions={
          <>
            <Badge className={statusIntent(ret.status)}>{ret.status}</Badge>
            <Link href="/returns">
              <Button variant="outline" size="sm">
                <ArrowLeft className="mr-2 h-4 w-4" /> Back to Returns
              </Button>
            </Link>
          </>
        }
      />

      {error ? (
        <div className="status-danger rounded-md px-4 py-3 text-sm">{error}</div>
      ) : null}
      {message ? (
        <div className="status-success rounded-md px-4 py-3 text-sm">{message}</div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Computation Breakdown</CardTitle>
            <CardDescription>Step-by-step tax computation for this return</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {computation ? (
              <>
                <Table>
                  <TableBody>
                    {computation.formType === 'FORM_2551Q' && (
                      <>
                        <TableRow>
                          <TableCell className="text-muted-foreground">Gross Receipts</TableCell>
                          <TableCell className="text-right font-medium">{computation.grossReceipts.formatted}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="text-muted-foreground">Elected Rate</TableCell>
                          <TableCell className="text-right font-medium">{computation.electedRate === 'RATE_8PCT' ? '8% Flat Rate' : 'Graduated Rate'}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="text-muted-foreground">Tax Due</TableCell>
                          <TableCell className="text-right font-bold">{computation.taxDue.formatted}</TableCell>
                        </TableRow>
                      </>
                    )}

                    {computation.formType === 'FORM_1701Q' && (
                      <>
                        <TableRow>
                          <TableCell className="text-muted-foreground">Cumulative Gross Receipts</TableCell>
                          <TableCell className="text-right font-medium">{computation.cumulativeGross.formatted}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="text-muted-foreground">Less: Statutory Exemption</TableCell>
                          <TableCell className="text-right font-medium">{computation.exemption.formatted}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="text-muted-foreground">Taxable Income</TableCell>
                          <TableCell className="text-right font-medium">{computation.taxableIncome.formatted}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="text-muted-foreground">Tax Due @ 8%</TableCell>
                          <TableCell className="text-right font-medium">{computation.taxDueAt8Percent.formatted}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="text-muted-foreground">Less: Prior Quarters Tax Paid</TableCell>
                          <TableCell className="text-right font-medium">{computation.priorQuartersTaxPaid.formatted}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="text-muted-foreground">Less: CWT Applied</TableCell>
                          <TableCell className="text-right font-medium">{computation.cwtApplied.formatted}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="text-muted-foreground">Net Tax Due</TableCell>
                          <TableCell className="text-right font-bold">{computation.netTaxDue.formatted}</TableCell>
                        </TableRow>
                        {Number(computation.overpayment.raw) > 0 && (
                          <TableRow>
                            <TableCell className="text-muted-foreground">Overpayment</TableCell>
                            <TableCell className="text-right font-bold text-green-600">{computation.overpayment.formatted}</TableCell>
                          </TableRow>
                        )}
                      </>
                    )}

                    {computation.formType === 'FORM_1701A' && (
                      <>
                        <TableRow>
                          <TableCell className="text-muted-foreground">Full Year Gross Receipts</TableCell>
                          <TableCell className="text-right font-medium">{computation.fullYearGross.formatted}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="text-muted-foreground">Less: Statutory Exemption</TableCell>
                          <TableCell className="text-right font-medium">{computation.exemption.formatted}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="text-muted-foreground">Taxable Income</TableCell>
                          <TableCell className="text-right font-medium">{computation.taxableIncome.formatted}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="text-muted-foreground">Tax Due @ 8%</TableCell>
                          <TableCell className="text-right font-medium">{computation.taxDue.formatted}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="text-muted-foreground">Less: Prior Year Credit</TableCell>
                          <TableCell className="text-right font-medium">{computation.priorYearCredit.formatted}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="text-muted-foreground">Less: Quarterly Payments</TableCell>
                          <TableCell className="text-right font-medium">{computation.quarterlyPayments.formatted}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="text-muted-foreground">Less: CWT Withheld</TableCell>
                          <TableCell className="text-right font-medium">{computation.cwtWithheld.formatted}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="text-muted-foreground">Total Credits</TableCell>
                          <TableCell className="text-right font-medium">{computation.totalCredits.formatted}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="text-muted-foreground">Net Tax Due</TableCell>
                          <TableCell className="text-right font-bold">{computation.netTaxDue.formatted}</TableCell>
                        </TableRow>
                        {Number(computation.overpayment.raw) > 0 && (
                          <TableRow>
                            <TableCell className="text-muted-foreground">Overpayment</TableCell>
                            <TableCell className="text-right font-bold text-green-600">{computation.overpayment.formatted}</TableCell>
                          </TableRow>
                        )}
                      </>
                    )}
                  </TableBody>
                </Table>

                {(computation.formType === 'FORM_1701Q' || computation.formType === 'FORM_1701A') &&
                  computation.creditApplicationSequence.length > 0 && (
                  <div className="mt-4">
                    <h4 className="font-semibold text-sm mb-2">Credit Application Sequence</h4>
                    <ol className="list-decimal list-inside text-sm space-y-1">
                      {computation.creditApplicationSequence.map((step, i) => (
                        <li key={i}>
                          {step.description}: {step.amount.formatted}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                {computation.sourceIncome.length > 0 && (
                  <div className="mt-4">
                    <h4 className="font-semibold text-sm mb-2">Source Income</h4>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Q</TableHead>
                          <TableHead>Payor</TableHead>
                          <TableHead>ATC</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead className="text-right">CWT</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {computation.sourceIncome.map((src, i) => (
                          <TableRow key={i}>
                            <TableCell>Q{src.quarter}</TableCell>
                            <TableCell>{src.payorName}</TableCell>
                            <TableCell>{src.atcCode}</TableCell>
                            <TableCell className="text-right">{src.quarterlyTotal.formatted}</TableCell>
                            <TableCell className="text-right">{src.cwtWithheld.formatted}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {computation.formType === 'FORM_2551Q' && computation.explanation && (
                  <p className="text-xs text-muted-foreground mt-2">{computation.explanation}</p>
                )}
              </>
            ) : (
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Computed Tax Due</span>
                  <span className="font-medium">{formatPeso(ret.computedTaxDue)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tax Credits Applied</span>
                  <span className="font-medium">{formatPeso(ret.taxCreditsTotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Net Tax Due</span>
                  <span className="font-medium">{formatPeso(ret.netTaxDue)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Overpayment</span>
                  <span className="font-medium">{formatPeso(ret.overpaymentAmt)}</span>
                </div>
                <hr />
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Statutory Due Date</span>
                  <span className="font-medium">{formatDate(ret.statutoryDueDate)}</span>
                </div>
                {ret.filedDate && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Filed Date</span>
                    <span className="font-medium">{formatDate(ret.filedDate)}</span>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle>Generated Form Preview</CardTitle>
            <CardDescription>Read-only preview of the populated BIR form</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 min-h-[400px]">
            {ret.status === 'GENERATED' || ret.status === 'FILED' ? (
              <div className="relative w-full h-full min-h-[400px] rounded-md border overflow-hidden">
                {previewLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-muted/30">
                    <span className="text-sm text-muted-foreground">Loading preview…</span>
                  </div>
                )}
                <iframe
                  src={`/api/returns/${id}/pdf?inline=1`}
                  title={`BIR ${ret.formType.replace('FORM_', '')} preview`}
                  className="w-full h-full min-h-[400px]"
                  onLoad={() => setPreviewLoading(false)}
                />
              </div>
            ) : (
              <div className="h-full min-h-[400px] flex flex-col items-center justify-center text-center text-muted-foreground space-y-3">
                <p>Form preview is available after the return is generated.</p>
                {ret.status === 'PENDING' && (
                  <Button onClick={generateReturn} disabled={loading}>
                    Generate Return
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Penalties</CardTitle>
          <CardDescription>Computed as of today</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Days Late</span>
            <span className="font-medium">{computation?.penalties?.daysLate ?? ret.penalties?.daysLate ?? 0}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Surcharge</span>
            <span className="font-medium">{formatPeso(computation?.penalties?.surcharge.raw ?? ret.penalties?.surcharge ?? null)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Interest</span>
            <span className="font-medium">{formatPeso(computation?.penalties?.interest.raw ?? ret.penalties?.interest ?? null)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Compromise</span>
            <span className="font-medium">{formatPeso(computation?.penalties?.compromise.raw ?? ret.penalties?.compromisePenalty ?? null)}</span>
          </div>
          <hr />
          <div className="flex justify-between">
            <span className="text-muted-foreground">Total Penalty</span>
            <span className="font-medium">{formatPeso(computation?.penalties?.total.raw ?? ret.penalties?.totalPenalty ?? null)}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Penalty Simulator</CardTitle>
          <CardDescription>See what the penalty would be if filed on a different date</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end">
            <div className="space-y-1">
              <Label htmlFor="sim-date">Hypothetical filing date</Label>
              <Input
                id="sim-date"
                type="date"
                value={simDate}
                onChange={(e) => setSimDate(e.target.value)}
                className="w-full sm:w-[240px]"
              />
            </div>
            <Button onClick={runSimulation} disabled={simLoading}>
              {simLoading ? 'Simulating…' : 'Simulate'}
            </Button>
          </div>

          {simError && <p className="text-sm text-red-600">{simError}</p>}

          {simulated && (
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Days Late</span>
                <span className="font-medium">{simulated.penalties.daysLate}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Surcharge</span>
                <span className="font-medium">{simulated.penalties.surcharge.formatted}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Interest</span>
                <span className="font-medium">{simulated.penalties.interest.formatted}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Compromise</span>
                <span className="font-medium">{simulated.penalties.compromise.formatted}</span>
              </div>
              <hr />
              <div className="flex justify-between">
                <span className="text-muted-foreground">Simulated Total</span>
                <span className="font-bold">{simulated.penalties.total.formatted}</span>
              </div>

              {(() => {
                const liveTotal = computation?.penalties?.total
                const liveRaw = liveTotal ? liveTotal.raw : ret.penalties?.totalPenalty
                if (liveRaw == null) return null
                const liveDecimal = Number(liveRaw)
                const simDecimal = Number(simulated.penalties.total.raw)
                const delta = simDecimal - liveDecimal
                if (delta === 0) {
                  return (
                    <p className="text-sm text-muted-foreground">
                      Same as the current live penalty.
                    </p>
                  )
                }
                const color = delta > 0 ? 'text-red-600' : 'text-green-600'
                const sign = delta > 0 ? '+' : ''
                return (
                  <p className={`text-sm font-medium ${color}`}>
                    {sign}
                    {formatPeso(delta)} vs. current live penalty ({formatPeso(liveRaw)})
                  </p>
                )
              })()}
            </div>
          )}
        </CardContent>
      </Card>

      {ret.formType === 'FORM_1701A' && Number(ret.overpaymentAmt) > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Overpayment Disposition</CardTitle>
            <CardDescription>
              Choose how to treat the {formatPeso(ret.overpaymentAmt)} overpayment.
              Required before filing.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Select
              value={disposition ?? ''}
              onValueChange={(value) => setDisposition(value)}
            >
              <SelectTrigger className="w-full md:w-[360px]">
                <SelectValue placeholder="Select disposition" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CARRY_OVER">Carry Over</SelectItem>
                <SelectItem value="REFUND">Refund</SelectItem>
                <SelectItem value="TAX_CREDIT_CERTIFICATE">Tax Credit Certificate</SelectItem>
              </SelectContent>
            </Select>
            <Button
              onClick={saveDisposition}
              disabled={loading || !disposition}
            >
              {loading ? 'Saving…' : 'Save Disposition'}
            </Button>
          </CardContent>
        </Card>
      )}

      {ret.stellarReceipt && (
        <Card>
          <CardHeader>
            <CardTitle>Stellar Receipt</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p>
              <strong>Status:</strong> {ret.stellarReceipt.status}
            </p>
            <p className="break-all">
              <strong>TX ID:</strong> {ret.stellarReceipt.stellarTxId}
            </p>
            {ret.stellarReceipt.explorerUrl && (
              <a href={ret.stellarReceipt.explorerUrl} target="_blank" rel="noreferrer">
                <Button variant="outline" size="sm">View on Stellar Explorer</Button>
              </a>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        {ret.status === 'PENDING' && (
          <Button onClick={generateReturn} disabled={loading}>Generate Return</Button>
        )}
        {ret.status === 'GENERATED' && (
          <Button
            onClick={fileReturn}
            disabled={
              loading ||
              (ret.formType === 'FORM_1701A' &&
                Number(ret.overpaymentAmt) > 0 &&
                !disposition)
            }
          >
            Mark as Filed
          </Button>
        )}
        {(ret.status === 'GENERATED' || ret.status === 'FILED') && (
          <a href={`/api/returns/${id}/pdf`} target="_blank" rel="noreferrer">
            <Button variant="outline">Download PDF</Button>
          </a>
        )}
        <Button
          variant="outline"
          onClick={recalculate}
          disabled={recalcLoading || ret.status === 'FILED'}
        >
          {recalcLoading ? (
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Recalculate
        </Button>
      </div>
    </PageShell>
  )
}
