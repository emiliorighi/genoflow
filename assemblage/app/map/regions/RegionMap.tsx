'use client'

import { useCallback, useMemo, useState } from 'react'
import DeckGL from '@deck.gl/react'
import { ArcLayer, GeoJsonLayer, ScatterplotLayer } from '@deck.gl/layers'
import { MapView } from '@deck.gl/core'
import type { PickingInfo } from '@deck.gl/core'
import { LoaderCircle, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  instituteKey,
  type GeoFilter,
  type RegionFlow,
  type Selection,
  type WorldFeature,
  type WorldGeoJson,
} from '../types'
import type {
  CountryCentroids,
  CountryInstituteLink,
  CountryTotal,
} from './regionData'

export type RegionLayers = { countries: boolean; institutes: boolean; flow: boolean }

const MAP_VIEW = new MapView({ repeat: true })

const INITIAL_VIEW_STATE = {
  longitude: 10,
  latitude: 15,
  zoom: 1.15,
  minZoom: 0.5,
  maxZoom: 8,
  pitch: 0,
  bearing: 0,
}

const AMBER: [number, number, number, number] = [216, 154, 104, 210]
const AMBER_HOT: [number, number, number, number] = [242, 192, 150, 255]
const BLUE: [number, number, number, number] = [124, 165, 194, 210]
const BLUE_HOT: [number, number, number, number] = [181, 212, 228, 255]
const ARC_SOURCE_DEFAULT: [number, number, number, number] = [216, 154, 104, 110]
const ARC_TARGET_DEFAULT: [number, number, number, number] = [124, 165, 194, 110]
const LAND_FILL: [number, number, number, number] = [20, 31, 36, 255]
const LAND_LINE: [number, number, number, number] = [41, 58, 65, 255]
const HIGHLIGHT_FILL: [number, number, number, number] = [216, 154, 104, 70]
const HIGHLIGHT_LINE: [number, number, number, number] = [242, 192, 150, 220]
const COUNTRY_LINE: [number, number, number, number] = [242, 192, 150, 255]
const INSTITUTE_LINE: [number, number, number, number] = [181, 212, 228, 255]

const NO_DEPTH = { depthTest: false } as const
const BASEMAP_DEPTH = { depthTest: false, depthMask: false } as const
const DIM_ALPHA = 28

const ARC_WIDTH_MIN = 0.8
const ARC_WIDTH_MAX = 8

function withAlpha(
  color: [number, number, number, number],
  alpha: number,
): [number, number, number, number] {
  return [color[0], color[1], color[2], alpha]
}

function arcWidth(count: number, scopeTotal: number): number {
  if (scopeTotal <= 0) return ARC_WIDTH_MIN
  const share = count / scopeTotal
  return Math.min(ARC_WIDTH_MAX, Math.max(ARC_WIDTH_MIN, share * ARC_WIDTH_MAX))
}

function countryRadius(total: number, maxTotal: number): number {
  if (maxTotal <= 0) return 4
  const t = Math.sqrt(total / maxTotal)
  return 3 + t * 14
}

type RegionMapProps = {
  countryTotals: CountryTotal[]
  links: CountryInstituteLink[]
  centroids: CountryCentroids | null
  world: WorldGeoJson | null
  error: string | null
  layers: RegionLayers
  geoFilter: GeoFilter
  selection: Selection
  selectedSpeciesRow: RegionFlow | null
  scopeTotal: number
  totalCount: number | null
  onSelect: (selection: Selection) => void
  onGeoSelect: (geo: GeoFilter) => void
  onRetry: () => void
}

type HoverTarget =
  | { kind: 'link'; link: CountryInstituteLink }
  | { kind: 'country'; country: CountryTotal }
  | { kind: 'institute'; key: string; name: string; country: string | null; count: number }

