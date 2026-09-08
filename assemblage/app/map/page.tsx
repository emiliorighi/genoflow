'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Info, Layers3, PanelRightClose } from 'lucide-react'
import { load } from '@loaders.gl/core'
import { ParquetLoader } from '@loaders.gl/parquet'
import DeckMap, { type Layers } from './DeckMap'
import {
  InstituteDetail,
  InstituteSearch,
  RegionOverview,
  SpeciesDetail,
  SpeciesSearch,
  regionTitle,
} from './SidebarPanels'
import {
  EMPTY_GEO_FILTER,
  computeRegionStats,
  filterFlows,
  instituteKey,
  normalizeFlows,
  PARQUET_COLUMNS,
  TAXON_RANKS,
  type GeoFilter,
  type RankFilter,
  type Selection,
  type SpeciesFlow,
  type TaxonRank,
  type WorldGeoJson,
} from './types'

function Toggle({
  label,
  color,
  checked,
  onChange,
}: {
  label: string
  color: 'amber' | 'blue' | 'flow'
  checked: boolean
  onChange: () => void
}) {
  return (
    <button className="layer-toggle" onClick={onChange} aria-pressed={checked}>
      <span className={`toggle-key ${color}`} />
      <span>{label}</span>
      <span className={`switch ${checked ? 'on' : ''}`}>
        <span />
      </span>
    </button>
  )
}

function rankTaxidKey(rank: TaxonRank): keyof SpeciesFlow {
  return `${rank}_taxid` as keyof SpeciesFlow
}

function rankNameKey(rank: TaxonRank): keyof SpeciesFlow {
  return `${rank}_name` as keyof SpeciesFlow
}

