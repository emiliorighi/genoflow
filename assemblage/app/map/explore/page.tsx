'use client'

import Link from 'next/link'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  ChevronDown,
  Info,
  Layers3,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react'
import { load } from '@loaders.gl/core'
import { ParquetLoader } from '@loaders.gl/parquet'
import ExploreLeftSidebar from './ExploreLeftSidebar'
import ExploreMap, { type ExploreLayers } from './ExploreMap'
import ExploreToolbar, { type SearchMode } from './ExploreToolbar'
import {
  buildContinentCards,
  buildContinentLookup,
  buildCountryCards,
  buildTaxonRankSummaries,
  type RegionCard,
} from './exploreData'
import {
  buildCountryTotals,
  computeCoverageStats,
  countsByIso3,
  type CountryCentroids,
  type SpeciesCountRow,
} from '../regions/regionData'
import { InstituteDetail, SpeciesDetail, regionTitle } from '../SidebarPanels'
import {
  EMPTY_GEO_FILTER,
  MAP_QUERY_KEYS,
  PARQUET_COLUMNS,
  TAXON_RANKS,
  decodeSelectionParam,
  encodeSelectionParam,
  filterFlows,
  instituteKey,
  normalizeRegionFlows,
  type GeoFilter,
  type RankFilter,
  type RegionFlow,
  type Selection,
  type TaxonRank,
  type WorldGeoJson,
} from '../types'

function parseRankParam(raw: string | null): TaxonRank | '' {
  return raw && (TAXON_RANKS as string[]).includes(raw) ? (raw as TaxonRank) : ''
}

function ExplorePageFallback() {
  return (
    <main className="atlas-shell">
      <div className="map-loading-overlay map-loading-overlay-standalone" role="status">
        <p>Loading explorer…</p>
      </div>
    </main>
  )
}

