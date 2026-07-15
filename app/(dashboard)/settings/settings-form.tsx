'use client'

import { useState } from 'react'
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
import { PageShell } from '@/components/ui/page-shell'
import { PageHeader } from '@/components/ui/page-header'
import { LocationPicker } from '@/components/location-picker'
import { type ZipCodeEntry } from '@/lib/data/zip-codes'
import { CIVIL_STATUS_OPTIONS } from '@/lib/validation/schemas'

type ATCCode = {
  code: string
  description: string
  ewtRate: number
}

export type SettingsProfile = {
  tin: string
  firstName: string
  lastName: string
  middleInitial: string
  rdoCode: string
  phoneNumber: string
  email: string
  registeredAddress: string
  zipCode: string
  natureOfBusiness: string
  citizenship: string
  civilStatus: string
  claimingForeignTaxCredits: boolean
  foreignTaxNumber: string
  incomeType: string
  corIncludes2551Q: boolean
  isNewRegistrant: boolean
  selectedAtcCodes: string[]
}

interface SettingsFormProps {
  profile: SettingsProfile
  atcCodes: ATCCode[]
  activeTaxYear: number | null
  structuralLocked: boolean
}

type FormValues = Omit<SettingsProfile, 'claimingForeignTaxCredits' | 'corIncludes2551Q' | 'isNewRegistrant'> & {
  claimingForeignTaxCredits: string
  corIncludes2551Q: string
  isNewRegistrant: string
  cityMunicipality: string
  province: string
}

function formatTin(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 12)
  const parts: string[] = []
  if (digits.length > 0) parts.push(digits.slice(0, 3))
  if (digits.length > 3) parts.push(digits.slice(3, 6))
  if (digits.length > 6) parts.push(digits.slice(6, 9))
  if (digits.length > 9) parts.push(digits.slice(9, 12))
  return parts.join('-')
}

// Client-side rules mirror taxpayerUpdateSchema in lib/validation/schemas.ts
// so the user sees errors immediately instead of only on save.
const tinPattern = /^\d{3}-\d{3}-\d{3}(-\d{3})?$/
const phonePattern = /^(?:\+63|0)\d{9,11}$/
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function validateField(name: string, form: FormValues): string | null {
  switch (name) {
    case 'firstName':
      return form.firstName.trim() ? null : 'First name is required'
    case 'lastName':
      return form.lastName.trim() ? null : 'Last name is required'
    case 'middleInitial':
      return form.middleInitial.length <= 2
        ? null
        : 'Middle initial must be at most 2 characters'
    case 'tin': {
      const tin = form.tin.trim()
      if (!tin) return 'TIN is required'
      return tinPattern.test(tin)
        ? null
        : 'TIN must be in format NNN-NNN-NNN or NNN-NNN-NNN-NNN'
    }
    case 'rdoCode':
      return form.rdoCode.trim() ? null : 'RDO code is required'
    case 'phoneNumber': {
      const phone = form.phoneNumber.trim()
      if (!phone) return 'Phone number is required'
      return phonePattern.test(phone)
        ? null
        : 'Phone number must be a valid Philippine number (e.g. +639171234567 or 09171234567)'
    }
    case 'email': {
      const email = form.email.trim()
      if (!email) return 'Email is required'
      return emailPattern.test(email) ? null : 'Email must be a valid email address'
    }
    case 'zipCode': {
      const zip = form.zipCode.trim()
      if (!zip) return 'ZIP code is required'
      return /^\d{4}$/.test(zip) ? null : 'ZIP code must be a 4-digit Philippine ZIP code'
    }
    case 'registeredAddress':
      return form.registeredAddress.trim() ? null : 'Registered address is required'
    case 'natureOfBusiness':
      return form.natureOfBusiness.trim() ? null : 'Nature of business is required'
    case 'citizenship':
      return form.citizenship.trim() ? null : 'Citizenship is required'
    case 'civilStatus':
      return CIVIL_STATUS_OPTIONS.includes(form.civilStatus as (typeof CIVIL_STATUS_OPTIONS)[number])
        ? null
        : 'Select a civil status'
    case 'foreignTaxNumber':
      // Only required when the filer claims foreign tax credits ("if applicable").
      if (form.claimingForeignTaxCredits !== 'true') return null
      return form.foreignTaxNumber.trim()
        ? null
        : 'Foreign tax number is required when claiming foreign tax credits'
    case 'atcCodes':
      return form.selectedAtcCodes.length > 0 ? null : 'Select at least one ATC code'
    default:
      return null
  }
}