export default function MapPage() {
  const [layers, setLayers] = useState<Layers>({ collection: true, submitter: true, flow: true })
  const [selection, setSelection] = useState<Selection>(null)
  const [mobileOpen, setMobileOpen] = useState(false)

  const [flows, setFlows] = useState<SpeciesFlow[] | null>(null)
  const [world, setWorld] = useState<WorldGeoJson | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [rankLevel, setRankLevel] = useState<TaxonRank | ''>('')
  const [rankTaxid, setRankTaxid] = useState('')
  const [geoFilter, setGeoFilter] = useState<GeoFilter>(EMPTY_GEO_FILTER)

  const clearSelection = () => {
    setSelection(null)
    setMobileOpen(false)
  }

  const select = (next: Selection) => {
    setSelection(next)
    if (next) setMobileOpen(true)
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
        const [table, worldJson] = await Promise.all([
          load('/data/species_flows.parquet', ParquetLoader, {
            parquet: { columnList: [...PARQUET_COLUMNS] },
          }),
          fetch('/data/world-110m.geojson').then((res) => {
            if (!res.ok) throw new Error(`world geojson ${res.status}`)
            return res.json() as Promise<WorldGeoJson>
          }),
        ])
        if (cancelled) return
        setFlows(normalizeFlows(table))
        setWorld(worldJson)
      } catch (err) {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : 'Failed to load map data')
      }
    }

    void loadData()
    return () => {
      cancelled = true
    }
  }, [])

  const rankFilter: RankFilter | null =
    rankLevel && rankTaxid ? { rank: rankLevel, taxid: rankTaxid } : null

  const filteredFlows = useMemo(() => {
    if (!flows) return []
    return filterFlows(flows, rankFilter, geoFilter)
  }, [flows, rankFilter, geoFilter])

  // Drop selection if it falls outside the current filtered scope.
  useEffect(() => {
    if (!selection) return
    const stillVisible = filteredFlows.some((row) => {
      if (selection.type === 'species') return row.species_taxid === selection.taxid
      return instituteKey(row) === selection.key
    })
    if (!stillVisible) setSelection(null)
  }, [filteredFlows, selection])

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

  const continentOptions = useMemo(() => {
    if (!flows) return []
    return [...new Set(flows.map((row) => row.collection_continent).filter(Boolean))].sort((a, b) => {
      if (a === 'Unknown') return 1
      if (b === 'Unknown') return -1
      return a.localeCompare(b)
    })
  }, [flows])

  const countryOptions = useMemo(() => {
    if (!flows) return []
    const byCountry = new Map<string, { continent: string; iso3: string | null }>()
    for (const row of flows) {
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
  }, [flows, geoFilter.continent])

  const regionStats = useMemo(
    () => computeRegionStats(filteredFlows, geoFilter),
    [filteredFlows, geoFilter],
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

  const title = regionTitle(geoFilter)
  const sidebarHeading = selectedSpeciesRow
    ? 'Species detail'
    : selection?.type === 'institute'
      ? 'Institute detail'
      : 'Region overview'

  return (
    <main className="atlas-shell">
      <header className="atlas-topbar">
        <Link href="/" className="wordmark">
          Assemblage<span className="wordmark-dot">.</span>
        </Link>
        <div className="atlas-title">
          <span>Atlas /</span> species flows
        </div>
        <div className="topbar-info">
          <Info size={14} /> INSDC flows · live atlas
        </div>
      </header>
      <div className="atlas-toolbar">
        <div className="map-filters">
          <label className="map-filter">
            <span>Rank</span>
            <select value={rankLevel} onChange={(e) => onRankLevelChange(e.target.value)} disabled={!flows}>
              <option value="">Any rank</option>
              {TAXON_RANKS.map((rank) => (
                <option key={rank} value={rank}>
                  {rank}
                </option>
              ))}
            </select>
          </label>
          <label className="map-filter">
            <span>Taxon</span>
            <select
              value={rankTaxid}
              onChange={(e) => setRankTaxid(e.target.value)}
              disabled={!rankLevel || taxonOptions.length === 0}
            >
              <option value="">All taxa</option>
              {taxonOptions.map((opt) => (
                <option key={opt.taxid} value={opt.taxid}>
                  {opt.name}
                </option>
              ))}
            </select>
          </label>
          <label className="map-filter">
            <span>Continent</span>
            <select
              value={geoFilter.continent ?? ''}
              onChange={(e) => onContinentChange(e.target.value)}
              disabled={!flows}
            >
              <option value="">All continents</option>
              {continentOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="map-filter">
            <span>Country</span>
            <select
              value={geoFilter.country ?? ''}
              onChange={(e) => onCountryChange(e.target.value)}
              disabled={!flows}
            >
              <option value="">All countries</option>
              {countryOptions.map((opt) => (
                <option key={opt.country} value={opt.country}>
                  {opt.country}
                </option>
              ))}
            </select>
          </label>
          <SpeciesSearch flows={filteredFlows} selection={selection} onSelect={select} />
          <InstituteSearch flows={filteredFlows} selection={selection} onSelect={select} />
        </div>
        <div className="toolbar-layers">
          <Toggle
            label="Collection sites"
            color="amber"
            checked={layers.collection}
            onChange={() => setLayers((old) => ({ ...old, collection: !old.collection }))}
          />
          <Toggle
            label="Submitter sites"
            color="blue"
            checked={layers.submitter}
            onChange={() => setLayers((old) => ({ ...old, submitter: !old.submitter }))}
          />
          <Toggle
            label="Flow arcs"
            color="flow"
            checked={layers.flow}
            onChange={() => setLayers((old) => ({ ...old, flow: !old.flow }))}
          />
        </div>
        <div className="metric-pill">
          <span>In view</span>
          <b>{filteredFlows.length.toLocaleString()}</b>
          <small>species</small>
        </div>
      </div>
      <div className="atlas-content">
        <DeckMap
          filteredFlows={filteredFlows}
          world={world}
          error={loadError}
          layers={layers}
          geoFilter={geoFilter}
          selection={selection}
          totalCount={flows?.length ?? null}
          onSelect={select}
          onGeoSelect={(geo) => {
            setGeoFilter(geo)
            setSelection(null)
            setMobileOpen(true)
          }}
        />
        <aside className={`species-sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
          <div className="sidebar-top">
            <div>
              <span className="sidebar-kicker">
                <Layers3 size={13} /> Specimen atlas
              </span>
              <h1>{sidebarHeading}</h1>
            </div>
            {selection && (
              <button className="icon-button" onClick={clearSelection} aria-label="Close selection">
                <PanelRightClose size={17} />
              </button>
            )}
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
            <RegionOverview
              title={title}
              stats={regionStats}
              onSelectInstitute={(key) => select({ type: 'institute', key })}
            />
          )}
        </aside>
      </div>
      <div className="mobile-sidebar-handle" onClick={() => setMobileOpen(!mobileOpen)}>
        <ChevronDown size={16} /> {sidebarHeading}
      </div>
    </main>
  )
}
