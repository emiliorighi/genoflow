'use client'

import { useMemo, useState } from 'react'
import { ArrowLeft, CircleHelp, Search } from 'lucide-react'
import { regionTitle } from '../SidebarPanels'
import { TAXON_RANKS, type GeoFilter, type RegionFlow } from '../types'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  buildSequencingBreakdown,
  filterCards,
  type DestinationMode,
  type RegionCard,
} from './exploreData'
import DestinationBars from './DestinationBars'
import {
  OUTREACH_MODE_DESCRIPTIONS,
  OUTREACH_MODE_LABELS,
  OUTREACH_MODES,
  originSharePct,
  type OutreachCounts,
  type OutreachMode,
} from './outreachFilter'

export type ExploreTab = 'regions' | 'continents' | 'countries'

function GuideKpiMock() {
  return (
    <div className="guide-kpi-mock" aria-hidden="true">
      {OUTREACH_MODES.map((mode) => (
        <div key={mode} className="guide-kpi-mock-cell">
          <span>{OUTREACH_MODE_LABELS[mode]}</span>
          <b>—</b>
        </div>
      ))}
    </div>
  )
}

function GuideRegionCardMock() {
  return (
    <div className="guide-region-mock" aria-hidden="true">
      <div className="guide-region-mock-head">
        <strong>Example region</strong>
        <span>Hover or click</span>
      </div>
      <div className="guide-kpi-mock guide-kpi-mock-compact">
        {OUTREACH_MODES.map((mode) => (
          <div key={mode} className="guide-kpi-mock-cell">
            <span>{OUTREACH_MODE_LABELS[mode]}</span>
            <b>—</b>
          </div>
        ))}
      </div>
    </div>
  )
}

function GuideToolbarMock() {
  return (
    <div className="guide-toolbar-mock" aria-hidden="true">
      <div className="guide-rank-mock">
        {TAXON_RANKS.map((rank) => (
          <span key={rank} className="guide-rank-mock-badge">
            {rank}
          </span>
        ))}
      </div>
      <div className="guide-search-mode-mock">
        <span className="is-active">Species</span>
        <span>Institutes</span>
      </div>
    </div>
  )
}

function GuideLegendMock() {
  return (
    <ul className="map-legend-help-list guide-legend-mock" aria-hidden="true">
      <li>
        <span className="legend-dot amber" />
        <div>
          <strong>Collected</strong>
          <p>Exact collection site when coordinates are known.</p>
        </div>
      </li>
      <li>
        <span className="legend-dot green" />
        <div>
          <strong>Centroid</strong>
          <p>Country center when precise coordinates are missing.</p>
        </div>
      </li>
      <li>
        <span className="legend-dot blue" />
        <div>
          <strong>Submitted</strong>
          <p>Institute that submitted the genome for sequencing.</p>
        </div>
      </li>
      <li>
        <span className="legend-line" />
        <div>
          <strong>Flow</strong>
          <p>Link from collection site to sequencing institute.</p>
        </div>
      </li>
    </ul>
  )
}

function FlowMapGuideHelp() {
  return (
    <Popover>
      <PopoverTrigger
        className="map-legend-help"
        aria-label="How to use the Flow Map"
      >
        <CircleHelp size={13} aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={10}
        className="flow-map-guide-popover ring-0"
      >
        <PopoverHeader>
          <PopoverTitle>How to use the Flow Map</PopoverTitle>
          <PopoverDescription>
            A short guide to reading flows, filtering taxa, and exploring the
            map.
          </PopoverDescription>
        </PopoverHeader>

        <div className="flow-map-guide-body">
          <section className="flow-map-guide-section">
            <h3>Species flow counts</h3>
            <GuideKpiMock />
            <ul className="flow-map-guide-defs">
              {OUTREACH_MODES.map((mode) => (
                <li key={mode}>
                  <strong>{OUTREACH_MODE_LABELS[mode]}</strong>
                  <span>{OUTREACH_MODE_DESCRIPTIONS[mode]}</span>
                </li>
              ))}
            </ul>
            <p>
              Region cards and detail radios show the same three counts.
              Percentages compare each slice to species collected here (Local +
              Exported). Imported can go above 100% when a region sequences more
              than it collects.
            </p>
          </section>

          <section className="flow-map-guide-section">
            <h3>Hover &amp; select a region</h3>
            <GuideRegionCardMock />
            <p>
              Hover a region to preview its <strong>Local</strong> flows on the
              map (or <strong>Exported</strong> if none are local). Click to open
              region details. Use the Local / Exported / Imported radios to
              choose which slice the map shows.
            </p>
          </section>

          <section className="flow-map-guide-section">
            <h3>Toolbar filters</h3>
            <GuideToolbarMock />
            <p>
              Rank badges and the Species / Institutes search narrow what appears
              on the map. When you select a region, those filters update to that
              region&apos;s current flow slice—so counts and search results stay
              in sync with what you are viewing.
            </p>
          </section>

          <section className="flow-map-guide-section">
            <h3>Map colors</h3>
            <GuideLegendMock />
          </section>

          <section className="flow-map-guide-section">
            <h3>Everything is clickable</h3>
            <p>
              Collection points, sequencing institutes, flow lines, and species
              can all be clicked to open related details in the side panels.
            </p>
          </section>
        </div>
      </PopoverContent>
    </Popover>
  )
}

