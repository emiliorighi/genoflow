'use client'

import { useCallback, useMemo, useState } from 'react'
import DeckGL from '@deck.gl/react'
import { ArcLayer, GeoJsonLayer, ScatterplotLayer } from '@deck.gl/layers'
import { MapView } from '@deck.gl/core'
import type { PickingInfo } from '@deck.gl/core'
import { LoaderCircle, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  EMPTY_GEO_FILTER,
  instituteKey,
  matchesGeoFilter,
  type GeoFilter,
  type RegionFlow,
  type Selection,
  type WorldFeature,
  type WorldGeoJson,
} from '../types'
import type { CountryCentroids } from '../regionData'
import {
  flowMatchesSelection,
  plotPositionKey,
  resolveCollectionPosition,
} from './exploreData'
import {
  customIso3SetForFilter,
  type CustomRegionId,
} from './customRegions'

export type ExploreLayers = {
  collection: boolean
  submitter: boolean
  flow: boolean
}

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
/** Region-card hover preview: keep context faintly visible. */
const PREVIEW_DIM_ALPHA = 10
/**
 * Species/institute selection: hide non-matching marks so stacked centroids
 * cannot re-opaque through additive blending.
 */
const SELECTION_DIM_ALPHA = 0

function withAlpha(
  color: [number, number, number, number],
  alpha: number,
): [number, number, number, number] {
  return [color[0], color[1], color[2], alpha]
}

type PlottedFlow = RegionFlow & {
  plot_lon: number
  plot_lat: number
  used_centroid: boolean
}

type ExploreMapProps = {
  filteredFlows: RegionFlow[]
  centroids: CountryCentroids | null
  world: WorldGeoJson | null
  error: string | null
  layers: ExploreLayers
  geoFilter: GeoFilter
  hoverPreview?: GeoFilter | null
  /** iso3 membership for custom regions (latin-america, etc.). */
  customIso3Sets?: Map<CustomRegionId, Set<string>> | null
  selection: Selection
  totalCount: number | null
  onSelect: (selection: Selection) => void
  onRetry: () => void
}

function selectionFromFlow(row: RegionFlow, preferInstitute: boolean): Selection {
  if (preferInstitute) {
    const key = instituteKey(row)
    if (key) return { type: 'institute', key }
  }
  if (row.species_taxid) return { type: 'species', taxid: row.species_taxid }
  return null
}

function isPlottedFlow(obj: unknown): obj is PlottedFlow {
  return Boolean(obj && typeof obj === 'object' && 'species_scientific_name' in obj && 'plot_lon' in obj)
}

function flowIdentity(row: RegionFlow): string {
  return `${row.species_taxid}::${instituteKey(row) ?? ''}`
}

function lineageParts(row: RegionFlow): string[] {
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
  row: PlottedFlow
  pointer: { x: number; y: number }
}) {
  const lineage = lineageParts(row)
  return (
    <div
      className="flow-tooltip"
      style={{ left: pointer.x + 14, top: pointer.y + 14 }}
      role="tooltip"
    >
      <span className="tooltip-kicker">
        {row.used_centroid ? 'Country-level flow' : 'Species flow'}
      </span>
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
    </div>
  )
}

