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
    'Percentage of species collected here with a known sequencing place (sequenced here + sequenced elsewhere) that were sequenced here. Species whose sequencing place is unknown are left out.',
  exported:
    'Percentage of species collected here with a known sequencing place (sequenced here + sequenced elsewhere) that were sequenced elsewhere. Species whose sequencing place is unknown are left out.',
  unknown:
    'Percentage of all species collected here (sequenced here + sequenced elsewhere + sequencing place unknown) whose sequencing place is unknown.',
  imported:
    'Percentage of all species sequenced here (collected here + collected elsewhere) that were collected elsewhere.',
}

/** Regions shown by default on the Regions tab; every other place starts switched off. */
const DEFAULT_ACTIVE_IDS = ['custom:global-north', 'custom:global-south', 'country:CHN']

function defaultHidden(cards: RegionCard[]): Set<string> {
  if (!cards.some((c) => DEFAULT_ACTIVE_IDS.includes(c.id))) return new Set()
  return new Set(cards.filter((c) => !DEFAULT_ACTIVE_IDS.includes(c.id)).map((c) => c.id))
}

const IMPORTED_NOTE =
  'Includes species collected at sea (oceans and seas belong to no region), which count as collected elsewhere.'

const DEFAULT_START_YEAR = 2015

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

type PlaceSeries = {
  card: RegionCard
  color: string
  series: ReturnType<typeof buildCardTimeSeries>
}

/** One log-ratio section: the retention index (here ÷ elsewhere) or its opposite, the export index. */
function IndexSection({
  name,
  inverse,
  places,
  years,
  firstYear,
  lastYear,
  startYear,
}: {
  name: string
  /** true: local ÷ exported (retention). false: exported ÷ local (export). */
  inverse: boolean
  places: PlaceSeries[]
  years: number[]
  firstYear: number
  lastYear: number
  startYear: number
}) {
  const [basis, setBasis] = useState<TimeBasis>('cumulative')
  const [view, setView] = useState<'ratio' | 'log2'>('log2')
  const [range, setRange] = useState<YearRange>({ from: startYear, to: lastYear })

  const series = useMemo<LineSeries[]>(
    () =>
      places.map((p) => {
        const all =
          view === 'log2'
            ? logRatioValues(p.series!, basis, inverse)
            : exportRatioValues(p.series!, basis, inverse)
        return {
          id: p.card.id,
          label: p.card.name,
          color: p.color,
          values: all.slice(range.from - firstYear, range.to - firstYear + 1),
        }
      }),
    [places, basis, view, inverse, range, firstYear],
  )

  const sideA = inverse ? 'here' : 'elsewhere'
  const sideB = inverse ? 'elsewhere' : 'here'
  const formula = inverse
    ? 'Collected here, sequenced here ÷ Collected here, sequenced elsewhere'
    : 'Collected here, sequenced elsewhere ÷ Collected here, sequenced here'
  const opposite = inverse ? 'export index' : 'retention index'

  return (
    <div className="time-section">
      <div className="time-controls" role="toolbar" aria-label={`${name} options`}>
        <ToggleGroup label="Species" value={basis} options={BASIS_OPTIONS} onChange={setBasis} />
        <span className="time-control-sep" aria-hidden="true" />
        <RangeSelect range={range} onChange={setRange} firstYear={firstYear} lastYear={lastYear} />
        <span className="time-control-sep" aria-hidden="true" />
        <ToggleGroup
          label="Ratio"
          value={view}
          options={[
            { id: 'ratio', text: 'Ratio' },
            { id: 'log2', text: 'log₂' },
          ]}
          onChange={setView}
        />
      </div>
      <div className="time-chart-grid">
        <div className="time-chart-wide">
          <MultiLineChart
            title={`${name}: ${view === 'log2' ? 'log₂ of ' : ''}${formula}`}
            years={years.slice(range.from - firstYear, range.to - firstYear + 1)}
            series={series}
            diverging={view === 'log2'}
            help={`${
              view === 'log2'
                ? `Base-2 logarithm of the ratio below: 0 means equal numbers, +1 means twice as many sequenced ${sideA} as ${sideB}, −1 means twice as many sequenced ${sideB} as ${sideA}. The vertical axis fits the plotted data.`
                : `For species collected in each place: how many are sequenced ${sideA} for each one sequenced ${sideB}. 1× means equal, 3× means three sequenced ${sideA} for each one sequenced ${sideB}.`
            } Species with an unknown sequencing place are left out. The ${opposite} is the same value with the opposite sign. ${basisText(basis)} A year where ${
              view === 'log2' ? 'either count is 0' : `nothing is sequenced ${sideB}`
            } has no point.`}
            formatValue={(v) =>
              view === 'log2'
                ? `${v > 0 ? '+' : ''}${Math.round(v * 100) / 100}`
                : `${Math.round(v * 100) / 100}×`
            }
          />
        </div>
      </div>
    </div>
  )
}

export default function PullTimeCharts({
  cards,
  flowIndex,
  lastYear,
  firstDataYear,
}: PullTimeChartsProps) {
  // Each section keeps its own controls.
  const startYear = Math.min(Math.max(DEFAULT_START_YEAR, firstDataYear), lastYear)
  const [catBasis, setCatBasis] = useState<TimeBasis>('cumulative')
  const [catRange, setCatRange] = useState<YearRange>({ from: startYear, to: lastYear })
  const [catView, setCatView] = useState<'count' | 'percent'>('count')
  const [logScale, setLogScale] = useState(false)
  const [hidden, setHidden] = useState<Set<string>>(() => defaultHidden(cards))

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

  return (
    <section className="time-charts" aria-label="Retention and export indices over time">
      <div className="time-charts-head">
        <div>
          <h2>Over time</h2>
          <p>
            By release year of each species&apos; displayed assembly. Early years rest on few
            species, so the indices can swing widely.
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

      <IndexSection
        name="Retention index"
        inverse
        places={visible}
        years={years}
        firstYear={firstYear}
        lastYear={lastYear}
        startYear={startYear}
      />

      <IndexSection
        name="Export index"
        inverse={false}
        places={visible}
        years={years}
        firstYear={firstYear}
        lastYear={lastYear}
        startYear={startYear}
      />

      <div className="time-section">
        <div className="time-controls" role="toolbar" aria-label="Collected and sequenced options">
          <ToggleGroup label="Species" value={catBasis} options={BASIS_OPTIONS} onChange={setCatBasis} />
          <span className="time-control-sep" aria-hidden="true" />
          <RangeSelect range={catRange} onChange={setCatRange} firstYear={firstYear} lastYear={lastYear} />
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
              } ${mode === 'imported' ? `${IMPORTED_NOTE} ` : ''}${basisText(catBasis)}`}
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
