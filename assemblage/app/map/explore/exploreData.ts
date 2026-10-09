import type { RegionFlow, Selection, TaxonRank, WorldGeoJson } from '../types'
import { TAXON_RANKS, instituteKey, matchesSelection } from '../types'
import type {
  CountryCentroids,
  CountryTotal,
  SpeciesCountRow,
} from '../regionData'
import { CUSTOM_REGIONS } from './customRegions'
import { hasInstituteGeography } from './outreachFilter'
import {
  countsFromLists,
  type FlowIndex,
  forEachInLists,
  type SliceLists,
} from './flowIndex'

export type { CountryCentroids, CountryTotal, SpeciesCountRow }
export type { CustomRegionId } from './customRegions'
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
  local: number
  exported: number
  unknown: number
  imported: number
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

/** Visibility / sort key for list cards (every flow that touches the region). */
export function cardTotal(
  card: Pick<RegionCard, 'local' | 'exported' | 'unknown' | 'imported'>,
): number {
  return card.local + card.exported + card.unknown + card.imported
}

function countsOrZero(lists: SliceLists | undefined): {
  local: number
  exported: number
  unknown: number
  imported: number
} {
  if (!lists) return { local: 0, exported: 0, unknown: 0, imported: 0 }
  const c = countsFromLists(lists)
  return {
    local: c.local,
    exported: c.exported,
    unknown: c.unknown,
    imported: c.imported,
  }
}

/** City-states without Natural Earth 110m polygons — shown under Regions, not Countries. */
export const CITY_STATE_ISO3 = new Set(['SGP', 'HKG'])

/**
 * Regions tab allowlist (others are still built / kept in data, just not listed).
 * Order is the display order.
 */
export const REGIONS_TAB_VISIBLE_IDS = [
  'custom:global-north',
  'custom:global-south',
  'country:CHN',
  'custom:latin-america',
] as const

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
  index: FlowIndex,
  speciesCounts: SpeciesCountRow[],
  countryTotals: CountryTotal[],
  continentLookup: Map<string, string>,
): RegionCard[] {
  const sequencedByIso = new Map(countryTotals.map((t) => [t.iso3, t]))
  const cards: RegionCard[] = []
  const seen = new Set<string>()

  for (const row of speciesCounts) {
    if (!row.iso3) continue
    const sequenced = sequencedByIso.get(row.iso3)
    const counts = countsOrZero(index.byCountryIso3.get(row.iso3))
    const meta = index.countryMeta.get(row.iso3)
    const continent =
      sequenced?.continent ||
      continentLookup.get(row.iso3) ||
      meta?.continent ||
      DESTINATION_UNRESOLVED
    cards.push({
      id: `country:${row.iso3}`,
      kind: 'country',
      name: row.country_name || sequenced?.countryName || meta?.name || row.iso3,
      iso3: row.iso3,
      continent,
      local: counts.local,
      exported: counts.exported,
      unknown: counts.unknown,
      imported: counts.imported,
    })
    seen.add(row.iso3)
  }

  for (const total of countryTotals) {
    if (seen.has(total.iso3)) continue
    const counts = countsOrZero(index.byCountryIso3.get(total.iso3))
    cards.push({
      id: `country:${total.iso3}`,
      kind: 'country',
      name: total.countryName,
      iso3: total.iso3,
      continent: total.continent,
      local: counts.local,
      exported: counts.exported,
      unknown: counts.unknown,
      imported: counts.imported,
    })
    seen.add(total.iso3)
  }

  // Import-only hubs / outreach countries missing from GBIF and totals tables.
  for (const [iso3, lists] of index.byCountryIso3) {
    if (seen.has(iso3)) continue
    const counts = countsOrZero(lists)
    const meta = index.countryMeta.get(iso3)
    cards.push({
      id: `country:${iso3}`,
      kind: 'country',
      name: meta?.name || iso3,
      iso3,
      continent:
        continentLookup.get(iso3) || meta?.continent || DESTINATION_UNRESOLVED,
      local: counts.local,
      exported: counts.exported,
      unknown: counts.unknown,
      imported: counts.imported,
    })
    seen.add(iso3)
  }

  return cards
    .filter((card) => cardTotal(card) > 0)
    .sort(
      (a, b) =>
        cardTotal(b) - cardTotal(a) || a.name.localeCompare(b.name),
    )
}

export function buildContinentCards(index: FlowIndex): RegionCard[] {
  return [...index.byContinent.entries()]
    .filter(
      ([name]) =>
        name !== DESTINATION_UNRESOLVED || index.byContinent.size === 1,
    )
    .map(([name, lists]) => {
      const counts = countsOrZero(lists)
      return {
        id: `continent:${name}`,
        kind: 'continent' as const,
        name,
        iso3: null,
        continent: name,
        local: counts.local,
        exported: counts.exported,
        unknown: counts.unknown,
        imported: counts.imported,
      }
    })
    .filter((card) => cardTotal(card) > 0)
    .sort((a, b) => {
      if (a.name === 'Unknown' || a.name === DESTINATION_UNRESOLVED) return 1
      if (b.name === 'Unknown' || b.name === DESTINATION_UNRESOLVED) return -1
      return cardTotal(b) - cardTotal(a) || a.name.localeCompare(b.name)
    })
}

