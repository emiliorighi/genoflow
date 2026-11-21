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
  logRatioValues,
  modeValues,
  percentTotalLabel,
  percentValues,
  pullValues,
  type TimeBasis,
  type TimeMode,
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

/** One labelled group of buttons, e.g. "Species: Cumulative | Per year". */
function ToggleGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string
  value: T
  options: { id: T; text: string }[]
  onChange: (id: T) => void
  disabled?: boolean
}) {
  return (
    <div className="time-control-group" role="group" aria-label={label}>
      <span className="time-control-label">{label}</span>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          disabled={disabled}
          className={`explore-search-mode-btn ${value === o.id ? 'is-active' : ''}`}
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
        >
          {o.text}
        </button>
      ))}
    </div>
  )
}

function basisText(basis: TimeBasis): string {
  return basis === 'cumulative'
    ? 'Cumulative: each point counts every species released up to that year.'
    : 'Per year: each point counts only the species released in that year.'
}

const MODE_HELP: Record<TimeMode, string> = {
  local: 'species collected in the place and sequenced in the same place',
  exported: 'species collected in the place and sequenced in another place',
  unknown: 'species collected in the place whose sequencing place is unknown',
  imported: 'species collected in another place and sequenced in the place',
}

const PERCENT_HELP: Record<TimeMode, string> = {
  local:
    'Percentage of all species collected here (sequenced here + sequenced elsewhere + sequencing place unknown) that were also sequenced here.',
  exported:
    'Percentage of all species collected here (sequenced here + sequenced elsewhere + sequencing place unknown) that were sequenced elsewhere.',
  unknown:
    'Percentage of all species collected here (sequenced here + sequenced elsewhere + sequencing place unknown) whose sequencing place is unknown.',
  imported:
    'Percentage of all species sequenced here (collected here + collected elsewhere) that were collected elsewhere. This is the same number as the pull index.',
}

const DEFAULT_START_YEAR = 2012

type YearRange = { from: number; to: number }