const VALIDATED_FIELDS = [
  'firstName',
  'lastName',
  'middleInitial',
  'tin',
  'rdoCode',
  'phoneNumber',
  'email',
  'zipCode',
  'registeredAddress',
  'natureOfBusiness',
  'citizenship',
  'civilStatus',
  'foreignTaxNumber',
  'atcCodes',
]

export default function SettingsForm({
  profile,
  atcCodes,
  activeTaxYear,
  structuralLocked,
}: SettingsFormProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  const [touched, setTouched] = useState<Record<string, boolean>>({})

  const [form, setForm] = useState<FormValues>({
    ...profile,
    claimingForeignTaxCredits: String(profile.claimingForeignTaxCredits),
    corIncludes2551Q: String(profile.corIncludes2551Q),
    isNewRegistrant: String(profile.isNewRegistrant),
    cityMunicipality: '',
    province: '',
  })

  // Snapshot of the structural values as last saved, so the form can warn
  // when the user is about to restructure the return slots (#241).
  const [savedStructural, setSavedStructural] = useState({
    incomeType: profile.incomeType,
    corIncludes2551Q: profile.corIncludes2551Q,
  })
  const structuralDirty =
    form.incomeType !== savedStructural.incomeType ||
    form.corIncludes2551Q !== String(savedStructural.corIncludes2551Q)

  function updateField(field: string, value: string | boolean) {
    setForm((prev) => ({ ...prev, [field]: value }))
    setFieldErrors((prev) => {
      if (!prev[field]) return prev
      const next = { ...prev }
      delete next[field]
      return next
    })
  }

  function markTouched(field: string) {
    setTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true }))
  }

  function selectLocation(entry: ZipCodeEntry | null) {
    markTouched('zipCode')
    setFieldErrors((prev) => {
      if (!prev.zipCode) return prev
      const next = { ...prev }
      delete next.zipCode
      return next
    })
    if (!entry) {
      setForm((prev) => ({ ...prev, zipCode: '', cityMunicipality: '', province: '' }))
      return
    }
    setForm((prev) => ({
      ...prev,
      zipCode: entry.zipCode,
      cityMunicipality: entry.cityMunicipality,
      province: entry.province,
      registeredAddress:
        prev.registeredAddress.trim() || `${entry.cityMunicipality}, ${entry.province}`,
    }))
  }

  function toggleAtc(code: string) {
    markTouched('atcCodes')
    setFieldErrors((prev) => {
      if (!prev.atcCodes) return prev
      const next = { ...prev }
      delete next.atcCodes
      return next
    })
    setForm((prev) => ({
      ...prev,
      selectedAtcCodes: prev.selectedAtcCodes.includes(code)
        ? prev.selectedAtcCodes.filter((c) => c !== code)
        : [...prev.selectedAtcCodes, code],
    }))
  }

  function validateAll(): boolean {
    const valid = VALIDATED_FIELDS.every((field) => validateField(field, form) === null)
    if (!valid) {
      setTouched((prev) => {
        const next = { ...prev }
        for (const field of VALIDATED_FIELDS) next[field] = true
        return next
      })
    }
    return valid
  }

  async function save() {
    if (!validateAll()) return

    setLoading(true)
    setError('')
    setSuccess('')
    setFieldErrors({})

    const tin = formatTin(form.tin)

    try {
      const res = await fetch('/api/taxpayer', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tin,
          firstName: form.firstName,
          lastName: form.lastName,
          middleInitial: form.middleInitial || undefined,
          rdoCode: form.rdoCode,
          phoneNumber: form.phoneNumber,
          email: form.email,
          registeredAddress: form.registeredAddress,
          zipCode: form.zipCode,
          natureOfBusiness: form.natureOfBusiness,
          citizenship: form.citizenship,
          civilStatus: form.civilStatus,
          claimingForeignTaxCredits: form.claimingForeignTaxCredits === 'true',
          foreignTaxNumber:
            form.claimingForeignTaxCredits === 'true'
              ? form.foreignTaxNumber || undefined
              : undefined,
          incomeType: form.incomeType,
          corIncludes2551Q: form.corIncludes2551Q === 'true',
          isNewRegistrant: form.isNewRegistrant === 'true',
          atcCodes: form.selectedAtcCodes,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(extractApiErrorMessage(data, 'Failed to save profile'))
        if (data && typeof data === 'object' && 'fieldErrors' in data && data.fieldErrors && typeof data.fieldErrors === 'object') {
          setFieldErrors(data.fieldErrors as Record<string, string[]>)
        }
        return
      }
      setForm((prev) => ({ ...prev, tin }))
      setSavedStructural({
        incomeType: form.incomeType,
        corIncludes2551Q: form.corIncludes2551Q === 'true',
      })
      setSuccess(
        data.restructured
          ? `Profile saved. Your return slots for tax year ${activeTaxYear ?? ''} were rebuilt to match the new settings.`
          : 'Profile saved.'
      )
      router.refresh()
    } catch {
      setError('Failed to save profile')
    } finally {
      setLoading(false)
    }
  }

  function fieldError(name: string): string | null {
    if (touched[name]) {
      const clientError = validateField(name, form)
      if (clientError) return clientError
    }
    const arr = fieldErrors[name]
    return Array.isArray(arr) && arr.length > 0 ? arr[0] : null
  }

  return (
    <PageShell className="max-w-2xl">
      <PageHeader
        title="Profile Settings"
        description="Update your taxpayer profile. Changes apply to your active tax year."
      />

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700" role="status">
          {success}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Taxpayer identity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="firstName">First Name</Label>
              <Input
                id="firstName"
                value={form.firstName}
                onChange={(e) => updateField('firstName', e.target.value)}
                onBlur={() => markTouched('firstName')}
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
                onBlur={() => markTouched('lastName')}
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
                onBlur={() => markTouched('middleInitial')}
                maxLength={2}
              />
              {fieldError('middleInitial') && (
                <p className="text-sm text-red-600">{fieldError('middleInitial')}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="tin">TIN (NNN-NNN-NNN or NNN-NNN-NNN-NNN)</Label>
              <Input
                id="tin"
                value={form.tin}
                onChange={(e) => updateField('tin', formatTin(e.target.value))}
                onBlur={() => markTouched('tin')}
                placeholder="000-000-000"
                maxLength={14}
                required
              />
              {fieldError('tin') && <p className="text-sm text-red-600">{fieldError('tin')}</p>}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="rdoCode">RDO Code</Label>
            <Input
              id="rdoCode"
              value={form.rdoCode}
              onChange={(e) => updateField('rdoCode', e.target.value)}
              onBlur={() => markTouched('rdoCode')}
              required
            />
            {fieldError('rdoCode') && (
              <p className="text-sm text-red-600">{fieldError('rdoCode')}</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="citizenship">Citizenship</Label>
              <Input
                id="citizenship"
                value={form.citizenship}
                onChange={(e) => updateField('citizenship', e.target.value)}
                onBlur={() => markTouched('citizenship')}
                placeholder="Filipino"
                required
              />
              {fieldError('citizenship') && (
                <p className="text-sm text-red-600">{fieldError('citizenship')}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="civilStatus">Civil Status</Label>
              <Select
                value={form.civilStatus}
                onValueChange={(value) => {
                  if (value) updateField('civilStatus', value)
                  markTouched('civilStatus')
                }}
              >
                <SelectTrigger id="civilStatus">
                  <SelectValue placeholder="Select civil status" />
                </SelectTrigger>
                <SelectContent>
                  {CIVIL_STATUS_OPTIONS.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {fieldError('civilStatus') && (
                <p className="text-sm text-red-600">{fieldError('civilStatus')}</p>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Claiming foreign tax credits?</Label>
            <RadioGroup
              value={form.claimingForeignTaxCredits}
              onValueChange={(value) => {
                updateField('claimingForeignTaxCredits', value)
                if (value !== 'true') {
                  updateField('foreignTaxNumber', '')
                }
              }}
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="false" id="ftc-no" />
                <Label htmlFor="ftc-no" className="font-normal">No</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="true" id="ftc-yes" />
                <Label htmlFor="ftc-yes" className="font-normal">Yes</Label>
              </div>
            </RadioGroup>
          </div>
          {form.claimingForeignTaxCredits === 'true' && (
            <div className="space-y-2">
              <Label htmlFor="foreignTaxNumber">Foreign Tax Number</Label>
              <Input
                id="foreignTaxNumber"
                value={form.foreignTaxNumber}
                onChange={(e) => updateField('foreignTaxNumber', e.target.value)}
                onBlur={() => markTouched('foreignTaxNumber')}
                placeholder="Tax identification number in the foreign country"
                required
              />
              {fieldError('foreignTaxNumber') && (
                <p className="text-sm text-red-600">{fieldError('foreignTaxNumber')}</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contact information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="phoneNumber">Phone Number</Label>
              <Input
                id="phoneNumber"
                type="tel"
                value={form.phoneNumber}
                onChange={(e) => updateField('phoneNumber', e.target.value)}
                onBlur={() => markTouched('phoneNumber')}
                placeholder="+639171234567 or 09171234567"
                required
              />
              {fieldError('phoneNumber') && (
                <p className="text-sm text-red-600">{fieldError('phoneNumber')}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={form.email}
                onChange={(e) => updateField('email', e.target.value)}
                onBlur={() => markTouched('email')}
                placeholder="you@example.com"
                required
              />
              {fieldError('email') && (
                <p className="text-sm text-red-600">{fieldError('email')}</p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
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
            <div className="space-y-2">
              <Label htmlFor="cityMunicipality">City / Municipality</Label>
              <Input
                id="cityMunicipality"
                value={form.cityMunicipality}
                readOnly
                placeholder="Auto-filled from ZIP code"
              />
            </div>
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
          <div className="space-y-2">
            <Label htmlFor="registeredAddress">Registered Address</Label>
            <Input
              id="registeredAddress"
              value={form.registeredAddress}
              onChange={(e) => updateField('registeredAddress', e.target.value)}
              onBlur={() => markTouched('registeredAddress')}
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Business / profession</CardTitle>
          <CardDescription>
            These answers drive your filing path
            {activeTaxYear ? ` for tax year ${activeTaxYear}` : ''}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="natureOfBusiness">Nature of Business / Profession</Label>
            <Input
              id="natureOfBusiness"
              value={form.natureOfBusiness}
              onChange={(e) => updateField('natureOfBusiness', e.target.value)}
              onBlur={() => markTouched('natureOfBusiness')}
              required
            />
            {fieldError('natureOfBusiness') && (
              <p className="text-sm text-red-600">{fieldError('natureOfBusiness')}</p>
            )}
          </div>

          {structuralLocked && (
            <div
              className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
              role="note"
              aria-label="Structural fields locked"
            >
              <p className="font-medium">Income type and COR 2551Q coverage are locked</p>
              <p className="mt-1">
                A return for your active tax year has already been generated or filed, so the
                filing structure can no longer be changed. Other profile fields remain editable.
              </p>
            </div>
          )}
          {!structuralLocked && structuralDirty && (
            <div
              className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
              role="note"
              aria-label="Structural change warning"
            >
              <p className="font-medium">This restructures your return slots</p>
              <p className="mt-1">
                Saving rebuilds the return slots for your active tax year (2551Q quarters
                added/removed, annual form switched between 1701A and 1701) and recomputes all
                return values. This is only possible while no return has been generated or filed.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="incomeType">Nature of Income</Label>
            <Select
              value={form.incomeType}
              onValueChange={(value) => value && updateField('incomeType', value)}
              disabled={structuralLocked}
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
                    The ₱250,000 statutory exemption does not apply to your freelance income —
                    it is already consumed by your compensation side.
                  </li>
                  <li>
                    Your annual return will be <strong>Form 1701</strong>, not Form 1701A.
                  </li>
                  <li>Graduated rate and OSD (40%) election remain available for the 1701 path.</li>
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
              disabled={structuralLocked}
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="true" id="cor-yes" disabled={structuralLocked} />
                <Label htmlFor="cor-yes" className="font-normal">Yes — 8-return filing path</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="false" id="cor-no" disabled={structuralLocked} />
                <Label htmlFor="cor-no" className="font-normal">
                  No — 4-return filing path (1701Q only)
                </Label>
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
              Annual registration fee: ₱30 Documentary Stamp Tax only. The ₱500 BIR registration
              fee was abolished under RA 11976.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">ATC codes</CardTitle>
          <CardDescription>
            Select all ATC codes that apply to your freelance work. Saving replaces your current
            set.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
                  <span className="text-sm text-muted-foreground">
                    EWT rate: {(atc.ewtRate * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
          {fieldError('atcCodes') && (
            <p className="text-sm text-red-600">{fieldError('atcCodes')}</p>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={loading}>
          {loading ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>
    </PageShell>
  )
}
