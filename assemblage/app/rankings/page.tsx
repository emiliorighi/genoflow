'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { load } from '@loaders.gl/core'
import {
  buildContinentCards,
  buildContinentLookup,
  buildCountryCards,
  buildRegionsTabCards,
  filterCountryCardsForCountriesTab,
  buildAllCustomIso3Sets,
} from '../map/explore/exploreData'
import { buildFlowIndex } from '../map/explore/flowIndex'
import { computeYearBounds } from '../map/explore/yearRange'
import { buildCountryTotals, type SpeciesCountRow } from '../map/regionData'
import {
  normalizeRegionFlows,
  type RegionFlow,
  type WorldGeoJson,
} from '../map/types'
import { publicUrl } from '../../lib/publicUrl'
import AtlasTopbar from '../components/AtlasTopbar'
import PullIndexRankings from './PullIndexRankings'

export default function RankingsPage() {
  const [flows, setFlows] = useState<RegionFlow[] | null>(null)
  const [world, setWorld] = useState<WorldGeoJson | null>(null)
  const [speciesCounts, setSpeciesCounts] = useState<SpeciesCountRow[] | null>(
    null,
  )
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function loadData() {
      try {
        const { ParquetArrowLoader } = await import('@loaders.gl/parquet')
        const [table, worldJson, countsJson] = await Promise.all([
          load(publicUrl('/data/species_flows.parquet'), ParquetArrowLoader, {
            parquet: { wasmUrl: publicUrl('/wasm/parquet_wasm_bg.wasm') },
          }),
          fetch(publicUrl('/data/world-110m.geojson')).then((res) => {
            if (!res.ok) throw new Error(`world geojson ${res.status}`)
            return res.json() as Promise<WorldGeoJson>
          }),
          fetch(publicUrl('/data/species_counts_by_country.json')).then((res) => {
            if (!res.ok) throw new Error(`species counts ${res.status}`)
            return res.json() as Promise<SpeciesCountRow[]>
          }),
        ])
        if (cancelled) return
        setFlows(normalizeRegionFlows(table))
        setWorld(worldJson)
        setSpeciesCounts(countsJson)
        setLoadError(null)
      } catch (err) {
        if (cancelled) return
        setLoadError(
          err instanceof Error ? err.message : 'Failed to load rankings data',
        )
      }
    }

    void loadData()
    return () => {
      cancelled = true
    }
  }, [loadAttempt])

  const continentLookup = useMemo(
    () => (world ? buildContinentLookup(world) : new Map<string, string>()),
    [world],
  )

  const allCountryTotals = useMemo(
    () => (flows ? buildCountryTotals(flows) : []),
    [flows],
  )

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

  const flowIndex = useMemo(
    () => (flows ? buildFlowIndex(flows, customIso3Sets) : null),
    [flows, customIso3Sets],
  )

  const yearBounds = useMemo(() => (flows ? computeYearBounds(flows) : null), [flows])

  const continentCards = useMemo(
    () => (flowIndex ? buildContinentCards(flowIndex) : []),
    [flowIndex],
  )

  const allCountryCards = useMemo(
    () =>
      flowIndex
        ? buildCountryCards(
            flowIndex,
            speciesCounts ?? [],
            allCountryTotals,
            membershipLookup,
          )
        : [],
    [flowIndex, speciesCounts, allCountryTotals, membershipLookup],
  )

  const countryCards = useMemo(
    () => filterCountryCardsForCountriesTab(allCountryCards),
    [allCountryCards],
  )

  const regionCards = useMemo(
    () => (flowIndex ? buildRegionsTabCards(flowIndex, allCountryCards) : []),
    [flowIndex, allCountryCards],
  )

  const loading = !flows || !speciesCounts || !world

  return (
    <main className="atlas-shell">
      <AtlasTopbar current="rankings" />

      <div className="pull-rank-page">
        {loadError ? (
          <div className="pull-rank-error">
            <p>{loadError}</p>
            <button
              type="button"
              className="button button-quiet"
              onClick={() => setLoadAttempt((n) => n + 1)}
            >
              Retry
            </button>
          </div>
        ) : (
          <PullIndexRankings
            flowIndex={flowIndex}
            yearBounds={yearBounds}
            regionCards={regionCards}
            continentCards={continentCards}
            countryCards={countryCards}
            loading={loading}
            error={null}
          />
        )}
      </div>
    </main>
  )
}
