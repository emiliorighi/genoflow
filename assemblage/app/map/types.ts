import { isCustomRegionId, isCustomRegionMember } from './explore/customRegions'

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
  assembly_level: string | null
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
  /** Predefined multi-country region id (e.g. latin-america). Mutually exclusive with continent/country. */
  customId: string | null
}

export type Selection =
  | { type: 'species'; taxid: string }
  | { type: 'institute'; key: string }
  | { type: 'point'; lat: number; lon: number }
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

export const EMPTY_GEO_FILTER: GeoFilter = {
  continent: null,
  country: null,
  countryIso3: null,
  customId: null,
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

/** Geo match for continent / country / custom region membership. */
export function matchesGeoFilter(
  row: RegionFlow | SpeciesFlow,
  geoFilter: GeoFilter,
  customIso3Set: Set<string> | null = null,
): boolean {
  if (geoFilter.customId) {
    if (!isCustomRegionId(geoFilter.customId)) return false
    // Prefer attribute-based membership so rows without ISO3 and deep links
    // before world geojson loads still scope correctly. ISO3 set is optional
    // fast-path when provided and the row has an ISO3.
    if (row.collection_country_iso3 && customIso3Set && customIso3Set.size > 0) {
      return customIso3Set.has(row.collection_country_iso3)
    }
    return isCustomRegionMember(
      geoFilter.customId,
      row.collection_country_iso3,
      row.collection_continent,
      row.collection_country,
    )
  }
  if (geoFilter.country) {
    if (geoFilter.countryIso3 && row.collection_country_iso3) {
      return row.collection_country_iso3 === geoFilter.countryIso3
    }
    return row.collection_country === geoFilter.country
  }
  if (geoFilter.continent) {
    return row.collection_continent === geoFilter.continent
  }
  return true
}

export function filterFlows<T extends RegionFlow | SpeciesFlow>(
  flows: T[],
  rankFilter: RankFilter | null,
  geoFilter: GeoFilter,
  customIso3Set: Set<string> | null = null,
): T[] {
  return flows.filter((row) => {
    if (rankFilter) {
      const taxid = row[`${rankFilter.rank}_taxid` as keyof T]
      if (taxid !== rankFilter.taxid) return false
    }
    return matchesGeoFilter(row, geoFilter, customIso3Set)
  })
}

/** Query param keys used to make the map's filter/selection state shareable via URL. */
export const MAP_QUERY_KEYS = {
  rank: 'rank',
  taxon: 'taxon',
  continent: 'continent',
  country: 'country',
  custom: 'custom',
  select: 'select',
} as const

export function encodeSelectionParam(selection: Selection): string | null {
  if (!selection) return null
  if (selection.type === 'species') return `species:${selection.taxid}`
  if (selection.type === 'institute') return `institute:${selection.key}`
  return `point:${selection.lat},${selection.lon}`
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
  if (type === 'point') {
    const comma = value.indexOf(',')
    if (comma < 0) return null
    const lat = Number(value.slice(0, comma))
    const lon = Number(value.slice(comma + 1))
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
    return { type: 'point', lat, lon }
  }
  return null
}

export type MapDeepLinkState = {
  rank?: TaxonRank
  taxon?: string
  continent?: string
  country?: string
  customId?: string
}

/** Build a `/map?...` deep link for quick-start entry points (e.g. from the landing page). */
export function buildMapHref(state: MapDeepLinkState): string {
  const params = new URLSearchParams()
  if (state.rank && state.taxon) {
    params.set(MAP_QUERY_KEYS.rank, state.rank)
    params.set(MAP_QUERY_KEYS.taxon, state.taxon)
  }
  if (state.customId) {
    params.set(MAP_QUERY_KEYS.custom, state.customId)
  } else {
    if (state.continent) params.set(MAP_QUERY_KEYS.continent, state.continent)
    if (state.country) params.set(MAP_QUERY_KEYS.country, state.country)
  }
  const qs = params.toString()
  return qs ? `/map?${qs}` : '/map'
}

export function matchesSelection(row: RegionFlow | SpeciesFlow, selection: Selection): boolean {
  if (!selection) return false
  if (selection.type === 'species') return row.species_taxid === selection.taxid
  if (selection.type === 'point') return false
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
      assembly_level: optionalString(row.assembly_level),
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

export function formatCoord(value: number, axis: 'lat' | 'lng'): string {
  const abs = Math.abs(value).toFixed(2)
  if (axis === 'lat') return `${abs}°${value >= 0 ? 'N' : 'S'}`
  return `${abs}°${value >= 0 ? 'E' : 'W'}`
}

/** Normalize parquet rows, keeping country-only species (null collection lat/lon). */
export function normalizeRegionFlows(table: unknown): RegionFlow[] {
  if (!table || typeof table !== 'object') return []
  const maybe = table as { data?: unknown }
  const data = maybe.data as unknown
  // ParquetArrowLoader returns { shape: 'arrow-table', data: Arrow.Table };
  // ParquetJSONLoader returns { shape: 'object-row-table', data: row[] }.
  const raw = Array.isArray(data)
    ? data
    : data && typeof (data as { toArray?: unknown }).toArray === 'function'
      ? (data as { toArray(): Record<string, unknown>[] }).toArray()
      : Array.isArray(table)
        ? table
        : []

  const flows: RegionFlow[] = []
  for (const row of raw as Record<string, unknown>[]) {
    const mapped = mapFlowRow(row)
    if (!mapped) continue
    // Skip rows with neither country nor ISO3.
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
  'assembly_level',
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
