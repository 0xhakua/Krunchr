/**
 * Extract a human-readable error message from an unknown API response body.
 *
 * Used by client pages that POST a form and want to show a top-level toast.
 * Prefers specific field/form errors over a generic "Validation failed"
 * placeholder so the user sees *what* to fix, not just that something is
 * wrong. Falls back to the API's `error` string (when it is not the generic
 * validation placeholder) and finally to the caller-supplied fallback.
 *
 * The function is defensive against malformed response bodies: a non-string
 * `error` is treated as if it were absent, and non-object inputs return the
 * fallback. Callers can safely pass `await res.json()` directly.
 */
export function extractApiErrorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === 'object') {
    const obj = data as {
      error?: unknown
      fieldErrors?: Record<string, unknown[]>
      formErrors?: unknown[]
    }

    if (obj.fieldErrors && typeof obj.fieldErrors === 'object') {
      for (const arr of Object.values(obj.fieldErrors)) {
        if (Array.isArray(arr) && typeof arr[0] === 'string') return arr[0]
      }
    }

    if (Array.isArray(obj.formErrors) && typeof obj.formErrors[0] === 'string') {
      return obj.formErrors[0]
    }

    if (typeof obj.error === 'string' && obj.error !== 'Validation failed') {
      return obj.error
    }
  }
  return fallback
}

import { NextResponse } from 'next/server'

export function unsupportedMediaType(expected = 'application/json') {
  return NextResponse.json(
    {
      error: 'Unsupported Media Type',
      code: 'UNSUPPORTED_MEDIA_TYPE',
      expected,
    },
    { status: 415 }
  )
}

export function badRequest(message: string, code = 'BAD_REQUEST') {
  return NextResponse.json({ error: message, code }, { status: 400 })
}
