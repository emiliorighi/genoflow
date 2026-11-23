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

/**
 * Exported / local per year (collected here sequenced elsewhere over collected here sequenced here),
 * or the other way round when `inverse`. Null where the denominator is 0.
 */
export function exportRatioValues(
  series: CardTimeSeries,
  basis: TimeBasis,
  inverse = false,
): (number | null)[] {
  const local = modeValues(series, 'local', basis)
  const exported = modeValues(series, 'exported', basis)
  const num = inverse ? local : exported
  const den = inverse ? exported : local
  return den.map((d, i) => (d > 0 ? num[i] / d : null))
}

/** log2 of the ratio above: positive when the numerator side is larger. Null if either side is 0. */
export function logRatioValues(
  series: CardTimeSeries,
  basis: TimeBasis,
  inverse = false,
): (number | null)[] {
  const local = modeValues(series, 'local', basis)
  const exported = modeValues(series, 'exported', basis)
  const num = inverse ? local : exported
  const den = inverse ? exported : local
  return den.map((d, i) =>
    d > 0 && num[i] > 0 ? Math.log2(num[i] / d) : null,
  )
}

/**
 * Totals for the category percentages. Local and exported are shares of the species whose
 * sequencing place is known (so a peak of unknown places does not move them); unknown is a share
 * of everything collected here; imported is a share of everything sequenced here.
 */
const PERCENT_TOTAL_MODES: Record<TimeMode, TimeMode[]> = {
  local: ['local', 'exported'],
  exported: ['local', 'exported'],
  unknown: ['local', 'exported', 'unknown'],
  imported: ['local', 'imported'],
}

const PERCENT_TOTAL_LABELS: Record<TimeMode, string> = {
  local: 'species collected here with a known sequencing place',
  exported: 'species collected here with a known sequencing place',
  unknown: 'all species collected here',
  imported: 'all species sequenced here',
}

export function percentTotalLabel(mode: TimeMode): string {
  return PERCENT_TOTAL_LABELS[mode]
}

/** Share (%) of a category within its total (see above). Null where the total is 0. */
export function percentValues(
  series: CardTimeSeries,
  mode: TimeMode,
  basis: TimeBasis,
): (number | null)[] {
  const own = modeValues(series, mode, basis)
  const parts = PERCENT_TOTAL_MODES[mode].map((m) => modeValues(series, m, basis))
  return own.map((v, i) => {
    const total = parts.reduce((sum, part) => sum + part[i], 0)
    return total > 0 ? Math.round((1000 * v) / total) / 10 : null
  })
}
