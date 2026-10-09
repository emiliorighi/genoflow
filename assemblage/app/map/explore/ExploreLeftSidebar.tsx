'use client'

import { useMemo, useState } from 'react'
import { ChevronLeft, CircleHelp, Search } from 'lucide-react'
import { regionTitle } from '../SidebarPanels'
import { type GeoFilter, type RegionFlow, type TaxonRank } from '../types'
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
  type TaxonRankSummaries,
} from './exploreData'
import DestinationBars from './DestinationBars'
import MapViewToggles from './MapViewToggles'
import TaxonPicker from './TaxonPicker'
import {
  FLOW_SLICE_LABELS,
  FLOW_SLICES,
  type MapSliceSelection,
  type OutreachCounts,
} from './outreachFilter'

export type ExploreTab = 'regions' | 'continents' | 'countries'

function FlowMapGuideHelp() {
  return (
    <Popover>
      <PopoverTrigger className="map-legend-help" aria-label="How to use the Flow Map">
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
            Region and taxon are peer filters. Flow checkboxes choose which
            species to plot.
          </PopoverDescription>
        </PopoverHeader>
        <div className="flow-map-guide-body">
          <section className="flow-map-guide-section">
            <h3>Peer filters</h3>
            <p>
              Pick a region from the list below, and use Taxon in the header to
              narrow scope. Either can be set first; each updates the
              other&apos;s counts.
            </p>
          </section>
          <section className="flow-map-guide-section">
            <h3>Hover &amp; select</h3>
            <p>
              Hover a region to preview every flow that touches it. Click to
              open details. The map starts with all flows checked.
            </p>
          </section>
          <section className="flow-map-guide-section">
            <h3>Flows</h3>
            <ul className="flow-map-guide-defs">
              {FLOW_SLICES.map((slice) => (
                <li key={slice}>
                  <strong>{FLOW_SLICE_LABELS[slice]}</strong>
                </li>
              ))}
            </ul>
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
  mapSlices: MapSliceSelection
  onMapSlicesChange: (next: MapSliceSelection) => void
  outreachCounts: OutreachCounts
  barsFlows: RegionFlow[]
  activeMapCount: number
  loading: boolean
  onSelectRegion: (card: RegionCard) => void
  onHoverRegion: (card: RegionCard | null) => void
  onClearRegion: () => void
  onSelectInstitute: (key: string) => void
  rankSummaries: TaxonRankSummaries
  rankLevel: TaxonRank | ''
  rankTaxid: string
  rankTaxidLabel: string
  onPickTaxon: (rank: TaxonRank, taxid: string) => void
  onClearTaxon: () => void
  hasTaxonFilter: boolean
  allSpeciesCount: number
  taxonSpeciesCount: number
  taxonPickerDisabled?: boolean
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
  const collected = card.local + card.exported + card.unknown
  const sequenced = card.local + card.imported
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
      <div className="region-card-quiet-metrics">
        <span>{collected.toLocaleString()} collected</span>
        <span className="region-card-quiet-sep">·</span>
        <span>{sequenced.toLocaleString()} sequenced</span>
      </div>
    </button>
  )
}

