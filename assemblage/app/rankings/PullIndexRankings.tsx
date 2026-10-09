'use client'

import { useMemo, useState } from 'react'
import { CircleHelp } from 'lucide-react'
import type { RegionCard } from '../map/explore/exploreData'
import {
  collectedCount,
  sequencedCount,
  sortCardsByPullIndex,
} from '../map/explore/pullIndex'
import PullIndexBarRow from './PullIndexBarRow'

export type RankingsTab = 'regions' | 'continents' | 'countries'

const PULL_TIP =
  'Of species sequenced here, the fraction collected elsewhere.'

type PullIndexRankingsProps = {
  regionCards: RegionCard[]
  continentCards: RegionCard[]
  countryCards: RegionCard[]
  loading: boolean
  error: string | null
}

export default function PullIndexRankings({
  regionCards,
  continentCards,
  countryCards,
  loading,
  error,
}: PullIndexRankingsProps) {
  const [tab, setTab] = useState<RankingsTab>('continents')

  const cards = useMemo(() => {
    const source =
      tab === 'regions'
        ? regionCards
        : tab === 'continents'
          ? continentCards
          : countryCards
    return sortCardsByPullIndex(source)
  }, [tab, regionCards, continentCards, countryCards])

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

      <div className="pull-rank-legend" aria-hidden="true">
        <span className="pull-rank-legend-group">
          <span className="pull-rank-legend-side">Collected</span>
          <span className="pull-rank-legend-item">
            <span className="pull-rank-swatch is-exported" /> Exported
          </span>
          <span className="pull-rank-legend-item">
            <span className="pull-rank-swatch is-kept" /> Kept
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
            <span className="pull-rank-col-head is-collected">Collected</span>
            <span className="pull-rank-col-head is-axis" />
            <span className="pull-rank-col-head is-sequenced">Sequenced</span>
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
    </div>
  )
}
