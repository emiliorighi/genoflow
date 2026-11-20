'use client'

import { useEffect, useMemo, useState } from 'react'
import { CircleHelp } from 'lucide-react'
import type { RegionCard } from '../map/explore/exploreData'
import type { FlowIndex } from '../map/explore/flowIndex'
import type { YearBounds } from '../map/explore/yearRange'
import {
  collectedCount,
  sequencedCount,
  sortCardsByPullIndex,
} from '../map/explore/pullIndex'
import PullIndexBarRow from './PullIndexBarRow'
import PullTimeCharts from './PullTimeCharts'

export type RankingsTab = 'regions' | 'continents' | 'countries'

const PULL_TIP =
  'Of species sequenced here, the fraction collected elsewhere.'

/** Countries with fewer sequenced species than this are hidden by default (tiny samples). */
const DEFAULT_MIN_SEQUENCED = 30
const MIN_PRESETS = [0, 10, 30, 50, 100]
const MIN_QUERY_KEY = 'min'

type PullIndexRankingsProps = {
  flowIndex: FlowIndex | null
  yearBounds: YearBounds | null
  regionCards: RegionCard[]
  continentCards: RegionCard[]
  countryCards: RegionCard[]
  loading: boolean
  error: string | null
}

export default function PullIndexRankings({
  flowIndex,
  yearBounds,
  regionCards,
  continentCards,
  countryCards,
  loading,
  error,
}: PullIndexRankingsProps) {
  const [tab, setTab] = useState<RankingsTab>('continents')
  const [minSequenced, setMinSequenced] = useState(DEFAULT_MIN_SEQUENCED)
  const [customMin, setCustomMin] = useState(false)

  // Restore a shared ?min= after mount (the page is statically exported, so no SSR read).
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get(MIN_QUERY_KEY)
    if (raw == null) return
    const value = Number.parseInt(raw, 10)
    if (Number.isFinite(value) && value >= 0) {
      setMinSequenced(value)
      setCustomMin(!MIN_PRESETS.includes(value))
    }
  }, [])

  const changeMin = (value: number) => {
    setMinSequenced(value)
    const url = new URL(window.location.href)
    if (value === DEFAULT_MIN_SEQUENCED) url.searchParams.delete(MIN_QUERY_KEY)
    else url.searchParams.set(MIN_QUERY_KEY, String(value))
    window.history.replaceState(null, '', url)
  }

  const sourceCards =
    tab === 'regions' ? regionCards : tab === 'continents' ? continentCards : countryCards

  const cards = useMemo(() => {
    const kept =
      tab === 'countries' && minSequenced > 0
        ? sourceCards.filter((card) => sequencedCount(card) >= minSequenced)
        : sourceCards
    return sortCardsByPullIndex(kept)
  }, [tab, sourceCards, minSequenced])

  const maxCount = useMemo(() => {
    let max = 0
    for (const card of cards) {
      max = Math.max(max, sequencedCount(card), collectedCount(card))
    }
    return max
  }, [cards])

  return (
    <div className="pull-rank-panel">
      <header className="pull-rank-header">
        <h1>Pull index</h1>
        <p>
          Places sorted by pull index (high → low). Collected grows left of the
          name; sequenced grows right. Within each bar: exported share of
          collected, imported share of sequenced.
        </p>
      </header>

      <div className="pull-rank-toolbar">
        <div className="explore-tabs" role="tablist" aria-label="Geography level">
          {(['regions', 'continents', 'countries'] as RankingsTab[]).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              className={`explore-tab ${tab === id ? 'is-active' : ''}`}
              aria-selected={tab === id}
              onClick={() => setTab(id)}
            >
              {id === 'regions'
                ? 'Regions'
                : id === 'continents'
                  ? 'Continents'
                  : 'Countries'}
            </button>
          ))}
        </div>
        <p className="pull-rank-tip">
          <span className="pull-rank-tip-label">
            Pull index
            <span
              className="dest-help"
              title={PULL_TIP}
              role="img"
              aria-label={PULL_TIP}
            >
              <CircleHelp size={12} aria-hidden="true" />
            </span>
          </span>
          Of species sequenced here, the fraction collected elsewhere.
        </p>
      </div>

      {tab === 'countries' && (
        <div className="pull-rank-filter">
          <label htmlFor="pull-min-select">Show countries with at least</label>
          <select
            id="pull-min-select"
            value={customMin ? 'custom' : String(minSequenced)}
            onChange={(event) => {
              if (event.target.value === 'custom') {
                setCustomMin(true)
                return
              }
              setCustomMin(false)
              changeMin(Number(event.target.value))
            }}
          >
            {MIN_PRESETS.map((n) => (
              <option key={n} value={n}>
                {n === 0 ? 'Any number of' : n}
              </option>
            ))}
            <option value="custom">Custom…</option>
          </select>
          {customMin && (
            <input
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              aria-label="Minimum sequenced species"
              value={minSequenced}
              onChange={(event) => {
                const value = Number.parseInt(event.target.value, 10)
                changeMin(Number.isFinite(value) && value >= 0 ? value : 0)
              }}
            />
          )}
          <span>sequenced species</span>
          {!loading && (
            <span className="pull-rank-filter-count">
              Showing {cards.length.toLocaleString()} of {countryCards.length.toLocaleString()}
            </span>
          )}
        </div>
      )}

      <div className="pull-rank-legend" aria-hidden="true">
        <span className="pull-rank-legend-group">
          <span className="pull-rank-legend-side">Collected</span>
          <span className="pull-rank-legend-item">
            <span className="pull-rank-swatch is-exported" /> Exported
          </span>
          <span className="pull-rank-legend-item">
            <span className="pull-rank-swatch is-kept" /> Kept
          </span>
          <span className="pull-rank-legend-item">
            <span className="pull-rank-swatch is-unknown" /> Unknown
          </span>
        </span>
        <span className="pull-rank-legend-group">
          <span className="pull-rank-legend-side">Sequenced</span>
          <span className="pull-rank-legend-item">
            <span className="pull-rank-swatch is-local" /> Local
          </span>
          <span className="pull-rank-legend-item">
            <span className="pull-rank-swatch is-imported" /> Imported
          </span>
        </span>
      </div>

      {loading ? (
        <p className="explore-empty">Loading rankings…</p>
      ) : error ? (
        <p className="explore-empty">{error}</p>
      ) : cards.length === 0 ? (
        <p className="explore-empty">No geographies available.</p>
      ) : (
        <div
          className="pull-rank-chart"
          role="list"
          aria-label="Pull index diverging bar chart"
        >
          <div className="pull-rank-col-heads" aria-hidden="true">
            <span className="pull-rank-col-head is-collected">
              Exported · Kept
            </span>
            <span className="pull-rank-col-head is-axis" />
            <span className="pull-rank-col-head is-sequenced">
              Local · Imported
            </span>
          </div>
          <div className="pull-rank-list">
            {cards.map((card) => (
              <div key={card.id} role="listitem">
                <PullIndexBarRow card={card} maxCount={maxCount} />
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && !error && tab !== 'countries' && flowIndex && yearBounds && (
        <PullTimeCharts
          key={tab}
          cards={sourceCards}
          flowIndex={flowIndex}
          lastYear={yearBounds.max}
          firstDataYear={yearBounds.min}
        />
      )}
    </div>
  )
}
