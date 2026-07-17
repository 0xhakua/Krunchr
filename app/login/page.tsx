'use client'

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
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
import { loginSchema } from '@/lib/validation/schemas'

type FieldErrors = {
  username?: string
  password?: string
}

type DemoAccount = {
  username: string
  password: string
  label: string
}

// Seeded by prisma/seed.ts as demo1/2/3 — safe to show in any environment.
// These are throwaway accounts for demo viewers; the admin account is
// intentionally omitted because its password is deploy-specific ($ADMIN_PASSWORD).
const DEMO_ACCOUNTS: DemoAccount[] = [
  { username: 'demo1', password: 'Test1234!', label: 'Demo 1 — pure SE, 8-return' },
  { username: 'demo2', password: 'Test1234!', label: 'Demo 2 — mixed income' },
  { username: 'demo3', password: 'Test1234!', label: 'Demo 3 — pure SE, 4-return' },
]

function validateField(name: keyof FieldErrors, value: string): string | undefined {
  const result = loginSchema.shape[name].safeParse(value)
  return result.success ? undefined : result.error.errors[0].message
}

export default function LoginPage() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [submitted, setSubmitted] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const runFieldValidation = useCallback((name: keyof FieldErrors, value: string) => {
    const message = validateField(name, value)
    setErrors((prev) => ({ ...prev, [name]: message }))
    return !message
  }, [])

  const handleBlur = useCallback(
    (field: keyof FieldErrors) => {
      setTouched((prev) => ({ ...prev, [field]: true }))
      const value = field === 'username' ? username : password
      // Don't scold the user for an empty field just because they clicked
      // into it and moved on — required-field errors only appear after a
      // submit attempt. Non-empty values are still validated right away.
      if (!value && !submitted) {
        setErrors((prev) => ({ ...prev, [field]: undefined }))
        return
      }
      runFieldValidation(field, value)
    },
    [username, password, submitted, runFieldValidation]
  )

  const handleChange = useCallback(
    (field: keyof FieldErrors, value: string) => {
      if (field === 'username') setUsername(value)
      if (field === 'password') setPassword(value)

      if (touched[field]) {
        runFieldValidation(field, value)
      }
    },
    [touched, runFieldValidation]
  )

  const isFormValid = useMemo(() => {
    return (
      !validateField('username', username) &&
      !validateField('password', password)
    )
  }, [username, password])

  const handleDemoClick = useCallback((account: DemoAccount) => {
    setUsername(account.username)
    setPassword(account.password)
    setTouched({})
    setSubmitted(false)
    setErrors({})
    setError('')
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitted(true)
    setTouched({ username: true, password: true })
    setError('')

    const usernameOk = runFieldValidation('username', username)
    const passwordOk = runFieldValidation('password', password)

    if (!usernameOk || !passwordOk) {
      return
    }

    setLoading(true)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'We could not sign you in. Please try again.')
        return
      }

      router.push('/dashboard')
    } catch {
      setError('Could not reach the server. Please check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl">Krunchr</CardTitle>
          <CardDescription>Sign in to your account</CardDescription>
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
                aria-invalid={touched.username && !!errors.username}
              />
              {touched.username && errors.username && (
                <p className="text-sm text-red-600">{errors.username}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <PasswordInput
                id="password"
                value={password}
                onChange={(e) => handleChange('password', e.target.value)}
                onBlur={() => handleBlur('password')}
                required
                autoComplete="current-password"
                aria-invalid={touched.password && !!errors.password}
              />
              {touched.password && errors.password && (
                <p className="text-sm text-red-600">{errors.password}</p>
              )}
            </div>
            {error && (
              <p className="text-sm text-red-600">{error}</p>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={loading || !isFormValid}
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Don&apos;t have an account?{' '}
              <Link href="/register" className="text-primary hover:underline">
                Create account
              </Link>
            </p>
          </form>

          <div className="mt-6 border-t pt-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Demo accounts
            </p>
            <p className="mb-3 text-xs text-muted-foreground">
              Click one to autofill the form. For demo and review use only.
            </p>
            <ul className="space-y-1.5">
              {DEMO_ACCOUNTS.map((account) => (
                <li key={account.username}>
                  <button
                    type="button"
                    onClick={() => handleDemoClick(account)}
                    className="flex w-full items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="font-medium text-foreground">
                      {account.label}
                    </span>
                    <span className="font-mono text-muted-foreground">
                      {account.username}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
