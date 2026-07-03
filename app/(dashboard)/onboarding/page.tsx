'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { extractApiErrorMessage } from '@/lib/api-error'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { VatBreachBanner } from '@/components/dashboard/vat-breach-banner'
import { LocationPicker } from '@/components/location-picker'
import { type ZipCodeEntry } from '@/lib/data/zip-codes'

type ATCCode = {
  code: string
  description: string
  ewtRate: number
}

type EligibilityCheck = {
  passed: boolean
  checks: {
    individual: boolean
    selfEmploymentIncome: boolean
    nonVatRegistered: boolean
    belowVatThreshold: boolean
    noPriorQ1GraduatedReturn: boolean
  }
  grossReceipts: string
  vatThreshold: string
}

const steps = ['Personal Information', 'Eligibility Check', 'ATC Codes', 'Tax Year']

function formatTin(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 12)
  const parts: string[] = []
  if (digits.length > 0) parts.push(digits.slice(0, 3))
  if (digits.length > 3) parts.push(digits.slice(3, 6))
  if (digits.length > 6) parts.push(digits.slice(6, 9))
  if (digits.length > 9) parts.push(digits.slice(9, 12))
  return parts.join('-')
}

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  const [atcCodes, setAtcCodes] = useState<ATCCode[]>([])

  const [form, setForm] = useState({
    tin: '',
    firstName: '',
    lastName: '',
    middleInitial: '',
    rdoCode: '',
    registeredAddress: '',
    cityMunicipality: '',
    province: '',
    zipCode: '',
    natureOfBusiness: '',
    incomeType: 'PURE_SELF_EMPLOYMENT',
    corIncludes2551Q: 'true',
    isNewRegistrant: 'false',
    selectedAtcCodes: [] as string[],
    taxYear: new Date().getFullYear(),
  })

  const [eligibility, setEligibility] = useState<EligibilityCheck | null>(null)

  useEffect(() => {
    fetch('/api/atc')
      .then((res) => res.json())
      .then((data) => setAtcCodes(data.codes || []))
      .catch(() => setError('Failed to load ATC codes'))
  }, [])

  function updateField(field: string, value: string | number | boolean) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  function selectLocation(entry: ZipCodeEntry | null) {
    if (!entry) {
      setForm((prev) => ({
        ...prev,
        zipCode: '',
        cityMunicipality: '',
        province: '',
      }))
      return
    }
    setForm((prev) => ({
      ...prev,
      zipCode: entry.zipCode,
      cityMunicipality: entry.cityMunicipality,
      province: entry.province,
      registeredAddress:
        prev.registeredAddress.trim() ||
        `${entry.cityMunicipality}, ${entry.province}`,
    }))
  }

  function toggleAtc(code: string) {
    setForm((prev) => ({
      ...prev,
      selectedAtcCodes: prev.selectedAtcCodes.includes(code)
        ? prev.selectedAtcCodes.filter((c) => c !== code)
        : [...prev.selectedAtcCodes, code],
    }))
  }

  async function checkEligibility() {
    setLoading(true)
    setError('')
    setFieldErrors({})
    try {
      const res = await fetch('/api/taxpayer/eligibility', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incomeType: form.incomeType,
          grossReceipts: '0',
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(extractErrorMessage(data, 'Eligibility check failed'))
        return
      }
      setEligibility(data)
      setStep(1)
    } catch {
      setError('Eligibility check failed')
    } finally {
      setLoading(false)
    }
  }

  async function submit() {
    setLoading(true)
    setError('')
    setFieldErrors({})
    try {
      const res = await fetch('/api/taxpayer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tin: form.tin,
          firstName: form.firstName,
          lastName: form.lastName,
          middleInitial: form.middleInitial || undefined,
          rdoCode: form.rdoCode,
          registeredAddress: form.registeredAddress,
          zipCode: form.zipCode,
          natureOfBusiness: form.natureOfBusiness,
          incomeType: form.incomeType,
          corIncludes2551Q: form.corIncludes2551Q === 'true',
          isNewRegistrant: form.isNewRegistrant === 'true',
          atcCodes: form.selectedAtcCodes,
          taxYear: form.taxYear,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(extractErrorMessage(data, 'Failed to complete onboarding'))
        if (data && typeof data === 'object' && data.fieldErrors && typeof data.fieldErrors === 'object') {
          setFieldErrors(data.fieldErrors as Record<string, string[]>)
        }
        return
      }
      router.push('/dashboard')
    } catch {
      setError('Failed to complete onboarding')
    } finally {
      setLoading(false)
    }
  }

  function extractErrorMessage(data: unknown, fallback: string): string {
    // Prefer a specific field/form error over the API's generic "Validation failed"
    // placeholder so the user sees *what* to fix in the toast, not just that
    // something is wrong.
    return extractApiErrorMessage(data, fallback)
  }

  function fieldError(name: string): string | null {
    const arr = fieldErrors[name]
    return Array.isArray(arr) && arr.length > 0 ? arr[0] : null
  }

  function renderStep() {
    switch (step) {
      case 0:
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name</Label>
                <Input
                  id="firstName"
                  value={form.firstName}
                  onChange={(e) => updateField('firstName', e.target.value)}
                  required
                />
                {fieldError('firstName') && (
                  <p className="text-sm text-red-600">{fieldError('firstName')}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  id="lastName"
                  value={form.lastName}
                  onChange={(e) => updateField('lastName', e.target.value)}
                  required
                />
                {fieldError('lastName') && (
                  <p className="text-sm text-red-600">{fieldError('lastName')}</p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="middleInitial">Middle Initial</Label>
                <Input
                  id="middleInitial"
                  value={form.middleInitial}
                  onChange={(e) => updateField('middleInitial', e.target.value.toUpperCase())}
                  maxLength={2}
                />
                {fieldError('middleInitial') && (
                  <p className="text-sm text-red-600">{fieldError('middleInitial')}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="tin">TIN (NNN-NNN-NNN-NNNN)</Label>
                <Input
                  id="tin"
                  value={form.tin}
                  onChange={(e) => updateField('tin', formatTin(e.target.value))}
                  placeholder="000-000-000-0000"
                  required
                />
                {fieldError('tin') && (
                  <p className="text-sm text-red-600">{fieldError('tin')}</p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="rdoCode">RDO Code</Label>
                <Input
                  id="rdoCode"
                  value={form.rdoCode}
                  onChange={(e) => updateField('rdoCode', e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="zipCode">ZIP Code</Label>
                <LocationPicker
                  id="zipCode"
                  value={form.zipCode}
                  onChange={selectLocation}
                  placeholder="Search ZIP code, city, or province"
                />
                {fieldError('zipCode') && (
                  <p className="text-sm text-red-600">{fieldError('zipCode')}</p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="cityMunicipality">City / Municipality</Label>
                <Input
                  id="cityMunicipality"
                  value={form.cityMunicipality}
                  readOnly
                  placeholder="Auto-filled from ZIP code"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="province">Province</Label>
                <Input
                  id="province"
                  value={form.province}
                  readOnly
                  placeholder="Auto-filled from ZIP code"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="registeredAddress">Registered Address</Label>
              <Input
                id="registeredAddress"
                value={form.registeredAddress}
                onChange={(e) => updateField('registeredAddress', e.target.value)}
                placeholder="Street address, barangay"
                required
              />
              <p className="text-xs text-muted-foreground">
                Add your street address; city and province are filled from the ZIP code picker.
              </p>
              {fieldError('registeredAddress') && (
                <p className="text-sm text-red-600">{fieldError('registeredAddress')}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="natureOfBusiness">Nature of Business / Profession</Label>
              <Input
                id="natureOfBusiness"
                value={form.natureOfBusiness}
                onChange={(e) => updateField('natureOfBusiness', e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="incomeType">Nature of Income</Label>
              <Select
                value={form.incomeType}
                onValueChange={(value) => value && updateField('incomeType', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select income type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PURE_SELF_EMPLOYMENT">Pure Self-Employment</SelectItem>
                  <SelectItem value="MIXED_INCOME">Mixed Income (Salary + Freelance)</SelectItem>
                </SelectContent>
              </Select>
              {form.incomeType === 'MIXED_INCOME' && (
                <div
                  className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
                  role="note"
                  aria-label="Mixed income consequences"
                >
                  <p className="font-medium">Mixed-income consequences</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    <li>
                      The ₱250,000 statutory exemption does not apply to your
                      freelance income — it is already consumed by your
                      compensation side.
                    </li>
                    <li>
                      Your annual return will be <strong>Form 1701</strong>,
                      not Form 1701A.
                    </li>
                    <li>
                      Graduated rate and OSD (40%) election remain available
                      for the 1701 path.
                    </li>
                  </ul>
                  <p className="mt-2 text-xs text-amber-800">
                    Legal basis: RR No. 8-2018 Sec. 3(D); RMC No. 50-2018.
                  </p>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label>COR includes 2551Q?</Label>
              <RadioGroup
                value={form.corIncludes2551Q}
                onValueChange={(value) => updateField('corIncludes2551Q', value)}
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="true" id="cor-yes" />
                  <Label htmlFor="cor-yes" className="font-normal">Yes — 8-return filing path</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="false" id="cor-no" />
                  <Label htmlFor="cor-no" className="font-normal">No — 4-return filing path (1701Q only)</Label>
                </div>
              </RadioGroup>
            </div>
            <div className="space-y-2">
              <Label>Are you a new BIR registrant?</Label>
              <RadioGroup
                value={form.isNewRegistrant}
                onValueChange={(value) => updateField('isNewRegistrant', value)}
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="true" id="new-reg-yes" />
                  <Label htmlFor="new-reg-yes" className="font-normal">
                    Yes — elected 8% on Form 1901 at initial registration
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="false" id="new-reg-no" />
                  <Label htmlFor="new-reg-no" className="font-normal">
                    No — election must be made via 2551Q/1701Q Item or Form 1905
                  </Label>
                </div>
              </RadioGroup>
              <p className="text-sm text-muted-foreground">
                Annual registration fee: ₱30 Documentary Stamp Tax only. The ₱500 BIR registration fee was abolished under RA 11976.
              </p>
            </div>
          </div>
        )
      case 1:
        return (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              All 5 conditions must pass to use the 8% flat income tax rate.
            </p>
            {eligibility && !eligibility.checks.belowVatThreshold && <VatBreachBanner />}
            {eligibility && (
              <div className="space-y-2">
                {Object.entries(eligibility.checks).map(([key, passed]) => (
                  <div
                    key={key}
                    className={`flex justify-between rounded-md border p-3 ${
                      passed ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
                    }`}
                  >
                    <span className="capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                    <span className={passed ? 'text-green-700' : 'text-red-700'}>
                      {passed ? 'Pass' : 'Fail'}
                    </span>
                  </div>
                ))}
                <p className="text-sm">
                  Gross receipts: ₱{Number(eligibility.grossReceipts).toLocaleString()} /
                  VAT threshold: ₱{Number(eligibility.vatThreshold).toLocaleString()}
                </p>
              </div>
            )}
          </div>
        )
      case 2:
        return (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Select all ATC codes that apply to your freelance work.</p>
            <div className="grid gap-3">
              {atcCodes.map((atc) => (
                <div key={atc.code} className="flex items-start space-x-3 rounded-md border p-3">
                  <Checkbox
                    id={atc.code}
                    checked={form.selectedAtcCodes.includes(atc.code)}
                    onCheckedChange={() => toggleAtc(atc.code)}
                  />
                  <div className="grid gap-1">
                    <Label htmlFor={atc.code} className="font-normal">
                      {atc.code} — {atc.description}
                    </Label>
                    <span className="text-sm text-muted-foreground">EWT rate: {(atc.ewtRate * 100).toFixed(0)}%</span>
                  </div>
                </div>
              ))}
            </div>
            {fieldError('atcCodes') && (
              <p className="text-sm text-red-600">{fieldError('atcCodes')}</p>
            )}
          </div>
        )
      case 3:
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="taxYear">Active Taxable Year</Label>
              <Input
                id="taxYear"
                type="number"
                value={form.taxYear}
                onChange={(e) => updateField('taxYear', Number(e.target.value))}
                required
              />
              {fieldError('taxYear') && (
                <p className="text-sm text-red-600">{fieldError('taxYear')}</p>
              )}
            </div>
            <div className="rounded-md border p-4 text-sm">
              <p className="font-medium">Filing sequence preview:</p>
              <p className="text-muted-foreground">
                {form.corIncludes2551Q === 'true'
                  ? '8 returns: 2551Q Q1–Q4, 1701Q Q1–Q3, 1701A'
                  : '4 returns: 1701Q Q1–Q3, 1701A'}
              </p>
            </div>
          </div>
        )
    }
  }

  return (
    <div className="max-w-2xl mx-auto py-8">
      <Card>
        <CardHeader>
          <CardTitle>Onboarding</CardTitle>
          <CardDescription>Step {step + 1} of {steps.length}: {steps[step]}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {error && <p className="text-sm text-red-600">{error}</p>}
          {renderStep()}
          <div className="flex justify-between pt-4">
            <Button
              variant="outline"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0 || loading}
            >
              Back
            </Button>
            {step < steps.length - 1 ? (
              <Button
                onClick={() => {
                  if (step === 0) {
                    checkEligibility()
                  } else {
                    setStep((s) => s + 1)
                  }
                }}
                disabled={loading}
              >
                {step === 0 ? 'Check Eligibility' : 'Next'}
              </Button>
            ) : (
              <Button onClick={submit} disabled={loading}>
                {loading ? 'Completing...' : 'Complete Onboarding'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
