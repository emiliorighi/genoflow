import {
  instituteKey,
  type GeoFilter,
  type RegionFlow,
} from '../types'

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

export type CountryInstituteLink = {
  countryIso3: string
  countryName: string
  continent: string
  instituteKey: string
  instituteName: string
  instituteLat: number
  instituteLon: number
  instituteCountry: string | null
  count: number
}

export type CoverageStats = {
  gbif: number | null
  inat: number | null
  sequenced: number
  gbifPct: number | null
  inatPct: number | null
}

/** Cap rendered arcs when no country/continent is selected. */
export const UNSCOPED_LINK_CAP = 40

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

export function buildCountryInstituteLinks(flows: RegionFlow[]): CountryInstituteLink[] {
  const byPair = new Map<string, CountryInstituteLink>()
  for (const row of flows) {
    if (!row.has_institute_coordinates || row.institute_lat == null || row.institute_lon == null) {
      continue
    }
    const iso3 = row.collection_country_iso3
    const key = instituteKey(row)
    if (!iso3 || !key || !row.institute_name) continue
    const pairKey = `${iso3}::${key}`
    const prev = byPair.get(pairKey)
    if (prev) {
      prev.count += 1
      continue
    }
    byPair.set(pairKey, {
      countryIso3: iso3,
      countryName: row.collection_country || iso3,
      continent: row.collection_continent,
      instituteKey: key,
      instituteName: row.institute_name,
      instituteLat: row.institute_lat,
      instituteLon: row.institute_lon,
      instituteCountry: row.institute_country,
      count: 1,
    })
  }
  return [...byPair.values()].sort(
    (a, b) => b.count - a.count || a.countryName.localeCompare(b.countryName),
  )
}

function linkInScope(link: CountryInstituteLink, geoFilter: GeoFilter): boolean {
  if (geoFilter.country) {
    if (geoFilter.countryIso3) return link.countryIso3 === geoFilter.countryIso3
    return link.countryName === geoFilter.country
  }
  if (geoFilter.continent) return link.continent === geoFilter.continent
  return true
}

function totalInScope(total: CountryTotal, geoFilter: GeoFilter): boolean {
  if (geoFilter.country) {
    if (geoFilter.countryIso3) return total.iso3 === geoFilter.countryIso3
    return total.countryName === geoFilter.country
  }
  if (geoFilter.continent) return total.continent === geoFilter.continent
  return true
}

export function scopeTotal(totals: CountryTotal[], geoFilter: GeoFilter): number {
  let sum = 0
  for (const t of totals) {
    if (totalInScope(t, geoFilter)) sum += t.total
  }
  return sum
}

export function filterTotalsForScope(
  totals: CountryTotal[],
  geoFilter: GeoFilter,
): CountryTotal[] {
  return totals.filter((t) => totalInScope(t, geoFilter))
}

/** All country→institute links in the geo scope (no cap). Use for sidebar ranks. */
export function linksForScope(
  links: CountryInstituteLink[],
  geoFilter: GeoFilter,
): CountryInstituteLink[] {
  return links.filter((link) => linkInScope(link, geoFilter))
}

/** Map arcs: same as linksForScope, but capped when no region is selected. */
export function topLinksForScope(
  links: CountryInstituteLink[],
  geoFilter: GeoFilter,
  cap = UNSCOPED_LINK_CAP,
): CountryInstituteLink[] {
  const scoped = linksForScope(links, geoFilter)
  const unscoped = !geoFilter.continent && !geoFilter.country
  if (unscoped) return scoped.slice(0, cap)
  return scoped
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
): CoverageStats {
  const scoped = filterTotalsForScope(countryTotals, geoFilter)
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

export function topInstitutesFromLinks(
  links: CountryInstituteLink[],
  limit = 8,
): { key: string; label: string; count: number }[] {
  const byKey = new Map<string, { label: string; count: number }>()
  for (const link of links) {
    const prev = byKey.get(link.instituteKey)
    if (prev) prev.count += link.count
    else byKey.set(link.instituteKey, { label: link.instituteName, count: link.count })
  }
  return [...byKey.entries()]
    .map(([key, { label, count }]) => ({ key, label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit)
}
