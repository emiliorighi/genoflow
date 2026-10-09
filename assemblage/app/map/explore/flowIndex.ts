import {
  CUSTOM_REGION_IDS,
  isCustomRegionId,
  type CustomRegionId,
} from './customRegions'
import {
  classifyOutreach,
  type OutreachCounts,
  type OutreachMode,
  type OutreachPartition,
} from './outreachFilter'
import type { GeoFilter, RankFilter, RegionFlow } from '../types'

export type SliceLists<T = RegionFlow> = {
  local: T[]
  exported: T[]
  unknown: T[]
  imported: T[]
}

export type CountryMeta = {
  name: string
  continent: string
}

export type FlowIndex = {
  byCountryIso3: Map<string, SliceLists>
  /** Rows whose collection/institute side has a country name but no ISO3. */
  byCountryName: Map<string, SliceLists>
  byContinent: Map<string, SliceLists>
  byCustom: Map<CustomRegionId, SliceLists>
  /** First-seen display name + continent for each ISO3 (avoids rescanning flows). */
  countryMeta: Map<string, CountryMeta>
}

function emptyLists(): SliceLists {
  return { local: [], exported: [], unknown: [], imported: [] }
}

function ensureLists(map: Map<string, SliceLists>, key: string): SliceLists {
  let lists = map.get(key)
  if (!lists) {
    lists = emptyLists()
    map.set(key, lists)
  }
  return lists
}

function ensureCustom(
  map: Map<CustomRegionId, SliceLists>,
  id: CustomRegionId,
): SliceLists {
  let lists = map.get(id)
  if (!lists) {
    lists = emptyLists()
    map.set(id, lists)
  }
  return lists
}

function pushSlice(lists: SliceLists, kind: OutreachMode, row: RegionFlow): void {
  lists[kind].push(row)
}

export function countsFromLists(lists: SliceLists): OutreachCounts {
  return {
    local: lists.local.length,
    exported: lists.exported.length,
    unknown: lists.unknown.length,
    imported: lists.imported.length,
    originTotal: lists.local.length + lists.exported.length + lists.unknown.length,
  }
}

export function partitionFromLists(lists: SliceLists): OutreachPartition<RegionFlow> {
  return {
    local: lists.local,
    exported: lists.exported,
    unknown: lists.unknown,
    imported: lists.imported,
    counts: countsFromLists(lists),
  }
}

function mergeLists(a: SliceLists | undefined, b: SliceLists | undefined): SliceLists {
  if (!a && !b) return emptyLists()
  if (!a) return b as SliceLists
  if (!b) return a
  const aEmpty =
    a.local.length + a.exported.length + a.unknown.length + a.imported.length === 0
  const bEmpty =
    b.local.length + b.exported.length + b.unknown.length + b.imported.length === 0
  if (aEmpty) return b
  if (bEmpty) return a
  return {
    local: a.local.concat(b.local),
    exported: a.exported.concat(b.exported),
    unknown: a.unknown.concat(b.unknown),
    imported: a.imported.concat(b.imported),
  }
}

function rememberCountry(
  meta: Map<string, CountryMeta>,
  iso3: string,
  name: string | null | undefined,
  continent: string | null | undefined,
): void {
  if (meta.has(iso3)) return
  meta.set(iso3, {
    name: (name || '').trim() || iso3,
    continent: (continent || '').trim() || 'Unresolved',
  })
}

function countryFilter(iso3: string | null, name: string): GeoFilter {
  return {
    continent: null,
    country: name,
    countryIso3: iso3,
    customId: null,
  }
}

function continentFilter(continent: string): GeoFilter {
  return {
    continent,
    country: null,
    countryIso3: null,
    customId: null,
  }
}

function customFilter(customId: CustomRegionId): GeoFilter {
  return {
    continent: null,
    country: null,
    countryIso3: null,
    customId,
  }
}

/**
 * One pass over flows. Buckets use the same membership rules as classifyOutreach
 * so list-card counts match the region-detail checkboxes.
 *
 * Blank collection continents are filed under "Unresolved" only (via a synthetic
 * card key); real continent totals use the exact collection_continent string.
 */
