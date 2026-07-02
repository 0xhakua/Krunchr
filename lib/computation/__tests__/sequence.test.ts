import { describe, expect, it } from 'vitest'
import { determineReturnStatus, getDependencies } from '../sequence'

describe('getDependencies', () => {
  it('returns the 8-return dependency graph when COR includes 2551Q', () => {
    const deps = getDependencies(true)
    expect(deps[1]).toEqual([])
    expect(deps[5]).toEqual([1]) // 1701Q Q1 depends on 2551Q Q1
    expect(deps[8]).toEqual([1, 5, 6, 7]) // 1701A depends on prior returns
  })

  it('returns the 4-return dependency graph when COR does not include 2551Q', () => {
    const deps = getDependencies(false)
    expect(deps[1]).toEqual([])
    expect(deps[2]).toEqual([1])
    expect(deps[4]).toEqual([1, 2, 3])
  })
})

describe('determineReturnStatus', () => {
  it('returns BLOCKED when the return is missing', () => {
    const result = determineReturnStatus(1, [], true)
    expect(result).toBe('BLOCKED')
  })

  it('preserves FILED status regardless of dependencies', () => {
    const result = determineReturnStatus(
      1,
      [{ sequenceOrder: 1, status: 'FILED', formType: 'FORM_2551Q' }],
      true
    )
    expect(result).toBe('FILED')
  })

  it('preserves GENERATED status regardless of dependencies', () => {
    const result = determineReturnStatus(
      2,
      [{ sequenceOrder: 2, status: 'GENERATED', formType: 'FORM_2551Q' }],
      false
    )
    expect(result).toBe('GENERATED')
  })

  it('returns BLOCKED when dependencies are not all filed (8-path)', () => {
    const returns = [
      { sequenceOrder: 1, status: 'FILED', formType: 'FORM_2551Q' as const },
      { sequenceOrder: 5, status: 'PENDING', formType: 'FORM_1701Q' as const },
    ]
    // 1701Q Q2 (order 6) depends on 1 and 5
    const result = determineReturnStatus(6, returns, true)
    expect(result).toBe('BLOCKED')
  })

  it('returns PENDING when all dependencies are filed (8-path)', () => {
    const returns = [
      { sequenceOrder: 1, status: 'FILED', formType: 'FORM_2551Q' as const },
      { sequenceOrder: 5, status: 'FILED', formType: 'FORM_1701Q' as const },
      { sequenceOrder: 6, status: 'PENDING', formType: 'FORM_1701Q' as const },
    ]
    const result = determineReturnStatus(6, returns, true)
    expect(result).toBe('PENDING')
  })

  it('returns PENDING for Q1 because it has no dependencies', () => {
    const returns = [{ sequenceOrder: 1, status: 'PENDING', formType: 'FORM_2551Q' as const }]
    const result = determineReturnStatus(1, returns, true)
    expect(result).toBe('PENDING')
  })

  it('returns BLOCKED when dependencies are not all filed (4-path)', () => {
    const returns = [
      { sequenceOrder: 1, status: 'FILED', formType: 'FORM_1701Q' as const },
      { sequenceOrder: 2, status: 'PENDING', formType: 'FORM_1701Q' as const },
    ]
    const result = determineReturnStatus(3, returns, false)
    expect(result).toBe('BLOCKED')
  })

  it('returns PENDING when all dependencies are filed (4-path)', () => {
    const returns = [
      { sequenceOrder: 1, status: 'FILED', formType: 'FORM_1701Q' as const },
      { sequenceOrder: 2, status: 'FILED', formType: 'FORM_1701Q' as const },
      { sequenceOrder: 3, status: 'FILED', formType: 'FORM_1701Q' as const },
      { sequenceOrder: 4, status: 'PENDING', formType: 'FORM_1701A' as const },
    ]
    const result = determineReturnStatus(4, returns, false)
    expect(result).toBe('PENDING')
  })

  it('blocks Form 1701A when the VAT threshold is breached', () => {
    const returns = [
      { sequenceOrder: 1, status: 'FILED', formType: 'FORM_2551Q' as const },
      { sequenceOrder: 5, status: 'FILED', formType: 'FORM_1701Q' as const },
      { sequenceOrder: 6, status: 'FILED', formType: 'FORM_1701Q' as const },
      { sequenceOrder: 7, status: 'FILED', formType: 'FORM_1701Q' as const },
      { sequenceOrder: 8, status: 'PENDING', formType: 'FORM_1701A' as const },
    ]
    const result = determineReturnStatus(8, returns, true, true)
    expect(result).toBe('BLOCKED')
  })

  it('overrides GENERATED Form 1701A when the VAT threshold is breached', () => {
    const returns = [
      { sequenceOrder: 8, status: 'GENERATED', formType: 'FORM_1701A' as const },
    ]
    const result = determineReturnStatus(8, returns, true, true)
    expect(result).toBe('BLOCKED')
  })

  it('keeps Form 1701A FILED even when the VAT threshold is breached', () => {
    const returns = [
      { sequenceOrder: 8, status: 'FILED', formType: 'FORM_1701A' as const },
    ]
    const result = determineReturnStatus(8, returns, true, true)
    expect(result).toBe('FILED')
  })

  it('does not block the annual return when it is Form 1701 (mixed-income)', () => {
    const returns = [
      { sequenceOrder: 1, status: 'FILED', formType: 'FORM_2551Q' as const },
      { sequenceOrder: 5, status: 'FILED', formType: 'FORM_1701Q' as const },
      { sequenceOrder: 6, status: 'FILED', formType: 'FORM_1701Q' as const },
      { sequenceOrder: 7, status: 'FILED', formType: 'FORM_1701Q' as const },
      { sequenceOrder: 8, status: 'PENDING', formType: 'FORM_1701' as const },
    ]
    const result = determineReturnStatus(8, returns, true, true)
    expect(result).toBe('PENDING')
  })
})
