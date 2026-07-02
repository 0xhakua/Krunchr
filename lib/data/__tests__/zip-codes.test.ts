import { describe, expect, it } from 'vitest'
import {
  findByZipCode,
  findFirstByZipCode,
  getCitiesByProvince,
  getProvinces,
  isValidZipCode,
  searchZipCodes,
} from '@/lib/data/zip-codes'

describe('Philippine ZIP code dataset', () => {
  it('finds entries by ZIP code', () => {
    const found = findByZipCode('1200')
    expect(found.length).toBeGreaterThan(0)
    expect(found[0].province).toBe('Metro Manila')
  })

  it('returns an empty array for an unknown ZIP code', () => {
    expect(findByZipCode('9999')).toEqual([])
  })

  it('finds the first entry by ZIP code', () => {
    const found = findFirstByZipCode('1200')
    expect(found).toBeDefined()
    expect(found?.zipCode).toBe('1200')
  })

  it('validates 4-digit known ZIP codes', () => {
    expect(isValidZipCode('1200')).toBe(true)
    expect(isValidZipCode('9999')).toBe(false)
    expect(isValidZipCode('12')).toBe(false)
    expect(isValidZipCode('abc')).toBe(false)
  })

  it('lists provinces alphabetically', () => {
    const provinces = getProvinces()
    expect(provinces.length).toBeGreaterThan(0)
    expect(provinces).toEqual([...provinces].sort())
  })

  it('lists cities for a province', () => {
    const cities = getCitiesByProvince('Metro Manila')
    expect(cities.length).toBeGreaterThan(0)
  })

  it('returns an empty array for an unknown province', () => {
    expect(getCitiesByProvince('Atlantis')).toEqual([])
  })

  it('searches by ZIP code, city, or province', () => {
    expect(searchZipCodes('1200').length).toBeGreaterThan(0)
    expect(searchZipCodes('Makati').length).toBeGreaterThan(0)
    expect(searchZipCodes('Metro Manila').length).toBeGreaterThan(0)
  })

  it('caps search results', () => {
    expect(searchZipCodes('Manila').length).toBeLessThanOrEqual(50)
  })
})
