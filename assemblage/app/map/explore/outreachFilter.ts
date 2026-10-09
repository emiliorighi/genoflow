import { isCustomRegionId, isCustomRegionMember } from './customRegions'
import {
  matchesGeoFilter,
  type GeoFilter,
  type RankFilter,
  type RegionFlow,
  type SpeciesFlow,
} from '../types'

/** Disjoint flow slices. Unknown is collected here with no sequencing place. */
export type OutreachMode = 'local' | 'exported' | 'unknown' | 'imported'

export type OutreachCounts = {
  local: number
  exported: number
  unknown: number
  imported: number
  /** Species collected in the region (local + exported + unknown). */
  originTotal: number
}

export type OutreachPartition<T extends RegionFlow | SpeciesFlow> = {
  local: T[]
  exported: T[]
  unknown: T[]
  imported: T[]
  counts: OutreachCounts
}

/** Disjoint flow slices that can be multi-selected for the map. */
export type FlowSlice = OutreachMode

export type MapSliceSelection = {
  local: boolean
  exported: boolean
  unknown: boolean
  imported: boolean
}

/** Default: show every flow that touches the region. */
export const DEFAULT_MAP_SLICES: MapSliceSelection = {
  local: true,
  exported: true,
  unknown: true,
  imported: true,
}

export const FLOW_SLICES: FlowSlice[] = ['local', 'exported', 'unknown', 'imported']

export type FlowPreset = 'all' | 'collected' | 'sequenced'

export const FLOW_PRESETS: { id: FlowPreset; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'collected', label: 'Collected here' },
  { id: 'sequenced', label: 'Sequenced here' },
]

export const FLOW_SLICE_LABELS: Record<FlowSlice, string> = {
  local: 'Collected here → sequenced here',
  exported: 'Collected here → sequenced elsewhere',
  unknown: 'Collected here → sequencing place unknown',
  imported: 'Collected elsewhere → sequenced here',
}

const COLLECTED_PRESET: MapSliceSelection = {
  local: true,
  exported: true,
  unknown: true,
  imported: false,
}

const SEQUENCED_PRESET: MapSliceSelection = {
  local: true,
  exported: false,
  unknown: false,
  imported: true,
}

/** True when the submitting institute has a continent, country, or ISO3. */
export function hasInstituteGeography(row: RegionFlow | SpeciesFlow): boolean {
  return Boolean(
    row.institute_continent?.trim() ||
      row.institute_country?.trim() ||
      row.institute_country_iso3?.trim(),
  )
}

/**
 * Institute geography membership for continent / country / custom region.
 * Null institute geo → false (cannot attribute a sequencing destination).
 */
export function matchesInstituteGeoFilter(
  row: RegionFlow | SpeciesFlow,
  geoFilter: GeoFilter,
  customIso3Set: Set<string> | null = null,
): boolean {
  if (geoFilter.customId) {
    if (!isCustomRegionId(geoFilter.customId)) return false
    if (row.institute_country_iso3 && customIso3Set && customIso3Set.size > 0) {
      return customIso3Set.has(row.institute_country_iso3)
    }
    if (!hasInstituteGeography(row)) return false
    return isCustomRegionMember(
      geoFilter.customId,
      row.institute_country_iso3,
      row.institute_continent ?? '',
      row.institute_country,
    )
  }
  if (geoFilter.country) {
    if (!row.institute_country && !row.institute_country_iso3) return false
    if (geoFilter.countryIso3 && row.institute_country_iso3) {
      return row.institute_country_iso3 === geoFilter.countryIso3
    }
    return row.institute_country === geoFilter.country
  }
  if (geoFilter.continent) {
    if (!row.institute_continent) return false
    return row.institute_continent === geoFilter.continent
  }
  return true
}

/**
 * Classify a row relative to the selected region.
 * Missing institute geography with collection in-region → unknown, not exported.
 * null = unrelated (neither origin nor destination here).
 */
export function classifyOutreach(
  row: RegionFlow | SpeciesFlow,
  geoFilter: GeoFilter,
  customIso3Set: Set<string> | null = null,
): OutreachMode | null {
  const collectionIn = matchesGeoFilter(row, geoFilter, customIso3Set)
  const instituteIn = matchesInstituteGeoFilter(row, geoFilter, customIso3Set)
  if (collectionIn && instituteIn) return 'local'
  if (collectionIn && !hasInstituteGeography(row)) return 'unknown'
  if (collectionIn) return 'exported'
  if (instituteIn) return 'imported'
  return null
}

