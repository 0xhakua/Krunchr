import React from 'react'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import Decimal from 'decimal.js'
import { prisma } from '@/lib/prisma'
import { Form2551Q } from './templates/form-2551q'
import { Form1701Q } from './templates/form-1701q'
import { Form1701A } from './templates/form-1701a'
import { Form1701 } from './templates/form-1701'
import { ReturnPdf } from './return-pdf'
import { renderForm1701AOverlay } from './bir/1701A'

export interface FilingPdfData {
  ret: {
    id: string
    formType: 'FORM_2551Q' | 'FORM_1701Q' | 'FORM_1701A' | 'FORM_1701'
    quarter: number | null
    status: string
    computedTaxDue: Decimal | null
    taxCreditsTotal: Decimal | null
    netTaxDue: Decimal | null
    overpaymentAmt: Decimal | null
    statutoryDueDate: Date
    filedDate: Date | null
    generatedAt: Date | null
    /** Per-line penalty rows, mirrored from TaxReturn.penalties. */
    penalties: {
      daysLate: number
      surcharge: Decimal
      interest: Decimal
      compromisePenalty: Decimal
      totalPenalty: Decimal
    } | null
  }
  taxYear: {
    id: string
    year: number
    electedRate: 'RATE_8PCT' | 'GRADUATED' | null
    electionStatus: string
  }
  taxpayer: {
    fullName: string
    tin: string
    rdoCode: string
    registeredAddress: string
    zipCode: string
    email: string | null
    phoneNumber: string | null
    natureOfBusiness: string
    incomeType: 'PURE_SELF_EMPLOYMENT' | 'MIXED_INCOME'
    corIncludes2551Q: boolean
  }
  certificates: Array<{
    quarter: number
    payorTin: string
    payorName: string
    atcCode: string
    month1Amount: Decimal
    month2Amount: Decimal
    month3Amount: Decimal
    quarterlyTotal: Decimal
    cwtWithheld: Decimal
  }>
  priorYearCredit: { amount: Decimal } | null
  overpayment: { disposition: string | null } | null
  allReturns: Array<{
    formType: 'FORM_2551Q' | 'FORM_1701Q' | 'FORM_1701A' | 'FORM_1701'
    quarter: number | null
    netTaxDue: Decimal | null
  }>
}

export async function loadFilingData(
  returnId: string,
  userId: string
): Promise<FilingPdfData | null> {
  const profile = await prisma.taxpayerProfile.findUnique({
    where: { userId },
    include: {
      taxYears: {
        orderBy: { year: 'desc' },
        take: 1,
        include: {
          certificates: true,
          priorYearCredit: true,
          overpayment: true,
          returns: {
            orderBy: { sequenceOrder: 'asc' },
            include: {
              penalties: true,
            },
          },
        },
      },
    },
  })

  if (!profile?.taxYears[0]) return null

  const taxYear = profile.taxYears[0]
  const ret = taxYear.returns.find((r) => r.id === returnId)
  if (!ret) return null

  return {
    ret: {
      id: ret.id,
      formType: ret.formType,
      quarter: ret.quarter,
      status: ret.status,
      computedTaxDue: ret.computedTaxDue,
      taxCreditsTotal: ret.taxCreditsTotal,
      netTaxDue: ret.netTaxDue,
      overpaymentAmt: ret.overpaymentAmt,
      statutoryDueDate: ret.statutoryDueDate,
      filedDate: ret.filedDate,
      generatedAt: ret.generatedAt,
      penalties: ret.penalties
        ? {
            daysLate: ret.penalties.daysLate,
            surcharge: ret.penalties.surcharge,
            interest: ret.penalties.interest,
            compromisePenalty: ret.penalties.compromisePenalty,
            totalPenalty: ret.penalties.totalPenalty,
          }
        : null,
    },
    taxYear: {
      id: taxYear.id,
      year: taxYear.year,
      electedRate: taxYear.electedRate,
      electionStatus: taxYear.electionStatus,
    },
    taxpayer: {
      fullName: profile.fullName,
      tin: profile.tin,
      rdoCode: profile.rdoCode,
      registeredAddress: profile.registeredAddress,
      zipCode: profile.zipCode,
      email: profile.email,
      phoneNumber: profile.phoneNumber,
      natureOfBusiness: profile.natureOfBusiness,
      incomeType: profile.incomeType,
      corIncludes2551Q: profile.corIncludes2551Q,
    },
    certificates: taxYear.certificates.map((c) => ({
      quarter: c.quarter,
      payorTin: c.payorTin,
      payorName: c.payorName,
      atcCode: c.atcCode,
      month1Amount: c.month1Amount,
      month2Amount: c.month2Amount,
      month3Amount: c.month3Amount,
      quarterlyTotal: c.quarterlyTotal,
      cwtWithheld: c.cwtWithheld,
    })),
    priorYearCredit: taxYear.priorYearCredit
      ? { amount: taxYear.priorYearCredit.amount }
      : null,
    overpayment: taxYear.overpayment
      ? { disposition: taxYear.overpayment.disposition }
      : null,
    allReturns: taxYear.returns.map((r) => ({
      formType: r.formType,
      quarter: r.quarter,
      netTaxDue: r.netTaxDue,
    })),
  }
}

export function FilingPdfElement(data: FilingPdfData): React.ReactElement<DocumentProps> {
  switch (data.ret.formType) {
    case 'FORM_2551Q':
      return <Form2551Q data={data} />
    case 'FORM_1701Q':
      return <Form1701Q data={data} />
    case 'FORM_1701A':
      return <Form1701A data={data} />
    case 'FORM_1701':
      return <Form1701 data={data} />
    default:
      return (
        <ReturnPdf
          formType={data.ret.formType}
          quarter={data.ret.quarter}
          taxYear={data.taxYear.year}
          taxpayerName={data.taxpayer.fullName}
          tin={data.taxpayer.tin}
          computedTaxDue={data.ret.computedTaxDue?.toString() ?? '0.00'}
          netTaxDue={data.ret.netTaxDue?.toString() ?? '0.00'}
          overpaymentAmt={data.ret.overpaymentAmt?.toString() ?? '0.00'}
        />
      )
  }
}

export async function renderFilingPdf(returnId: string, userId: string): Promise<Buffer | null> {
  const data = await loadFilingData(returnId, userId)
  if (!data) return null
  // Issue #159: 1701A renders as a flat overlay on the official BIR PDF
  // (high-fidelity facsimile). 1701Q, 2551Q, and 1701 still use the
  // react-pdf templates until their overlays are built.
  if (data.ret.formType === 'FORM_1701A') {
    const result = await renderForm1701AOverlay(data)
    return Buffer.from(result.bytes)
  }
  return renderToBuffer(FilingPdfElement(data))
}
