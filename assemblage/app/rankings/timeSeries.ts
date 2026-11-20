import { isCustomRegionId, type CustomRegionId } from '../map/explore/customRegions'
import type { RegionCard } from '../map/explore/exploreData'
import type { FlowIndex, SliceLists } from '../map/explore/flowIndex'
import type { RegionFlow } from '../map/types'

export const TIME_MODES = ['local', 'exported', 'unknown', 'imported'] as const
export type TimeMode = (typeof TIME_MODES)[number]

export type TimeBasis = 'cumulative' | 'yearly'

/** Species per release year for each flow mode of one place. */
export type CardTimeSeries = {
  /** counts[mode][i] = species released in firstYear + i. */
  counts: Record<TimeMode, Uint32Array>
  /** Species released before firstYear, so cumulative curves start from the right base. */
  before: Record<TimeMode, number>
}

function listsForCard(index: FlowIndex, card: RegionCard): SliceLists | null {
  if (card.kind === 'continent') return index.byContinent.get(card.name) ?? null
  if (card.kind === 'custom') {
    const id = card.id.startsWith('custom:') ? card.id.slice('custom:'.length) : card.id
    return isCustomRegionId(id) ? (index.byCustom.get(id as CustomRegionId) ?? null) : null
  }
  if (card.kind === 'country') {
    const byIso = card.iso3 ? index.byCountryIso3.get(card.iso3) : undefined
    return byIso ?? index.byCountryName.get(card.name) ?? null
  }
  return null
}

function bin(rows: RegionFlow[], firstYear: number, lastYear: number) {
  const counts = new Uint32Array(lastYear - firstYear + 1)
  let before = 0
  for (const row of rows) {
    const year = row.release_year
    if (year == null) continue
    if (year < firstYear) before += 1
    else if (year <= lastYear) counts[year - firstYear] += 1
  }
  return { counts, before }
}

/** One pass per mode list; the lists already exist in the flow index. */
export function buildCardTimeSeries(
  index: FlowIndex,
  card: RegionCard,
  firstYear: number,
  lastYear: number,
): CardTimeSeries | null {
  const lists = listsForCard(index, card)
  if (!lists) return null
  const counts = {} as Record<TimeMode, Uint32Array>
  const before = {} as Record<TimeMode, number>
  for (const mode of TIME_MODES) {
    const binned = bin(lists[mode], firstYear, lastYear)
    counts[mode] = binned.counts
    before[mode] = binned.before
  }
  return { counts, before }
}

/** Value of a mode per year, either per-year or running total. */
export function modeValues(
  series: CardTimeSeries,
  mode: TimeMode,
  basis: TimeBasis,
): number[] {
  const counts = series.counts[mode]
  if (basis === 'yearly') return Array.from(counts)
  const out = new Array<number>(counts.length)
  let running = series.before[mode]
  for (let i = 0; i < counts.length; i++) {
    running += counts[i]
    out[i] = running
  }
  return out
}

/** Pull index (%) per year; null only where nothing was sequenced yet. */
export function pullValues(
  series: CardTimeSeries,
  basis: TimeBasis,
): (number | null)[] {
  const local = modeValues(series, 'local', basis)
  const imported = modeValues(series, 'imported', basis)
  return local.map((l, i) => {
    const sequenced = l + imported[i]
    return sequenced > 0
      ? Math.round((1000 * imported[i]) / sequenced) / 10
      : null
  })
}
