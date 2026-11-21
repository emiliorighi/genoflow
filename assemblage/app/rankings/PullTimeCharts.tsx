'use client'

import { useMemo, useState } from 'react'
import type { RegionCard } from '../map/explore/exploreData'
import type { FlowIndex } from '../map/explore/flowIndex'
import { FLOW_SLICE_LABELS } from '../map/explore/outreachFilter'
import MultiLineChart, { type LineSeries } from './MultiLineChart'
import {
  TIME_MODES,
  buildCardTimeSeries,
  exportRatioValues,
  modeValues,
  pullValues,
  type TimeBasis,
} from './timeSeries'

/** Categorical palette, fixed order; color follows the place, never its rank. */
const PALETTE = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767']

/** Continents left out of the over-time charts (still shown in the bar rows above). */
const EXCLUDED_FROM_TIME_CHARTS = new Set(['Unknown', 'Antarctica'])

type PullTimeChartsProps = {
  /** Places in list order; colors are assigned by position here, so sorting never repaints. */
  cards: RegionCard[]
  flowIndex: FlowIndex
  lastYear: number
  firstDataYear: number
}

export default function PullTimeCharts({
  cards,
  flowIndex,
  lastYear,
  firstDataYear,
}: PullTimeChartsProps) {
  const [basis, setBasis] = useState<TimeBasis>('cumulative')
  const [logScale, setLogScale] = useState(false)
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())

  // Every year in the data, matching the map's year filter bounds.
  const firstYear = firstDataYear
  const years = useMemo(
    () => Array.from({ length: lastYear - firstYear + 1 }, (_, i) => firstYear + i),
    [firstYear, lastYear],
  )

  // Binning is the only per-row work; it runs when the tab or data changes, not on toggles.
  const places = useMemo(
    () =>
      cards
        .filter((card) => !(card.kind === 'continent' && EXCLUDED_FROM_TIME_CHARTS.has(card.name)))
        .map((card, i) => ({
          card,
          color: PALETTE[i % PALETTE.length],
          series: buildCardTimeSeries(flowIndex, card, firstYear, lastYear),
        }))
        .filter((p) => p.series != null),
    [cards, flowIndex, firstYear, lastYear],
  )

  const visible = useMemo(() => places.filter((p) => !hidden.has(p.card.id)), [places, hidden])

  const pullSeries = useMemo<LineSeries[]>(
    () =>
      visible.map((p) => ({
        id: p.card.id,
        label: p.card.name,
        color: p.color,
        values: pullValues(p.series!, basis),
      })),
    [visible, basis],
  )

  const modeSeries = useMemo(
    () =>
      TIME_MODES.map((mode) => ({
        mode,
        lines: visible.map<LineSeries>((p) => ({
          id: p.card.id,
          label: p.card.name,
          color: p.color,
          values: modeValues(p.series!, mode, basis),
        })),
      })),
    [visible, basis],
  )

  const ratioSeries = useMemo<LineSeries[]>(
    () =>
      visible.map((p) => ({
        id: p.card.id,
        label: p.card.name,
        color: p.color,
        values: exportRatioValues(p.series!, basis),
      })),
    [visible, basis],
  )

  if (places.length === 0) return null

  const toggle = (id: string) =>
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <section className="time-charts" aria-label="Pull index over time">
      <div className="time-charts-head">
        <div>
          <h2>Over time</h2>
          <p>
            By release year of each species&apos; displayed assembly. Early years rest on few
            species, so their pull index can swing widely.
          </p>
        </div>
      </div>

      <div className="time-toolbar">
      <div className="time-legend">
        {places.map((p) => (
          <button
            key={p.card.id}
            type="button"
            className={`time-legend-item ${hidden.has(p.card.id) ? 'is-off' : ''}`}
            aria-pressed={!hidden.has(p.card.id)}
            onClick={() => toggle(p.card.id)}
          >
            <i style={{ background: p.color }} />
            {p.card.name}
          </button>
        ))}
      </div>
        <div className="time-controls" role="toolbar" aria-label="Chart options">
          <div className="time-control-group" role="group" aria-label="Time basis">
            <span className="time-control-label">Species</span>
            {(['cumulative', 'yearly'] as TimeBasis[]).map((id) => (
              <button
                key={id}
                type="button"
                className={`explore-search-mode-btn ${basis === id ? 'is-active' : ''}`}
                aria-pressed={basis === id}
                onClick={() => setBasis(id)}
              >
                {id === 'cumulative' ? 'Cumulative' : 'Per year'}
              </button>
            ))}
          </div>
          <span className="time-control-sep" aria-hidden="true" />
          <div className="time-control-group" role="group" aria-label="Count scale">
            <span className="time-control-label">Scale</span>
            {([false, true] as const).map((isLog) => (
              <button
                key={String(isLog)}
                type="button"
                className={`explore-search-mode-btn ${logScale === isLog ? 'is-active' : ''}`}
                aria-pressed={logScale === isLog}
                onClick={() => setLogScale(isLog)}
              >
                {isLog ? 'log(1 + n)' : 'Raw'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="time-chart-grid">
        <div className="time-chart-wide">
          <MultiLineChart
            title="Pull index"
            years={years}
            series={pullSeries}
            yMax={100}
            formatValue={(v) => `${Math.round(v * 10) / 10}%`}
          />
        </div>
        <div className="time-chart-wide">
          <MultiLineChart
            title="Collected here, sequenced elsewhere ÷ Collected here, sequenced here"
            years={years}
            series={ratioSeries}
            logScale={logScale}
            formatValue={(v) => `${Math.round(v * 100) / 100}×`}
          />
        </div>
        {modeSeries.map(({ mode, lines }) => (
          <MultiLineChart
            key={mode}
            title={FLOW_SLICE_LABELS[mode]}
            years={years}
            series={lines}
            logScale={logScale}
            formatValue={(v) => Math.round(v).toLocaleString()}
          />
        ))}
      </div>
    </section>
  )
}
