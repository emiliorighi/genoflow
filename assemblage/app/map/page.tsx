'use client'

import Link from 'next/link'
import { Suspense, startTransition, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Info } from 'lucide-react'
import { load } from '@loaders.gl/core'
import ExploreLeftSidebar from './explore/ExploreLeftSidebar'
import ExploreMap, { type ExploreLayers } from './explore/ExploreMap'
import ExploreToolbar, { type FilterFocus, type SearchMode } from './explore/ExploreToolbar'
import {
  buildContinentCards,
  buildContinentLookup,
  buildCountryCards,
  buildRegionsTabCards,
  filterCountryCardsForCountriesTab,
  buildAllCustomIso3Sets,
  customIso3SetForFilter,
  isCustomRegionId,
  buildTaxonRankSummaries,
  flowMatchesSelection,
  groupFlowsByPoint,
  plotPositionKey,
  type RegionCard,
} from './explore/exploreData'
import {
  buildCountryTotals,
  type CountryCentroids,
  type SpeciesCountRow,
} from './regionData'
import {
  DEFAULT_MAP_SLICES,
  defaultMapSlicesForPartition,
  filterByRank,
  flowsForMapSlices,
  partitionOutreachFlows,
  type MapSliceSelection,
} from './explore/outreachFilter'
import {
  InstituteDetail,
  PointSpeciesList,
  SpeciesDetail,
  regionTitle,
} from './SidebarPanels'
import { publicUrl } from '../../lib/publicUrl'
import {
  EMPTY_GEO_FILTER,
  MAP_QUERY_KEYS,
  TAXON_RANKS,
  decodeSelectionParam,
  encodeSelectionParam,
  instituteKey,
  normalizeRegionFlows,
  type GeoFilter,
  type RankFilter,
  type RegionFlow,
  type Selection,
  type TaxonRank,
  type WorldGeoJson,
} from './types'

function parseRankParam(raw: string | null): TaxonRank | '' {
  return raw && (TAXON_RANKS as string[]).includes(raw) ? (raw as TaxonRank) : ''
}

function MapPageFallback() {
  return (
    <main className="atlas-shell">
      <div className="map-loading-overlay map-loading-overlay-standalone" role="status">
        <p>Loading explorer…</p>
      </div>
    </main>
  )
}