export function buildFlowIndex(
  flows: RegionFlow[],
  customIso3Sets: Map<CustomRegionId, Set<string>> | null = null,
): FlowIndex {
  const byCountryIso3 = new Map<string, SliceLists>()
  const byCountryName = new Map<string, SliceLists>()
  const byContinent = new Map<string, SliceLists>()
  const byCustom = new Map<CustomRegionId, SliceLists>()
  const countryMeta = new Map<string, CountryMeta>()

  for (const id of CUSTOM_REGION_IDS) {
    byCustom.set(id, emptyLists())
  }

  // Continents / countries touched by each row (deduped per row).
  const touchedContinents = new Set<string>()
  const touchedCountryIso = new Set<string>()
  const touchedCountryName = new Set<string>()

  for (const row of flows) {
    touchedContinents.clear()
    touchedCountryIso.clear()
    touchedCountryName.clear()

    const collIso = row.collection_country_iso3
    const instIso = row.institute_country_iso3
    if (collIso) {
      rememberCountry(
        countryMeta,
        collIso,
        row.collection_country,
        row.collection_continent,
      )
      touchedCountryIso.add(collIso)
    }
    if (instIso) {
      rememberCountry(
        countryMeta,
        instIso,
        row.institute_country,
        row.institute_continent,
      )
      touchedCountryIso.add(instIso)
    }
    if (!collIso && row.collection_country) touchedCountryName.add(row.collection_country)
    if (!instIso && row.institute_country) touchedCountryName.add(row.institute_country)

    if (row.collection_continent.trim()) {
      touchedContinents.add(row.collection_continent)
    } else {
      // Blank collection continent → Unresolved list card only.
      touchedContinents.add('Unresolved')
    }
    if (row.institute_continent?.trim()) {
      touchedContinents.add(row.institute_continent)
    }

    for (const iso3 of touchedCountryIso) {
      const name =
        iso3 === collIso
          ? row.collection_country || ''
          : row.institute_country || ''
      const kind = classifyOutreach(row, countryFilter(iso3, name))
      if (kind) pushSlice(ensureLists(byCountryIso3, iso3), kind, row)
    }

    for (const name of touchedCountryName) {
      const kind = classifyOutreach(row, countryFilter(null, name))
      if (kind) pushSlice(ensureLists(byCountryName, name), kind, row)
    }

    for (const continent of touchedContinents) {
      if (continent === 'Unresolved') {
        // Blank collection_continent === "" matches continentFilter("").
        if (row.collection_continent.trim()) continue
        const kind = classifyOutreach(row, continentFilter(row.collection_continent))
        if (kind) pushSlice(ensureLists(byContinent, 'Unresolved'), kind, row)
        continue
      }
      const kind = classifyOutreach(row, continentFilter(continent))
      if (kind) pushSlice(ensureLists(byContinent, continent), kind, row)
    }

    for (const id of CUSTOM_REGION_IDS) {
      const set = customIso3Sets?.get(id) ?? null
      const kind = classifyOutreach(row, customFilter(id), set)
      if (kind) pushSlice(ensureCustom(byCustom, id), kind, row)
    }
  }

  return { byCountryIso3, byCountryName, byContinent, byCustom, countryMeta }
}

/** Look up the four slice lists for a geo filter (O(1) map reads). */
export function listsForGeoFilter(
  index: FlowIndex,
  geoFilter: GeoFilter,
): SliceLists | null {
  if (geoFilter.customId) {
    if (!isCustomRegionId(geoFilter.customId)) return null
    return index.byCustom.get(geoFilter.customId) ?? emptyLists()
  }
  if (geoFilter.country) {
    const byIso = geoFilter.countryIso3
      ? index.byCountryIso3.get(geoFilter.countryIso3)
      : undefined
    const byName = index.byCountryName.get(geoFilter.country)
    return mergeLists(byIso, byName)
  }
  if (geoFilter.continent) {
    return index.byContinent.get(geoFilter.continent) ?? emptyLists()
  }
  return null
}

export function partitionForGeoFilter(
  index: FlowIndex,
  geoFilter: GeoFilter,
): OutreachPartition<RegionFlow> | null {
  const lists = listsForGeoFilter(index, geoFilter)
  if (!lists) return null
  return partitionFromLists(lists)
}

/** Filter an existing partition by taxon rank without rescanning the full table. */
export function filterPartitionByRank(
  partition: OutreachPartition<RegionFlow>,
  rankFilter: RankFilter | null,
): OutreachPartition<RegionFlow> {
  if (!rankFilter) return partition
  const keep = (row: RegionFlow) =>
    row[`${rankFilter.rank}_taxid` as keyof RegionFlow] === rankFilter.taxid
  const local = partition.local.filter(keep)
  const exported = partition.exported.filter(keep)
  const unknown = partition.unknown.filter(keep)
  const imported = partition.imported.filter(keep)
  return {
    local,
    exported,
    unknown,
    imported,
    counts: countsFromLists({ local, exported, unknown, imported }),
  }
}

/** Concatenate enabled slice lists into one array for map / bars consumers. */
export function flowsFromLists(
  lists: SliceLists,
  slices: {
    local: boolean
    exported: boolean
    unknown: boolean
    imported: boolean
  },
): RegionFlow[] {
  const out: RegionFlow[] = []
  if (slices.local) {
    for (const row of lists.local) out.push(row)
  }
  if (slices.exported) {
    for (const row of lists.exported) out.push(row)
  }
  if (slices.unknown) {
    for (const row of lists.unknown) out.push(row)
  }
  if (slices.imported) {
    for (const row of lists.imported) out.push(row)
  }
  return out
}

/** Iterate every row in the four slice lists (no intermediate concat). */
export function forEachInLists(
  lists: SliceLists,
  visit: (row: RegionFlow) => void,
): void {
  for (const row of lists.local) visit(row)
  for (const row of lists.exported) visit(row)
  for (const row of lists.unknown) visit(row)
  for (const row of lists.imported) visit(row)
}
