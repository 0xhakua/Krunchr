import zipCodesJson from './zip-codes.json'

export interface ZipCodeEntry {
  zipCode: string
  cityMunicipality: string
  province: string
}

export const ZIP_CODES: ZipCodeEntry[] = zipCodesJson as ZipCodeEntry[]

const byZipCode = new Map<string, ZipCodeEntry[]>()
const byProvince = new Map<string, Set<string>>()

for (const entry of ZIP_CODES) {
  const list = byZipCode.get(entry.zipCode) ?? []
  list.push(entry)
  byZipCode.set(entry.zipCode, list)

  const cities = byProvince.get(entry.province) ?? new Set<string>()
  cities.add(entry.cityMunicipality)
  byProvince.set(entry.province, cities)
}

export function findByZipCode(zipCode: string): ZipCodeEntry[] {
  return byZipCode.get(zipCode.trim()) ?? []
}

export function findFirstByZipCode(zipCode: string): ZipCodeEntry | undefined {
  return findByZipCode(zipCode)[0]
}

export function isValidZipCode(zipCode: string): boolean {
  return /^\d{4}$/.test(zipCode.trim()) && byZipCode.has(zipCode.trim())
}

export function getProvinces(): string[] {
  return Array.from(byProvince.keys()).sort()
}

export function getCitiesByProvince(province: string): string[] {
  const cities = byProvince.get(province)
  return cities ? Array.from(cities).sort() : []
}

export function searchZipCodes(query: string): ZipCodeEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return ZIP_CODES.filter(
    (entry) =>
      entry.zipCode.includes(q) ||
      entry.cityMunicipality.toLowerCase().includes(q) ||
      entry.province.toLowerCase().includes(q)
  ).slice(0, 50)
}
