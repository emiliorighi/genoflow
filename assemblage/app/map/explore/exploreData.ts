import type { RegionFlow, Selection, TaxonRank, WorldGeoJson } from '../types'
import { TAXON_RANKS, instituteKey, matchesSelection } from '../types'
import type {
  CountryCentroids,
  CountryTotal,
  SpeciesCountRow,
} from '../regionData'
import {
  CUSTOM_REGIONS,
  buildCustomRegionIso3Set,
  type CustomRegionId,
} from './customRegions'

export type { CountryCentroids, CountryTotal, SpeciesCountRow }
export type { CustomRegionId }
export {
  CUSTOM_REGIONS,
  CUSTOM_REGION_IDS,
  SE_ASIA_ISO3,
  buildAllCustomIso3Sets,
  buildCustomRegionIso3Set,
  customIso3SetForFilter,
  customRegionLabel,
  isCustomRegionId,
  isCustomRegionMember,
} from './customRegions'

export type RegionCard = {
  id: string
  kind: 'continent' | 'country' | 'custom'
  name: string
  iso3: string | null
  continent: string
  /** Optional list subtitle; falls back to continent when omitted. */
  subtitle?: string
  gbif: number | null
  inat: number | null
  sequenced: number
}

export type DestinationChild = {
  key: string
  label: string
  count: number
  /** Institute country shown in parentheses; only set in institute mode. */
  country?: string | null
}

export type DestinationContinentGroup = {
  continent: string
  total: number
  children: DestinationChild[]
}

export type DestinationMode = 'country' | 'institute'

export const DESTINATION_UNRESOLVED = 'Unresolved'

/** City-states without Natural Earth 110m polygons — shown under Regions, not Countries. */
export const CITY_STATE_ISO3 = new Set(['SGP', 'HKG'])

/** Whether a country-like card belongs on the Regions tab as a single entity. */
export function isSpecialRegionCard(card: RegionCard): boolean {
  if (!card.iso3) return false
  if (CITY_STATE_ISO3.has(card.iso3)) return true
  return card.continent === 'Unknown'
}

/** Countries tab: real countries only (no Unknown basins / city-states). */
export function filterCountryCardsForCountriesTab(cards: RegionCard[]): RegionCard[] {
  return cards.filter((card) => !isSpecialRegionCard(card))
}

/** iso3 → CONTINENT from world geojson features. */
export function buildContinentLookup(world: WorldGeoJson): Map<string, string> {
  const map = new Map<string, string>()
  for (const feature of world.features) {
    const iso3 = feature.properties.ISO_A3
    const continent = feature.properties.CONTINENT
    if (!iso3 || iso3 === '-99' || !continent) continue
    map.set(iso3, continent)
  }
  return map
}

export function buildCountryCards(
  speciesCounts: SpeciesCountRow[],
  countryTotals: CountryTotal[],
  continentLookup: Map<string, string>,
): RegionCard[] {
  const sequencedByIso = new Map(countryTotals.map((t) => [t.iso3, t]))
  const cards: RegionCard[] = []

  for (const row of speciesCounts) {
    if (!row.iso3) continue
    const sequenced = sequencedByIso.get(row.iso3)
    const continent =
      sequenced?.continent ||
      continentLookup.get(row.iso3) ||
      DESTINATION_UNRESOLVED
    cards.push({
      id: `country:${row.iso3}`,
      kind: 'country',
      name: row.country_name || sequenced?.countryName || row.iso3,
      iso3: row.iso3,
      continent,
      gbif: row.gbif_species_count,
      inat: row.inat_species_count,
      sequenced: sequenced?.total ?? 0,
    })
  }

  // Include sequenced countries missing from GBIF/iNat table.
  for (const total of countryTotals) {
    if (cards.some((c) => c.iso3 === total.iso3)) continue
    cards.push({
      id: `country:${total.iso3}`,
      kind: 'country',
      name: total.countryName,
      iso3: total.iso3,
      continent: total.continent,
      gbif: null,
      inat: null,
      sequenced: total.total,
    })
  }

  return cards
    .filter((card) => card.sequenced > 0)
    .sort(
      (a, b) =>
        b.sequenced - a.sequenced || a.name.localeCompare(b.name),
    )
}

