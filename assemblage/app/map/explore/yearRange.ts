import type { RegionFlow, SpeciesFlow, YearRange } from '../types'

export type YearBounds = { min: number; max: number }

/** Min/max release year across all flows in a single pass; null when none have a date. */
export function computeYearBounds(
  flows: ReadonlyArray<RegionFlow | SpeciesFlow>,
): YearBounds | null {
  let min = Infinity
  let max = -Infinity
  for (const row of flows) {
    const year = row.release_year
    if (year == null) continue
    if (year < min) min = year
    if (year > max) max = year
  }
  return min <= max ? { min, max } : null
}

/**
 * Clamp a range into the bounds. Returns null when it spans every year, so
 * "no filter" has one canonical representation (and rows without a date survive).
 */
export function normalizeYearRange(
  range: YearRange | null,
  bounds: YearBounds | null,
): YearRange | null {
  if (!range || !bounds) return null
  const from = Math.max(bounds.min, Math.min(range.from, bounds.max))
  const to = Math.max(from, Math.min(range.to, bounds.max))
  return from <= bounds.min && to >= bounds.max ? null : { from, to }
}

export function sameYearRange(a: YearRange | null, b: YearRange | null): boolean {
  return a === b || (a != null && b != null && a.from === b.from && a.to === b.to)
}

/** Rows released within the inclusive range. Undated rows are excluded while active. */
export function filterByYearRange<T extends RegionFlow | SpeciesFlow>(
  flows: T[],
  range: YearRange | null,
): T[] {
  if (!range) return flows
  const { from, to } = range
  return flows.filter((row) => {
    const year = row.release_year
    return year != null && year >= from && year <= to
  })
}

/** Species per release year, index 0 = bounds.min. */
export function buildYearHistogram(
  flows: ReadonlyArray<RegionFlow | SpeciesFlow>,
  bounds: YearBounds,
): Uint32Array {
  const counts = new Uint32Array(bounds.max - bounds.min + 1)
  for (const row of flows) {
    const year = row.release_year
    if (year == null || year < bounds.min || year > bounds.max) continue
    counts[year - bounds.min] += 1
  }
  return counts
}

/** Running total of a histogram: out[i] = sum(counts[0..i]). */
export function cumulativeCounts(counts: Uint32Array): Float64Array {
  const out = new Float64Array(counts.length)
  let running = 0
  for (let i = 0; i < counts.length; i++) {
    running += counts[i]
    out[i] = running
  }
  return out
}

/**
 * SVG paths for a cumulative area chart. Shared by the map's year popover and the
 * landing page so both draw the same curve. Points span x ∈ [0, width]; the line
 * keeps a 1-unit gutter at the bottom and a 2-unit one at the top.
 */
export function cumulativeAreaPaths(
  cumulative: ArrayLike<number>,
  width: number,
  height: number,
): { area: string; line: string; total: number } | null {
  const n = cumulative.length
  if (n < 2) return null
  const total = cumulative[n - 1]
  const points: string[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * width
    const y = total > 0 ? height - 1 - (cumulative[i] / total) * (height - 3) : height - 1
    points[i] = `${x.toFixed(2)},${y.toFixed(2)}`
  }
  const line = `M${points.join(' L')}`
  return { area: `M0,${height} L${points.join(' L')} L${width},${height} Z`, line, total }
}
