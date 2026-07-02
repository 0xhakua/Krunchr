'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { FileText, Plus, Rocket, Wallet } from 'lucide-react'
import { VatBreachBanner } from '@/components/dashboard/vat-breach-banner'
import { EmptyState } from '@/components/ui/empty-state'
import { DashboardSkeleton } from './loading'

type DashboardReturn = {
  id: string
  sequenceOrder: number
  formType: 'FORM_2551Q' | 'FORM_1701Q' | 'FORM_1701A'
  quarter: number | null
  label: string
  period: string
  deadline: string
  status: 'BLOCKED' | 'PENDING' | 'GENERATED' | 'FILED'
  daysUntilDeadline: number
  isOverdue: boolean
  computedTaxDue: string
  netTaxDue: string
  overpaymentAmt: string
  totalPenalty: string
  filedDate: string | null
  stellarTxId: string | null
  stellarStatus: string | null
  explorerUrl: string | null
  blockReason?: string
}

type DashboardData = {
  taxpayer: {
    fullName: string
    tin: string
    rdoCode: string
    incomeType: string
  } | null
  taxYear: {
    id: string
    year: number
    electionStatus: string
    electedRate: string | null
    corIncludes2551Q: boolean
    vatBreached: boolean
  } | null
  returns: DashboardReturn[]
  ytd: {
    totalGross: string
    totalCwt: string
    vatThreshold: string
    vatThresholdPercent: number
  }
  upcoming: DashboardReturn[]
  nextReturnId: string | null
  progress: { filedCount: number; totalCount: number; percent: number }
  annualPosition: {
    taxDue: string
    totalCredits: string
    netPosition: string
    overpayment: string
  } | null
  // S7.4 (#71): which BIR form number the annual slot uses. Mixed-income
  // earners file Form 1701, everyone else files Form 1701A.
  annualFormType: 'FORM_1701A' | 'FORM_1701' | null
  availableYears: number[]
  activeYear: number | null
}

