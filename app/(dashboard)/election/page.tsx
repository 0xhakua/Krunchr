'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ElectionSkeleton } from './loading'

type ElectionPath = 'ITEM_13_2551Q_Q1' | 'ITEM_16_1701Q_Q1' | 'FORM_1905'

type ElectionStatus = {
  electionStatus: string
  electedRate: string | null
  electionPath: ElectionPath
  electionMethod: ElectionPath
  electionDate: string | null
  electionLockedAt: string | null
  osdElection: boolean
  canElect: boolean
  defaultElectionPath: ElectionPath
  firstReturnFiled: boolean
}

const PATH_LABELS: Record<ElectionPath, string> = {
  ITEM_13_2551Q_Q1: 'Item 13 on Q1 Form 2551Q (standard 8-return path)',
  ITEM_16_1701Q_Q1: 'Item 16 on Q1 Form 1701Q (4-return path; COR does not include 2551Q)',
  FORM_1905: 'BIR Form 1905 (COR update filed with RDO)',
}

const disclosures = [
  'Election is irrevocable for the entire taxable year.',
  'Percentage tax is eliminated (if 2551Q applies, tax due = ₱0.00 on all quarters).',
  'BIR Form 1701A is the required annual return (or 1701 for mixed-income earners).',
  'Financial Statements are NOT required.',
]

