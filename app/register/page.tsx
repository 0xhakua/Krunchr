'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Check, Circle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { registerBaseSchema } from '@/lib/validation/schemas'

type FieldErrors = {
  username?: string
  password?: string
  confirmPassword?: string
}

// Mirrors the password rules in registerBaseSchema (lib/validation/schemas.ts).
// Keep these in sync — the checklist is the user-facing version of the schema.
const PASSWORD_REQUIREMENTS = [
  { label: 'At least 8 characters', test: (p: string) => p.length >= 8 },
  { label: 'At least one uppercase letter', test: (p: string) => /[A-Z]/.test(p) },
  { label: 'At least one lowercase letter', test: (p: string) => /[a-z]/.test(p) },
  { label: 'At least one number', test: (p: string) => /\d/.test(p) },
  {
    label: 'At least one special character',
    test: (p: string) => /[^A-Za-z0-9]/.test(p),
  },
] as const

export default function RegisterPage() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [submitted, setSubmitted] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [serverErrors, setServerErrors] = useState<Record<string, string[]>>({})
  const [topLevelError, setTopLevelError] = useState('')
  const [loading, setLoading] = useState(false)
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null)
  const [checkingUsername, setCheckingUsername] = useState(false)
  const [passwordFocused, setPasswordFocused] = useState(false)

  const usernameDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const validateField = useCallback(
    (name: keyof FieldErrors, value: string): string | undefined => {
      if (name === 'username') {
        const result = registerBaseSchema.shape.username.safeParse(value)
        return result.success ? undefined : result.error.errors[0].message
      }
      if (name === 'password') {
        const result = registerBaseSchema.shape.password.safeParse(value)
        return result.success ? undefined : result.error.errors[0].message
      }
      if (name === 'confirmPassword') {
        if (!value) return 'Please confirm your password'
        if (value !== password) return "Passwords don't match — please re-enter them"
        return undefined
      }
    },
    [password]
  )

  const runFieldValidation = useCallback(
    (name: keyof FieldErrors, value: string) => {
      const message = validateField(name, value)
      setErrors((prev) => ({ ...prev, [name]: message }))
      return !message
    },
    [validateField]
  )

  const checkUsername = useCallback(async (value: string) => {
    setCheckingUsername(true)
    try {
      const res = await fetch(
        `/api/auth/check-username?username=${encodeURIComponent(value)}`
      )
      const data = await res.json()
      setUsernameAvailable(data.available === true)
    } catch {
      setUsernameAvailable(null)
    } finally {
      setCheckingUsername(false)
    }
  }, [])

  const scheduleUsernameCheck = useCallback(
    (value: string) => {
      if (usernameDebounceRef.current) {
        clearTimeout(usernameDebounceRef.current)
        usernameDebounceRef.current = null
      }

      const usernameError = validateField('username', value)
      if (usernameError || !value) {
        setUsernameAvailable(null)
        setCheckingUsername(false)
        return
      }

      usernameDebounceRef.current = setTimeout(() => {
        void checkUsername(value)
      }, 300)
    },
    [validateField, checkUsername]
  )

  useEffect(() => {
    return () => {
      if (usernameDebounceRef.current) {
        clearTimeout(usernameDebounceRef.current)
      }
    }
  }, [])

  const handleBlur = useCallback(
    (field: keyof FieldErrors) => {
      setTouched((prev) => ({ ...prev, [field]: true }))
      const value =
        field === 'username'
          ? username
          : field === 'password'
            ? password
            : confirmPassword
      // Don't scold the user for an empty field just because they clicked
      // into it and moved on — required-field errors only appear after a
      // submit attempt. Non-empty values are still validated right away.
      if (!value && !submitted) {
        setErrors((prev) => ({ ...prev, [field]: undefined }))
        return
      }
      runFieldValidation(field, value)
    },
    [username, password, confirmPassword, submitted, runFieldValidation]
  )

  const handleChange = useCallback(
    (field: keyof FieldErrors, value: string) => {
      if (field === 'username') {
        setUsername(value)
        scheduleUsernameCheck(value)
      }
      if (field === 'password') setPassword(value)
      if (field === 'confirmPassword') setConfirmPassword(value)

      if (touched[field]) {
        if (field === 'confirmPassword') {
          // Don't nag about a mismatch while the user is still typing —
          // clear the error the instant the passwords match, and otherwise
          // wait for blur (or submit) to report a mismatch.
          if (value === password) {
            setErrors((prev) => ({ ...prev, confirmPassword: undefined }))
          }
        } else {
          runFieldValidation(field, value)
        }
      }

      if (field === 'password' && touched.confirmPassword) {
        runFieldValidation('confirmPassword', confirmPassword)
      }
    },
    [touched, password, confirmPassword, scheduleUsernameCheck, runFieldValidation]
  )

  const isFormValid = useMemo(() => {
    const usernameError = validateField('username', username)
    const passwordError = validateField('password', password)
    const confirmPasswordError = validateField('confirmPassword', confirmPassword)
    return (
      !usernameError &&
      !passwordError &&
      !confirmPasswordError &&
      usernameAvailable === true
    )
  }, [username, password, confirmPassword, usernameAvailable, validateField])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitted(true)
    setTouched({ username: true, password: true, confirmPassword: true })
    setServerErrors({})
    setTopLevelError('')

    const usernameOk = runFieldValidation('username', username)
    const passwordOk = runFieldValidation('password', password)
    const confirmOk = runFieldValidation('confirmPassword', confirmPassword)

    if (!usernameOk || !passwordOk || !confirmOk || usernameAvailable !== true) {
      return
    }

    setLoading(true)

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, confirmPassword }),
      })

      const data = await res.json()

      if (!res.ok) {
        if (data.details) {
          setServerErrors(data.details)
        }
        setTopLevelError(data.error || 'We could not create your account. Please try again.')
        return
      }

      router.push('/onboarding')
    } catch {
      setTopLevelError('Could not reach the server. Please check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  const showUsernameStatus =
    touched.username && !errors.username && username.length > 0

  const allPasswordRequirementsMet = PASSWORD_REQUIREMENTS.every((req) =>
    req.test(password)
  )
  // The checklist stays out of the way until the password field is focused,
  // and remains visible afterwards only while there is still an unmet rule —
  // so a valid password never leaves clutter on the form.
  const showPasswordRequirements =
    passwordFocused || (password.length > 0 && !allPasswordRequirementsMet)

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl">Krunchr</CardTitle>
          <CardDescription>Create your account</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                type="text"
                value={username}
                onChange={(e) => handleChange('username', e.target.value)}
                onBlur={() => handleBlur('username')}
                required
                autoComplete="username"
                aria-invalid={
                  touched.username &&
                  (!!errors.username || usernameAvailable === false)
                }
              />
              {touched.username && errors.username && (
                <p className="text-sm text-red-600">{errors.username}</p>
              )}
              {showUsernameStatus && (
                <>
                  {checkingUsername && (
                    <p className="text-sm text-muted-foreground">
                      Checking availability…
                    </p>
                  )}
                  {!checkingUsername && usernameAvailable === true && (
                    <p className="text-sm text-green-600">Username available</p>
                  )}
                  {!checkingUsername && usernameAvailable === false && (
                    <p className="text-sm text-red-600">
                      That username is already taken — please choose another one
                    </p>
                  )}
                </>
              )}
              {serverErrors.username && (
                <p className="text-sm text-red-600">{serverErrors.username[0]}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <PasswordInput
                id="password"
                value={password}
                onChange={(e) => handleChange('password', e.target.value)}
                onFocus={() => setPasswordFocused(true)}
                onBlur={() => {
                  setPasswordFocused(false)
                  handleBlur('password')
                }}
                required
                autoComplete="new-password"
                aria-invalid={touched.password && !!errors.password}
                aria-describedby={
                  showPasswordRequirements ? 'password-requirements' : undefined
                }
              />
              {showPasswordRequirements && (
                <ul
                  id="password-requirements"
                  className="space-y-1 pt-1"
                  aria-label="Password requirements"
                >
                  {PASSWORD_REQUIREMENTS.map((req) => {
                    const met = req.test(password)
                    return (
                      <li
                        key={req.label}
                        className={`flex items-center gap-1.5 text-sm ${
                          met ? 'text-green-600' : 'text-muted-foreground'
                        }`}
                      >
                        {met ? (
                          <Check className="size-3.5 shrink-0" aria-hidden="true" />
                        ) : (
                          <Circle className="size-3.5 shrink-0" aria-hidden="true" />
                        )}
                        <span>{req.label}</span>
                      </li>
                    )
                  })}
                </ul>
              )}
              {serverErrors.password && (
                <p className="text-sm text-red-600">{serverErrors.password[0]}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <PasswordInput
                id="confirmPassword"
                value={confirmPassword}
                onChange={(e) => handleChange('confirmPassword', e.target.value)}
                onBlur={() => handleBlur('confirmPassword')}
                required
                autoComplete="new-password"
                aria-invalid={touched.confirmPassword && !!errors.confirmPassword}
              />
              {touched.confirmPassword && errors.confirmPassword && (
                <p className="text-sm text-red-600">{errors.confirmPassword}</p>
              )}
            </div>
            {topLevelError && (
              <p className="text-sm text-red-600">{topLevelError}</p>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={loading || !isFormValid}
            >
              {loading ? 'Creating account...' : 'Create account'}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Already have an account?{' '}
              <Link href="/login" className="text-primary hover:underline">
                Log in
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
