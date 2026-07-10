'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { registerSchema } from '@/lib/validation/schemas'

type FieldErrors = {
  username?: string
  password?: string
  confirmPassword?: string
}

export default function RegisterPage() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<FieldErrors>({})
  const [serverErrors, setServerErrors] = useState<Record<string, string[]>>({})
  const [topLevelError, setTopLevelError] = useState('')
  const [loading, setLoading] = useState(false)
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null)
  const [checkingUsername, setCheckingUsername] = useState(false)

  const usernameDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const validateField = useCallback(
    (name: keyof FieldErrors, value: string): string | undefined => {
      if (name === 'username') {
        const result = registerSchema.shape.username.safeParse(value)
        return result.success ? undefined : result.error.errors[0].message
      }
      if (name === 'password') {
        const result = registerSchema.shape.password.safeParse(value)
        return result.success ? undefined : result.error.errors[0].message
      }
      if (name === 'confirmPassword') {
        if (!value) return 'Confirm password is required'
        if (value !== password) return 'Passwords do not match'
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
      runFieldValidation(field, value)
    },
    [username, password, confirmPassword, runFieldValidation]
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
        runFieldValidation(field, value)
      }

      if (field === 'password' && touched.confirmPassword) {
        runFieldValidation('confirmPassword', confirmPassword)
      }
    },
    [touched, confirmPassword, scheduleUsernameCheck, runFieldValidation]
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
        setTopLevelError(data.error || 'Registration failed')
        return
      }

      router.push('/onboarding')
    } catch {
      setTopLevelError('An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  const showUsernameStatus =
    touched.username && !errors.username && username.length > 0

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
                    <p className="text-sm text-red-600">Username already taken</p>
                  )}
                </>
              )}
              {serverErrors.username && (
                <p className="text-sm text-red-600">{serverErrors.username[0]}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => handleChange('password', e.target.value)}
                onBlur={() => handleBlur('password')}
                required
                autoComplete="new-password"
                aria-invalid={touched.password && !!errors.password}
              />
              {touched.password && errors.password && (
                <p className="text-sm text-red-600">{errors.password}</p>
              )}
              {serverErrors.password && (
                <p className="text-sm text-red-600">{serverErrors.password[0]}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <Input
                id="confirmPassword"
                type="password"
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