function MapPageInner() {
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

  const [flows, setFlows] = useState<RegionFlow[] | null>(null)
  const [world, setWorld] = useState<WorldGeoJson | null>(null)
  const [centroids, setCentroids] = useState<CountryCentroids | null>(null)
  const [speciesCounts, setSpeciesCounts] = useState<SpeciesCountRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)

  const [geoFilter, setGeoFilter] = useState<GeoFilter>(() => {
    const customRaw = initialParams.current.get(MAP_QUERY_KEYS.custom)
    if (isCustomRegionId(customRaw)) {
      return {
        continent: null,
        country: null,
        countryIso3: null,
        customId: customRaw,
      }
    }
    return {
      continent: initialParams.current.get(MAP_QUERY_KEYS.continent) || null,
      country: initialParams.current.get(MAP_QUERY_KEYS.country) || null,
      countryIso3: null,
      customId: null,
    }
  })
  const [hoverPreview, setHoverPreview] = useState<GeoFilter | null>(null)
  const [rankLevel, setRankLevel] = useState<TaxonRank | ''>(() =>
    parseRankParam(initialParams.current.get(MAP_QUERY_KEYS.rank)),
  )
  const [rankTaxid, setRankTaxid] = useState(
    () => initialParams.current.get(MAP_QUERY_KEYS.taxon) || '',
  )
  const [mapSlices, setMapSlices] = useState<MapSliceSelection>(DEFAULT_MAP_SLICES)
  const [filterFocusOrder, setFilterFocusOrder] = useState<FilterFocus[]>(() => {
    const order: FilterFocus[] = []
    const hasGeo =
      Boolean(initialParams.current.get(MAP_QUERY_KEYS.custom)) ||
      Boolean(initialParams.current.get(MAP_QUERY_KEYS.continent)) ||
      Boolean(initialParams.current.get(MAP_QUERY_KEYS.country))
    const hasTaxon =
      Boolean(initialParams.current.get(MAP_QUERY_KEYS.rank)) &&
      Boolean(initialParams.current.get(MAP_QUERY_KEYS.taxon))
    // Deep-link with both: region then taxon
    if (hasGeo) order.push('region')
    if (hasTaxon) order.push('taxon')
    return order
  })
  const [searchMode, setSearchMode] = useState<SearchMode>('species')
  const geoHydrated = useRef(false)
  const mapSlicesHydrated = useRef(false)

  function appendFilterFocus(focus: FilterFocus) {
    setFilterFocusOrder((prev) => (prev.includes(focus) ? prev : [...prev, focus]))
  }

  function removeFilterFocus(focus: FilterFocus) {
    setFilterFocusOrder((prev) => prev.filter((f) => f !== focus))
  }

  const clearSelection = () => {
    setSelection(null)
  }

  const select = (next: Selection) => {
    setSelection(next)
  }

  const retryLoad = () => {
    setLoadError(null)
    setFlows(null)
    setWorld(null)
    setCentroids(null)
    setSpeciesCounts(null)
    setLoadAttempt((n) => n + 1)
  }

  const clearSelectionRef = useRef(clearSelection)
  clearSelectionRef.current = clearSelection
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') clearSelectionRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadData() {
      try {
        // Dynamic import so parquet-wasm is never evaluated during Next.js
        // static prerender (SSR would try to open a non-existent /ROOT/... wasm path).
        const { ParquetArrowLoader } = await import('@loaders.gl/parquet')
        const [table, worldJson, centroidsJson, countsJson] = await Promise.all([
          load(publicUrl('/data/species_flows.parquet'), ParquetArrowLoader, {
            parquet: { wasmUrl: publicUrl('/wasm/parquet_wasm_bg.wasm') },
          }),
          fetch(publicUrl('/data/world-110m.geojson')).then((res) => {
            if (!res.ok) throw new Error(`world geojson ${res.status}`)
            return res.json() as Promise<WorldGeoJson>
          }),
          fetch(publicUrl('/data/country_centroids.json')).then((res) => {
            if (!res.ok) throw new Error(`centroids ${res.status}`)
            return res.json() as Promise<CountryCentroids>
          }),
          fetch(publicUrl('/data/species_counts_by_country.json')).then((res) => {
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
    if (geoFilter.customId) {
      if (!isCustomRegionId(geoFilter.customId)) setGeoFilter(EMPTY_GEO_FILTER)
      return
    }
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
          customId: null,
        })
        return
      }
      // Special-region display names (e.g. empty/nd → "Unknown" for XUN).
      const isoMatch =
        geoFilter.country === 'Unknown'
          ? flows.find(
              (row) =>
                row.collection_country_iso3 === 'XUN' &&
                (!geoFilter.continent ||
                  row.collection_continent === geoFilter.continent),
            )
          : null
      if (isoMatch) {
        setGeoFilter({
          continent: isoMatch.collection_continent,
          country: 'Unknown',
          countryIso3: isoMatch.collection_country_iso3,
          customId: null,
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

  const continentLookup = useMemo(
    () => (world ? buildContinentLookup(world) : new Map<string, string>()),
    [world],
  )

  const allCountryTotals = useMemo(
    () => (flows ? buildCountryTotals(flows) : []),
    [flows],
  )

  /** World continents plus any sequenced countries missing from the basemap. */
  const membershipLookup = useMemo(() => {
    const map = new Map(continentLookup)
    for (const total of allCountryTotals) {
      if (total.iso3 && !map.has(total.iso3)) {
        map.set(total.iso3, total.continent)
      }
    }
    return map
  }, [continentLookup, allCountryTotals])

  const customIso3Sets = useMemo(
    () => buildAllCustomIso3Sets(membershipLookup),
    [membershipLookup],
  )

  const activeCustomIso3Set = useMemo(
    () => customIso3SetForFilter(geoFilter.customId, customIso3Sets),
    [geoFilter.customId, customIso3Sets],
  )

  const hasRegion = Boolean(
    geoFilter.continent || geoFilter.country || geoFilter.customId,
  )
  const rankFilter: RankFilter | null =
    rankLevel && rankTaxid ? { rank: rankLevel, taxid: rankTaxid } : null

  const taxonFilteredFlows = useMemo(
    () => filterByRank(flows ?? [], rankFilter),
    // rankFilter is derived from rankLevel + rankTaxid
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flows, rankLevel, rankTaxid],
  )

  /** Geo partition over all taxa — drives taxon picker options/counts. */
  const geoPartition = useMemo(() => {
    if (!flows || !hasRegion) return null
    return partitionOutreachFlows(flows, geoFilter, activeCustomIso3Set)
  }, [flows, geoFilter, hasRegion, activeCustomIso3Set])

  /** Geo partition scoped to the active taxon — drives KPI counts and map slices. */
  const taxonPartition = useMemo(() => {
    if (!flows || !hasRegion) return null
    return partitionOutreachFlows(taxonFilteredFlows, geoFilter, activeCustomIso3Set)
  }, [flows, taxonFilteredFlows, geoFilter, hasRegion, activeCustomIso3Set])

  const outreachCounts = taxonPartition?.counts ?? {
    local: 0,
    exported: 0,
    imported: 0,
    originTotal: 0,
  }

  // Deep-link / first paint: full union once geo data is ready.
  useEffect(() => {
    if (mapSlicesHydrated.current || !flows || !hasRegion || !taxonPartition) return
    mapSlicesHydrated.current = true
    setMapSlices(defaultMapSlicesForPartition(taxonPartition))
  }, [flows, hasRegion, taxonPartition])

  const mapFlows = useMemo(() => {
    if (!flows) return []
    if (!hasRegion || !taxonPartition) return taxonFilteredFlows
    return flowsForMapSlices(taxonPartition, mapSlices)
  }, [flows, hasRegion, taxonPartition, mapSlices, taxonFilteredFlows])

  const barsFlows = mapFlows

  useEffect(() => {
    if (!selection || !flows) return
    const stillVisible = mapFlows.some((row) =>
      flowMatchesSelection(row, selection, centroids),
    )
    if (!stillVisible) setSelection(null)
  }, [mapFlows, selection, flows, centroids])

  useEffect(() => {
    const params = new URLSearchParams()
    if (rankLevel && rankTaxid) {
      params.set(MAP_QUERY_KEYS.rank, rankLevel)
      params.set(MAP_QUERY_KEYS.taxon, rankTaxid)
    }
    if (geoFilter.customId) {
      params.set(MAP_QUERY_KEYS.custom, geoFilter.customId)
    } else {
      if (geoFilter.continent) params.set(MAP_QUERY_KEYS.continent, geoFilter.continent)
      if (geoFilter.country) params.set(MAP_QUERY_KEYS.country, geoFilter.country)
    }
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
    geoFilter.customId,
    selection,
    pathname,
    router,
    searchParams,
  ])

  // Defer expensive list-card rebuilds while a region detail is open.
  const continentCards = useMemo(
    () =>
      !hasRegion && flows ? buildContinentCards(taxonFilteredFlows) : [],
    [hasRegion, flows, taxonFilteredFlows],
  )

  const allCountryCards = useMemo(
    () =>
      !hasRegion && flows
        ? buildCountryCards(
            taxonFilteredFlows,
            speciesCounts ?? [],
            allCountryTotals,
            membershipLookup,
          )
        : [],
    [hasRegion, flows, taxonFilteredFlows, speciesCounts, allCountryTotals, membershipLookup],
  )

  const countryCards = useMemo(
    () => filterCountryCardsForCountriesTab(allCountryCards),
    [allCountryCards],
  )

  const customCards = useMemo(
    () =>
      !hasRegion && flows
        ? buildRegionsTabCards(taxonFilteredFlows, allCountryCards, membershipLookup)
        : [],
    [hasRegion, flows, taxonFilteredFlows, allCountryCards, membershipLookup],
  )

  const chipScopeFlows = useMemo(() => {
    if (!flows) return []
    if (!hasRegion || !geoPartition) return flows
    return [...geoPartition.local, ...geoPartition.exported, ...geoPartition.imported]
  }, [flows, hasRegion, geoPartition])

  const rankSummaries = useMemo(
    () => buildTaxonRankSummaries(chipScopeFlows),
    [chipScopeFlows],
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
      setFilterFocusOrder((prev) => prev.filter((f) => f !== 'taxon'))
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

  const selectedPointRows = useMemo(() => {
    if (selection?.type !== 'point') return []
    const groups = groupFlowsByPoint(mapFlows, centroids)
    return groups.get(plotPositionKey(selection.lon, selection.lat)) ?? []
  }, [mapFlows, selection, centroids])

  const onPickTaxon = (rank: TaxonRank, taxid: string) => {
    appendFilterFocus('taxon')
    // Defer expensive list-card rebuilds only while the region list is visible.
    // With a region open, update urgently so map/KPI stay snappy.
    if (hasRegion) {
      setRankLevel(rank)
      setRankTaxid(taxid)
      return
    }
    startTransition(() => {
      setRankLevel(rank)
      setRankTaxid(taxid)
    })
  }

  const onClearTaxon = () => {
    if (hasRegion) {
      setRankLevel('')
      setRankTaxid('')
      removeFilterFocus('taxon')
      return
    }
    startTransition(() => {
      setRankLevel('')
      setRankTaxid('')
      removeFilterFocus('taxon')
    })
  }

  const onSelectRegion = (card: RegionCard) => {
    setHoverPreview(null)
    clearSelection()
    let nextFilter: GeoFilter
    if (card.kind === 'custom') {
      const customId = card.id.startsWith('custom:')
        ? card.id.slice('custom:'.length)
        : card.id
      nextFilter = {
        continent: null,
        country: null,
        countryIso3: null,
        customId,
      }
    } else if (card.kind === 'continent') {
      nextFilter = {
        continent: card.name,
        country: null,
        countryIso3: null,
        customId: null,
      }
    } else {
      nextFilter = {
        continent: card.continent,
        country: card.name,
        countryIso3: card.iso3,
        customId: null,
      }
    }
    setGeoFilter(nextFilter)
    appendFilterFocus('region')
    setMapSlices(DEFAULT_MAP_SLICES)
    mapSlicesHydrated.current = true
  }

  const onHoverRegion = (card: RegionCard | null) => {
    if (!card) {
      setHoverPreview(null)
      return
    }
    if (card.kind === 'custom') {
      const customId = card.id.startsWith('custom:')
        ? card.id.slice('custom:'.length)
        : card.id
      setHoverPreview({
        continent: null,
        country: null,
        countryIso3: null,
        customId,
      })
      return
    }
    if (card.kind === 'continent') {
      setHoverPreview({
        continent: card.name,
        country: null,
        countryIso3: null,
        customId: null,
      })
      return
    }
    setHoverPreview({
      continent: card.continent,
      country: card.name,
      countryIso3: card.iso3,
      customId: null,
    })
  }

  const onClearRegion = () => {
    setHoverPreview(null)
    clearSelection()
    setMapSlices(DEFAULT_MAP_SLICES)
    // Returning to the list: defer continent/country/custom card rebuilds
    // and keep breadcrumb/focus order in the same transition as geo clear.
    startTransition(() => {
      setGeoFilter(EMPTY_GEO_FILTER)
      removeFilterFocus('region')
    })
  }

  const title = regionTitle(geoFilter)
  const showRightSidebar = Boolean(
    selectedSpeciesRow ||
      (selection?.type === 'institute' && selectedInstituteRows.length > 0) ||
      (selection?.type === 'point' && selectedPointRows.length > 0),
  )

  /** Species in region across all map-view slices (all taxa). */
  const allSpeciesCount = useMemo(() => {
    if (!geoPartition) return 0
    return (
      geoPartition.local.length +
      geoPartition.exported.length +
      geoPartition.imported.length
    )
  }, [geoPartition])

  /** Species in region for the active taxon (all map-view slices). */
  const taxonSpeciesCount = useMemo(() => {
    if (!taxonPartition) return 0
    return (
      taxonPartition.local.length +
      taxonPartition.exported.length +
      taxonPartition.imported.length
    )
  }, [taxonPartition])

  const taxonBreadcrumbLabel =
    rankLevel && rankTaxidLabel ? `${rankTaxidLabel} (${rankLevel})` : ''

  return (
    <main className="atlas-shell">
      <header className="atlas-topbar">
        <Link href="/" className="wordmark">
          GenoFlow<span className="wordmark-dot">.</span>
        </Link>
        <div className="atlas-title">Atlas</div>
        <div className="topbar-info">
          <Info size={14} aria-hidden="true" /> Region explorer · live atlas
        </div>
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
          customCards={customCards}
          mapSlices={mapSlices}
          onMapSlicesChange={setMapSlices}
          outreachCounts={outreachCounts}
          barsFlows={barsFlows}
          activeMapCount={mapFlows.length}
          loading={!flows || !speciesCounts}
          onSelectRegion={onSelectRegion}
          onHoverRegion={onHoverRegion}
          onClearRegion={onClearRegion}
          onSelectInstitute={(key) => select({ type: 'institute', key })}
          rankSummaries={rankSummaries}
          rankLevel={rankLevel}
          rankTaxid={rankTaxid}
          rankTaxidLabel={rankTaxidLabel}
          onPickTaxon={onPickTaxon}
          onClearTaxon={onClearTaxon}
          hasTaxonFilter={Boolean(rankFilter)}
          allSpeciesCount={allSpeciesCount}
          taxonSpeciesCount={taxonSpeciesCount}
          taxonPickerDisabled={!flows}
        />

        <div className="explore-center">
          <ExploreToolbar
            mapFlows={mapFlows}
            searchMode={searchMode}
            onSearchModeChange={setSearchMode}
            selection={selection}
            onSelect={select}
            disabled={!flows}
            filterFocusOrder={filterFocusOrder}
            regionLabel={title}
            taxonLabel={taxonBreadcrumbLabel}
            hasRegion={hasRegion}
            hasTaxon={Boolean(rankFilter)}
            onClearRegion={onClearRegion}
            onClearTaxon={onClearTaxon}
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
              customIso3Sets={customIso3Sets}
              selection={selection}
              totalCount={flows?.length ?? null}
              onSelect={select}
              onRetry={retryLoad}
            />
            {showRightSidebar && (
              <aside className="species-sidebar explore-right mobile-open">
                {selectedSpeciesRow ? (
                  <SpeciesDetail
                    row={selectedSpeciesRow}
                    onClear={clearSelection}
                    onSelectInstitute={(key) => select({ type: 'institute', key })}
                  />
                ) : selection?.type === 'institute' && selectedInstituteRows.length > 0 ? (
                  <InstituteDetail
                    keyName={selection.key}
                    rows={selectedInstituteRows}
                    onClear={clearSelection}
                    onSelectSpecies={(taxid) => select({ type: 'species', taxid })}
                  />
                ) : (
                  <PointSpeciesList
                    rows={selectedPointRows}
                    onClear={clearSelection}
                    onSelectSpecies={(taxid) => select({ type: 'species', taxid })}
                  />
                )}
              </aside>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}

export default function MapPage() {
  return (
    <Suspense fallback={<MapPageFallback />}>
      <MapPageInner />
    </Suspense>
  )
}
