export type TaxonRank = 'kingdom' | 'phylum' | 'class' | 'order' | 'family' | 'genus'

export const TAXON_RANKS: TaxonRank[] = [
  'kingdom',
  'phylum',
  'class',
  'order',
  'family',
  'genus',
]

export type SpeciesFlow = {
  species_taxid: string
  species_scientific_name: string
  assembly_accession: string
  collection_lat: number
  collection_lon: number
  institute_lat: number | null
  institute_lon: number | null
  has_institute_coordinates: boolean
  collection_country: string
  collection_continent: string
  collection_country_iso3: string | null
  submitter_name: string | null
  institute_name: string | null
  institute_ror_id: string | null
  institute_country: string | null
  institute_continent: string | null
  institute_country_iso3: string | null
  kingdom_taxid: string | null
  kingdom_name: string | null
  phylum_taxid: string | null
  phylum_name: string | null
  class_taxid: string | null
  class_name: string | null
  order_taxid: string | null
  order_name: string | null
  family_taxid: string | null
  family_name: string | null
  genus_taxid: string | null
  genus_name: string | null
}

/** Same as SpeciesFlow but keeps country-only rows (null collection coordinates). */
export type RegionFlow = Omit<SpeciesFlow, 'collection_lat' | 'collection_lon'> & {
  collection_lat: number | null
  collection_lon: number | null
}

export type RankFilter = { rank: TaxonRank; taxid: string }

export type GeoFilter = {
  continent: string | null
  country: string | null
  countryIso3: string | null
}

export type Selection =
  | { type: 'species'; taxid: string }
  | { type: 'institute'; key: string }
  | null

export type WorldFeature = {
  type: 'Feature'
  properties: { NAME: string; ISO_A3: string; CONTINENT: string }
  geometry: unknown
}

export type WorldGeoJson = {
  type: 'FeatureCollection'
  features: WorldFeature[]
}

export type RankedCount = { label: string; key: string; count: number }

export type RegionStats = {
  total: number
  domestic: number
  offshore: number
  unknown: number
  topInstitutes: RankedCount[]
  topSubmitterCountries: RankedCount[]
}

export const EMPTY_GEO_FILTER: GeoFilter = {
  continent: null,
  country: null,
  countryIso3: null,
}

export function toFiniteNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function optionalString(value: unknown): string | null {
  if (value == null) return null
  const text = String(value).trim()
  return text || null
}

export function instituteKey(row: RegionFlow | SpeciesFlow): string | null {
  return row.institute_ror_id || row.institute_name || null
}

export function filterFlows<T extends RegionFlow | SpeciesFlow>(
  flows: T[],
  rankFilter: RankFilter | null,
  geoFilter: GeoFilter,
): T[] {
  return flows.filter((row) => {
    if (rankFilter) {
      const taxid = row[`${rankFilter.rank}_taxid` as keyof T]
      if (taxid !== rankFilter.taxid) return false
    }
    if (geoFilter.continent) {
      if (row.collection_continent !== geoFilter.continent) return false
      if (geoFilter.country && row.collection_country !== geoFilter.country) return false
    }
    return true
  })
}

/** Query param keys used to make the map's filter/selection state shareable via URL. */
export const MAP_QUERY_KEYS = {
  rank: 'rank',
  taxon: 'taxon',
  continent: 'continent',
  country: 'country',
  select: 'select',
} as const

export function encodeSelectionParam(selection: Selection): string | null {
  if (!selection) return null
  return selection.type === 'species' ? `species:${selection.taxid}` : `institute:${selection.key}`
}

export function decodeSelectionParam(raw: string | null): Selection {
  if (!raw) return null
  const idx = raw.indexOf(':')
  if (idx < 0) return null
  const type = raw.slice(0, idx)
  const value = raw.slice(idx + 1)
  if (!value) return null
  if (type === 'species') return { type: 'species', taxid: value }
  if (type === 'institute') return { type: 'institute', key: value }
  return null
}

export type MapDeepLinkState = {
  rank?: TaxonRank
  taxon?: string
  continent?: string
  country?: string
}