function ListState({
  tab,
  onTabChange,
  continentCards,
  countryCards,
  customCards,
  loading,
  onSelectRegion,
  onHoverRegion,
}: {
  tab: ExploreTab
  onTabChange: (tab: ExploreTab) => void
  continentCards: RegionCard[]
  countryCards: RegionCard[]
  customCards: RegionCard[]
  loading: boolean
  onSelectRegion: (card: RegionCard) => void
  onHoverRegion: (card: RegionCard | null) => void
}) {
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
          {(['regions', 'continents', 'countries'] as ExploreTab[]).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              className={`explore-tab ${tab === id ? 'is-active' : ''}`}
              aria-selected={tab === id}
              onClick={() => onTabChange(id)}
            >
              {id === 'regions' ? 'Regions' : id === 'continents' ? 'Continents' : 'Countries'}
            </button>
          ))}
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
  mapSlices,
  onMapSlicesChange,
  outreachCounts,
  barsFlows,
  activeMapCount,
  onClearRegion,
  onSelectInstitute,
  rankTaxidLabel,
  hasTaxonFilter,
  allSpeciesCount,
  taxonSpeciesCount,
}: {
  geoFilter: GeoFilter
  mapSlices: MapSliceSelection
  onMapSlicesChange: (next: MapSliceSelection) => void
  outreachCounts: OutreachCounts
  barsFlows: RegionFlow[]
  activeMapCount: number
  onClearRegion: () => void
  onSelectInstitute: (key: string) => void
  rankTaxidLabel: string
  hasTaxonFilter: boolean
  allSpeciesCount: number
  taxonSpeciesCount: number
}) {
  const title = regionTitle(geoFilter)
  const [destMode, setDestMode] = useState<DestinationMode>('country')
  const { groups, unknownPlaceCount } = useMemo(
    () => buildSequencingBreakdown(barsFlows, destMode),
    [barsFlows, destMode],
  )

  return (
    <div className="explore-detail">
      <div className="explore-detail-head">
        <div className="region-title explore-detail-title">
          <button
            type="button"
            className="explore-detail-back"
            aria-label="Back to region list"
            onClick={onClearRegion}
          >
            <ChevronLeft size={14} aria-hidden="true" />
            Back to Regions
          </button>
          <h2>{title}</h2>
        </div>
      </div>

      <section className="explore-section">
        <MapViewToggles
          slices={mapSlices}
          counts={outreachCounts}
          onChange={onMapSlicesChange}
          activeCount={activeMapCount}
        />
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
          <p className="explore-taxon-caption">
            {rankTaxidLabel} — {taxonSpeciesCount.toLocaleString()} of{' '}
            {allSpeciesCount.toLocaleString()} species in {title}
          </p>
        ) : null}
        <DestinationBars
          regionLabel={title}
          total={barsFlows.length - unknownPlaceCount}
          unknownPlaceCount={unknownPlaceCount}
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
  mapSlices,
  onMapSlicesChange,
  outreachCounts,
  barsFlows,
  activeMapCount,
  loading,
  onSelectRegion,
  onHoverRegion,
  onClearRegion,
  onSelectInstitute,
  rankSummaries,
  rankLevel,
  rankTaxid,
  rankTaxidLabel,
  onPickTaxon,
  onClearTaxon,
  hasTaxonFilter,
  allSpeciesCount,
  taxonSpeciesCount,
  taxonPickerDisabled,
}: ExploreLeftSidebarProps) {
  const hasRegion = Boolean(
    geoFilter.continent || geoFilter.country || geoFilter.customId,
  )
  const [listTab, setListTab] = useState<ExploreTab>('continents')

  return (
    <aside className="explore-left">
      <header className="explore-sidebar-title">
        <div className="explore-sidebar-title-brand">
          <h1>Flow Map</h1>
          <FlowMapGuideHelp />
        </div>
        <TaxonPicker
          rankSummaries={rankSummaries}
          rankLevel={rankLevel}
          rankTaxid={rankTaxid}
          rankTaxidLabel={rankTaxidLabel}
          onPickTaxon={onPickTaxon}
          onClearTaxon={onClearTaxon}
          disabled={taxonPickerDisabled}
        />
      </header>
      {hasRegion ? (
        <DetailState
          geoFilter={geoFilter}
          mapSlices={mapSlices}
          onMapSlicesChange={onMapSlicesChange}
          outreachCounts={outreachCounts}
          barsFlows={barsFlows}
          activeMapCount={activeMapCount}
          onClearRegion={onClearRegion}
          onSelectInstitute={onSelectInstitute}
          rankTaxidLabel={rankTaxidLabel}
          hasTaxonFilter={hasTaxonFilter}
          allSpeciesCount={allSpeciesCount}
          taxonSpeciesCount={taxonSpeciesCount}
        />
      ) : (
        <ListState
          tab={listTab}
          onTabChange={setListTab}
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
