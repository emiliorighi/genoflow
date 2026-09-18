import { type RegionFlow } from './types'

export type CountryCentroid = { name: string; lon: number; lat: number }
export type CountryCentroids = Record<string, CountryCentroid>

export type SpeciesCountRow = {
  country_name: string
  iso3: string | null
  iso2: string | null
  gbif_species_count: number | null
  inat_species_count: number | null
}

export type CountryTotal = {
  iso3: string
  countryName: string
  continent: string
  total: number
}

export function buildCountryTotals(flows: RegionFlow[]): CountryTotal[] {
  const byIso = new Map<string, CountryTotal>()
  for (const row of flows) {
    const iso3 = row.collection_country_iso3
    if (!iso3) continue
    const prev = byIso.get(iso3)
    if (prev) {
      prev.total += 1
      continue
    }
    byIso.set(iso3, {
      iso3,
      countryName: row.collection_country || iso3,
      continent: row.collection_continent,
      total: 1,
    })
  }
  return [...byIso.values()].sort(
    (a, b) => b.total - a.total || a.countryName.localeCompare(b.countryName),
  )
}
