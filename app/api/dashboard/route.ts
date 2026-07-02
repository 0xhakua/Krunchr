import { NextResponse } from 'next/server'
import Decimal from 'decimal.js'
import { requireAuth } from '@/lib/auth/session'
import { prisma } from '@/lib/prisma'
import { determineReturnStatus, getReturnBlockReason } from '@/lib/computation/sequence'
import { getSequence, VAT_THRESHOLD } from '@/lib/computation/constants'
import {
  ACTIVE_YEAR_QUERY,
  getActiveYearFromRequest,
  setActiveYearCookie,
} from '@/lib/active-year'

function daysUntil(date: Date): number {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diff = target.getTime() - today.getTime()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

function formatPeso(value: Decimal | number | string | null): string {
  if (value == null) return '₱0.00'
  const num = value instanceof Decimal ? value.toNumber() : Number(value)
  if (Number.isNaN(num)) return '₱0.00'
  return `₱${num.toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export async function GET(request: Request) {
  const session = await requireAuth()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const profile = await prisma.taxpayerProfile.findUnique({
      where: { userId: session.sub },
      include: {
        taxYears: {
          orderBy: { year: 'desc' },
          include: {
            certificates: true,
            overpayment: true,
            priorYearCredit: true,
            returns: {
              orderBy: { sequenceOrder: 'asc' },
              include: { penalties: true, stellarReceipt: true },
            },
          },
        },
      },
    })

    if (!profile || profile.taxYears.length === 0) {
      return NextResponse.json({
        taxpayer: null,
        taxYear: null,
        returns: [],
        ytd: {
          totalGross: '₱0.00',
          totalCwt: '₱0.00',
          vatThreshold: VAT_THRESHOLD.toString(),
          vatThresholdPercent: 0,
        },
        upcoming: [],
        progress: { filedCount: 0, totalCount: 0, percent: 0 },
        annualPosition: null,
        availableYears: [],
        activeYear: null,
      })
    }

    const availableYears = profile.taxYears.map((ty) => ty.year)
    const url = new URL(request.url)
    const explicitQueryYear = url.searchParams.get(ACTIVE_YEAR_QUERY)
    const resolvedYear = await getActiveYearFromRequest(request, availableYears)
    const taxYear =
      profile.taxYears.find((ty) => ty.year === resolvedYear) ??
      profile.taxYears[0]
    const activeYear = taxYear.year

    if (explicitQueryYear && Number.parseInt(explicitQueryYear, 10) === activeYear) {
      await setActiveYearCookie(activeYear)
    }
    const sequence = getSequence(profile.corIncludes2551Q, profile.incomeType)

    const totalGross = taxYear.certificates.reduce(
      (sum, cert) => sum.plus(cert.quarterlyTotal),
      new Decimal('0')
    )
    const totalCwt = taxYear.certificates.reduce(
      (sum, cert) => sum.plus(cert.cwtWithheld),
      new Decimal('0')
    )
    const vatThresholdPercent = Math.min(
      totalGross.dividedBy(VAT_THRESHOLD).times(100).toNumber(),
      100
    )

    const returns = taxYear.returns.map((ret) => {
      const dynamicStatus = determineReturnStatus(
        ret.sequenceOrder,
        taxYear.returns,
        profile.corIncludes2551Q,
        taxYear.vatBreached
      )
      const blockReason = getReturnBlockReason(ret, taxYear.vatBreached)
      const seq = sequence.find(
        (s) => s.formType === ret.formType && s.quarter === ret.quarter
      )
      const days = daysUntil(ret.statutoryDueDate)

      return {
        id: ret.id,
        sequenceOrder: ret.sequenceOrder,
        formType: ret.formType,
        quarter: ret.quarter,
        label: seq?.label ?? `${ret.formType.replace('FORM_', '')} ${ret.quarter ? `Q${ret.quarter}` : 'Annual'}`,
        period: seq?.period ?? '',
        deadline: ret.statutoryDueDate.toISOString(),
        status: dynamicStatus,
        daysUntilDeadline: days,
        isOverdue: days < 0 && dynamicStatus !== 'FILED',
        computedTaxDue: formatPeso(ret.computedTaxDue),
        netTaxDue: formatPeso(ret.netTaxDue),
        overpaymentAmt: formatPeso(ret.overpaymentAmt),
        totalPenalty: formatPeso(ret.penalties?.totalPenalty ?? null),
        filedDate: ret.filedDate?.toISOString() ?? null,
        stellarTxId: ret.stellarReceipt?.stellarTxId ?? null,
        stellarStatus: ret.stellarReceipt?.status ?? null,
        explorerUrl: ret.stellarReceipt?.explorerUrl ?? null,
        blockReason,
      }
    })

    const filedCount = returns.filter((r) => r.status === 'FILED').length
    const totalCount = returns.length
    const nextReturn = returns.find(
      (r) => r.status !== 'FILED' && (r.status === 'PENDING' || r.status === 'GENERATED')
    )

    const upcoming = returns
      .filter((r) => r.status !== 'FILED')
      .slice(0, 3)

    const annualReturn = taxYear.returns.find(
      (r) => r.formType === 'FORM_1701A' || r.formType === 'FORM_1701'
    )
    const annualPosition = annualReturn
      ? {
          taxDue: formatPeso(annualReturn.computedTaxDue),
          totalCredits: formatPeso(annualReturn.taxCreditsTotal),
          netPosition: formatPeso(annualReturn.netTaxDue),
          overpayment: formatPeso(annualReturn.overpaymentAmt),
        }
      : null

    return NextResponse.json({
      taxpayer: {
        fullName: profile.fullName,
        tin: profile.tin,
        rdoCode: profile.rdoCode,
        incomeType: profile.incomeType,
      },
      taxYear: {
        id: taxYear.id,
        year: taxYear.year,
        electionStatus: taxYear.electionStatus,
        electedRate: taxYear.electedRate,
        corIncludes2551Q: profile.corIncludes2551Q,
        vatBreached: taxYear.vatBreached,
      },
      returns,
      ytd: {
        totalGross: formatPeso(totalGross),
        totalCwt: formatPeso(totalCwt),
        vatThreshold: VAT_THRESHOLD.toString(),
        vatThresholdPercent,
      },
      upcoming,
      nextReturnId: nextReturn?.id ?? null,
      progress: {
        filedCount,
        totalCount,
        percent: totalCount > 0 ? Math.round((filedCount / totalCount) * 100) : 0,
      },
      // S7.4 (#71): tell the dashboard which annual form applies so the
      // UI can label it correctly. Mixed-income earners file Form 1701
      // (BR-13); everyone else files Form 1701A.
      annualFormType:
        annualReturn?.formType ??
        (profile.incomeType === 'MIXED_INCOME' ? 'FORM_1701' : 'FORM_1701A'),
      annualPosition,
      availableYears,
      activeYear,
    })
  } catch (err) {
    console.error('Dashboard data error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
