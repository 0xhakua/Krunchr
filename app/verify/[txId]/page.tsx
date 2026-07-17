'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { PageShell } from '@/components/ui/page-shell'
import { PageHeader } from '@/components/ui/page-header'
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  ExternalLink,
  Upload,
  FileCheck2,
  ShieldCheck,
  Copy,
  Check,
} from 'lucide-react'

interface VerifyResponse {
  txId: string
  returnId: string
  network: 'testnet' | 'mainnet'
  sourceAccount: string | null
  ledgerCreatedAt: string | null
  onChainHash: string | null
  onChainTimestamp: string | null
  explorerUrl: string
  status: 'CONFIRMED' | 'NOT_FOUND'
  return: {
    formType: string
    quarter: number | null
    taxYear: number
  } | null
}

async function sha256Hex(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  const bytes = new Uint8Array(digest)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function formatForm(returnData: VerifyResponse['return']): string {
  if (!returnData) return 'Unknown return'
  const form = returnData.formType.replace('FORM_', '')
  return returnData.quarter ? `${form} Q${returnData.quarter}` : form
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-PH', {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
  } catch {
    return iso
  }
}

function useCopy(timeout = 1500) {
  const [copied, setCopied] = useState(false)

  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), timeout)
      } catch {
        setCopied(false)
      }
    },
    [timeout]
  )

  return { copied, copy }
}

function CopyButton({ value }: { value: string }) {
  const { copied, copy } = useCopy()

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 px-2 text-muted-foreground"
      onClick={() => copy(value)}
    >
      {copied ? (
        <>
          <Check className="mr-1 h-3.5 w-3.5" />
          Copied
        </>
      ) : (
        <>
          <Copy className="mr-1 h-3.5 w-3.5" />
          Copy
        </>
      )}
    </Button>
  )
}