export default function DashboardPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const urlYear = searchParams.get('year')
  const parsedUrlYear = useMemo(() => {
    if (!urlYear || !/^\d{4}$/.test(urlYear)) return null
    const n = Number.parseInt(urlYear, 10)
    return Number.isFinite(n) ? n : null
  }, [urlYear])

  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function fetchDashboard() {
      try {
        const qs = parsedUrlYear != null ? `?year=${parsedUrlYear}` : ''
        const res = await fetch(`/api/dashboard${qs}`)
        const json = await res.json()
        if (cancelled) return
        if (!res.ok) {
          setError(json.error || 'Failed to load dashboard')
          return
        }
        setData(json)
      } catch {
        if (!cancelled) setError('Failed to load dashboard')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchDashboard()
    return () => {
      cancelled = true
    }
  }, [parsedUrlYear])

  const handleYearChange = useCallback(
    (value: string | null) => {
      if (value == null) return
      const next = Number.parseInt(value, 10)
      if (!Number.isFinite(next)) return
      const params = new URLSearchParams(searchParams.toString())
      params.set('year', String(next))
      router.replace(`/dashboard?${params.toString()}`)
    },
    [router, searchParams]
  )

  function statusColor(status: string) {
    switch (status) {
      case 'FILED':
        return 'bg-green-100 text-green-800 hover:bg-green-100'
      case 'PENDING':
      case 'GENERATED':
        return 'bg-amber-100 text-amber-800 hover:bg-amber-100'
      default:
        return 'bg-red-100 text-red-800 hover:bg-red-100'
    }
  }

  function deadlineText(ret: DashboardReturn) {
    if (ret.status === 'FILED') return `Filed on ${formatDate(ret.filedDate)}`
    if (ret.isOverdue) return `${Math.abs(ret.daysUntilDeadline)} days overdue`
    if (ret.daysUntilDeadline === 0) return 'Due today'
    if (ret.daysUntilDeadline <= 7) return `${ret.daysUntilDeadline} days left`
    return `Due ${formatDate(ret.deadline)}`
  }

  function formatDate(value: string | null) {
    if (!value) return '—'
    return new Date(value).toLocaleDateString('en-PH')
  }

  if (loading) return <DashboardSkeleton />
  if (error) return <p className="p-6 text-red-600">{error}</p>
  if (!data?.taxpayer) {
    return (
      <div className="py-6">
        <EmptyState
          title="Welcome to Kuwenta"
          description="Complete onboarding to see your compliance dashboard and filing roadmap."
          actions={
            <Link href="/onboarding">
              <Button>Start Onboarding</Button>
            </Link>
          }
        />
      </div>
    )
  }

  const { taxpayer, taxYear, returns, ytd, upcoming, nextReturnId, progress, annualPosition, annualFormType, availableYears, activeYear } = data

  // S7.4 (#71): the dashboard explicitly tells mixed-income earners they
  // are on the Form 1701 (not 1701A) path. The label sits next to the
  // annual-position card so the link to BR-13 is visible at a glance.
  const annualFormLabel = annualFormType === 'FORM_1701' ? 'Form 1701' : 'Form 1701A'
  const isMixedIncome = taxpayer.incomeType === 'MIXED_INCOME'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Hello, {taxpayer.fullName}</h1>
          <p className="text-muted-foreground">
            TIN {taxpayer.tin} · RDO {taxpayer.rdoCode} · Tax Year {taxYear?.year}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {availableYears.length > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Tax Year</span>
              <Select value={String(activeYear ?? '')} onValueChange={handleYearChange}>
                <SelectTrigger className="h-8 w-[120px]" aria-label="Select active tax year">
                  <SelectValue placeholder="Year" />
                </SelectTrigger>
                <SelectContent>
                  {availableYears.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <Badge variant="outline">{taxpayer.incomeType === 'MIXED_INCOME' ? 'Mixed Income' : 'Pure Self-Employment'}</Badge>
          <Badge variant="outline">{taxYear?.corIncludes2551Q ? 'COR includes 2551Q' : 'No 2551Q'}</Badge>
          {taxYear?.electedRate === 'RATE_8PCT' && (
            <Badge className="bg-green-100 text-green-800 hover:bg-green-100">8% Elected</Badge>
          )}
        </div>
      </div>

      {taxYear?.vatBreached && <VatBreachBanner />}

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>YTD Gross Income</CardDescription>
            <CardTitle className="text-2xl">{ytd.totalGross}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>YTD CWT Withheld</CardDescription>
            <CardTitle className="text-2xl">{ytd.totalCwt}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>
              Annual Position · {annualFormLabel}
            </CardDescription>
            <CardTitle className="text-2xl">{annualPosition?.netPosition ?? '₱0.00'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs text-muted-foreground">
            {annualPosition ? (
              <p>{annualPosition.overpayment} overpayment</p>
            ) : (
              <p>No annual return computed yet</p>
            )}
            {isMixedIncome && (
              <p className="text-amber-700">
                Mixed-income earners file {annualFormLabel}; the ₱250,000 exemption does not apply.
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Filing Progress</CardDescription>
            <CardTitle className="text-2xl">{progress.filedCount}/{progress.totalCount}</CardTitle>
          </CardHeader>
          <CardContent>
            <Progress value={progress.percent} />
          </CardContent>
        </Card>
      </div>

      {/* VAT threshold */}
      <Card className={ytd.vatThresholdPercent >= 80 ? 'border-red-200 bg-red-50/30' : ''}>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">VAT Threshold Progress</CardTitle>
          <CardDescription>
            {ytd.totalGross} of ₱{Number(ytd.vatThreshold).toLocaleString('en-PH')} ({ytd.vatThresholdPercent.toFixed(1)}%)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Progress value={ytd.vatThresholdPercent} />
          {ytd.vatThresholdPercent >= 80 && (
            <p className="text-sm text-red-600">Warning: approaching ₱3,000,000 VAT threshold.</p>
          )}
        </CardContent>
      </Card>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-3">
        <Link href="/income">
          <Button variant="outline">
            <Plus className="mr-2 h-4 w-4" /> Add 2307 Certificate
          </Button>
        </Link>
        <Link href="/sawt">
          <Button variant="outline">
            <FileText className="mr-2 h-4 w-4" /> View Filing Package
          </Button>
        </Link>
        <Link href="/returns">
          <Button variant="outline">
            <Rocket className="mr-2 h-4 w-4" /> Go to Returns
          </Button>
        </Link>
      </div>

      {/* Filing Roadmap */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Filing Roadmap</h2>
          {nextReturnId && (
            <Link href={`/returns/${nextReturnId}`}>
              <Button size="sm">Next Return →</Button>
            </Link>
          )}
        </div>

        <div className="grid gap-4">
          {returns.map((ret) => (
            <Card
              key={ret.id}
              className={ret.status === 'BLOCKED' ? 'opacity-70' : ''}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle className="text-lg">
                      {ret.label} · <span className="text-muted-foreground">{ret.period}</span>
                    </CardTitle>
                    <CardDescription className={ret.isOverdue ? 'text-red-600 font-medium' : ''}>
                      {deadlineText(ret)}
                    </CardDescription>
                  </div>
                  <Badge className={statusColor(ret.status)}>{ret.status}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Tax Due</p>
                    <p className="font-medium">{ret.computedTaxDue}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Net Due</p>
                    <p className="font-medium">{ret.netTaxDue}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Penalty</p>
                    <p className="font-medium">{ret.totalPenalty}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Overpayment</p>
                    <p className="font-medium">{ret.overpaymentAmt}</p>
                  </div>
                </div>

                {ret.blockReason && (
                  <p className="text-sm font-medium text-red-600">{ret.blockReason}</p>
                )}

                {ret.stellarTxId && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">Stellar TX: </span>
                    {ret.explorerUrl ? (
                      <a
                        href={ret.explorerUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-primary hover:underline break-all"
                      >
                        {ret.stellarTxId}
                      </a>
                    ) : (
                      <span className="font-medium">{ret.stellarTxId}</span>
                    )}
                    <span className="ml-2 text-muted-foreground">({ret.stellarStatus})</span>
                  </div>
                )}

                <div className="flex gap-2">
                  <Link href={`/returns/${ret.id}`}>
                    <Button variant="outline" size="sm">View</Button>
                  </Link>
                  {ret.status === 'FILED' && ret.explorerUrl && (
                    <a href={ret.explorerUrl} target="_blank" rel="noreferrer">
                      <Button variant="outline" size="sm">
                        <Wallet className="mr-2 h-4 w-4" /> Stellar
                      </Button>
                    </a>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Upcoming deadlines */}
      {upcoming.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Upcoming Deadlines</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {upcoming.map((ret) => (
              <div key={ret.id} className="flex items-center justify-between text-sm">
                <span>{ret.label}</span>
                <span className={ret.isOverdue ? 'text-red-600 font-medium' : 'text-muted-foreground'}>
                  {deadlineText(ret)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
