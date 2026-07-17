'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageShell } from '@/components/ui/page-shell'
import { PageHeader } from '@/components/ui/page-header'
import { ShieldCheck, ArrowRight, ScanLine } from 'lucide-react'

const TX_ID_REGEX = /^[a-f0-9]{64}$/i

export default function VerifyLandingPage() {
  const router = useRouter()
  const [txId, setTxId] = useState('')
  const [error, setError] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = txId.trim()
    if (!TX_ID_REGEX.test(trimmed)) {
      setError('Please enter a valid 64-character Stellar transaction ID')
      return
    }
    setError('')
    router.push(`/verify/${trimmed}`)
  }

  return (
    <PageShell>
      <PageHeader
        title="Verify a Krunchr filing"
        description="Confirm a BIR return was filed and anchored on the Stellar blockchain."
      />

      <div className="mx-auto w-full max-w-xl">
        <Card>
          <CardHeader className="space-y-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <CardTitle>Enter a Stellar transaction ID</CardTitle>
            </div>
            <CardDescription>
              Paste the transaction ID from a Krunchr filing receipt, or scan the
              QR code on the receipt to be taken here automatically.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-4">
              <ScanLine className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Where do I find this?</p>
                <p className="text-sm text-muted-foreground">
                  Every filed return has a QR code on the Stellar Receipts page.
                  The transaction ID is the long string after
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">/verify/</code>
                  in the link below the QR code.
                </p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="txId">Stellar transaction ID</Label>
                <Input
                  id="txId"
                  value={txId}
                  onChange={(e) => setTxId(e.target.value)}
                  placeholder="e.g. abc123…"
                  className="font-mono"
                />
                {error && (
                  <p className="text-sm text-red-600">{error}</p>
                )}
              </div>
              <Button type="submit">
                Verify
                <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  )
}