export default function VerifyPage() {
  const params = useParams()
  const txId = (params?.txId as string) ?? ''

  const [data, setData] = useState<VerifyResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [file, setFile] = useState<File | null>(null)
  const [fileHash, setFileHash] = useState<string | null>(null)
  const [comparing, setComparing] = useState(false)
  const [dragActive, setDragActive] = useState(false)

  const verifierUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/verify/${txId}`
      : `/verify/${txId}`

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!txId) {
        setError('Missing transaction ID')
        setLoading(false)
        return
      }

      try {
        const res = await fetch(`/api/public/verify/${txId}`)
        const json = await res.json()
        if (cancelled) return
        if (!res.ok) {
          setError(json.error || 'Unable to verify this receipt')
          return
        }
        setData(json)
      } catch {
        if (!cancelled) setError('Unable to verify this receipt')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [txId])

  const compareFile = useCallback(async (selectedFile: File) => {
    setFile(selectedFile)
    setComparing(true)
    setFileHash(null)
    try {
      const hash = await sha256Hex(selectedFile)
      setFileHash(hash)
    } catch {
      setFileHash(null)
    } finally {
      setComparing(false)
    }
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragActive(false)
      const dropped = e.dataTransfer.files[0]
      if (dropped) compareFile(dropped)
    },
    [compareFile]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragActive(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragActive(false)
  }, [])

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = e.target.files?.[0]
      if (selected) compareFile(selected)
    },
    [compareFile]
  )

  const hashMatch =
    fileHash && data?.onChainHash
      ? fileHash.toLowerCase() === data.onChainHash.toLowerCase()
      : null

  return (
    <PageShell>
      <PageHeader
        title="Verify a Krunchr filing"
        description="Confirm a BIR return was filed and anchored on the Stellar blockchain."
      />

      {loading && (
        <Card className="p-2">
          <CardHeader className="space-y-3">
            <Skeleton className="h-7 w-56" />
            <Skeleton className="h-4 w-80" />
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
            <Skeleton className="h-10 w-40" />
          </CardContent>
        </Card>
      )}

      {!loading && error && (
        <Card className="border-red-200">
          <CardHeader className="space-y-1">
            <div className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-red-600" />
              <CardTitle>Receipt not verified</CardTitle>
            </div>
            <CardDescription>
              We could not confirm this transaction as a Krunchr filing receipt.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-red-600">{error}</p>
            <div className="rounded-lg bg-muted/40 p-3">
              <Label className="text-muted-foreground text-xs">Transaction ID</Label>
              <div className="flex items-center justify-between gap-3">
                <p className="font-mono text-sm break-all">{txId}</p>
                <CopyButton value={txId} />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {!loading && data && (
        <div className="space-y-6">
          <Card
            className={
              data.status === 'CONFIRMED'
                ? 'border-green-200 bg-green-50/30'
                : 'border-red-200'
            }
          >
            <CardHeader className="space-y-2 pb-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  {data.status === 'CONFIRMED' ? (
                    <CheckCircle2 className="h-6 w-6 text-green-600" />
                  ) : (
                    <AlertCircle className="h-6 w-6 text-red-600" />
                  )}
                  <CardTitle>
                    {data.status === 'CONFIRMED'
                      ? 'Filing receipt verified'
                      : 'Receipt not found'}
                  </CardTitle>
                </div>
                <Badge
                  variant="outline"
                  className={
                    data.network === 'mainnet'
                      ? 'border-blue-200 text-blue-700'
                      : 'border-purple-200 text-purple-700'
                  }
                >
                  {data.network}
                </Badge>
              </div>
              <CardDescription>
                {data.return
                  ? `${formatForm(data.return)} — Tax Year ${data.return.taxYear}`
                  : 'On-chain filing receipt'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="rounded-lg border bg-background p-4 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <Label className="text-muted-foreground">Public verifier link</Label>
                  <CopyButton value={verifierUrl} />
                </div>
                <a
                  href={verifierUrl}
                  className="block font-mono text-sm text-primary break-all hover:underline"
                >
                  {verifierUrl}
                </a>
              </div>

              <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
                <div>
                  <Label className="text-muted-foreground">Transaction ID</Label>
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-mono text-sm break-all">{data.txId}</p>
                    <CopyButton value={data.txId} />
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Anchored at</Label>
                  <p className="text-sm">{formatDate(data.onChainTimestamp)}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Return ID</Label>
                  <p className="font-mono text-sm break-all">{data.returnId}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Ledger timestamp</Label>
                  <p className="text-sm">{formatDate(data.ledgerCreatedAt)}</p>
                </div>
                <div className="sm:col-span-2">
                  <Label className="text-muted-foreground">Anchored SHA-256 hash</Label>
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-mono text-sm break-all">{data.onChainHash}</p>
                    {data.onChainHash && <CopyButton value={data.onChainHash} />}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-2">
                <a href={data.explorerUrl} target="_blank" rel="noreferrer">
                  <Button variant="outline" size="sm">
                    <ExternalLink className="mr-1 h-4 w-4" />
                    View raw transaction
                  </Button>
                </a>
                <Link href="/verify">
                  <Button variant="outline" size="sm">
                    Verify another receipt
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="space-y-2 pb-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary" />
                <CardTitle>Check the filing PDF</CardTitle>
              </div>
              <CardDescription>
                Drop the taxpayer&apos;s PDF here to compare its SHA-256 hash against
                the one anchored on Stellar. The check happens in your browser —
                the file is not uploaded.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                className={`
                  relative rounded-xl border-2 border-dashed p-8 text-center transition-colors
                  ${dragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'}
                  ${comparing ? 'opacity-70' : ''}
                `}
              >
                <input
                  id="pdf-input"
                  type="file"
                  accept=".pdf,application/pdf"
                  onChange={handleInputChange}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
                <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
                <p className="mt-2 text-sm font-medium">
                  {comparing ? 'Computing hash…' : 'Drop a PDF or click to browse'}
                </p>
                <p className="text-xs text-muted-foreground">
                  Only PDF files are accepted
                </p>
              </div>

              {file && (
                <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <FileCheck2 className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">{file.name}</span>
                  </div>

                  {fileHash && (
                    <>
                      <div>
                        <Label className="text-muted-foreground text-xs">
                          Computed hash
                        </Label>
                        <p className="font-mono text-xs break-all">{fileHash}</p>
                      </div>

                      {hashMatch === true && (
                        <div className="flex items-center gap-2 text-green-700">
                          <CheckCircle2 className="h-5 w-5" />
                          <span className="font-medium">Hash matches on-chain record</span>
                        </div>
                      )}
                      {hashMatch === false && (
                        <div className="flex items-center gap-2 text-red-700">
                          <XCircle className="h-5 w-5" />
                          <span className="font-medium">
                            Hash does not match the on-chain record
                          </span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </PageShell>
  )
}