function LinkTooltip({
  target,
  pointer,
  scopeTotal,
}: {
  target: HoverTarget
  pointer: { x: number; y: number }
  scopeTotal: number
}) {
  if (target.kind === 'link') {
    const { link } = target
    const share = scopeTotal > 0 ? Math.round((1000 * link.count) / scopeTotal) / 10 : 0
    return (
      <div
        className="flow-tooltip"
        style={{ left: pointer.x + 14, top: pointer.y + 14 }}
        role="tooltip"
      >
        <span className="tooltip-kicker">Country → institute</span>
        <h4>{link.countryName}</h4>
        <div className="tooltip-route">
          <span>
            <span className="card-dot amber" />
            {link.countryName}
          </span>
          <span className="spark-arrow">→</span>
          <span>
            <span className="card-dot blue" />
            {link.instituteName}
            {link.instituteCountry ? ` (${link.instituteCountry})` : ''}
          </span>
        </div>
        <p className="tooltip-lineage">
          {link.count.toLocaleString()} species · {share}% of scope
        </p>
      </div>
    )
  }
  if (target.kind === 'country') {
    return (
      <div
        className="flow-tooltip"
        style={{ left: pointer.x + 14, top: pointer.y + 14 }}
        role="tooltip"
      >
        <span className="tooltip-kicker">Collection country</span>
        <h4>{target.country.countryName}</h4>
        <p className="tooltip-lineage">
          {target.country.total.toLocaleString()} sequenced species · {target.country.continent}
        </p>
      </div>
    )
  }
  return (
    <div
      className="flow-tooltip"
      style={{ left: pointer.x + 14, top: pointer.y + 14 }}
      role="tooltip"
    >
      <span className="tooltip-kicker">Submitter institute</span>
      <h4>{target.name}</h4>
      <p className="tooltip-lineage">
        {target.count.toLocaleString()} species
        {target.country ? ` · ${target.country}` : ''}
      </p>
    </div>
  )
}

type InstitutePoint = {
  key: string
  name: string
  lat: number
  lon: number
  country: string | null
  count: number
}