export default function ExploreMap({
  filteredFlows,
  centroids,
  world,
  error,
  layers,
  geoFilter,
  hoverPreview = null,
  customIso3Sets = null,
  selection,
  totalCount,
  onSelect,
  onRetry,
}: ExploreMapProps) {
  const [hoveredRow, setHoveredRow] = useState<PlottedFlow | null>(null)
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)

  const plotted = useMemo(() => {
    const rows: PlottedFlow[] = []
    for (const row of filteredFlows) {
      const pos = resolveCollectionPosition(row, centroids)
      if (!pos) continue
      rows.push({
        ...row,
        plot_lon: pos[0],
        plot_lat: pos[1],
        used_centroid:
          row.collection_lat == null || row.collection_lon == null,
      })
    }
    return rows
  }, [filteredFlows, centroids])

  const pointGroups = useMemo(() => {
    const groups = new Map<string, PlottedFlow[]>()
    for (const row of plotted) {
      const key = plotPositionKey(row.plot_lon, row.plot_lat)
      const prev = groups.get(key)
      if (prev) prev.push(row)
      else groups.set(key, [row])
    }
    return groups
  }, [plotted])

  const withInstitute = useMemo(
    () => plotted.filter((row) => row.has_institute_coordinates),
    [plotted],
  )

  const selectedFlows = useMemo(() => {
    if (!selection) return [] as PlottedFlow[]
    return plotted.filter((row) => flowMatchesSelection(row, selection, centroids))
  }, [plotted, selection, centroids])

  const selectedWithInstitute = useMemo(
    () => selectedFlows.filter((row) => row.has_institute_coordinates),
    [selectedFlows],
  )

  const hasCommittedRegion = Boolean(
    geoFilter.continent || geoFilter.country || geoFilter.customId,
  )
  const activeGeo = hasCommittedRegion
    ? geoFilter
    : (hoverPreview ?? EMPTY_GEO_FILTER)

  const activeCustomIso3Set = useMemo(
    () => customIso3SetForFilter(activeGeo.customId, customIso3Sets),
    [activeGeo.customId, customIso3Sets],
  )

  const hoverCustomIso3Set = useMemo(
    () => customIso3SetForFilter(hoverPreview?.customId, customIso3Sets),
    [hoverPreview?.customId, customIso3Sets],
  )

  const highlightFeatures = useMemo(() => {
    if (!world) return null
    const { continent, country, countryIso3, customId } = activeGeo
    if (customId) {
      if (!activeCustomIso3Set || activeCustomIso3Set.size === 0) return null
      const features = world.features.filter((f) =>
        activeCustomIso3Set.has(f.properties.ISO_A3),
      )
      if (!features.length) return null
      return { type: 'FeatureCollection' as const, features }
    }
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
  }, [world, activeGeo, activeCustomIso3Set])

  const hasSelection = Boolean(selection)
  const selectionDimsOthers =
    selection?.type === 'species' || selection?.type === 'institute'
  // Preview dimming only in list mode (no committed region) and when no species/institute selection.
  const previewActive = Boolean(
    hoverPreview &&
      (hoverPreview.continent || hoverPreview.country || hoverPreview.customId) &&
      !hasCommittedRegion &&
      !hasSelection,
  )

  const flowIsFocused = (row: RegionFlow): boolean => {
    if (hasSelection) return flowMatchesSelection(row, selection, centroids)
    if (previewActive && hoverPreview) {
      return matchesGeoFilter(row, hoverPreview, hoverCustomIso3Set)
    }
    return true
  }

  const focusActive = hasSelection || previewActive
  const focusDimAlpha = selectionDimsOthers ? SELECTION_DIM_ALPHA : PREVIEW_DIM_ALPHA

  const hoveredIsSelected = Boolean(
    hasSelection && hoveredRow && flowMatchesSelection(hoveredRow, selection, centroids),
  )
  const showHover = Boolean(hoveredRow && !hoveredIsSelected && !previewActive)

  const selectCollectionPoint = useCallback(
    (row: PlottedFlow) => {
      const key = plotPositionKey(row.plot_lon, row.plot_lat)
      const group = pointGroups.get(key)
      if (group && group.length > 1) {
        onSelect({ type: 'point', lat: row.plot_lat, lon: row.plot_lon })
        return
      }
      onSelect(selectionFromFlow(row, false))
    },
    [pointGroups, onSelect],
  )

  const onHover = useCallback((info: PickingInfo) => {
    const obj = info.object
    if (isPlottedFlow(obj)) {
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
      const highlightKey =
        activeGeo.customId ??
        activeGeo.countryIso3 ??
        activeGeo.continent ??
        'none'
      built.push(
        new GeoJsonLayer({
          id: `highlight-area-${highlightKey}`,
          data: highlightFeatures,
          stroked: true,
          filled: true,
          pickable: false,
          getFillColor: HIGHLIGHT_FILL,
          getLineColor: HIGHLIGHT_LINE,
          lineWidthMinPixels: 1.5,
          parameters: BASEMAP_DEPTH,
        }),
      )
    }

    if (layers.flow) {
      built.push(
        new ArcLayer<PlottedFlow>({
          id: 'explore-flow-arcs',
          data: withInstitute,
          pickable: true,
          getSourcePosition: (d) => [d.plot_lon, d.plot_lat],
          getTargetPosition: (d) => [d.institute_lon as number, d.institute_lat as number],
          getSourceColor: (d) =>
            focusActive && !flowIsFocused(d)
              ? withAlpha(ARC_SOURCE_DEFAULT, focusDimAlpha)
              : ARC_SOURCE_DEFAULT,
          getTargetColor: (d) =>
            focusActive && !flowIsFocused(d)
              ? withAlpha(ARC_TARGET_DEFAULT, focusDimAlpha)
              : ARC_TARGET_DEFAULT,
          getWidth: 1.2,
          widthMinPixels: 1,
          greatCircle: true,
          parameters: NO_DEPTH,
          updateTriggers: {
            getSourceColor: [focusActive, focusDimAlpha, selection, hoverPreview, previewActive],
            getTargetColor: [focusActive, focusDimAlpha, selection, hoverPreview, previewActive],
          },
          onClick: (info: PickingInfo<PlottedFlow>) => {
            if (info.object) onSelect(selectionFromFlow(info.object, false))
          },
        }),
      )
    }

    if (layers.collection) {
      built.push(
        new ScatterplotLayer<PlottedFlow>({
          id: 'explore-collection-points',
          data: plotted,
          pickable: true,
          radiusUnits: 'pixels',
          radiusMinPixels: 2,
          radiusMaxPixels: 6,
          getPosition: (d) => [d.plot_lon, d.plot_lat],
          getRadius: (d) => (d.used_centroid ? 4 : 3),
          getFillColor: (d) =>
            focusActive && !flowIsFocused(d)
              ? withAlpha(AMBER, focusDimAlpha)
              : AMBER,
          getLineColor: (d) =>
            focusActive && !flowIsFocused(d)
              ? withAlpha(COLLECTION_LINE, focusDimAlpha)
              : COLLECTION_LINE,
          lineWidthMinPixels: 1,
          stroked: true,
          parameters: NO_DEPTH,
          updateTriggers: {
            getFillColor: [focusActive, focusDimAlpha, selection, hoverPreview, previewActive],
            getLineColor: [focusActive, focusDimAlpha, selection, hoverPreview, previewActive],
          },
          onClick: (info: PickingInfo<PlottedFlow>) => {
            if (info.object) selectCollectionPoint(info.object)
          },
        }),
      )
    }

    if (layers.submitter) {
      built.push(
        new ScatterplotLayer<PlottedFlow>({
          id: 'explore-institute-points',
          data: withInstitute,
          pickable: true,
          radiusUnits: 'pixels',
          radiusMinPixels: 2,
          radiusMaxPixels: 6,
          getPosition: (d) => [d.institute_lon as number, d.institute_lat as number],
          getRadius: 3,
          getFillColor: (d) =>
            focusActive && !flowIsFocused(d)
              ? withAlpha(BLUE, focusDimAlpha)
              : BLUE,
          getLineColor: (d) =>
            focusActive && !flowIsFocused(d)
              ? withAlpha(INSTITUTE_LINE, focusDimAlpha)
              : INSTITUTE_LINE,
          lineWidthMinPixels: 1,
          stroked: true,
          parameters: NO_DEPTH,
          updateTriggers: {
            getFillColor: [focusActive, focusDimAlpha, selection, hoverPreview, previewActive],
            getLineColor: [focusActive, focusDimAlpha, selection, hoverPreview, previewActive],
          },
          onClick: (info: PickingInfo<PlottedFlow>) => {
            if (info.object) onSelect(selectionFromFlow(info.object, true))
          },
        }),
      )
    }

    if (hasSelection && selectedWithInstitute.length && layers.flow) {
      built.push(
        new ArcLayer<PlottedFlow>({
          id: 'explore-selected-arcs',
          data: selectedWithInstitute,
          pickable: true,
          getSourcePosition: (d) => [d.plot_lon, d.plot_lat],
          getTargetPosition: (d) => [d.institute_lon as number, d.institute_lat as number],
          getSourceColor: AMBER_HOT,
          getTargetColor: BLUE_HOT,
          getWidth: 2.4,
          widthMinPixels: 2,
          greatCircle: true,
          parameters: NO_DEPTH,
          onClick: (info: PickingInfo<PlottedFlow>) => {
            if (info.object) onSelect(selectionFromFlow(info.object, false))
          },
        }),
      )
    }

    if (hasSelection && selectedFlows.length && layers.collection) {
      built.push(
        new ScatterplotLayer<PlottedFlow>({
          id: 'explore-selected-collection',
          data: selectedFlows,
          pickable: true,
          radiusUnits: 'pixels',
          radiusMinPixels: 4,
          radiusMaxPixels: 10,
          getPosition: (d) => [d.plot_lon, d.plot_lat],
          getRadius: 5,
          getFillColor: AMBER_HOT,
          getLineColor: [255, 230, 200, 255],
          lineWidthMinPixels: 1.5,
          stroked: true,
          parameters: NO_DEPTH,
          onClick: (info: PickingInfo<PlottedFlow>) => {
            if (info.object) selectCollectionPoint(info.object)
          },
        }),
      )
    }

    if (hasSelection && selectedWithInstitute.length && layers.submitter) {
      built.push(
        new ScatterplotLayer<PlottedFlow>({
          id: 'explore-selected-institutes',
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
          onClick: (info: PickingInfo<PlottedFlow>) => {
            if (info.object) onSelect(selectionFromFlow(info.object, true))
          },
        }),
      )
    }

    if (showHover && hoveredRow) {
      if (hoveredRow.has_institute_coordinates && layers.flow) {
        built.push(
          new ArcLayer<PlottedFlow>({
            id: 'explore-hover-arc',
            data: [hoveredRow],
            pickable: false,
            getSourcePosition: (d) => [d.plot_lon, d.plot_lat],
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
          new ScatterplotLayer<PlottedFlow>({
            id: 'explore-hover-collection',
            data: [hoveredRow],
            pickable: false,
            radiusUnits: 'pixels',
            radiusMinPixels: 4,
            radiusMaxPixels: 10,
            getPosition: (d) => [d.plot_lon, d.plot_lat],
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
          new ScatterplotLayer<PlottedFlow>({
            id: 'explore-hover-institute',
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
    activeGeo,
    plotted,
    withInstitute,
    layers,
    hasSelection,
    focusActive,
    focusDimAlpha,
    previewActive,
    hoverPreview,
    selection,
    selectedFlows,
    selectedWithInstitute,
    showHover,
    hoveredRow,
    onSelect,
    selectCollectionPoint,
    hoverCustomIso3Set,
    centroids,
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
    ? `Showing ${selectedFlows.length.toLocaleString()} related record${selectedFlows.length === 1 ? '' : 's'} · Esc or click empty map to clear`
    : `${plotted.length.toLocaleString()} species · precise + country centroids`

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
      {hoveredRow && pointer && <FlowTooltip row={hoveredRow} pointer={pointer} />}
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
