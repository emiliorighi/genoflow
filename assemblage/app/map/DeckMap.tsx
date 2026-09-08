'use client'

import { useCallback, useMemo, useState } from 'react'
import DeckGL from '@deck.gl/react'
import { ArcLayer, GeoJsonLayer, ScatterplotLayer } from '@deck.gl/layers'
import { MapView } from '@deck.gl/core'
import type { PickingInfo } from '@deck.gl/core'
import {
  instituteKey,
  matchesSelection,
  type GeoFilter,
  type Selection,
  type SpeciesFlow,
  type WorldFeature,
  type WorldGeoJson,
} from './types'

export type Layers = { collection: boolean; submitter: boolean; flow: boolean }

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
const ARC_SOURCE_DEFAULT: [number, number, number, number] = [216, 154, 104, 90]
const ARC_TARGET_DEFAULT: [number, number, number, number] = [124, 165, 194, 90]
const LAND_FILL: [number, number, number, number] = [20, 31, 36, 255]
const LAND_LINE: [number, number, number, number] = [41, 58, 65, 255]
const HIGHLIGHT_FILL: [number, number, number, number] = [216, 154, 104, 70]
const HIGHLIGHT_LINE: [number, number, number, number] = [242, 192, 150, 220]
const COLLECTION_LINE: [number, number, number, number] = [242, 192, 150, 255]
const INSTITUTE_LINE: [number, number, number, number] = [181, 212, 228, 255]

const NO_DEPTH = { depthTest: false } as const
const BASEMAP_DEPTH = { depthTest: false, depthMask: false } as const

type DeckMapProps = {
  filteredFlows: SpeciesFlow[]
  world: WorldGeoJson | null
  error: string | null
  layers: Layers
  geoFilter: GeoFilter
  selection: Selection
  totalCount: number | null
  onSelect: (selection: Selection) => void
  onGeoSelect: (geo: GeoFilter) => void
}

function selectionFromFlow(row: SpeciesFlow, preferInstitute: boolean): Selection {
  if (preferInstitute) {
    const key = instituteKey(row)
    if (key) return { type: 'institute', key }
  }
  if (row.species_taxid) return { type: 'species', taxid: row.species_taxid }
  return null
}

function isSpeciesFlow(obj: unknown): obj is SpeciesFlow {
  return Boolean(obj && typeof obj === 'object' && 'species_scientific_name' in obj)
}

function flowIdentity(row: SpeciesFlow): string {
  return `${row.species_taxid}::${instituteKey(row) ?? ''}`
}

function lineageParts(row: SpeciesFlow): string[] {
  return [
    row.kingdom_name,
    row.phylum_name,
    row.class_name,
    row.order_name,
    row.family_name,
    row.genus_name,
  ].filter((part): part is string => Boolean(part))
}

function FlowTooltip({
  row,
  pointer,
}: {
  row: SpeciesFlow
  pointer: { x: number; y: number }
}) {
  const lineage = lineageParts(row)
  return (
    <div
      className="flow-tooltip"
      style={{ left: pointer.x + 14, top: pointer.y + 14 }}
      role="tooltip"
    >
      <span className="tooltip-kicker">Species flow</span>
      <h4>
        <i>{row.species_scientific_name}</i>
      </h4>
      <div className="tooltip-route">
        <span>
          <span className="card-dot amber" />
          {row.collection_country || 'Unknown origin'}
        </span>
        <span className="spark-arrow">→</span>
        <span>
          <span className="card-dot blue" />
          {row.institute_name || 'Submitter unresolved'}
          {row.institute_country ? ` (${row.institute_country})` : ''}
        </span>
      </div>
      {lineage.length > 0 && (
        <p className="tooltip-lineage">
          {lineage.map((part, index) => (
            <span key={`${part}-${index}`}>
              {part}
              {index < lineage.length - 1 ? <span className="tooltip-sep"> / </span> : null}
            </span>
          ))}
        </p>
      )}
      {!row.institute_name && !row.institute_country && (
        <div className="tooltip-submitter">No submitter geography</div>
      )}
    </div>
  )
}

