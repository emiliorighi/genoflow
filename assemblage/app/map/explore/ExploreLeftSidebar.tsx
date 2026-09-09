'use client'

import { useMemo, useState } from 'react'
import { ArrowLeft, Search } from 'lucide-react'
import { regionTitle } from '../SidebarPanels'
import type { CoverageStats } from '../regions/regionData'
import type { GeoFilter, RegionFlow } from '../types'
import {
  buildSequencingBreakdown,
  filterCards,
  type DestinationMode,
  type RegionCard,
} from './exploreData'
import DestinationBars from './DestinationBars'

export type ExploreTab = 'custom' | 'continents' | 'countries'

type ExploreLeftSidebarProps = {
  geoFilter: GeoFilter
  continentCards: RegionCard[]
  countryCards: RegionCard[]
  coverage: CoverageStats
  /** Flows for DestinationBars (region totals or taxon-scoped). */
  barsFlows: RegionFlow[]
  loading: boolean
  onSelectRegion: (card: RegionCard) => void
  onHoverRegion: (card: RegionCard | null) => void
  onClearRegion: () => void
  onSelectInstitute: (key: string) => void
  rankTaxidLabel: string
  hasTaxonFilter: boolean
  /** Species count in the region (no taxon filter). */
  allSpeciesCount: number
  /** Species count for the selected taxon within the region. */
  taxonSpeciesCount: number
  scopeBarsToTaxon: boolean
  onScopeBarsToTaxonChange: (scoped: boolean) => void
}

function formatPct(value: number | null): string {
  if (value == null) return '—'
  return `${value}%`
}

function formatCount(value: number | null): string {
  if (value == null) return '—'
  return value.toLocaleString()
}

function RegionCardButton({
  card,
  onSelect,
  onHover,
}: {
  card: RegionCard
  onSelect: (card: RegionCard) => void
  onHover: (card: RegionCard | null) => void
}) {
  return (
    <button
      type="button"
      className="region-card"
      onClick={() => onSelect(card)}
      onMouseEnter={() => onHover(card)}
      onMouseLeave={() => onHover(null)}
    >
      <div className="region-card-head">
        <strong>{card.name}</strong>
        {card.kind === 'country' && (
          <span className="region-card-sub">{card.continent}</span>
        )}
      </div>
      <div className="region-card-metrics">
        <div>
          <span>GBIF</span>
          <b>{formatCount(card.gbif)}</b>
        </div>
        <div>
          <span>iNat</span>
          <b>{formatCount(card.inat)}</b>
        </div>
        <div>
          <span>Sequenced</span>
          <b>{formatCount(card.sequenced)}</b>
        </div>
      </div>
    </button>
  )
}