function countsFromLengths(
  local: number,
  exported: number,
  unknown: number,
  imported: number,
): OutreachCounts {
  return {
    local,
    exported,
    unknown,
    imported,
    originTotal: local + exported + unknown,
  }
}

/**
 * Single-pass partition into local / exported / unknown / imported.
 * originTotal = species collected in the region.
 */
export function partitionOutreachFlows<T extends RegionFlow | SpeciesFlow>(
  flows: T[],
  geoFilter: GeoFilter,
  customIso3Set: Set<string> | null = null,
): OutreachPartition<T> {
  const local: T[] = []
  const exported: T[] = []
  const unknown: T[] = []
  const imported: T[] = []
  for (const row of flows) {
    const kind = classifyOutreach(row, geoFilter, customIso3Set)
    if (kind === 'local') local.push(row)
    else if (kind === 'exported') exported.push(row)
    else if (kind === 'unknown') unknown.push(row)
    else if (kind === 'imported') imported.push(row)
  }
  return {
    local,
    exported,
    unknown,
    imported,
    counts: countsFromLengths(
      local.length,
      exported.length,
      unknown.length,
      imported.length,
    ),
  }
}

/** Counts-only sibling of partitionOutreachFlows (no row arrays allocated). */
export function countOutreachFlows<T extends RegionFlow | SpeciesFlow>(
  flows: T[],
  geoFilter: GeoFilter,
  customIso3Set: Set<string> | null = null,
): OutreachCounts {
  let local = 0
  let exported = 0
  let unknown = 0
  let imported = 0
  for (const row of flows) {
    const kind = classifyOutreach(row, geoFilter, customIso3Set)
    if (kind === 'local') local++
    else if (kind === 'exported') exported++
    else if (kind === 'unknown') unknown++
    else if (kind === 'imported') imported++
  }
  return countsFromLengths(local, exported, unknown, imported)
}

/** Union of every enabled slice. */
export function flowsForMapSlices<T extends RegionFlow | SpeciesFlow>(
  partition: OutreachPartition<T>,
  slices: MapSliceSelection,
): T[] {
  const out: T[] = []
  if (slices.local) out.push(...partition.local)
  if (slices.exported) out.push(...partition.exported)
  if (slices.unknown) out.push(...partition.unknown)
  if (slices.imported) out.push(...partition.imported)
  return out
}

export function countActiveMapSlices(slices: MapSliceSelection): number {
  return (
    (slices.local ? 1 : 0) +
    (slices.exported ? 1 : 0) +
    (slices.unknown ? 1 : 0) +
    (slices.imported ? 1 : 0)
  )
}

/** Toggle one slice; refuse to clear the last active slice. */
export function toggleFlowSlice(
  slices: MapSliceSelection,
  slice: FlowSlice,
): MapSliceSelection {
  const next = { ...slices, [slice]: !slices[slice] }
  if (countActiveMapSlices(next) === 0) return slices
  return next
}

/** Quick-select presets. Clicking a preset restores its full set. */
export function applyFlowPreset(preset: FlowPreset): MapSliceSelection {
  if (preset === 'collected') return { ...COLLECTED_PRESET }
  if (preset === 'sequenced') return { ...SEQUENCED_PRESET }
  return { ...DEFAULT_MAP_SLICES }
}

/** Which preset the current boxes match, if any. */
export function matchingFlowPreset(slices: MapSliceSelection): FlowPreset | null {
  if (slices.local && slices.exported && slices.unknown && slices.imported) return 'all'
  if (slices.local && slices.exported && slices.unknown && !slices.imported) {
    return 'collected'
  }
  if (slices.local && !slices.exported && !slices.unknown && slices.imported) {
    return 'sequenced'
  }
  return null
}

/** Always start with the full region union (all slices on). */
export function defaultMapSlicesForPartition(
  _partition?: OutreachPartition<RegionFlow | SpeciesFlow>,
): MapSliceSelection {
  return { ...DEFAULT_MAP_SLICES }
}

/** Rank-only filter over an already outreach-scoped slice. */
export function filterByRank<T extends RegionFlow | SpeciesFlow>(
  flows: T[],
  rankFilter: RankFilter | null,
): T[] {
  if (!rankFilter) return flows
  return flows.filter((row) => {
    const taxid = row[`${rankFilter.rank}_taxid` as keyof T]
    return taxid === rankFilter.taxid
  })
}
