'use client'

import { memo, useEffect, useId, useMemo, useRef, useState } from 'react'
import { CalendarRange, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { YearRange } from '../types'
import {
  cumulativeAreaPaths,
  cumulativeCounts,
  normalizeYearRange,
  sameYearRange,
  type YearBounds,
} from './yearRange'

/** Delay before a slider drag is committed to the (expensive) map pipeline. */
const COMMIT_DELAY_MS = 160

const CHART_W = 100
const CHART_H = 40

type YearRangeFilterProps = {
  bounds: YearBounds | null
  /** Species per release year (index 0 = bounds.min), scoped to the active taxon. */
  histogram: Uint32Array | null
  /** Committed range; null = all years. */
  range: YearRange | null
  onChange: (next: YearRange | null) => void
  disabled?: boolean
}

function YearRangeFilter({
  bounds,
  histogram,
  range,
  onChange,
  disabled,
}: YearRangeFilterProps) {
  const clipId = useId()
  const [open, setOpen] = useState(false)
  // Uncommitted slider position while the user drags; null = follow `range`.
  const [draft, setDraft] = useState<YearRange | null>(null)
  const [prevRange, setPrevRange] = useState(range)
  const timer = useRef<number | null>(null)
  const pending = useRef<YearRange | null | undefined>(undefined)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  // Once the committed range catches up with the draft, hand control back to it.
  if (prevRange !== range) {
    setPrevRange(range)
    if (draft && sameYearRange(normalizeYearRange(draft, bounds), range)) {
      setDraft(null)
    }
  }

  const flush = () => {
    if (timer.current != null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
    if (pending.current !== undefined) {
      const next = pending.current
      pending.current = undefined
      onChangeRef.current(next)
    }
  }

  const schedule = (next: YearRange) => {
    setDraft(next)
    pending.current = normalizeYearRange(next, bounds)
    if (timer.current != null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(flush, COMMIT_DELAY_MS)
  }

  useEffect(
    () => () => {
      if (timer.current != null) window.clearTimeout(timer.current)
    },
    [],
  )

  const reset = () => {
    if (timer.current != null) window.clearTimeout(timer.current)
    timer.current = null
    pending.current = undefined
    setDraft(null)
    onChange(null)
  }

  const cumulative = useMemo(
    () => (histogram ? cumulativeCounts(histogram) : null),
    [histogram],
  )

  const chart = useMemo(
    () => (cumulative ? cumulativeAreaPaths(cumulative, CHART_W, CHART_H) : null),
    [cumulative],
  )

  const ready = Boolean(bounds && bounds.max > bounds.min && histogram && cumulative)
  const shown: YearRange | null = bounds
    ? (draft ?? range ?? { from: bounds.min, to: bounds.max })
    : null
  const active = range != null || draft != null

  const inRange =
    shown && bounds && cumulative
      ? cumulative[shown.to - bounds.min] -
        (shown.from > bounds.min ? cumulative[shown.from - bounds.min - 1] : 0)
      : 0
  const cumulativeToEnd =
    shown && bounds && cumulative ? cumulative[shown.to - bounds.min] : 0

  const span = bounds ? bounds.max - bounds.min : 0
  const fromPct = shown && bounds && span ? ((shown.from - bounds.min) / span) * 100 : 0
  const toPct = shown && bounds && span ? ((shown.to - bounds.min) / span) * 100 : 100

  const label = !ready
    ? 'Years'
    : active && shown
      ? shown.from === shown.to
        ? String(shown.from)
        : `${shown.from}–${shown.to}`
      : 'All years'

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) flush()
      }}
    >
      <PopoverTrigger
        disabled={disabled || !ready}
        aria-label={`Release year filter: ${label}`}
        className={`year-chip ${active ? 'is-active' : ''}`}
      >
        <CalendarRange size={13} aria-hidden="true" className="year-chip-icon" />
        <span className="year-chip-kicker">Released</span>
        <span className="year-chip-value">{label}</span>
        {active && (
          <span
            role="button"
            tabIndex={0}
            className="combo-clear"
            aria-label="Clear year filter"
            onClick={(event) => {
              event.stopPropagation()
              reset()
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                event.stopPropagation()
                reset()
              }
            }}
          >
            <X size={12} />
          </span>
        )}
      </PopoverTrigger>

      <PopoverContent align="start" sideOffset={6} className="year-popover">
        {ready && bounds && shown && chart ? (
          <>
            <div className="year-popover-head">
              <span className="section-label">Release year</span>
              <span className="year-popover-range">
                {shown.from} – {shown.to}
              </span>
            </div>

            <div className="year-chart">
              <svg
                viewBox={`0 0 ${CHART_W} ${CHART_H}`}
                preserveAspectRatio="none"
                role="img"
                aria-label={`Cumulative species by release year, ${bounds.min} to ${bounds.max}`}
              >
                <path d={chart.area} className="year-chart-area" />
                <defs>
                  <clipPath id={clipId}>
                    <rect x={fromPct} y={0} width={Math.max(toPct - fromPct, 0)} height={CHART_H} />
                  </clipPath>
                </defs>
                <path d={chart.area} className="year-chart-area is-selected" clipPath={`url(#${clipId})`} />
                <path d={chart.line} className="year-chart-line" vectorEffect="non-scaling-stroke" />
                <path
                  d={chart.line}
                  className="year-chart-line is-selected"
                  vectorEffect="non-scaling-stroke"
                  clipPath={`url(#${clipId})`}
                />
              </svg>
            </div>

            <div className="year-slider">
              <div className="year-slider-track" aria-hidden="true">
                <div
                  className="year-slider-fill"
                  style={{ left: `${fromPct}%`, right: `${100 - toPct}%` }}
                />
              </div>
              <input
                type="range"
                className="year-slider-input"
                min={bounds.min}
                max={bounds.max}
                step={1}
                value={shown.from}
                aria-label="Earliest release year"
                style={{ zIndex: shown.from >= bounds.max - span * 0.1 ? 3 : 2 }}
                onChange={(event) =>
                  schedule({
                    from: Math.min(Number(event.target.value), shown.to),
                    to: shown.to,
                  })
                }
              />
              <input
                type="range"
                className="year-slider-input"
                min={bounds.min}
                max={bounds.max}
                step={1}
                value={shown.to}
                aria-label="Latest release year"
                style={{ zIndex: 2 }}
                onChange={(event) =>
                  schedule({
                    from: shown.from,
                    to: Math.max(Number(event.target.value), shown.from),
                  })
                }
              />
            </div>

            <div className="year-axis" aria-hidden="true">
              <span>{bounds.min}</span>
              <span>{bounds.max}</span>
            </div>

            <div className="year-popover-foot">
              <p>
                <b>{inRange.toLocaleString()}</b> species in range
                <span className="year-popover-sub">
                  {cumulativeToEnd.toLocaleString()} cumulative by {shown.to}
                </span>
              </p>
              {active && (
                <button type="button" className="year-popover-reset" onClick={reset}>
                  Reset
                </button>
              )}
            </div>
            <p className="year-popover-note">
              NCBI release date of each species&apos; displayed assembly.
            </p>
          </>
        ) : (
          <p className="year-popover-note">No release dates available.</p>
        )}
      </PopoverContent>
    </Popover>
  )
}

export default memo(YearRangeFilter)