export default function ElectionPage() {
  const router = useRouter()
  const [status, setStatus] = useState<ElectionStatus | null>(null)
  const [selectedPath, setSelectedPath] = useState<ElectionPath | ''>('')
  const [selectedRate, setSelectedRate] = useState<'RATE_8PCT' | 'GRADUATED' | ''>('')
  // S7.6 (#117): 40% Optional Standard Deduction election. Hidden when
  // the chosen rate is 8% (mutually exclusive under NIRC Sec 24(A)(2));
  // shown only under GRADUATED.
  const [osdElection, setOsdElection] = useState(false)
  const [acknowledged, setAcknowledged] = useState<boolean[]>([false, false, false, false])
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function fetchStatus() {
      try {
        const res = await fetch('/api/election')
        const data = await res.json()
        if (!cancelled) {
          if (!res.ok) {
            setError(data.error || 'Failed to load election status')
            return
          }
          setStatus(data)
          setSelectedPath(data.electionMethod || data.defaultElectionPath)
          if (data.electedRate) {
            setSelectedRate(data.electedRate)
          }
          if (typeof data.osdElection === 'boolean') {
            setOsdElection(data.osdElection)
          }
        }
      } catch {
        if (!cancelled) setError('Failed to load election status')
      }
    }
    fetchStatus()
    return () => {
      cancelled = true
    }
  }, [])

  function allAcknowledged() {
    return acknowledged.every(Boolean)
  }

  function openConfirm() {
    if (!selectedPath) {
      setError('Please select an election path')
      return
    }
    if (!selectedRate) {
      setError('Please select a tax rate option')
      return
    }
    setError('')
    setConfirmOpen(true)
  }

  async function confirmElection() {
    if (selectedRate === 'RATE_8PCT' && !allAcknowledged()) {
      setError('You must acknowledge all disclosures')
      return
    }

    setLoading(true)
    setError('')

    try {
    const res = await fetch('/api/election', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        electedRate: selectedRate,
        electionPath: selectedPath,
        disclosuresAcknowledged: selectedRate === 'RATE_8PCT' ? allAcknowledged() : true,
        osdElection: selectedRate === 'GRADUATED' ? osdElection : false,
      }),
    })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to record election')
        return
      }
      setConfirmOpen(false)
      router.push('/dashboard')
    } catch {
      setError('Failed to record election')
    } finally {
      setLoading(false)
    }
  }

  if (!status) {
    return <ElectionSkeleton />
  }

  return (
    <div className="max-w-2xl mx-auto py-8 space-y-6">
      <h1 className="text-2xl font-bold">Tax Rate Election</h1>

      {status.electionLockedAt ? (
        <Card>
          <CardHeader>
            <CardTitle>Election Locked</CardTitle>
            <CardDescription>
              You have already elected for this taxable year. The election is irrevocable.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <p>
              <strong>Selected rate:</strong>{' '}
              {status.electedRate === 'RATE_8PCT' ? '8% Income Tax Rate' : 'Graduated Income Tax Rate'}
            </p>
            <p>
              <strong>Election method:</strong>{' '}
              {PATH_LABELS[status.electionMethod]}
            </p>
            {status.electionMethod === 'FORM_1905' && (
              <p>
                <strong>Recorded as:</strong> {PATH_LABELS[status.electionPath]}
              </p>
            )}
            <p>
              <strong>Locked at:</strong>{' '}
              {status.electionLockedAt ? new Date(status.electionLockedAt).toLocaleString() : 'N/A'}
            </p>
          </CardContent>
        </Card>
      ) : !status.canElect ? (
        <Card>
          <CardHeader>
            <CardTitle>Election Closed</CardTitle>
            <CardDescription>
              The first quarterly return has already been filed, so the election can no longer be
              made or changed for this tax year.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Election Path</CardTitle>
              <CardDescription>
                Choose how the 8% election is recorded with the BIR.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <RadioGroup
                value={selectedPath}
                onValueChange={(v) => setSelectedPath(v as ElectionPath)}
              >
                {(Object.keys(PATH_LABELS) as ElectionPath[]).map((path) => (
                  <div key={path} className="flex items-start space-x-3 rounded-md border p-4">
                    <RadioGroupItem value={path} id={path} />
                    <div className="grid gap-1">
                      <Label htmlFor={path} className="font-medium">
                        {path === 'FORM_1905'
                          ? 'Form 1905 (COR update)'
                          : path === 'ITEM_13_2551Q_Q1'
                            ? 'Item 13 on Q1 2551Q'
                            : 'Item 16 on Q1 1701Q'}
                      </Label>
                      <span className="text-sm text-muted-foreground">{PATH_LABELS[path]}</span>
                    </div>
                  </div>
                ))}
              </RadioGroup>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Select Tax Rate</CardTitle>
              <CardDescription>
                Election path: {selectedPath ? PATH_LABELS[selectedPath as ElectionPath] : '—'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <RadioGroup value={selectedRate} onValueChange={(v) => setSelectedRate(v as typeof selectedRate)}>
                <div className="flex items-start space-x-3 rounded-md border p-4">
                  <RadioGroupItem value="GRADUATED" id="graduated" />
                  <div className="grid gap-1">
                    <Label htmlFor="graduated" className="font-medium">
                      (A) Graduated Income Tax Rate on Net Taxable Income
                    </Label>
                    <span className="text-sm text-muted-foreground">
                      Standard graduated tax table with deductions. Not yet fully implemented for
                      computation preview.
                    </span>
                  </div>
                </div>
                <div className="flex items-start space-x-3 rounded-md border p-4">
                  <RadioGroupItem value="RATE_8PCT" id="eight-pct" />
                  <div className="grid gap-1">
                    <Label htmlFor="eight-pct" className="font-medium">
                      (B) 8% Income Tax Rate on Gross Sales/Receipts/Others
                    </Label>
                    <span className="text-sm text-muted-foreground">
                      Flat 8% on gross receipts less ₱250,000 exemption (no exemption for mixed-income
                      earners).
                    </span>
                  </div>
                </div>
              </RadioGroup>

              {selectedRate === 'GRADUATED' && (
                <div className="rounded-md border p-4">
                  <div className="flex items-start space-x-3">
                    <Checkbox
                      id="osd-election"
                      checked={osdElection}
                      onCheckedChange={(checked) => setOsdElection(checked === true)}
                    />
                    <div className="grid gap-1">
                      <Label htmlFor="osd-election" className="font-medium">
                        40% Optional Standard Deduction (OSD)
                      </Label>
                      <span className="text-sm text-muted-foreground">
                        OSD replaces the ₱250,000 statutory exemption with a flat 40% deduction
                        of gross receipts. Valid only under the graduated rate. The 8% flat rate
                        is computed on gross receipts and does not allow itemised or standard
                        deductions, so OSD is hidden when 8% is selected.
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {error && <p className="text-sm text-red-600">{error}</p>}

              <Button onClick={openConfirm} disabled={!selectedRate}>Continue to Confirmation</Button>
            </CardContent>
          </Card>

          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Confirm Election</DialogTitle>
                <DialogDescription>
                  {selectedRate === 'RATE_8PCT'
                    ? 'You are electing the 8% flat income tax rate. Please acknowledge all disclosures.'
                    : 'You are electing the graduated income tax rate.'}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-4">
                {selectedRate === 'RATE_8PCT' &&
                  disclosures.map((text, i) => (
                    <div key={i} className="flex items-start space-x-3">
                      <Checkbox
                        id={`disclosure-${i}`}
                        checked={acknowledged[i]}
                        onCheckedChange={(checked) => {
                          setAcknowledged((prev) => {
                            const next = [...prev]
                            next[i] = checked === true
                            return next
                          })
                        }}
                      />
                      <Label htmlFor={`disclosure-${i}`} className="font-normal text-sm">
                        {text}
                      </Label>
                    </div>
                  ))}

                {selectedRate === 'GRADUATED' && (
                  <p className="text-sm text-muted-foreground">
                    Graduated-rate tax computations are not yet implemented. Your election will be
                    recorded, but return previews will remain unavailable until graduated logic is
                    added.
                  </p>
                )}

                {error && <p className="text-sm text-red-600">{error}</p>}

                <Button
                  className="w-full"
                  onClick={confirmElection}
                  disabled={loading || (selectedRate === 'RATE_8PCT' && !allAcknowledged())}
                >
                  {loading ? 'Confirming...' : 'Confirm Election'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  )
}