type ExploreLeftSidebarProps = {
  geoFilter: GeoFilter
  continentCards: RegionCard[]
  countryCards: RegionCard[]
  customCards: RegionCard[]
  outreachMode: OutreachMode
  outreachCounts: OutreachCounts
  onOutreachModeChange: (mode: OutreachMode) => void
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
        {card.kind !== 'continent' && (
          <span className="region-card-sub">{card.subtitle ?? card.continent}</span>
        )}
      </div>
      <div className="region-card-metrics">
        <div>
          <span>{OUTREACH_MODE_LABELS.local}</span>
          <b>{formatCount(card.local)}</b>
        </div>
        <div>
          <span>{OUTREACH_MODE_LABELS.exported}</span>
          <b>{formatCount(card.exported)}</b>
        </div>
        <div>
          <span>{OUTREACH_MODE_LABELS.imported}</span>
          <b>{formatCount(card.imported)}</b>
        </div>
      </div>
    </button>
  )
}

function ListState({
  continentCards,
  countryCards,
  customCards,
  loading,
  onSelectRegion,
  onHoverRegion,
}: {
  continentCards: RegionCard[]
  countryCards: RegionCard[]
  customCards: RegionCard[]
  loading: boolean
  onSelectRegion: (card: RegionCard) => void
  onHoverRegion: (card: RegionCard | null) => void
}) {
  const [tab, setTab] = useState<ExploreTab>('continents')
  const [query, setQuery] = useState('')

  const cards = useMemo(() => {
    const source =
      tab === 'regions'
        ? customCards
        : tab === 'continents'
          ? continentCards
          : countryCards
    if (tab !== 'countries') return source
    return filterCards(source, query)
  }, [tab, continentCards, countryCards, customCards, query])

  return (
    <div className="explore-list">
      <div className="explore-filter-row">
        <div className="explore-tabs" role="tablist" aria-label="Region type">
          <button
            type="button"
            role="tab"
            className={`explore-tab ${tab === 'regions' ? 'is-active' : ''}`}
            aria-selected={tab === 'regions'}
            onClick={() => setTab('regions')}
          >
            Regions
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

      {tab === 'countries' ? (
        <div className="explore-countries-search">
          <label className="explore-search">
            <Search size={13} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search countries…"
              aria-label="Search countries"
            />
          </label>
        </div>
      ) : null}

      <div className="explore-card-list" role="list">
        {loading ? (
          <p className="explore-empty">Loading regions…</p>
        ) : cards.length === 0 ? (
          <p className="explore-empty">
            {tab === 'countries' && query
              ? `No matches for “${query}”.`
              : 'No regions available.'}
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
  outreachMode,
  outreachCounts,
  onOutreachModeChange,
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
  outreachMode: OutreachMode
  outreachCounts: OutreachCounts
  onOutreachModeChange: (mode: OutreachMode) => void
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
  const modeLabel = OUTREACH_MODE_LABELS[outreachMode]
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
        <div
          className="kpi-grid coverage-kpi-grid"
          role="radiogroup"
          aria-label="Species flow"
        >
          {OUTREACH_MODES.map((mode) => {
            const active = outreachMode === mode
            const share = originSharePct(
              outreachCounts[mode],
              outreachCounts.originTotal,
            )
            return (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={`${OUTREACH_MODE_LABELS[mode]}: ${OUTREACH_MODE_DESCRIPTIONS[mode]}`}
                className={`kpi-card kpi-card-toggle ${active ? 'is-active' : ''}`}
                onClick={() => onOutreachModeChange(mode)}
              >
                <span>{OUTREACH_MODE_LABELS[mode]}</span>
                <div className="kpi-card-value">
                  <b>{outreachCounts[mode].toLocaleString()}</b>
                  {share != null ? (
                    <em className="kpi-card-pct">{share}%</em>
                  ) : null}
                </div>
              </button>
            )
          })}
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
          regionLabel={`${title} · ${modeLabel}`}
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
  customCards,
  outreachMode,
  outreachCounts,
  onOutreachModeChange,
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
  const hasRegion = Boolean(
    geoFilter.continent || geoFilter.country || geoFilter.customId,
  )

  return (
    <aside className="explore-left">
      <header className="explore-sidebar-title">
        <h1>Flow Map</h1>
        <FlowMapGuideHelp />
      </header>
      {hasRegion ? (
        <DetailState
          geoFilter={geoFilter}
          outreachMode={outreachMode}
          outreachCounts={outreachCounts}
          onOutreachModeChange={onOutreachModeChange}
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
          customCards={customCards}
          loading={loading}
          onSelectRegion={onSelectRegion}
          onHoverRegion={onHoverRegion}
        />
      )}
    </aside>
  )
}
