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

export const DEFAULT_OUTREACH_MODE: OutreachMode = 'local'

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

export function matchesOutreachMode(
  row: RegionFlow | SpeciesFlow,
  geoFilter: GeoFilter,
  mode: OutreachMode,
  customIso3Set: Set<string> | null = null,
): boolean {
  return classifyOutreach(row, geoFilter, customIso3Set) === mode
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

export function flowsForOutreachMode<T extends RegionFlow | SpeciesFlow>(
  partition: OutreachPartition<T>,
  mode: OutreachMode,
): T[] {
  if (mode === 'local') return partition.local
  if (mode === 'exported') return partition.exported
  return partition.imported
}

/**
 * Share of origin total (local + exported), one decimal.
 * Returns null when originTotal is 0 (omit % rather than 0% / infinity).
 * Imported / originTotal can exceed 100.
 */
export function originSharePct(count: number, originTotal: number): number | null {
  if (originTotal <= 0) return null
  return Math.round((1000 * count) / originTotal) / 10
}

/** Prefer local; if empty, exported; otherwise keep local (may still be empty). */
export function defaultOutreachModeForPartition(
  partition: OutreachPartition<RegionFlow | SpeciesFlow>,
): OutreachMode {
  if (partition.local.length > 0) return 'local'
  if (partition.exported.length > 0) return 'exported'
  return 'local'
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
