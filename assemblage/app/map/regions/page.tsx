'use client'

import Link from 'next/link'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ChevronDown, Info, Layers3, PanelRightClose } from 'lucide-react'
import { load } from '@loaders.gl/core'
import { ParquetLoader } from '@loaders.gl/parquet'
import RegionMap, { type RegionLayers } from './RegionMap'
import RegionFilterBar from './RegionFilterBar'
import RegionSidebar from './RegionSidebar'
import {
  buildCountryInstituteLinks,
  buildCountryTotals,
  computeCoverageStats,
  countsByIso3,
  filterTotalsForScope,
  linksForScope,
  scopeTotal as computeScopeTotal,
  topLinksForScope,
  type CountryCentroids,
  type SpeciesCountRow,
} from './regionData'
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

function rankTaxidKey(rank: TaxonRank): keyof RegionFlow {
  return `${rank}_taxid` as keyof RegionFlow
}

function rankNameKey(rank: TaxonRank): keyof RegionFlow {
  return `${rank}_name` as keyof RegionFlow
}

function parseRankParam(raw: string | null): TaxonRank | '' {
  return raw && (TAXON_RANKS as string[]).includes(raw) ? (raw as TaxonRank) : ''
}

function RegionsPageFallback() {
  return (
    <main className="atlas-shell">
      <div className="map-loading-overlay map-loading-overlay-standalone" role="status">
        <p>Loading regions atlas…</p>
      </div>
    </main>
  )
}