/** Build a `/map?...` deep link for quick-start entry points (e.g. from the landing page). */
export function buildMapHref(state: MapDeepLinkState): string {
  const params = new URLSearchParams()
  if (state.rank && state.taxon) {
    params.set(MAP_QUERY_KEYS.rank, state.rank)
    params.set(MAP_QUERY_KEYS.taxon, state.taxon)
  }
  if (state.continent) params.set(MAP_QUERY_KEYS.continent, state.continent)
  if (state.country) params.set(MAP_QUERY_KEYS.country, state.country)
  const qs = params.toString()
  return qs ? `/map?${qs}` : '/map'
}

export function matchesSelection(row: RegionFlow | SpeciesFlow, selection: Selection): boolean {
  if (!selection) return false
  if (selection.type === 'species') return row.species_taxid === selection.taxid
  const key = instituteKey(row)
  return key != null && key === selection.key
}

function mapFlowRow(row: Record<string, unknown>): {
  collection_lat: number | null
  collection_lon: number | null
  institute_lat: number | null
  institute_lon: number | null
  has_institute_coordinates: boolean
  base: Omit<RegionFlow, 'collection_lat' | 'collection_lon' | 'institute_lat' | 'institute_lon' | 'has_institute_coordinates'>
} | null {
  const collection_lat = toFiniteNumber(row.collection_lat)
  const collection_lon = toFiniteNumber(row.collection_lon)
  const institute_lat = toFiniteNumber(row.institute_lat)
  const institute_lon = toFiniteNumber(row.institute_lon)
  const hasInstitute =
    institute_lat != null &&
    institute_lon != null &&
    (row.has_institute_coordinates === true ||
      row.has_institute_coordinates === 'true' ||
      row.has_institute_coordinates === 1)

  const species_taxid = String(row.species_taxid ?? '')
  if (!species_taxid) return null

  return {
    collection_lat,
    collection_lon,
    institute_lat: hasInstitute ? institute_lat : null,
    institute_lon: hasInstitute ? institute_lon : null,
    has_institute_coordinates: hasInstitute,
    base: {
      species_taxid,
      species_scientific_name: String(row.species_scientific_name ?? ''),
      assembly_accession: String(row.assembly_accession ?? ''),
      collection_country: String(row.collection_country ?? '').trim(),
      collection_continent: String(row.collection_continent ?? 'Unknown').trim() || 'Unknown',
      collection_country_iso3: optionalString(row.collection_country_iso3),
      submitter_name: optionalString(row.submitter_name),
      institute_name: optionalString(row.institute_name),
      institute_ror_id: optionalString(row.institute_ror_id),
      institute_country: optionalString(row.institute_country),
      institute_continent: optionalString(row.institute_continent),
      institute_country_iso3: optionalString(row.institute_country_iso3),
      kingdom_taxid: optionalString(row.kingdom_taxid),
      kingdom_name: optionalString(row.kingdom_name),
      phylum_taxid: optionalString(row.phylum_taxid),
      phylum_name: optionalString(row.phylum_name),
      class_taxid: optionalString(row.class_taxid),
      class_name: optionalString(row.class_name),
      order_taxid: optionalString(row.order_taxid),
      order_name: optionalString(row.order_name),
      family_taxid: optionalString(row.family_taxid),
      family_name: optionalString(row.family_name),
      genus_taxid: optionalString(row.genus_taxid),
      genus_name: optionalString(row.genus_name),
    },
  }
}

