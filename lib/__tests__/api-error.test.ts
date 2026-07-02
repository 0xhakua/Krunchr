import { describe, expect, it } from 'vitest'
import { extractApiErrorMessage } from '../api-error'

describe('extractApiErrorMessage', () => {
  it('returns the first field error when the API response has field errors', () => {
    const data = {
      error: 'Validation failed',
      formErrors: [],
      fieldErrors: { tin: ['TIN must be in format NNN-NNN-NNN-NNNN'] },
    }
    expect(extractApiErrorMessage(data, 'fallback')).toBe(
      'TIN must be in format NNN-NNN-NNN-NNNN'
    )
  })

  it('returns the first field error across multiple fields', () => {
    const data = {
      error: 'Validation failed',
      formErrors: [],
      fieldErrors: {
        tin: ['TIN must be in format NNN-NNN-NNN-NNNN'],
        atcCodes: ['Select at least one ATC code'],
      },
    }
    // Order is insertion order in V8; either field error is acceptable as long as
    // it is one of the two.
    const msg = extractApiErrorMessage(data, 'fallback')
    expect(['TIN must be in format NNN-NNN-NNN-NNNN', 'Select at least one ATC code']).toContain(msg)
  })

  it('returns the first form error when there are no field errors', () => {
    const data = {
      error: 'Validation failed',
      formErrors: ['Form-level error message'],
      fieldErrors: {},
    }
    expect(extractApiErrorMessage(data, 'fallback')).toBe('Form-level error message')
  })

  it('falls back to the API error string when it is not the generic "Validation failed"', () => {
    const data = { error: 'TIN already registered' }
    expect(extractApiErrorMessage(data, 'fallback')).toBe('TIN already registered')
  })

  it('falls back to the caller-supplied fallback when the API only returns the generic "Validation failed"', () => {
    const data = { error: 'Validation failed', formErrors: [], fieldErrors: {} }
    expect(extractApiErrorMessage(data, 'Failed to complete onboarding')).toBe(
      'Failed to complete onboarding'
    )
  })

  it('returns the fallback for null, undefined, primitives, and non-objects', () => {
    expect(extractApiErrorMessage(null, 'fallback')).toBe('fallback')
    expect(extractApiErrorMessage(undefined, 'fallback')).toBe('fallback')
    expect(extractApiErrorMessage('a string', 'fallback')).toBe('fallback')
    expect(extractApiErrorMessage(42, 'fallback')).toBe('fallback')
  })

  it('returns the fallback when the API returns the legacy { _errors, tin: { _errors } } shape', () => {
    // Regression for #97: the old API returned Zod's format() output. Even if a
    // stray server still does that, the helper must not throw and must produce
    // some message (here: the fallback).
    const data = { _errors: [], tin: { _errors: ['TIN must be in format NNN-NNN-NNN-NNNN'] } }
    expect(extractApiErrorMessage(data, 'fallback')).toBe('fallback')
  })
})

describe('unsupportedMediaType', () => {
  it('returns a 415 JSON response with default expected type', async () => {
    const { unsupportedMediaType } = await import('../api-error')
    const res = unsupportedMediaType()
    expect(res.status).toBe(415)
    expect(await res.json()).toEqual({
      error: 'Unsupported Media Type',
      code: 'UNSUPPORTED_MEDIA_TYPE',
      expected: 'application/json',
    })
  })

  it('returns a 415 JSON response with a custom expected type', async () => {
    const { unsupportedMediaType } = await import('../api-error')
    const res = unsupportedMediaType('text/csv')
    expect(res.status).toBe(415)
    expect(await res.json()).toEqual({
      error: 'Unsupported Media Type',
      code: 'UNSUPPORTED_MEDIA_TYPE',
      expected: 'text/csv',
    })
  })
})

describe('badRequest', () => {
  it('returns a 400 JSON response with the supplied message', async () => {
    const { badRequest } = await import('../api-error')
    const res = badRequest('Invalid input')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid input', code: 'BAD_REQUEST' })
  })
})