/** "From [year] to [year]" for one section. */
function RangeSelect({
  range,
  firstYear,
  lastYear,
  onChange,
}: {
  range: YearRange
  firstYear: number
  lastYear: number
  onChange: (range: YearRange) => void
}) {
  const years = Array.from({ length: lastYear - firstYear + 1 }, (_, i) => firstYear + i)
  return (
    <div className="time-control-group" role="group" aria-label="Years shown">
      <span className="time-control-label">From</span>
      <select
        className="explore-search-mode-btn"
        aria-label="First year shown"
        value={range.from}
        onChange={(e) => {
          const from = Number(e.target.value)
          onChange({ from, to: Math.max(from, range.to) })
        }}
      >
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
      <span className="time-control-label">to</span>
      <select
        className="explore-search-mode-btn"
        aria-label="Last year shown"
        value={range.to}
        onChange={(e) => {
          const to = Number(e.target.value)
          onChange({ from: Math.min(range.from, to), to })
        }}
      >
        {years
          .filter((y) => y >= range.from)
          .map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
      </select>
    </div>
  )
}

const BASIS_OPTIONS: { id: TimeBasis; text: string }[] = [
  { id: 'cumulative', text: 'Cumulative' },
  { id: 'yearly', text: 'Per year' },
]

export default function PullTimeCharts({
  cards,
  flowIndex,
  lastYear,
  firstDataYear,
}: PullTimeChartsProps) {
  // Each section keeps its own controls.
  const startYear = Math.min(Math.max(DEFAULT_START_YEAR, firstDataYear), lastYear)
  const [pullRange, setPullRange] = useState<YearRange>({ from: startYear, to: lastYear })
  const [ratioRange, setRatioRange] = useState<YearRange>({ from: startYear, to: lastYear })
  const [catRange, setCatRange] = useState<YearRange>({ from: startYear, to: lastYear })
  const [ratioDir, setRatioDir] = useState<'abroad' | 'home'>('abroad')
  const [pullBasis, setPullBasis] = useState<TimeBasis>('cumulative')
  const [ratioBasis, setRatioBasis] = useState<TimeBasis>('cumulative')
  const [ratioView, setRatioView] = useState<'ratio' | 'log2'>('ratio')
  const [catBasis, setCatBasis] = useState<TimeBasis>('cumulative')
  const [catView, setCatView] = useState<'count' | 'percent'>('count')
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

  // Cumulative values always start from the first year of data; the range only crops what is drawn.
  const windowYears = (r: YearRange) => years.slice(r.from - firstYear, r.to - firstYear + 1)
  const windowSeries = (list: LineSeries[], r: YearRange) =>
    list.map((s) => ({ ...s, values: s.values.slice(r.from - firstYear, r.to - firstYear + 1) }))

  const visible = useMemo(() => places.filter((p) => !hidden.has(p.card.id)), [places, hidden])

  const pullSeries = useMemo<LineSeries[]>(
    () =>
      visible.map((p) => ({
        id: p.card.id,
        label: p.card.name,
        color: p.color,
        values: pullValues(p.series!, pullBasis),
      })),
    [visible, pullBasis],
  )

  const ratioSeries = useMemo<LineSeries[]>(
    () =>
      visible.map((p) => ({
        id: p.card.id,
        label: p.card.name,
        color: p.color,
        values:
          ratioView === 'log2'
            ? logRatioValues(p.series!, ratioBasis, ratioDir === 'home')
            : exportRatioValues(p.series!, ratioBasis, ratioDir === 'home'),
      })),
    [visible, ratioBasis, ratioView, ratioDir],
  )

  const modeSeries = useMemo(
    () =>
      TIME_MODES.map((mode) => ({
        mode,
        lines: visible.map<LineSeries>((p) => ({
          id: p.card.id,
          label: p.card.name,
          color: p.color,
          values:
            catView === 'percent'
              ? percentValues(p.series!, mode, catBasis)
              : modeValues(p.series!, mode, catBasis),
        })),
      })),
    [visible, catBasis, catView],
  )

  if (places.length === 0) return null

  const toggle = (id: string) =>
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const inverse = ratioDir === 'home'
  const ratioTitle = inverse
    ? 'Collected here, sequenced here ÷ Collected here, sequenced elsewhere'
    : 'Collected here, sequenced elsewhere ÷ Collected here, sequenced here'
  const sideA = inverse ? 'here' : 'elsewhere'
  const sideB = inverse ? 'elsewhere' : 'here'
  const rangeProps = { firstYear, lastYear }

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
      </div>

      <div className="time-section">
        <div className="time-controls" role="toolbar" aria-label="Pull index options">
          <ToggleGroup label="Species" value={pullBasis} options={BASIS_OPTIONS} onChange={setPullBasis} />
          <span className="time-control-sep" aria-hidden="true" />
          <RangeSelect range={pullRange} onChange={setPullRange} {...rangeProps} />
        </div>
        <div className="time-chart-grid">
          <div className="time-chart-wide">
            <MultiLineChart
              title="Pull index"
              years={windowYears(pullRange)}
              series={windowSeries(pullSeries, pullRange)}
              yMax={100}
              formatValue={(v) => `${Math.round(v * 10) / 10}%`}
              help={`Of the species sequenced in each place, the share that was collected elsewhere: "collected elsewhere → sequenced here" divided by ("collected here → sequenced here" + "collected elsewhere → sequenced here"). ${basisText(pullBasis)} A year with no sequenced species has no point.`}
            />
          </div>
        </div>
      </div>

      <div className="time-section">
        <div className="time-controls" role="toolbar" aria-label="Ratio options">
          <ToggleGroup label="Species" value={ratioBasis} options={BASIS_OPTIONS} onChange={setRatioBasis} />
          <span className="time-control-sep" aria-hidden="true" />
          <RangeSelect range={ratioRange} onChange={setRatioRange} {...rangeProps} />
          <span className="time-control-sep" aria-hidden="true" />
          <ToggleGroup
            label="Order"
            value={ratioDir}
            options={[
              { id: 'abroad', text: 'Elsewhere ÷ here' },
              { id: 'home', text: 'Here ÷ elsewhere' },
            ]}
            onChange={setRatioDir}
          />
          <span className="time-control-sep" aria-hidden="true" />
          <ToggleGroup
            label="Ratio"
            value={ratioView}
            options={[
              { id: 'ratio', text: 'Ratio' },
              { id: 'log2', text: 'log₂' },
            ]}
            onChange={setRatioView}
          />
        </div>
        <div className="time-chart-grid">
          <div className="time-chart-wide">
            <MultiLineChart
              title={ratioView === 'log2' ? `log₂ of ${ratioTitle}` : ratioTitle}
              years={windowYears(ratioRange)}
              series={windowSeries(ratioSeries, ratioRange)}
              diverging={ratioView === 'log2'}
              yMax={ratioView === 'log2' ? 5 : undefined}
              help={`${
                ratioView === 'log2'
                  ? `Base-2 logarithm of the ratio below: 0 means equal numbers, +1 means twice as many sequenced ${sideA} as ${sideB}, −1 means twice as many sequenced ${sideB} as ${sideA}. The vertical axis is fixed from −5 to +5; values beyond it are drawn at the edge.`
                  : `For species collected in each place: how many are sequenced ${sideA} for each one sequenced ${sideB}. 1× means equal, 3× means three sequenced ${sideA} for each one sequenced ${sideB}.`
              } Ratio = ${inverse ? '"collected here → sequenced here" ÷ "collected here → sequenced elsewhere"' : '"collected here → sequenced elsewhere" ÷ "collected here → sequenced here"'}. ${basisText(ratioBasis)} A year where ${
                ratioView === 'log2' ? 'either count is 0' : `nothing is sequenced ${sideB}`
              } has no point.`}
              formatValue={(v) =>
                ratioView === 'log2'
                  ? `${v > 0 ? '+' : ''}${Math.round(v * 100) / 100}`
                  : `${Math.round(v * 100) / 100}×`
              }
            />
          </div>
        </div>
      </div>

      <div className="time-section">
        <div className="time-controls" role="toolbar" aria-label="Collected and sequenced options">
          <ToggleGroup label="Species" value={catBasis} options={BASIS_OPTIONS} onChange={setCatBasis} />
          <span className="time-control-sep" aria-hidden="true" />
          <RangeSelect range={catRange} onChange={setCatRange} {...rangeProps} />
          <span className="time-control-sep" aria-hidden="true" />
          <ToggleGroup
            label="Show"
            value={catView}
            options={[
              { id: 'count', text: 'Count' },
              { id: 'percent', text: '%' },
            ]}
            onChange={setCatView}
          />
          <span className="time-control-sep" aria-hidden="true" />
          <ToggleGroup
            label="Scale"
            value={logScale ? 'log' : 'raw'}
            options={[
              { id: 'raw', text: 'Raw' },
              { id: 'log', text: 'log(1 + n)' },
            ]}
            onChange={(id) => setLogScale(id === 'log')}
            disabled={catView === 'percent'}
          />
        </div>
        <div className="time-chart-grid">
          {modeSeries.map(({ mode, lines }) => (
            <MultiLineChart
              key={mode}
              title={
                catView === 'percent'
                  ? `${FLOW_SLICE_LABELS[mode]} (% of ${percentTotalLabel(mode)})`
                  : FLOW_SLICE_LABELS[mode]
              }
              years={windowYears(catRange)}
              series={windowSeries(lines, catRange)}
              logScale={logScale && catView === 'count'}
              yMax={catView === 'percent' ? 100 : undefined}
              help={`${
                catView === 'percent'
                  ? `${PERCENT_HELP[mode]}`
                  : `Number of ${MODE_HELP[mode]}.${logScale ? ' Vertical axis is log(1 + n), so zero still shows.' : ''}`
              } ${basisText(catBasis)}`}
              formatValue={(v) =>
                catView === 'percent'
                  ? `${Math.round(v * 10) / 10}%`
                  : Math.round(v).toLocaleString()
              }
            />
          ))}
        </div>
      </div>
    </section>
  )
}