export default function RegionMap({
  countryTotals,
  links,
  centroids,
  world,
  error,
  layers,
  geoFilter,
  selection,
  selectedSpeciesRow,
  scopeTotal,
  totalCount,
  onSelect,
  onGeoSelect,
  onRetry,
}: RegionMapProps) {
  const [hovered, setHovered] = useState<HoverTarget | null>(null)
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)

  const maxCountryTotal = useMemo(
    () => countryTotals.reduce((m, t) => Math.max(m, t.total), 0),
    [countryTotals],
  )

  const countriesWithCentroid = useMemo(() => {
    if (!centroids) return [] as CountryTotal[]
    return countryTotals.filter((t) => centroids[t.iso3])
  }, [countryTotals, centroids])

  const institutePoints = useMemo(() => {
    const byKey = new Map<string, InstitutePoint>()
    for (const link of links) {
      const prev = byKey.get(link.instituteKey)
      if (prev) {
        prev.count += link.count
        continue
      }
      byKey.set(link.instituteKey, {
        key: link.instituteKey,
        name: link.instituteName,
        lat: link.instituteLat,
        lon: link.instituteLon,
        country: link.instituteCountry,
        count: link.count,
      })
    }
    return [...byKey.values()]
  }, [links])

  const highlightFeatures = useMemo(() => {
    if (!world) return null
    const { continent, country, countryIso3 } = geoFilter
    if (country) {
      if (!countryIso3) return null
      const features = world.features.filter((f) => f.properties.ISO_A3 === countryIso3)
      if (!features.length) return null
      return { type: 'FeatureCollection' as const, features }
    }
    if (!continent) return null
    const features = world.features.filter((f) => f.properties.CONTINENT === continent)
    if (!features.length) return null
    return { type: 'FeatureCollection' as const, features }
  }, [world, geoFilter])

  const hasSelection = Boolean(selection)
  const selectedInstituteKey = selection?.type === 'institute' ? selection.key : null
  const selectedSpeciesLinkKey = useMemo(() => {
    if (selection?.type !== 'species' || !selectedSpeciesRow) return null
    const iso3 = selectedSpeciesRow.collection_country_iso3
    const key = instituteKey(selectedSpeciesRow)
    if (!iso3 || !key) return null
    return `${iso3}::${key}`
  }, [selection, selectedSpeciesRow])
  const focusedInstituteKey =
    selectedInstituteKey ??
    (selectedSpeciesLinkKey ? selectedSpeciesLinkKey.slice(selectedSpeciesLinkKey.indexOf('::') + 2) : null)

  const linkIsFocused = (link: CountryInstituteLink): boolean => {
    if (selectedInstituteKey) return link.instituteKey === selectedInstituteKey
    if (selectedSpeciesLinkKey) {
      return `${link.countryIso3}::${link.instituteKey}` === selectedSpeciesLinkKey
    }
    return true
  }

  const selectedLinks = useMemo(() => {
    if (!selection) return [] as CountryInstituteLink[]
    if (selection.type === 'institute') {
      return links.filter((l) => l.instituteKey === selection.key)
    }
    // Species selection: highlight that species' country → institute link when present.
    if (selection.type === 'species' && selectedSpeciesRow) {
      const row = selectedSpeciesRow
      const iso3 = row.collection_country_iso3
      const key = instituteKey(row)
      if (
        !iso3 ||
        !key ||
        !row.has_institute_coordinates ||
        row.institute_lat == null ||
        row.institute_lon == null ||
        !row.institute_name
      ) {
        return []
      }
      const existing = links.find((l) => l.countryIso3 === iso3 && l.instituteKey === key)
      if (existing) return [existing]
      return [
        {
          countryIso3: iso3,
          countryName: row.collection_country || iso3,
          continent: row.collection_continent,
          instituteKey: key,
          instituteName: row.institute_name,
          instituteLat: row.institute_lat,
          instituteLon: row.institute_lon,
          instituteCountry: row.institute_country,
          count: 1,
        },
      ]
    }
    return []
  }, [links, selection, selectedSpeciesRow])

  const onHover = useCallback((info: PickingInfo) => {
    const obj = info.object as
      | CountryInstituteLink
      | CountryTotal
      | InstitutePoint
      | WorldFeature
      | undefined
    if (!obj) {
      setHovered(null)
      setPointer(null)
      return
    }
    if ('properties' in obj) {
      setHovered(null)
      setPointer(null)
      return
    }
    setPointer({ x: info.x, y: info.y })
    if ('instituteKey' in obj && 'countryIso3' in obj) {
      setHovered({ kind: 'link', link: obj })
      return
    }
    if ('iso3' in obj && 'total' in obj) {
      setHovered({ kind: 'country', country: obj })
      return
    }
    if ('key' in obj && 'lat' in obj) {
      setHovered({
        kind: 'institute',
        key: obj.key,
        name: obj.name,
        country: obj.country,
        count: obj.count,
      })
    }
  }, [])

  const deckLayers = useMemo(() => {
    const built = []

    if (world) {
      built.push(
        new GeoJsonLayer({
          id: 'world-outline',
          data: world,
          stroked: true,
          filled: true,
          pickable: false,
          getFillColor: LAND_FILL,
          getLineColor: LAND_LINE,
          lineWidthMinPixels: 1,
          parameters: BASEMAP_DEPTH,
        }),
      )
    }

    if (highlightFeatures) {
      const highlightKey = geoFilter.countryIso3 ?? geoFilter.continent ?? 'none'
      built.push(
        new GeoJsonLayer({
          id: `highlight-area-${highlightKey}`,
          data: highlightFeatures,
          stroked: true,
          filled: true,
          pickable: true,
          getFillColor: HIGHLIGHT_FILL,
          getLineColor: HIGHLIGHT_LINE,
          lineWidthMinPixels: 1.5,
          parameters: BASEMAP_DEPTH,
          onClick: (info: PickingInfo<WorldFeature>) => {
            const props = info.object?.properties
            if (!props) return
            if (geoFilter.continent && !geoFilter.country && props.ISO_A3 && props.ISO_A3 !== '-99') {
              const match = countryTotals.find((t) => t.iso3 === props.ISO_A3)
              if (match) {
                onGeoSelect({
                  continent: props.CONTINENT || geoFilter.continent,
                  country: match.countryName,
                  countryIso3: props.ISO_A3,
                })
                return
              }
            }
            onGeoSelect({
              continent: props.CONTINENT || null,
              country: null,
              countryIso3: null,
            })
          },
        }),
      )
    }

    if (layers.flow && centroids) {
      built.push(
        new ArcLayer<CountryInstituteLink>({
          id: 'region-flow-arcs',
          data: links,
          pickable: true,
          getSourcePosition: (d) => {
            const c = centroids[d.countryIso3]
            return c ? [c.lon, c.lat] : [0, 0]
          },
          getTargetPosition: (d) => [d.instituteLon, d.instituteLat],
          getSourceColor: (d) =>
            hasSelection && !linkIsFocused(d)
              ? withAlpha(ARC_SOURCE_DEFAULT, DIM_ALPHA)
              : ARC_SOURCE_DEFAULT,
          getTargetColor: (d) =>
            hasSelection && !linkIsFocused(d)
              ? withAlpha(ARC_TARGET_DEFAULT, DIM_ALPHA)
              : ARC_TARGET_DEFAULT,
          getWidth: (d) => arcWidth(d.count, scopeTotal),
          widthMinPixels: 1,
          widthMaxPixels: 12,
          greatCircle: true,
          parameters: NO_DEPTH,
          updateTriggers: {
            getSourceColor: [hasSelection, selectedInstituteKey, selectedSpeciesLinkKey],
            getTargetColor: [hasSelection, selectedInstituteKey, selectedSpeciesLinkKey],
            getWidth: [scopeTotal],
            getSourcePosition: [centroids],
          },
          onClick: (info: PickingInfo<CountryInstituteLink>) => {
            if (info.object) onSelect({ type: 'institute', key: info.object.instituteKey })
          },
        }),
      )
    }

    if (layers.countries && centroids) {
      built.push(
        new ScatterplotLayer<CountryTotal>({
          id: 'country-points',
          data: countriesWithCentroid,
          pickable: true,
          radiusUnits: 'pixels',
          radiusMinPixels: 3,
          radiusMaxPixels: 18,
          getPosition: (d) => {
            const c = centroids[d.iso3]
            return c ? [c.lon, c.lat] : [0, 0]
          },
          getRadius: (d) => countryRadius(d.total, maxCountryTotal),
          getFillColor: (d) => {
            const active =
              geoFilter.countryIso3 === d.iso3 ||
              (!geoFilter.country && geoFilter.continent === d.continent)
            if (hasSelection && !active) return withAlpha(AMBER, DIM_ALPHA)
            return active && geoFilter.country ? AMBER_HOT : AMBER
          },
          getLineColor: COUNTRY_LINE,
          lineWidthMinPixels: 1,
          stroked: true,
          parameters: NO_DEPTH,
          updateTriggers: {
            getFillColor: [geoFilter, hasSelection],
            getRadius: [maxCountryTotal],
            getPosition: [centroids],
          },
          onClick: (info: PickingInfo<CountryTotal>) => {
            const t = info.object
            if (!t) return
            onGeoSelect({
              continent: t.continent,
              country: t.countryName,
              countryIso3: t.iso3,
            })
          },
        }),
      )
    }

    if (layers.institutes) {
      built.push(
        new ScatterplotLayer<InstitutePoint>({
          id: 'institute-points',
          data: institutePoints,
          pickable: true,
          radiusUnits: 'pixels',
          radiusMinPixels: 2,
          radiusMaxPixels: 10,
          getPosition: (d) => [d.lon, d.lat],
          getRadius: 3.5,
          getFillColor: (d) =>
            hasSelection && focusedInstituteKey && d.key !== focusedInstituteKey
              ? withAlpha(BLUE, DIM_ALPHA)
              : focusedInstituteKey === d.key
                ? BLUE_HOT
                : BLUE,
          getLineColor: INSTITUTE_LINE,
          lineWidthMinPixels: 1,
          stroked: true,
          parameters: NO_DEPTH,
          updateTriggers: {
            getFillColor: [hasSelection, focusedInstituteKey],
          },
          onClick: (info: PickingInfo<InstitutePoint>) => {
            if (info.object) onSelect({ type: 'institute', key: info.object.key })
          },
        }),
      )
    }

    if (hasSelection && selectedLinks.length && layers.flow && centroids) {
      built.push(
        new ArcLayer<CountryInstituteLink>({
          id: 'selected-region-arcs',
          data: selectedLinks,
          pickable: true,
          getSourcePosition: (d) => {
            const c = centroids[d.countryIso3]
            return c ? [c.lon, c.lat] : [0, 0]
          },
          getTargetPosition: (d) => [d.instituteLon, d.instituteLat],
          getSourceColor: AMBER_HOT,
          getTargetColor: BLUE_HOT,
          getWidth: (d) => Math.max(arcWidth(d.count, scopeTotal), 2.4),
          widthMinPixels: 2,
          greatCircle: true,
          parameters: NO_DEPTH,
          onClick: (info: PickingInfo<CountryInstituteLink>) => {
            if (info.object) onSelect({ type: 'institute', key: info.object.instituteKey })
          },
        }),
      )
    }

    return built
  }, [
    world,
    highlightFeatures,
    geoFilter,
    layers,
    links,
    centroids,
    countriesWithCentroid,
    institutePoints,
    maxCountryTotal,
    scopeTotal,
    hasSelection,
    selectedInstituteKey,
    selectedSpeciesLinkKey,
    selectedLinks,
    countryTotals,
    onSelect,
    onGeoSelect,
  ])

  const getTooltip = (info: PickingInfo<WorldFeature>) => {
    const obj = info.object
    if (!obj || !('properties' in obj) || !obj.properties?.NAME) return null
    return {
      text: obj.properties.NAME,
      style: {
        backgroundColor: '#0b0f12',
        color: '#d6dad7',
        fontSize: '11px',
        fontFamily: 'Arial, sans-serif',
        padding: '6px 8px',
        border: '1px solid #222a30',
      },
    }
  }

  const mapNote = hasSelection
    ? 'Esc or click empty map to clear selection'
    : geoFilter.country || geoFilter.continent
      ? `Region scope · ${links.length.toLocaleString()} country→institute links`
      : `Top ${links.length} country→institute links`

  const onDeckClick = useCallback(
    (info: PickingInfo) => {
      if (!info.object && hasSelection) onSelect(null)
    },
    [hasSelection, onSelect],
  )

  return (
    <div className="map-canvas atlas-grid">
      <DeckGL
        views={MAP_VIEW}
        initialViewState={INITIAL_VIEW_STATE}
        controller={true}
        layers={deckLayers}
        getTooltip={getTooltip}
        onHover={onHover}
        onClick={onDeckClick}
        style={{ position: 'absolute', inset: '0', background: '#080e11' }}
      />
      {hovered && pointer && (
        <LinkTooltip target={hovered} pointer={pointer} scopeTotal={scopeTotal} />
      )}
      {totalCount == null && !error && (
        <div className="map-loading-overlay" role="status" aria-live="polite">
          <LoaderCircle size={22} className="map-loading-spinner" aria-hidden="true" />
          <p>Loading region flows…</p>
        </div>
      )}
      {error && (
        <div className="map-error-overlay" role="alert">
          <p>{error}</p>
          <Button variant="outline" size="sm" onClick={onRetry} className="map-error-retry">
            <RotateCw size={13} aria-hidden="true" /> Retry
          </Button>
        </div>
      )}
      <div className="map-legend">
        <div>
          <span className="legend-dot amber" /> Country
        </div>
        <div>
          <span className="legend-square blue" /> Institute
        </div>
        <div>
          <span className="legend-line" /> Country → institute
        </div>
      </div>
      <div className="map-note">{mapNote}</div>
    </div>
  )
}
