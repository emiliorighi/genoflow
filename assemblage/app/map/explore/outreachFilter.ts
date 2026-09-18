import { isCustomRegionId, isCustomRegionMember } from './customRegions'
import {
  matchesGeoFilter,
  type GeoFilter,
  type RankFilter,
  type RegionFlow,
  type SpeciesFlow,
} from '../types'

/** Stable mode keys; UI labels are the three disjoint flow slices. */
export type OutreachMode = 'local' | 'exported' | 'imported'

export type OutreachCounts = {
  local: number
  exported: number
  imported: number
  /** Species collected in the region (local + exported). */
  originTotal: number
}

export type OutreachPartition<T extends RegionFlow | SpeciesFlow> = {
  local: T[]
  exported: T[]
  imported: T[]
  counts: OutreachCounts
}

export const OUTREACH_MODE_LABELS: Record<OutreachMode, string> = {
  local: 'Local',
  exported: 'Exported',
  imported: 'Imported',
}

/** Full definitions for help popover and radio aria-labels. */
export const OUTREACH_MODE_DESCRIPTIONS: Record<OutreachMode, string> = {
  local: 'Collected here and sequenced here.',
  exported: 'Collected here, sequenced elsewhere.',
  imported: 'Collected elsewhere, sequenced here.',
}

export const OUTREACH_MODES: OutreachMode[] = ['local', 'exported', 'imported']

/** Disjoint flow slices that can be multi-selected for the map. */
export type FlowSlice = OutreachMode

export type MapSliceSelection = {
  local: boolean
  exported: boolean
  imported: boolean
}

/** Default: show every flow that touches the region. */
export const DEFAULT_MAP_SLICES: MapSliceSelection = {
  local: true,
  exported: true,
  imported: true,
}

export const FLOW_SLICES: FlowSlice[] = ['local', 'exported', 'imported']

export const MAP_SHORTCUT_LABELS = {
  collected: 'Collected here',
  sequenced: 'Sequenced here',
} as const

export const MAP_SHORTCUT_DESCRIPTIONS = {
  collected: 'Collected here (local + exported).',
  sequenced: 'Sequenced here (local + imported).',
} as const

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
    if (!row.institute_continent && !row.institute_country && !row.institute_country_iso3) {
      return false
    }
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
 * Collection checked first; unknown institute with collection in-region → exported.
 * null = unrelated (neither origin nor destination here).
 */
export function classifyOutreach(
  row: RegionFlow | SpeciesFlow,
  geoFilter: GeoFilter,
  customIso3Set: Set<string> | null = null,
): OutreachMode | null {
  const collectionIn = matchesGeoFilter(row, geoFilter, customIso3Set)
  const instituteIn = matchesInstituteGeoFilter(row, geoFilter, customIso3Set)
  if (collectionIn) return instituteIn ? 'local' : 'exported'
  if (instituteIn) return 'imported'
  return null
}

/**
 * Single-pass partition into local / exported / imported.
 * originTotal = local + exported (species collected in the region).
 */
export function partitionOutreachFlows<T extends RegionFlow | SpeciesFlow>(
  flows: T[],
  geoFilter: GeoFilter,
  customIso3Set: Set<string> | null = null,
): OutreachPartition<T> {
  const local: T[] = []
  const exported: T[] = []
  const imported: T[] = []
  for (const row of flows) {
    const kind = classifyOutreach(row, geoFilter, customIso3Set)
    if (kind === 'local') local.push(row)
    else if (kind === 'exported') exported.push(row)
    else if (kind === 'imported') imported.push(row)
  }
  return {
    local,
    exported,
    imported,
    counts: {
      local: local.length,
      exported: exported.length,
      imported: imported.length,
      originTotal: local.length + exported.length,
    },
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
  let imported = 0
  for (const row of flows) {
    const kind = classifyOutreach(row, geoFilter, customIso3Set)
    if (kind === 'local') local++
    else if (kind === 'exported') exported++
    else if (kind === 'imported') imported++
  }
  return { local, exported, imported, originTotal: local + exported }
}

/** Union of every enabled slice (Local counted once). */
export function flowsForMapSlices<T extends RegionFlow | SpeciesFlow>(
  partition: OutreachPartition<T>,
  slices: MapSliceSelection,
): T[] {
  const out: T[] = []
  if (slices.local) out.push(...partition.local)
  if (slices.exported) out.push(...partition.exported)
  if (slices.imported) out.push(...partition.imported)
  return out
}

export function countActiveMapSlices(slices: MapSliceSelection): number {
  return (slices.local ? 1 : 0) + (slices.exported ? 1 : 0) + (slices.imported ? 1 : 0)
}

/** Toggle one slice; refuse to clear the last active slice. */
export function toggleMapSlice(
  slices: MapSliceSelection,
  slice: FlowSlice,
): MapSliceSelection {
  const next = { ...slices, [slice]: !slices[slice] }
  if (countActiveMapSlices(next) === 0) return slices
  return next
}

/**
 * Toggle the Collected (local+exported) or Sequenced (local+imported) pair.
 * Turning a pair on sets both members true. Turning it off clears the pair's
 * unique member and clears local only when the other shortcut is also off.
 */
export function toggleMapShortcut(
  slices: MapSliceSelection,
  shortcut: 'collected' | 'sequenced',
): MapSliceSelection {
  if (shortcut === 'collected') {
    const on = slices.local && slices.exported
    if (!on) return { ...slices, local: true, exported: true }
    const sequencedOn = slices.local && slices.imported
    const next: MapSliceSelection = {
      ...slices,
      exported: false,
      local: sequencedOn,
    }
    if (countActiveMapSlices(next) === 0) return slices
    return next
  }

  const on = slices.local && slices.imported
  if (!on) return { ...slices, local: true, imported: true }
  const collectedOn = slices.local && slices.exported
  const next: MapSliceSelection = {
    ...slices,
    imported: false,
    local: collectedOn,
  }
  if (countActiveMapSlices(next) === 0) return slices
  return next
}

export function isCollectedShortcutOn(slices: MapSliceSelection): boolean {
  return slices.local && slices.exported
}

export function isSequencedShortcutOn(slices: MapSliceSelection): boolean {
  return slices.local && slices.imported
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
