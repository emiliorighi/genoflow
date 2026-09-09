import { type GeoFilter, type RegionFlow } from './types'
import { isCustomRegionId, isCustomRegionMember } from './explore/customRegions'

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

export type CoverageStats = {
  gbif: number | null
  inat: number | null
  sequenced: number
  gbifPct: number | null
  inatPct: number | null
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

function totalInScope(
  total: CountryTotal,
  geoFilter: GeoFilter,
  customIso3Set: Set<string> | null = null,
): boolean {
  if (geoFilter.customId) {
    if (!isCustomRegionId(geoFilter.customId)) return false
    if (customIso3Set && customIso3Set.size > 0) {
      return customIso3Set.has(total.iso3)
    }
    return isCustomRegionMember(
      geoFilter.customId,
      total.iso3,
      total.continent,
      total.countryName,
    )
  }
  if (geoFilter.country) {
    if (geoFilter.countryIso3) return total.iso3 === geoFilter.countryIso3
    return total.countryName === geoFilter.country
  }
  if (geoFilter.continent) return total.continent === geoFilter.continent
  return true
}

function filterTotalsForScope(
  totals: CountryTotal[],
  geoFilter: GeoFilter,
  customIso3Set: Set<string> | null = null,
): CountryTotal[] {
  return totals.filter((t) => totalInScope(t, geoFilter, customIso3Set))
}

export function countsByIso3(
  rows: SpeciesCountRow[],
): Map<string, SpeciesCountRow> {
  const map = new Map<string, SpeciesCountRow>()
  for (const row of rows) {
    if (row.iso3) map.set(row.iso3, row)
  }
  return map
}

function pct(part: number, total: number): number | null {
  if (!total) return null
  return Math.round((1000 * part) / total) / 10
}

export function computeCoverageStats(
  geoFilter: GeoFilter,
  countryTotals: CountryTotal[],
  countsLookup: Map<string, SpeciesCountRow>,
  customIso3Set: Set<string> | null = null,
): CoverageStats {
  const scoped = filterTotalsForScope(countryTotals, geoFilter, customIso3Set)
  const sequenced = scoped.reduce((sum, t) => sum + t.total, 0)

  let gbif: number | null = 0
  let inat: number | null = 0
  let hasGbif = false
  let hasInat = false
  for (const t of scoped) {
    const row = countsLookup.get(t.iso3)
    if (!row) continue
    if (row.gbif_species_count != null) {
      gbif = (gbif ?? 0) + row.gbif_species_count
      hasGbif = true
    }
    if (row.inat_species_count != null) {
      inat = (inat ?? 0) + row.inat_species_count
      hasInat = true
    }
  }
  if (!hasGbif) gbif = null
  if (!hasInat) inat = null

  return {
    gbif,
    inat,
    sequenced,
    gbifPct: gbif != null ? pct(sequenced, gbif) : null,
    inatPct: inat != null ? pct(sequenced, inat) : null,
  }
}