function ExplorePageInner() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const initialParams = useRef(searchParams)

  const [layers] = useState<ExploreLayers>({
    collection: true,
    submitter: true,
    flow: true,
  })
  const [selection, setSelection] = useState<Selection>(() =>
    decodeSelectionParam(initialParams.current.get(MAP_QUERY_KEYS.select)),
  )
  const [rightOpen, setRightOpen] = useState(() =>
    Boolean(decodeSelectionParam(initialParams.current.get(MAP_QUERY_KEYS.select))),
  )

  const [flows, setFlows] = useState<RegionFlow[] | null>(null)
  const [world, setWorld] = useState<WorldGeoJson | null>(null)
  const [centroids, setCentroids] = useState<CountryCentroids | null>(null)
  const [speciesCounts, setSpeciesCounts] = useState<SpeciesCountRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)

  const [geoFilter, setGeoFilter] = useState<GeoFilter>(() => ({
    continent: initialParams.current.get(MAP_QUERY_KEYS.continent) || null,
    country: initialParams.current.get(MAP_QUERY_KEYS.country) || null,
    countryIso3: null,
  }))
  const [hoverPreview, setHoverPreview] = useState<GeoFilter | null>(null)
  const [rankLevel, setRankLevel] = useState<TaxonRank | ''>(() =>
    parseRankParam(initialParams.current.get(MAP_QUERY_KEYS.rank)),
  )
  const [rankTaxid, setRankTaxid] = useState(
    () => initialParams.current.get(MAP_QUERY_KEYS.taxon) || '',
  )
  const [scopeBarsToTaxon, setScopeBarsToTaxon] = useState(false)
  const [searchMode, setSearchMode] = useState<SearchMode>('species')
  const geoHydrated = useRef(false)

  const clearSelection = () => {
    setSelection(null)
  }

  const select = (next: Selection) => {
    setSelection(next)
    if (next) setRightOpen(true)
  }

  const retryLoad = () => {
    setLoadError(null)
    setFlows(null)
    setWorld(null)
    setCentroids(null)
    setSpeciesCounts(null)
    setLoadAttempt((n) => n + 1)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') clearSelection()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadData() {
      try {
        const [table, worldJson, centroidsJson, countsJson] = await Promise.all([
          load('/data/species_flows.parquet', ParquetLoader, {
            parquet: { columnList: [...PARQUET_COLUMNS] },
          }),
          fetch('/data/world-110m.geojson').then((res) => {
            if (!res.ok) throw new Error(`world geojson ${res.status}`)
            return res.json() as Promise<WorldGeoJson>
          }),
          fetch('/data/country_centroids.json').then((res) => {
            if (!res.ok) throw new Error(`centroids ${res.status}`)
            return res.json() as Promise<CountryCentroids>
          }),
          fetch('/data/species_counts_by_country.json').then((res) => {
            if (!res.ok) throw new Error(`species counts ${res.status}`)
            return res.json() as Promise<SpeciesCountRow[]>
          }),
        ])
        if (cancelled) return
        setFlows(normalizeRegionFlows(table))
        setWorld(worldJson)
        setCentroids(centroidsJson)
        setSpeciesCounts(countsJson)
      } catch (err) {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : 'Failed to load explorer data')
      }
    }

    void loadData()
    return () => {
      cancelled = true
    }
  }, [loadAttempt])

  useEffect(() => {
    if (!flows || geoHydrated.current) return
    geoHydrated.current = true
    if (!geoFilter.country && !geoFilter.continent) return
    if (geoFilter.country) {
      const match = flows.find(
        (row) =>
          row.collection_country === geoFilter.country &&
          (!geoFilter.continent || row.collection_continent === geoFilter.continent),
      )
      if (match) {
        setGeoFilter({
          continent: match.collection_continent,
          country: match.collection_country,
          countryIso3: match.collection_country_iso3,
        })
        return
      }
      setGeoFilter(EMPTY_GEO_FILTER)
      return
    }
    const hasContinent = flows.some(
      (row) => row.collection_continent === geoFilter.continent,
    )
    if (!hasContinent) setGeoFilter(EMPTY_GEO_FILTER)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flows])

  const hasRegion = Boolean(geoFilter.continent || geoFilter.country)
  const rankFilter: RankFilter | null =
    rankLevel && rankTaxid ? { rank: rankLevel, taxid: rankTaxid } : null

  const regionFlows = useMemo(() => {
    if (!flows) return []
    if (!hasRegion) return flows
    return filterFlows(flows, null, geoFilter)
  }, [flows, geoFilter, hasRegion])

  const mapFlows = useMemo(() => {
    if (!flows) return []
    return filterFlows(flows, rankFilter, hasRegion ? geoFilter : EMPTY_GEO_FILTER)
  }, [flows, rankFilter, geoFilter, hasRegion])

  const barsFlows = useMemo(() => {
    if (scopeBarsToTaxon && rankFilter) return mapFlows
    return regionFlows
  }, [scopeBarsToTaxon, rankFilter, mapFlows, regionFlows])

  useEffect(() => {
    if (!selection || !flows) return
    const stillVisible = mapFlows.some((row) => {
      if (selection.type === 'species') return row.species_taxid === selection.taxid
      return instituteKey(row) === selection.key
    })
    if (!stillVisible) setSelection(null)
  }, [mapFlows, selection, flows])

  useEffect(() => {
    const params = new URLSearchParams()
    if (rankLevel && rankTaxid) {
      params.set(MAP_QUERY_KEYS.rank, rankLevel)
      params.set(MAP_QUERY_KEYS.taxon, rankTaxid)
    }
    if (geoFilter.continent) params.set(MAP_QUERY_KEYS.continent, geoFilter.continent)
    if (geoFilter.country) params.set(MAP_QUERY_KEYS.country, geoFilter.country)
    const encodedSelection = encodeSelectionParam(selection)
    if (encodedSelection) params.set(MAP_QUERY_KEYS.select, encodedSelection)

    const nextQuery = params.toString()
    if (nextQuery === searchParams.toString()) return
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false })
  }, [
    rankLevel,
    rankTaxid,
    geoFilter.continent,
    geoFilter.country,
    selection,
    pathname,
    router,
    searchParams,
  ])

  const continentLookup = useMemo(
    () => (world ? buildContinentLookup(world) : new Map<string, string>()),
    [world],
  )

  const allCountryTotals = useMemo(
    () => (flows ? buildCountryTotals(flows) : []),
    [flows],
  )

  const countsLookup = useMemo(
    () => countsByIso3(speciesCounts ?? []),
    [speciesCounts],
  )

  const continentCards = useMemo(
    () =>
      buildContinentCards(speciesCounts ?? [], allCountryTotals, continentLookup),
    [speciesCounts, allCountryTotals, continentLookup],
  )

  const countryCards = useMemo(
    () =>
      buildCountryCards(speciesCounts ?? [], allCountryTotals, continentLookup),
    [speciesCounts, allCountryTotals, continentLookup],
  )

  const coverage = useMemo(
    () => computeCoverageStats(geoFilter, allCountryTotals, countsLookup),
    [geoFilter, allCountryTotals, countsLookup],
  )

  const rankSummaries = useMemo(
    () => buildTaxonRankSummaries(regionFlows),
    [regionFlows],
  )

  const rankTaxidLabel = useMemo(() => {
    if (!rankLevel || !rankTaxid) return ''
    return (
      rankSummaries[rankLevel].options.find((opt) => opt.taxid === rankTaxid)?.name ??
      ''
    )
  }, [rankSummaries, rankLevel, rankTaxid])

  // Drop taxon if it disappears from the current region scope (e.g. region change).
  useEffect(() => {
    if (!rankLevel || !rankTaxid || !flows) return
    const stillPresent = rankSummaries[rankLevel].options.some((opt) => opt.taxid === rankTaxid)
    if (!stillPresent) {
      setRankLevel('')
      setRankTaxid('')
      setScopeBarsToTaxon(false)
    }
  }, [rankSummaries, rankLevel, rankTaxid, flows])

  const selectedSpeciesRow = useMemo(() => {
    if (selection?.type !== 'species') return null
    return mapFlows.find((row) => row.species_taxid === selection.taxid) ?? null
  }, [mapFlows, selection])

  const selectedInstituteRows = useMemo(() => {
    if (selection?.type !== 'institute') return []
    return mapFlows.filter((row) => instituteKey(row) === selection.key)
  }, [mapFlows, selection])

  const onPickTaxon = (rank: TaxonRank, taxid: string) => {
    setRankLevel(rank)
    setRankTaxid(taxid)
  }

  const onClearTaxon = () => {
    setRankLevel('')
    setRankTaxid('')
    setScopeBarsToTaxon(false)
  }

  const onSelectRegion = (card: RegionCard) => {
    setHoverPreview(null)
    setSelection(null)
    setScopeBarsToTaxon(false)
    if (card.kind === 'continent') {
      setGeoFilter({
        continent: card.name,
        country: null,
        countryIso3: null,
      })
      return
    }
    setGeoFilter({
      continent: card.continent,
      country: card.name,
      countryIso3: card.iso3,
    })
  }

  const onHoverRegion = (card: RegionCard | null) => {
    if (!card) {
      setHoverPreview(null)
      return
    }
    if (card.kind === 'continent') {
      setHoverPreview({
        continent: card.name,
        country: null,
        countryIso3: null,
      })
      return
    }
    setHoverPreview({
      continent: card.continent,
      country: card.name,
      countryIso3: card.iso3,
    })
  }

  const onClearRegion = () => {
    setHoverPreview(null)
    setGeoFilter(EMPTY_GEO_FILTER)
    setSelection(null)
    setScopeBarsToTaxon(false)
  }

  const title = regionTitle(geoFilter)
  const sidebarHeading = selectedSpeciesRow
    ? 'Species detail'
    : selection?.type === 'institute'
      ? 'Institute detail'
      : 'Selection'

  const rankQuery =
    rankLevel && rankTaxid
      ? `?rank=${rankLevel}&taxon=${encodeURIComponent(rankTaxid)}`
      : ''

  return (
    <main className="atlas-shell">
      <header className="atlas-topbar">
        <Link href="/" className="wordmark">
          Assemblage<span className="wordmark-dot">.</span>
        </Link>
        <div className="atlas-title">
          <span>Atlas /</span> explore
        </div>
        <nav className="atlas-view-toggle" aria-label="Atlas view">
          <Link href={`/map${rankQuery}`} className="atlas-view-link">
            Flows
          </Link>
          <Link href={`/map/regions${rankQuery}`} className="atlas-view-link">
            Regions
          </Link>
          <Link
            href={`/map/explore${rankQuery}`}
            className="atlas-view-link is-active"
            aria-current="page"
          >
            Explore
          </Link>
        </nav>
        <div className="topbar-info">
          <Info size={14} aria-hidden="true" /> Region explorer · live atlas
        </div>
        <button
          type="button"
          className="icon-button explore-right-toggle"
          onClick={() => setRightOpen((open) => !open)}
          aria-label={rightOpen ? 'Hide details panel' : 'Show details panel'}
          aria-pressed={rightOpen}
        >
          {rightOpen ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}
        </button>
      </header>

      <span className="sr-only" role="status" aria-live="polite">
        {flows
          ? `${mapFlows.length.toLocaleString()} species in ${hasRegion ? title : 'view'}`
          : ''}
      </span>

      <div className="explore-content">
        <ExploreLeftSidebar
          geoFilter={geoFilter}
          continentCards={continentCards}
          countryCards={countryCards}
          coverage={coverage}
          barsFlows={barsFlows}
          loading={!flows || !speciesCounts}
          onSelectRegion={onSelectRegion}
          onHoverRegion={onHoverRegion}
          onClearRegion={onClearRegion}
          onSelectInstitute={(key) => select({ type: 'institute', key })}
          rankTaxidLabel={rankTaxidLabel}
          hasTaxonFilter={Boolean(rankFilter)}
          allSpeciesCount={regionFlows.length}
          taxonSpeciesCount={mapFlows.length}
          scopeBarsToTaxon={scopeBarsToTaxon}
          onScopeBarsToTaxonChange={setScopeBarsToTaxon}
        />

        <div className="explore-center">
          <ExploreToolbar
            mapFlows={mapFlows}
            rankSummaries={rankSummaries}
            rankLevel={rankLevel}
            rankTaxid={rankTaxid}
            rankTaxidLabel={rankTaxidLabel}
            onPickTaxon={onPickTaxon}
            onClearTaxon={onClearTaxon}
            searchMode={searchMode}
            onSearchModeChange={setSearchMode}
            selection={selection}
            onSelect={select}
            disabled={!flows}
          />
          <div className="explore-map-stage">
            <ExploreMap
              filteredFlows={mapFlows}
              centroids={centroids}
              world={world}
              error={loadError}
              layers={layers}
              geoFilter={geoFilter}
              hoverPreview={hoverPreview}
              selection={selection}
              totalCount={flows?.length ?? null}
              onSelect={select}
              onRetry={retryLoad}
            />
            {rightOpen && (
              <aside className="species-sidebar explore-right mobile-open">
                <div className="sidebar-top">
                  <div>
                    <span className="sidebar-kicker">
                      <Layers3 size={13} aria-hidden="true" /> Specimen atlas
                    </span>
                    <h1>{sidebarHeading}</h1>
                  </div>
                  <button
                    className="icon-button"
                    onClick={() => {
                      clearSelection()
                      setRightOpen(false)
                    }}
                    aria-label="Close details panel"
                  >
                    <PanelRightClose size={17} />
                  </button>
                </div>
                {selectedSpeciesRow ? (
                  <SpeciesDetail
                    row={selectedSpeciesRow}
                    regionLabel={title}
                    onBack={clearSelection}
                    onClear={clearSelection}
                    onSelectInstitute={(key) => select({ type: 'institute', key })}
                  />
                ) : selection?.type === 'institute' && selectedInstituteRows.length > 0 ? (
                  <InstituteDetail
                    keyName={selection.key}
                    rows={selectedInstituteRows}
                    regionLabel={title}
                    onBack={clearSelection}
                    onClear={clearSelection}
                    onSelectSpecies={(taxid) => select({ type: 'species', taxid })}
                  />
                ) : (
                  <p className="sidebar-copy">
                    Click a collection point, institute, or flow arc on the map to inspect
                    species and submitter details.
                  </p>
                )}
              </aside>
            )}
          </div>
        </div>
      </div>

      <button
        type="button"
        className="mobile-sidebar-handle"
        onClick={() => setRightOpen(!rightOpen)}
        aria-expanded={rightOpen}
      >
        <ChevronDown size={16} aria-hidden="true" /> {sidebarHeading}
      </button>
    </main>
  )
}

export default function ExplorePage() {
  return (
    <Suspense fallback={<ExplorePageFallback />}>
      <ExplorePageInner />
    </Suspense>
  )
}