export function buildContinentCards(
  speciesCounts: SpeciesCountRow[],
  countryTotals: CountryTotal[],
  continentLookup: Map<string, string>,
): RegionCard[] {
  type Acc = {
    gbif: number
    inat: number
    sequenced: number
    hasGbif: boolean
    hasInat: boolean
  }
  const byContinent = new Map<string, Acc>()

  const ensure = (continent: string): Acc => {
    let acc = byContinent.get(continent)
    if (!acc) {
      acc = { gbif: 0, inat: 0, sequenced: 0, hasGbif: false, hasInat: false }
      byContinent.set(continent, acc)
    }
    return acc
  }

  const countsByIso = new Map(
    speciesCounts.filter((r) => r.iso3).map((r) => [r.iso3 as string, r]),
  )

  for (const total of countryTotals) {
    const acc = ensure(total.continent || DESTINATION_UNRESOLVED)
    acc.sequenced += total.total
    const row = countsByIso.get(total.iso3)
    if (row?.gbif_species_count != null) {
      acc.gbif += row.gbif_species_count
      acc.hasGbif = true
    }
    if (row?.inat_species_count != null) {
      acc.inat += row.inat_species_count
      acc.hasInat = true
    }
  }

  // Fold GBIF/iNat countries that have no sequenced species into their continent.
  for (const row of speciesCounts) {
    if (!row.iso3) continue
    if (countryTotals.some((t) => t.iso3 === row.iso3)) continue
    const continent = continentLookup.get(row.iso3) || DESTINATION_UNRESOLVED
    const acc = ensure(continent)
    if (row.gbif_species_count != null) {
      acc.gbif += row.gbif_species_count
      acc.hasGbif = true
    }
    if (row.inat_species_count != null) {
      acc.inat += row.inat_species_count
      acc.hasInat = true
    }
  }

  return [...byContinent.entries()]
    .filter(([name]) => name !== DESTINATION_UNRESOLVED || byContinent.size === 1)
    .map(([name, acc]) => ({
      id: `continent:${name}`,
      kind: 'continent' as const,
      name,
      iso3: null,
      continent: name,
      gbif: acc.hasGbif ? acc.gbif : null,
      inat: acc.hasInat ? acc.inat : null,
      sequenced: acc.sequenced,
    }))
    .filter((card) => card.sequenced > 0)
    .sort((a, b) => {
      if (a.name === 'Unknown') return 1
      if (b.name === 'Unknown') return -1
      return b.sequenced - a.sequenced || a.name.localeCompare(b.name)
    })
}

/** Aggregate country-card metrics into the three predefined custom regions. */
export function buildCustomRegionCards(
  countryCards: RegionCard[],
  continentLookup: Map<string, string>,
): RegionCard[] {
  return CUSTOM_REGIONS.map((region) => {
    const members = buildCustomRegionIso3Set(region.id, continentLookup)
    let gbif = 0
    let inat = 0
    let sequenced = 0
    let hasGbif = false
    let hasInat = false
    for (const card of countryCards) {
      if (!card.iso3 || !members.has(card.iso3)) continue
      sequenced += card.sequenced
      if (card.gbif != null) {
        gbif += card.gbif
        hasGbif = true
      }
      if (card.inat != null) {
        inat += card.inat
        hasInat = true
      }
    }
    return {
      id: `custom:${region.id}`,
      kind: 'custom' as const,
      name: region.name,
      iso3: null,
      continent: 'Custom region',
      gbif: hasGbif ? gbif : null,
      inat: hasInat ? inat : null,
      sequenced,
    }
  }).sort((a, b) => b.sequenced - a.sequenced || a.name.localeCompare(b.name))
}

function specialRegionDisplayName(card: RegionCard): string {
  const raw = (card.name || '').trim()
  if (!raw || raw.toLowerCase() === 'nd') {
    return card.iso3 === 'XUN' ? 'Unknown' : card.iso3 || 'Unknown'
  }
  return raw
}

/**
 * Seas/oceans (Unknown continent) and city-states without basemap polygons.
 * Reuses kind "country" so selection filters by ISO3 and plots via centroids.
 * Keeps the real collection continent for URL/hydration; subtitle is display-only.
 */
export function buildSpecialRegionCards(countryCards: RegionCard[]): RegionCard[] {
  return countryCards
    .filter((card) => isSpecialRegionCard(card) && card.sequenced > 0)
    .map((card) => ({
      ...card,
      name: specialRegionDisplayName(card),
      subtitle:
        card.iso3 && CITY_STATE_ISO3.has(card.iso3) ? 'City-state' : 'Region',
    }))
    .sort(
      (a, b) =>
        b.sequenced - a.sequenced || a.name.localeCompare(b.name),
    )
}

/** Regions tab: multi-country atlases first, then special single entities. */
export function buildRegionsTabCards(
  countryCards: RegionCard[],
  continentLookup: Map<string, string>,
): RegionCard[] {
  const atlases = buildCustomRegionCards(countryCards, continentLookup)
  const specials = buildSpecialRegionCards(countryCards)
  return [...atlases, ...specials]
}

/**
 * Groups scoped flows by institute continent → nested country or institute.
 * Rows missing institute geography roll into "Unresolved" so the diagram
 * total always equals the scope's sequenced-species count.
 */