function RegionsPageInner() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const initialParams = useRef(searchParams)

  const [layers, setLayers] = useState<RegionLayers>({
    countries: true,
    institutes: true,
    flow: true,
  })
  const [selection, setSelection] = useState<Selection>(() =>
    decodeSelectionParam(initialParams.current.get(MAP_QUERY_KEYS.select)),
  )
  const [mobileOpen, setMobileOpen] = useState(false)

  const [flows, setFlows] = useState<RegionFlow[] | null>(null)
  const [world, setWorld] = useState<WorldGeoJson | null>(null)
  const [centroids, setCentroids] = useState<CountryCentroids | null>(null)
  const [speciesCounts, setSpeciesCounts] = useState<SpeciesCountRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)

  const [rankLevel, setRankLevel] = useState<TaxonRank | ''>(() =>
    parseRankParam(initialParams.current.get(MAP_QUERY_KEYS.rank)),
  )
  const [rankTaxid, setRankTaxid] = useState(() => initialParams.current.get(MAP_QUERY_KEYS.taxon) || '')
  const [geoFilter, setGeoFilter] = useState<GeoFilter>(() => ({
    continent: initialParams.current.get(MAP_QUERY_KEYS.continent) || null,
    country: initialParams.current.get(MAP_QUERY_KEYS.country) || null,
    countryIso3: null,
  }))
  const geoHydrated = useRef(false)

  const clearSelection = () => {
    setSelection(null)
    setMobileOpen(false)
  }

  const select = (next: Selection) => {
    setSelection(next)
    if (next) setMobileOpen(true)
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
        setLoadError(err instanceof Error ? err.message : 'Failed to load region data')
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
    if (!geoFilter.country) return
    const match = flows.find(
      (row) =>
        row.collection_country === geoFilter.country &&
        (!geoFilter.continent || row.collection_continent === geoFilter.continent),
    )
    setGeoFilter(
      match
        ? {
            continent: match.collection_continent,
            country: match.collection_country,
            countryIso3: match.collection_country_iso3,
          }
        : EMPTY_GEO_FILTER,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flows])

  const rankFilter: RankFilter | null =
    rankLevel && rankTaxid ? { rank: rankLevel, taxid: rankTaxid } : null

  // Rank filter only — geo is applied via aggregation scope, not by dropping species rows
  // from search/detail lists (search stays within the selected region).
  const rankFilteredFlows = useMemo(() => {
    if (!flows) return []
    return filterFlows(flows, rankFilter, EMPTY_GEO_FILTER)
  }, [flows, rankFilter])

  const filteredFlows = useMemo(() => {
    return filterFlows(rankFilteredFlows, null, geoFilter)
  }, [rankFilteredFlows, geoFilter])

  useEffect(() => {
    if (!selection || !flows) return
    const stillVisible = filteredFlows.some((row) => {
      if (selection.type === 'species') return row.species_taxid === selection.taxid
      return instituteKey(row) === selection.key
    })
    if (!stillVisible) setSelection(null)
  }, [filteredFlows, selection, flows])

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
  }, [rankLevel, rankTaxid, geoFilter.continent, geoFilter.country, selection, pathname, router, searchParams])

  const taxonOptions = useMemo(() => {
    if (!flows || !rankLevel) return []
    const taxidKey = rankTaxidKey(rankLevel)
    const nameKey = rankNameKey(rankLevel)
    const byId = new Map<string, string>()
    for (const row of flows) {
      const taxid = row[taxidKey]
      const name = row[nameKey]
      if (typeof taxid === 'string' && taxid && typeof name === 'string' && name) {
        byId.set(taxid, name)
      }
    }
    return [...byId.entries()]
      .map(([taxid, name]) => ({ taxid, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [flows, rankLevel])

  const rankTaxidLabel = useMemo(
    () => taxonOptions.find((opt) => opt.taxid === rankTaxid)?.name ?? '',
    [taxonOptions, rankTaxid],
  )

  const continentOptions = useMemo(() => {
    if (!rankFilteredFlows.length) return []
    return [...new Set(rankFilteredFlows.map((row) => row.collection_continent).filter(Boolean))].sort(
      (a, b) => {
        if (a === 'Unknown') return 1
        if (b === 'Unknown') return -1
        return a.localeCompare(b)
      },
    )
  }, [rankFilteredFlows])

  const countryOptions = useMemo(() => {
    if (!rankFilteredFlows.length) return []
    const byCountry = new Map<string, { continent: string; iso3: string | null }>()
    for (const row of rankFilteredFlows) {
      const country = row.collection_country
      if (!country) continue
      if (geoFilter.continent && row.collection_continent !== geoFilter.continent) continue
      if (!byCountry.has(country)) {
        byCountry.set(country, {
          continent: row.collection_continent,
          iso3: row.collection_country_iso3,
        })
      }
    }
    return [...byCountry.entries()]
      .map(([country, meta]) => ({ country, ...meta }))
      .sort((a, b) => a.country.localeCompare(b.country))
  }, [rankFilteredFlows, geoFilter.continent])

  const allCountryTotals = useMemo(
    () => buildCountryTotals(rankFilteredFlows),
    [rankFilteredFlows],
  )
  const allLinks = useMemo(
    () => buildCountryInstituteLinks(rankFilteredFlows),
    [rankFilteredFlows],
  )
  const scopedTotals = useMemo(
    () => filterTotalsForScope(allCountryTotals, geoFilter),
    [allCountryTotals, geoFilter],
  )
  const mapLinks = useMemo(
    () => topLinksForScope(allLinks, geoFilter),
    [allLinks, geoFilter],
  )
  const sidebarLinks = useMemo(
    () => linksForScope(allLinks, geoFilter),
    [allLinks, geoFilter],
  )
  const activeScopeTotal = useMemo(
    () => computeScopeTotal(allCountryTotals, geoFilter),
    [allCountryTotals, geoFilter],
  )

  const countsLookup = useMemo(
    () => countsByIso3(speciesCounts ?? []),
    [speciesCounts],
  )
  const coverage = useMemo(
    () => computeCoverageStats(geoFilter, allCountryTotals, countsLookup),
    [geoFilter, allCountryTotals, countsLookup],
  )

  const selectedSpeciesRow = useMemo(() => {
    if (selection?.type !== 'species') return null
    return filteredFlows.find((row) => row.species_taxid === selection.taxid) ?? null
  }, [filteredFlows, selection])

  const selectedInstituteRows = useMemo(() => {
    if (selection?.type !== 'institute') return []
    return filteredFlows.filter((row) => instituteKey(row) === selection.key)
  }, [filteredFlows, selection])

  const onRankLevelChange = (value: string) => {
    setRankLevel((value || '') as TaxonRank | '')
    setRankTaxid('')
  }

  const onContinentChange = (value: string) => {
    const continent = value || null
    if (!continent) {
      setGeoFilter(EMPTY_GEO_FILTER)
      return
    }
    setGeoFilter((prev) => {
      if (!prev.country || !flows) {
        return { continent, country: null, countryIso3: null }
      }
      const match = flows.find(
        (row) =>
          row.collection_country === prev.country && row.collection_continent === continent,
      )
      if (match) {
        return {
          continent,
          country: prev.country,
          countryIso3: match.collection_country_iso3,
        }
      }
      return { continent, country: null, countryIso3: null }
    })
  }

  const onCountryChange = (value: string) => {
    if (!value) {
      setGeoFilter((prev) => ({
        continent: prev.continent,
        country: null,
        countryIso3: null,
      }))
      return
    }
    const match =
      flows?.find((row) => {
        if (row.collection_country !== value) return false
        if (geoFilter.continent && row.collection_continent !== geoFilter.continent) return false
        return true
      }) ?? null
    if (!match) {
      setGeoFilter(EMPTY_GEO_FILTER)
      return
    }
    setGeoFilter({
      continent: match.collection_continent,
      country: match.collection_country,
      countryIso3: match.collection_country_iso3,
    })
  }

  const sidebarHeading = selectedSpeciesRow
    ? 'Species detail'
    : selection?.type === 'institute'
      ? 'Institute detail'
      : 'Region overview'

  const rankQuery = rankLevel && rankTaxid ? `?rank=${rankLevel}&taxon=${encodeURIComponent(rankTaxid)}` : ''

  return (
    <main className="atlas-shell">
      <header className="atlas-topbar">
        <Link href="/" className="wordmark">
          Assemblage<span className="wordmark-dot">.</span>
        </Link>
        <div className="atlas-title">
          <span>Atlas /</span> regions
        </div>
        <nav className="atlas-view-toggle" aria-label="Atlas view">
          <Link href={`/map${rankQuery}`} className="atlas-view-link">
            Flows
          </Link>
          <Link href={`/map/regions${rankQuery}`} className="atlas-view-link is-active" aria-current="page">
            Regions
          </Link>
          <Link href={`/map/explore${rankQuery}`} className="atlas-view-link">
            Explore
          </Link>
        </nav>
        <div className="topbar-info">
          <Info size={14} aria-hidden="true" /> Country → institute · live atlas
        </div>
      </header>
      <div className="atlas-toolbar">
        <RegionFilterBar
          flows={flows}
          filteredFlows={filteredFlows}
          rankLevel={rankLevel}
          rankTaxid={rankTaxid}
          rankTaxidLabel={rankTaxidLabel}
          onRankLevelChange={onRankLevelChange}
          onRankTaxidChange={setRankTaxid}
          taxonOptions={taxonOptions}
          selection={selection}
          onSelect={select}
          layers={layers}
          onToggleLayer={(key) => setLayers((old) => ({ ...old, [key]: !old[key] }))}
        />
        <div className="metric-pill">
          <span>In view</span>
          <b>{filteredFlows.length.toLocaleString()}</b>
          <small>species</small>
        </div>
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {flows ? `${filteredFlows.length.toLocaleString()} species in view` : ''}
      </span>
      <div className="atlas-content">
        <RegionMap
          countryTotals={scopedTotals}
          links={mapLinks}
          centroids={centroids}
          world={world}
          error={loadError}
          layers={layers}
          geoFilter={geoFilter}
          selection={selection}
          selectedSpeciesRow={selectedSpeciesRow}
          scopeTotal={activeScopeTotal}
          totalCount={flows?.length ?? null}
          onSelect={select}
          onGeoSelect={(geo) => {
            setGeoFilter(geo)
            setSelection(null)
            setMobileOpen(true)
          }}
          onRetry={retryLoad}
        />
        <aside className={`species-sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
          <div className="sidebar-top">
            <div>
              <span className="sidebar-kicker">
                <Layers3 size={13} aria-hidden="true" /> Regions atlas
              </span>
              <h1>{sidebarHeading}</h1>
            </div>
            {selection && (
              <button className="icon-button" onClick={clearSelection} aria-label="Close selection">
                <PanelRightClose size={17} />
              </button>
            )}
          </div>
          <RegionSidebar
            geoFilter={geoFilter}
            continentOptions={continentOptions}
            countryOptions={countryOptions}
            onContinentChange={onContinentChange}
            onCountryChange={onCountryChange}
            coverage={coverage}
            links={sidebarLinks}
            countryTotals={scopedTotals}
            selection={selection}
            selectedSpeciesRow={selectedSpeciesRow}
            selectedInstituteRows={selectedInstituteRows}
            onSelect={select}
            onClearSelection={clearSelection}
          />
        </aside>
      </div>
      <button
        type="button"
        className="mobile-sidebar-handle"
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-expanded={mobileOpen}
      >
        <ChevronDown size={16} aria-hidden="true" /> {sidebarHeading}
      </button>
    </main>
  )
}

export default function RegionsPage() {
  return (
    <Suspense fallback={<RegionsPageFallback />}>
      <RegionsPageInner />
    </Suspense>
  )
}