/** Aggregate outreach counts for the three predefined custom regions. */
export function buildCustomRegionCards(index: FlowIndex): RegionCard[] {
  return CUSTOM_REGIONS.map((region) => {
    const counts = countsOrZero(index.byCustom.get(region.id))
    return {
      id: `custom:${region.id}`,
      kind: 'custom' as const,
      name: region.name,
      iso3: null,
      continent: 'Custom region',
      local: counts.local,
      exported: counts.exported,
      unknown: counts.unknown,
      imported: counts.imported,
    }
  }).sort((a, b) => cardTotal(b) - cardTotal(a) || a.name.localeCompare(b.name))
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
    .filter((card) => isSpecialRegionCard(card) && cardTotal(card) > 0)
    .map((card) => ({
      ...card,
      name: specialRegionDisplayName(card),
      subtitle:
        card.iso3 && CITY_STATE_ISO3.has(card.iso3) ? 'City-state' : 'Region',
    }))
    .sort(
      (a, b) =>
        cardTotal(b) - cardTotal(a) || a.name.localeCompare(b.name),
    )
}

/** Regions tab: multi-country atlases first, then special single entities. */
export function buildRegionsTabCards(
  index: FlowIndex,
  countryCards: RegionCard[],
): RegionCard[] {
  const atlases = buildCustomRegionCards(index)
  const specials = buildSpecialRegionCards(countryCards)
  // Featured country entries that live on Regions alongside atlases (e.g. China).
  const featuredCountries = countryCards
    .filter(
      (card) =>
        card.iso3 === 'CHN' &&
        cardTotal(card) > 0 &&
        !isSpecialRegionCard(card),
    )
    .map((card) => ({
      ...card,
      subtitle: card.continent || undefined,
    }))

  // Keep computing atlases + specials; only surface the allowlisted subset for now.
  const byId = new Map<string, RegionCard>()
  for (const card of [...atlases, ...featuredCountries, ...specials]) {
    byId.set(card.id, card)
  }

  return REGIONS_TAB_VISIBLE_IDS.flatMap((id) => {
    const card = byId.get(id)
    return card ? [card] : []
  })
}

export type SequencingBreakdown = {
  groups: DestinationContinentGroup[]
  /** Rows in scope with no institute geography (shown under the bars). */
  unknownPlaceCount: number
}

/**
 * Groups scoped flows by institute continent → nested country or institute.
 * Rows with no institute geography are counted in unknownPlaceCount, not the bars.
 */
export function buildSequencingBreakdown(
  flows: RegionFlow[],
  mode: DestinationMode = 'country',
): SequencingBreakdown {
  type ChildAcc = {
    key: string
    label: string
    country: string | null
    count: number
  }
  const byContinent = new Map<string, Map<string, ChildAcc>>()
  let unknownPlaceCount = 0

  for (const row of flows) {
    if (!hasInstituteGeography(row)) {
      unknownPlaceCount++
      continue
    }
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

  const groups = [...byContinent.entries()]
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

  return { groups, unknownPlaceCount }
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

/**
 * Distinct taxa per rank with species counts.
 * Pass slice lists (or a partition) to avoid concatenating the region union first.
 */
export function buildTaxonRankSummaries(
  flowsOrLists: RegionFlow[] | Pick<SliceLists, 'local' | 'exported' | 'unknown' | 'imported'>,
): TaxonRankSummaries {
  const empty = (): TaxonRankSummary => ({ count: 0, options: [] })
  const result = Object.fromEntries(TAXON_RANKS.map((r) => [r, empty()])) as TaxonRankSummaries

  const byRank = Object.fromEntries(
    TAXON_RANKS.map((r) => [r, new Map<string, { name: string; species: Set<string> }>()]),
  ) as Record<TaxonRank, Map<string, { name: string; species: Set<string> }>>

  const visit = (row: RegionFlow) => {
    for (const rank of TAXON_RANKS) {
      const taxid = row[`${rank}_taxid` as keyof RegionFlow]
      const name = row[`${rank}_name` as keyof RegionFlow]
      if (typeof taxid !== 'string' || !taxid) continue
      if (typeof name !== 'string' || !name) continue
      let entry = byRank[rank].get(taxid)
      if (!entry) {
        entry = { name, species: new Set() }
        byRank[rank].set(taxid, entry)
      }
      if (row.species_taxid) entry.species.add(row.species_taxid)
    }
  }

  if (Array.isArray(flowsOrLists)) {
    for (const row of flowsOrLists) visit(row)
  } else {
    forEachInLists(flowsOrLists, visit)
  }

  for (const rank of TAXON_RANKS) {
    const options = [...byRank[rank].entries()]
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
