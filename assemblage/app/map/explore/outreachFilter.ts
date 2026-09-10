import { isCustomRegionId, isCustomRegionMember } from './customRegions'
import {
  matchesGeoFilter,
  type GeoFilter,
  type RankFilter,
  type RegionFlow,
  type SpeciesFlow,
} from '../types'

/** Stable mode keys; UI labels are All outreach / Collected here / Sequenced here. */
export type OutreachMode = 'all' | 'inshore' | 'offshore'

export type OutreachCounts = {
  all: number
  inshore: number
  offshore: number
}

export type OutreachPartition<T extends RegionFlow | SpeciesFlow> = {
  inshore: T[]
  offshore: T[]
  counts: OutreachCounts
}

export const OUTREACH_MODE_LABELS: Record<OutreachMode, string> = {
  all: 'All outreach',
  inshore: 'Collected here',
  offshore: 'Sequenced here',
}

export const OUTREACH_MODE_SUBTITLES: Record<OutreachMode, string> = {
  all: 'Origin or destination',
  inshore: 'Current view',
  offshore: 'Collected elsewhere',
}

export const OUTREACH_MODES: OutreachMode[] = ['all', 'inshore', 'offshore']

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

/** Classify a row relative to the selected region. null = unrelated. */
export function classifyOutreach(
  row: RegionFlow | SpeciesFlow,
  geoFilter: GeoFilter,
  customIso3Set: Set<string> | null = null,
): 'inshore' | 'offshore' | null {
  const collectionIn = matchesGeoFilter(row, geoFilter, customIso3Set)
  if (collectionIn) return 'inshore'
  const instituteIn = matchesInstituteGeoFilter(row, geoFilter, customIso3Set)
  if (instituteIn) return 'offshore'
  return null
}

export function matchesOutreachMode(
  row: RegionFlow | SpeciesFlow,
  geoFilter: GeoFilter,
  mode: OutreachMode,
  customIso3Set: Set<string> | null = null,
): boolean {
  const collectionIn = matchesGeoFilter(row, geoFilter, customIso3Set)
  if (mode === 'inshore') return collectionIn
  const instituteIn = matchesInstituteGeoFilter(row, geoFilter, customIso3Set)
  if (mode === 'offshore') return instituteIn && !collectionIn
  return collectionIn || instituteIn
}

/**
 * Single-pass partition into Collected here (inshore) and Sequenced here (offshore).
 * All outreach = inshore ∪ offshore; counts.all = inshore + offshore.
 */
export function partitionOutreachFlows<T extends RegionFlow | SpeciesFlow>(
  flows: T[],
  geoFilter: GeoFilter,
  customIso3Set: Set<string> | null = null,
): OutreachPartition<T> {
  const inshore: T[] = []
  const offshore: T[] = []
  for (const row of flows) {
    const kind = classifyOutreach(row, geoFilter, customIso3Set)
    if (kind === 'inshore') inshore.push(row)
    else if (kind === 'offshore') offshore.push(row)
  }
  return {
    inshore,
    offshore,
    counts: {
      inshore: inshore.length,
      offshore: offshore.length,
      all: inshore.length + offshore.length,
    },
  }
}

export function flowsForOutreachMode<T extends RegionFlow | SpeciesFlow>(
  partition: OutreachPartition<T>,
  mode: OutreachMode,
): T[] {
  if (mode === 'inshore') return partition.inshore
  if (mode === 'offshore') return partition.offshore
  if (partition.offshore.length === 0) return partition.inshore
  if (partition.inshore.length === 0) return partition.offshore
  return partition.inshore.concat(partition.offshore)
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