export function buildSequencingBreakdown(
  flows: RegionFlow[],
  mode: DestinationMode = 'country',
): DestinationContinentGroup[] {
  type ChildAcc = {
    key: string
    label: string
    country: string | null
    count: number
  }
  const byContinent = new Map<string, Map<string, ChildAcc>>()

  for (const row of flows) {
    const continent = row.institute_continent?.trim() || DESTINATION_UNRESOLVED
    let childKey: string
    let childLabel: string
    let childCountry: string | null = null
    if (mode === 'institute') {
      childKey = instituteKey(row) || DESTINATION_UNRESOLVED
      childLabel = row.institute_name?.trim() || DESTINATION_UNRESOLVED
      childCountry = row.institute_country?.trim() || null
    } else {
      const country = row.institute_country?.trim() || DESTINATION_UNRESOLVED
      childKey = row.institute_country_iso3 || country
      childLabel = country
    }

    let children = byContinent.get(continent)
    if (!children) {
      children = new Map()
      byContinent.set(continent, children)
    }
    const prev = children.get(childKey)
    if (prev) {
      prev.count += 1
      if (!prev.country && childCountry) prev.country = childCountry
    } else {
      children.set(childKey, {
        key: childKey,
        label: childLabel,
        country: childCountry,
        count: 1,
      })
    }
  }

  return [...byContinent.entries()]
    .map(([continent, children]) => {
      const sorted = [...children.values()].sort(
        (a, b) => b.count - a.count || a.label.localeCompare(b.label),
      )
      const nodes: DestinationChild[] = sorted.map((c) => ({
        key: c.key,
        label: c.label,
        count: c.count,
        ...(mode === 'institute' ? { country: c.country } : {}),
      }))
      const total = sorted.reduce((sum, c) => sum + c.count, 0)
      return { continent, total, children: nodes }
    })
    .sort((a, b) => {
      if (a.continent === DESTINATION_UNRESOLVED) return 1
      if (b.continent === DESTINATION_UNRESOLVED) return -1
      return b.total - a.total || a.continent.localeCompare(b.continent)
    })
}

export function resolveCollectionPosition(
  row: RegionFlow,
  centroids: CountryCentroids | null,
): [number, number] | null {
  if (row.collection_lat != null && row.collection_lon != null) {
    return [row.collection_lon, row.collection_lat]
  }
  if (centroids && row.collection_country_iso3) {
    const c = centroids[row.collection_country_iso3]
    if (c) return [c.lon, c.lat]
  }
  return null
}

/** Stable key for a plot position (rounded to avoid float noise). */
export function plotPositionKey(lon: number, lat: number): string {
  return `${lon.toFixed(5)},${lat.toFixed(5)}`
}

/** Group flows by resolved collection plot position (precise coords or country centroid). */
export function groupFlowsByPoint(
  flows: RegionFlow[],
  centroids: CountryCentroids | null,
): Map<string, RegionFlow[]> {
  const groups = new Map<string, RegionFlow[]>()
  for (const row of flows) {
    const pos = resolveCollectionPosition(row, centroids)
    if (!pos) continue
    const key = plotPositionKey(pos[0], pos[1])
    const prev = groups.get(key)
    if (prev) prev.push(row)
    else groups.set(key, [row])
  }
  return groups
}

/**
 * Whether a flow matches the current selection, including point-cluster selections
 * that highlight every species sharing a plot position.
 */
export function flowMatchesSelection(
  row: RegionFlow,
  selection: Selection,
  centroids: CountryCentroids | null,
): boolean {
  if (!selection) return false
  if (selection.type !== 'point') return matchesSelection(row, selection)
  const pos = resolveCollectionPosition(row, centroids)
  if (!pos) return false
  return plotPositionKey(pos[0], pos[1]) === plotPositionKey(selection.lon, selection.lat)
}

export function filterCards(cards: RegionCard[], query: string): RegionCard[] {
  const q = query.trim().toLowerCase()
  if (!q) return cards
  return cards.filter(
    (card) =>
      card.name.toLowerCase().includes(q) ||
      card.continent.toLowerCase().includes(q) ||
      (card.iso3 && card.iso3.toLowerCase().includes(q)),
  )
}

export type TaxonOption = {
  taxid: string
  name: string
  speciesCount: number
}

export type TaxonRankSummary = {
  count: number
  options: TaxonOption[]
}

export type TaxonRankSummaries = Record<TaxonRank, TaxonRankSummary>

/** Distinct taxa per rank with species counts, from the given (already geo-scoped) flows. */
export function buildTaxonRankSummaries(flows: RegionFlow[]): TaxonRankSummaries {
  const empty = (): TaxonRankSummary => ({ count: 0, options: [] })
  const result = Object.fromEntries(TAXON_RANKS.map((r) => [r, empty()])) as TaxonRankSummaries

  for (const rank of TAXON_RANKS) {
    const taxidKey = `${rank}_taxid` as keyof RegionFlow
    const nameKey = `${rank}_name` as keyof RegionFlow
    const byTaxid = new Map<string, { name: string; species: Set<string> }>()

    for (const row of flows) {
      const taxid = row[taxidKey]
      const name = row[nameKey]
      if (typeof taxid !== 'string' || !taxid) continue
      if (typeof name !== 'string' || !name) continue
      let entry = byTaxid.get(taxid)
      if (!entry) {
        entry = { name, species: new Set() }
        byTaxid.set(taxid, entry)
      }
      if (row.species_taxid) entry.species.add(row.species_taxid)
    }

    const options = [...byTaxid.entries()]
      .map(([taxid, { name, species }]) => ({
        taxid,
        name,
        speciesCount: species.size,
      }))
      .sort(
        (a, b) =>
          b.speciesCount - a.speciesCount || a.name.localeCompare(b.name),
      )

    result[rank] = { count: options.length, options }
  }

  return result
}