function ListState({
  continentCards,
  countryCards,
  loading,
  onSelectRegion,
  onHoverRegion,
}: {
  continentCards: RegionCard[]
  countryCards: RegionCard[]
  loading: boolean
  onSelectRegion: (card: RegionCard) => void
  onHoverRegion: (card: RegionCard | null) => void
}) {
  const [tab, setTab] = useState<ExploreTab>('continents')
  const [query, setQuery] = useState('')

  const cards = useMemo(() => {
    if (tab === 'custom') return []
    const source = tab === 'continents' ? continentCards : countryCards
    return filterCards(source, query)
  }, [tab, continentCards, countryCards, query])

  return (
    <div className="explore-list">
      <div className="explore-filter-row">
        <label className="explore-search">
          <Search size={13} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={
              tab === 'countries' ? 'Search countries…' : 'Search continents…'
            }
            aria-label="Search regions"
            disabled={tab === 'custom'}
          />
        </label>
        <div className="explore-tabs" role="tablist" aria-label="Region type">
          <button
            type="button"
            role="tab"
            className={`explore-tab ${tab === 'custom' ? 'is-active' : ''}`}
            aria-selected={tab === 'custom'}
            aria-disabled="true"
            title="Custom regions coming soon"
            onClick={() => setTab('custom')}
          >
            Custom
          </button>
          <button
            type="button"
            role="tab"
            className={`explore-tab ${tab === 'continents' ? 'is-active' : ''}`}
            aria-selected={tab === 'continents'}
            onClick={() => setTab('continents')}
          >
            Continents
          </button>
          <button
            type="button"
            role="tab"
            className={`explore-tab ${tab === 'countries' ? 'is-active' : ''}`}
            aria-selected={tab === 'countries'}
            onClick={() => setTab('countries')}
          >
            Countries
          </button>
        </div>
      </div>

      <div className="explore-card-list" role="list">
        {tab === 'custom' ? (
          <p className="explore-empty">Custom regions coming soon.</p>
        ) : loading ? (
          <p className="explore-empty">Loading regions…</p>
        ) : cards.length === 0 ? (
          <p className="explore-empty">
            {query ? `No matches for “${query}”.` : 'No regions available.'}
          </p>
        ) : (
          cards.map((card) => (
            <div key={card.id} role="listitem">
              <RegionCardButton
                card={card}
                onSelect={onSelectRegion}
                onHover={onHoverRegion}
              />
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function DetailState({
  geoFilter,
  coverage,
  barsFlows,
  onClearRegion,
  onSelectInstitute,
  rankTaxidLabel,
  hasTaxonFilter,
  allSpeciesCount,
  taxonSpeciesCount,
  scopeBarsToTaxon,
  onScopeBarsToTaxonChange,
}: {
  geoFilter: GeoFilter
  coverage: CoverageStats
  barsFlows: RegionFlow[]
  onClearRegion: () => void
  onSelectInstitute: (key: string) => void
  rankTaxidLabel: string
  hasTaxonFilter: boolean
  allSpeciesCount: number
  taxonSpeciesCount: number
  scopeBarsToTaxon: boolean
  onScopeBarsToTaxonChange: (scoped: boolean) => void
}) {
  const title = regionTitle(geoFilter)
  const [destMode, setDestMode] = useState<DestinationMode>('country')
  const groups = useMemo(
    () => buildSequencingBreakdown(barsFlows, destMode),
    [barsFlows, destMode],
  )
  const barsTotal = barsFlows.length

  return (
    <div className="explore-detail">
      <div className="explore-detail-head">
        <button type="button" className="back-index" onClick={onClearRegion}>
          <ArrowLeft size={15} /> All regions
        </button>
        <div className="region-title explore-detail-title">
          <span className="detail-kicker">Region details</span>
          <h2>{title}</h2>
        </div>
      </div>

      <section className="explore-section explore-section-flush">
        <div className="kpi-grid coverage-kpi-grid">
          <div className="kpi-card">
            <span>Sequenced</span>
            <b>{coverage.sequenced.toLocaleString()}</b>
            <small>INSDC assemblies</small>
          </div>
          <div className="kpi-card">
            <span>vs GBIF</span>
            <b>{formatCount(coverage.gbif)}</b>
            <small>
              {coverage.gbifPct != null
                ? `${formatPct(coverage.gbifPct)} sequenced`
                : 'no GBIF count'}
            </small>
          </div>
          <div className="kpi-card">
            <span>vs iNat</span>
            <b>{formatCount(coverage.inat)}</b>
            <small>
              {coverage.inatPct != null
                ? `${formatPct(coverage.inatPct)} sequenced`
                : 'no iNat count'}
            </small>
          </div>
        </div>
      </section>

      <section className="explore-section">
        <div className="explore-section-head">
          <div className="section-label">Sequencing destinations</div>
          <div className="explore-section-actions">
            <div
              className="explore-bars-scope"
              role="group"
              aria-label="Sequencing destination breakdown"
            >
              <button
                type="button"
                className={`explore-bars-scope-btn ${destMode === 'country' ? 'is-active' : ''}`}
                aria-pressed={destMode === 'country'}
                onClick={() => setDestMode('country')}
              >
                Countries
              </button>
              <button
                type="button"
                className={`explore-bars-scope-btn ${destMode === 'institute' ? 'is-active' : ''}`}
                aria-pressed={destMode === 'institute'}
                onClick={() => setDestMode('institute')}
              >
                Institutes
              </button>
            </div>
          </div>
        </div>
        {hasTaxonFilter ? (
          <div
            className="explore-bars-scope explore-bars-scope-taxon"
            role="group"
            aria-label="Destination bar scope"
          >
            <button
              type="button"
              className={`explore-bars-scope-btn ${!scopeBarsToTaxon ? 'is-active' : ''}`}
              aria-pressed={!scopeBarsToTaxon}
              onClick={() => onScopeBarsToTaxonChange(false)}
            >
              All species ({allSpeciesCount.toLocaleString()})
            </button>
            <button
              type="button"
              className={`explore-bars-scope-btn explore-bars-scope-btn-taxon ${scopeBarsToTaxon ? 'is-active' : ''}`}
              aria-pressed={scopeBarsToTaxon}
              onClick={() => onScopeBarsToTaxonChange(true)}
              title={`${rankTaxidLabel} (${taxonSpeciesCount.toLocaleString()})`}
            >
              <span className="explore-bars-scope-taxon-name">
                {rankTaxidLabel || 'Selected taxon'}
              </span>
              <span className="explore-bars-scope-taxon-count">
                ({taxonSpeciesCount.toLocaleString()})
              </span>
            </button>
          </div>
        ) : null}
        <DestinationBars
          regionLabel={title}
          total={barsTotal}
          mode={destMode}
          groups={groups}
          onSelectInstitute={onSelectInstitute}
        />
      </section>
    </div>
  )
}

export default function ExploreLeftSidebar({
  geoFilter,
  continentCards,
  countryCards,
  coverage,
  barsFlows,
  loading,
  onSelectRegion,
  onHoverRegion,
  onClearRegion,
  onSelectInstitute,
  rankTaxidLabel,
  hasTaxonFilter,
  allSpeciesCount,
  taxonSpeciesCount,
  scopeBarsToTaxon,
  onScopeBarsToTaxonChange,
}: ExploreLeftSidebarProps) {
  const hasRegion = Boolean(geoFilter.continent || geoFilter.country)

  return (
    <aside className="explore-left">
      {hasRegion ? (
        <DetailState
          geoFilter={geoFilter}
          coverage={coverage}
          barsFlows={barsFlows}
          onClearRegion={onClearRegion}
          onSelectInstitute={onSelectInstitute}
          rankTaxidLabel={rankTaxidLabel}
          hasTaxonFilter={hasTaxonFilter}
          allSpeciesCount={allSpeciesCount}
          taxonSpeciesCount={taxonSpeciesCount}
          scopeBarsToTaxon={scopeBarsToTaxon}
          onScopeBarsToTaxonChange={onScopeBarsToTaxonChange}
        />
      ) : (
        <ListState
          continentCards={continentCards}
          countryCards={countryCards}
          loading={loading}
          onSelectRegion={onSelectRegion}
          onHoverRegion={onHoverRegion}
        />
      )}
    </aside>
  )
}