function topCounts(
  rows: Array<RegionFlow | SpeciesFlow>,
  getLabel: (row: RegionFlow | SpeciesFlow) => string | null,
  getKey: (row: RegionFlow | SpeciesFlow) => string | null,
  limit = 5,
): RankedCount[] {
  const counts = new Map<string, { label: string; count: number }>()
  for (const row of rows) {
    const key = getKey(row)
    const label = getLabel(row)
    if (!key || !label) continue
    const prev = counts.get(key)
    if (prev) prev.count += 1
    else counts.set(key, { label, count: 1 })
  }
  return [...counts.entries()]
    .map(([key, { label, count }]) => ({ key, label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit)
}

export function computeRegionStats(
  flows: Array<RegionFlow | SpeciesFlow>,
  geoFilter: GeoFilter,
): RegionStats {
  let domestic = 0
  let offshore = 0
  let unknown = 0
  const withInstitute: Array<RegionFlow | SpeciesFlow> = []

  for (const row of flows) {
    if (!row.has_institute_coordinates || !row.institute_country) {
      unknown += 1
      continue
    }
    withInstitute.push(row)
    let isDomestic = false
    if (geoFilter.country) {
      if (row.collection_country_iso3 && row.institute_country_iso3) {
        isDomestic = row.collection_country_iso3 === row.institute_country_iso3
      } else {
        isDomestic = row.institute_country === row.collection_country
      }
    } else {
      isDomestic = (row.institute_continent ?? 'Unknown') === row.collection_continent
    }
    if (isDomestic) domestic += 1
    else offshore += 1
  }

  return {
    total: flows.length,
    domestic,
    offshore,
    unknown,
    topInstitutes: topCounts(
      withInstitute,
      (row) => row.institute_name,
      (row) => instituteKey(row),
    ),
    topSubmitterCountries: topCounts(
      withInstitute,
      (row) => row.institute_country,
      (row) => row.institute_country,
    ),
  }
}

export function formatCoord(value: number, axis: 'lat' | 'lng'): string {
  const abs = Math.abs(value).toFixed(2)
  if (axis === 'lat') return `${abs}°${value >= 0 ? 'N' : 'S'}`
  return `${abs}°${value >= 0 ? 'E' : 'W'}`
}

export function normalizeFlows(table: unknown): SpeciesFlow[] {
  if (!table || typeof table !== 'object') return []
  const maybe = table as { data?: unknown }
  const raw = Array.isArray(maybe.data) ? maybe.data : Array.isArray(table) ? table : []

  const flows: SpeciesFlow[] = []
  for (const row of raw as Record<string, unknown>[]) {
    const mapped = mapFlowRow(row)
    if (!mapped) continue
    if (mapped.collection_lat == null || mapped.collection_lon == null) continue
    flows.push({
      ...mapped.base,
      collection_lat: mapped.collection_lat,
      collection_lon: mapped.collection_lon,
      institute_lat: mapped.institute_lat,
      institute_lon: mapped.institute_lon,
      has_institute_coordinates: mapped.has_institute_coordinates,
    })
  }
  return flows
}

/** Like normalizeFlows but keeps country-only species (null collection lat/lon). */
export function normalizeRegionFlows(table: unknown): RegionFlow[] {
  if (!table || typeof table !== 'object') return []
  const maybe = table as { data?: unknown }
  const raw = Array.isArray(maybe.data) ? maybe.data : Array.isArray(table) ? table : []

  const flows: RegionFlow[] = []
  for (const row of raw as Record<string, unknown>[]) {
    const mapped = mapFlowRow(row)
    if (!mapped) continue
    // Regions atlas needs country; skip rows with neither country nor ISO3.
    if (!mapped.base.collection_country && !mapped.base.collection_country_iso3) continue
    flows.push({
      ...mapped.base,
      collection_lat: mapped.collection_lat,
      collection_lon: mapped.collection_lon,
      institute_lat: mapped.institute_lat,
      institute_lon: mapped.institute_lon,
      has_institute_coordinates: mapped.has_institute_coordinates,
    })
  }
  return flows
}

export const PARQUET_COLUMNS = [
  'species_taxid',
  'species_scientific_name',
  'assembly_accession',
  'collection_lat',
  'collection_lon',
  'institute_lat',
  'institute_lon',
  'has_institute_coordinates',
  'collection_country',
  'collection_continent',
  'collection_country_iso3',
  'submitter_name',
  'institute_name',
  'institute_ror_id',
  'institute_country',
  'institute_continent',
  'institute_country_iso3',
  'kingdom_taxid',
  'kingdom_name',
  'phylum_taxid',
  'phylum_name',
  'class_taxid',
  'class_name',
  'order_taxid',
  'order_name',
  'family_taxid',
  'family_name',
  'genus_taxid',
  'genus_name',
] as const