export default function DeckMap({
  filteredFlows,
  world,
  error,
  layers,
  geoFilter,
  selection,
  totalCount,
  onSelect,
  onGeoSelect,
}: DeckMapProps) {
  const [hoveredRow, setHoveredRow] = useState<SpeciesFlow | null>(null)
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)

  const withInstitute = useMemo(
    () => filteredFlows.filter((row) => row.has_institute_coordinates),
    [filteredFlows],
  )

  const selectedFlows = useMemo(() => {
    if (!selection) return [] as SpeciesFlow[]
    return filteredFlows.filter((row) => matchesSelection(row, selection))
  }, [filteredFlows, selection])

  const selectedWithInstitute = useMemo(
    () => selectedFlows.filter((row) => row.has_institute_coordinates),
    [selectedFlows],
  )

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
  const hoveredIsSelected = Boolean(
    hasSelection && hoveredRow && matchesSelection(hoveredRow, selection),
  )
  const showHover = Boolean(hoveredRow && !hoveredIsSelected)

  const onHover = useCallback((info: PickingInfo<SpeciesFlow | WorldFeature>) => {
    const obj = info.object
    if (isSpeciesFlow(obj)) {
      setPointer({ x: info.x, y: info.y })
      setHoveredRow((prev) => {
        if (prev && flowIdentity(prev) === flowIdentity(obj)) return prev
        return obj
      })
      return
    }
    setHoveredRow((prev) => (prev == null ? prev : null))
    setPointer((prev) => (prev == null ? prev : null))
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
              const match = filteredFlows.find((row) => row.collection_country_iso3 === props.ISO_A3)
              if (match) {
                onGeoSelect({
                  continent: props.CONTINENT || geoFilter.continent,
                  country: match.collection_country,
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

    if (layers.flow && !hasSelection) {
      built.push(
        new ArcLayer<SpeciesFlow>({
          id: 'flow-arcs',
          data: withInstitute,
          pickable: true,
          getSourcePosition: (d) => [d.collection_lon, d.collection_lat],
          getTargetPosition: (d) => [d.institute_lon as number, d.institute_lat as number],
          getSourceColor: ARC_SOURCE_DEFAULT,
          getTargetColor: ARC_TARGET_DEFAULT,
          getWidth: 1.2,
          widthMinPixels: 1,
          greatCircle: true,
          parameters: NO_DEPTH,
          onClick: (info: PickingInfo<SpeciesFlow>) => {
            if (info.object) onSelect(selectionFromFlow(info.object, false))
          },
        }),
      )
    }

    if (layers.collection && !hasSelection) {
      built.push(
        new ScatterplotLayer<SpeciesFlow>({
          id: 'collection-points',
          data: filteredFlows,
          pickable: true,
          radiusUnits: 'pixels',
          radiusMinPixels: 2,
          radiusMaxPixels: 6,
          getPosition: (d) => [d.collection_lon, d.collection_lat],
          getRadius: 3,
          getFillColor: AMBER,
          getLineColor: COLLECTION_LINE,
          lineWidthMinPixels: 1,
          stroked: true,
          parameters: NO_DEPTH,
          onClick: (info: PickingInfo<SpeciesFlow>) => {
            if (info.object) onSelect(selectionFromFlow(info.object, false))
          },
        }),
      )
    }

    if (layers.submitter && !hasSelection) {
      built.push(
        new ScatterplotLayer<SpeciesFlow>({
          id: 'institute-points',
          data: withInstitute,
          pickable: true,
          radiusUnits: 'pixels',
          radiusMinPixels: 2,
          radiusMaxPixels: 6,
          getPosition: (d) => [d.institute_lon as number, d.institute_lat as number],
          getRadius: 3,
          getFillColor: BLUE,
          getLineColor: INSTITUTE_LINE,
          lineWidthMinPixels: 1,
          stroked: true,
          parameters: NO_DEPTH,
          onClick: (info: PickingInfo<SpeciesFlow>) => {
            if (info.object) onSelect(selectionFromFlow(info.object, true))
          },
        }),
      )
    }

    if (hasSelection && selectedWithInstitute.length && layers.flow) {
      built.push(
        new ArcLayer<SpeciesFlow>({
          id: 'selected-arcs',
          data: selectedWithInstitute,
          pickable: true,
          getSourcePosition: (d) => [d.collection_lon, d.collection_lat],
          getTargetPosition: (d) => [d.institute_lon as number, d.institute_lat as number],
          getSourceColor: AMBER_HOT,
          getTargetColor: BLUE_HOT,
          getWidth: 2.4,
          widthMinPixels: 2,
          greatCircle: true,
          parameters: NO_DEPTH,
          onClick: (info: PickingInfo<SpeciesFlow>) => {
            if (info.object) onSelect(selectionFromFlow(info.object, false))
          },
        }),
      )
    }

    if (hasSelection && selectedFlows.length && layers.collection) {
      built.push(
        new ScatterplotLayer<SpeciesFlow>({
          id: 'selected-collection',
          data: selectedFlows,
          pickable: true,
          radiusUnits: 'pixels',
          radiusMinPixels: 4,
          radiusMaxPixels: 10,
          getPosition: (d) => [d.collection_lon, d.collection_lat],
          getRadius: 5,
          getFillColor: AMBER_HOT,
          getLineColor: [255, 230, 200, 255],
          lineWidthMinPixels: 1.5,
          stroked: true,
          parameters: NO_DEPTH,
          onClick: (info: PickingInfo<SpeciesFlow>) => {
            if (info.object) onSelect(selectionFromFlow(info.object, false))
          },
        }),
      )
    }

    if (hasSelection && selectedWithInstitute.length && layers.submitter) {
      built.push(
        new ScatterplotLayer<SpeciesFlow>({
          id: 'selected-institutes',
          data: selectedWithInstitute,
          pickable: true,
          radiusUnits: 'pixels',
          radiusMinPixels: 4,
          radiusMaxPixels: 10,
          getPosition: (d) => [d.institute_lon as number, d.institute_lat as number],
          getRadius: 5,
          getFillColor: BLUE_HOT,
          getLineColor: [220, 240, 250, 255],
          lineWidthMinPixels: 1.5,
          stroked: true,
          parameters: NO_DEPTH,
          onClick: (info: PickingInfo<SpeciesFlow>) => {
            if (info.object) onSelect(selectionFromFlow(info.object, true))
          },
        }),
      )
    }

    if (showHover && hoveredRow) {
      if (hoveredRow.has_institute_coordinates && layers.flow) {
        built.push(
          new ArcLayer<SpeciesFlow>({
            id: 'hover-arc',
            data: [hoveredRow],
            pickable: false,
            getSourcePosition: (d) => [d.collection_lon, d.collection_lat],
            getTargetPosition: (d) => [d.institute_lon as number, d.institute_lat as number],
            getSourceColor: AMBER_HOT,
            getTargetColor: BLUE_HOT,
            getWidth: 2.4,
            widthMinPixels: 2,
            greatCircle: true,
            parameters: NO_DEPTH,
          }),
        )
      }

      if (layers.collection) {
        built.push(
          new ScatterplotLayer<SpeciesFlow>({
            id: 'hover-collection',
            data: [hoveredRow],
            pickable: false,
            radiusUnits: 'pixels',
            radiusMinPixels: 4,
            radiusMaxPixels: 10,
            getPosition: (d) => [d.collection_lon, d.collection_lat],
            getRadius: 5,
            getFillColor: AMBER_HOT,
            getLineColor: [255, 230, 200, 255],
            lineWidthMinPixels: 1.5,
            stroked: true,
            parameters: NO_DEPTH,
          }),
        )
      }

      if (hoveredRow.has_institute_coordinates && layers.submitter) {
        built.push(
          new ScatterplotLayer<SpeciesFlow>({
            id: 'hover-institute',
            data: [hoveredRow],
            pickable: false,
            radiusUnits: 'pixels',
            radiusMinPixels: 4,
            radiusMaxPixels: 10,
            getPosition: (d) => [d.institute_lon as number, d.institute_lat as number],
            getRadius: 5,
            getFillColor: BLUE_HOT,
            getLineColor: [220, 240, 250, 255],
            lineWidthMinPixels: 1.5,
            stroked: true,
            parameters: NO_DEPTH,
          }),
        )
      }
    }

    return built
  }, [
    world,
    highlightFeatures,
    geoFilter,
    filteredFlows,
    withInstitute,
    layers,
    hasSelection,
    selectedFlows,
    selectedWithInstitute,
    showHover,
    hoveredRow,
    onSelect,
    onGeoSelect,
  ])

  const getTooltip = (info: PickingInfo<SpeciesFlow | WorldFeature>) => {
    const obj = info.object
    if (!obj) return null
    // Species flows use the custom FlowTooltip card; keep deck.gl text for polygons only.
    if ('properties' in obj && obj.properties?.NAME) {
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
    return null
  }

  const mapNote =
    totalCount == null
      ? 'INSDC / ENA'
      : hasSelection
        ? `Showing ${selectedFlows.length.toLocaleString()} related record${selectedFlows.length === 1 ? '' : 's'} · clear selection to see all`
        : `${filteredFlows.length.toLocaleString()} / ${totalCount.toLocaleString()} species · INSDC / ENA`

  return (
    <div className="map-canvas atlas-grid">
      <DeckGL
        views={MAP_VIEW}
        initialViewState={INITIAL_VIEW_STATE}
        controller={true}
        layers={deckLayers}
        getTooltip={getTooltip}
        onHover={onHover}
        style={{ position: 'absolute', inset: '0', background: '#080e11' }}
      />
      {hoveredRow && pointer && <FlowTooltip row={hoveredRow} pointer={pointer} />}
      {totalCount == null && !error && (
        <div className="map-note" style={{ left: 25, right: 'auto' }}>
          Loading species flows…
        </div>
      )}
      {error && (
        <div className="map-note" style={{ left: 25, right: 'auto', color: 'var(--amber)' }}>
          {error}
        </div>
      )}
      <div className="map-legend">
        <div>
          <span className="legend-dot amber" /> Collected
        </div>
        <div>
          <span className="legend-square blue" /> Submitted
        </div>
        <div>
          <span className="legend-line" /> Flow
        </div>
      </div>
      <div className="map-note">{mapNote}</div>
    </div>
  )
}
