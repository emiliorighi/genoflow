'use client'

import { CircleHelp } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  FLOW_SLICES,
  MAP_SHORTCUT_DESCRIPTIONS,
  MAP_SHORTCUT_LABELS,
  OUTREACH_MODE_DESCRIPTIONS,
  OUTREACH_MODE_LABELS,
  isCollectedShortcutOn,
  isSequencedShortcutOn,
  toggleMapShortcut,
  toggleMapSlice,
  type FlowSlice,
  type MapSliceSelection,
  type OutreachCounts,
} from './outreachFilter'

const MAP_VIEW_HELP =
  'These controls are interactive. Toggle Collected / Sequenced or Local / Exported / Imported to choose which flows appear on the map. At least one slice stays on.'

type MapViewTogglesProps = {
  slices: MapSliceSelection
  counts: Pick<OutreachCounts, 'local' | 'exported' | 'imported'>
  onChange: (next: MapSliceSelection) => void
  /** Species currently plotted (active slice union). */
  activeCount: number
  /** Active taxon label shown far-right on the header row (e.g. "Insecta"). */
  taxonLabel?: string
}

export default function MapViewToggles({
  slices,
  counts,
  onChange,
  activeCount,
  taxonLabel,
}: MapViewTogglesProps) {
  const collected = counts.local + counts.exported
  const sequenced = counts.local + counts.imported
  const collectedOn = isCollectedShortcutOn(slices)
  const sequencedOn = isSequencedShortcutOn(slices)

  return (
    <div className="map-view-toggles" role="group" aria-label="Map view">
      <div className="map-view-toggles-head">
        <div className="map-view-toggles-label-group">
          <span className="map-view-toggles-label">Map view</span>
          <TooltipProvider delay={200}>
            <Tooltip>
              <TooltipTrigger
                type="button"
                className="map-view-toggles-help"
                aria-label={MAP_VIEW_HELP}
              >
                <CircleHelp size={12} aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent side="top" align="start" className="map-view-toggles-tooltip">
                {MAP_VIEW_HELP}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        {taxonLabel ? (
          <p className="explore-map-taxon-kicker" title={taxonLabel}>
            for {taxonLabel}
          </p>
        ) : null}
      </div>

      <div className="map-view-toggles-row map-view-toggles-shortcuts" role="group" aria-label="Flow unions">
        <button
          type="button"
          className={`map-view-toggle map-view-toggle-shortcut ${collectedOn ? 'is-active' : ''}`}
          aria-pressed={collectedOn}
          title={MAP_SHORTCUT_DESCRIPTIONS.collected}
          onClick={() => onChange(toggleMapShortcut(slices, 'collected'))}
        >
          <span>{MAP_SHORTCUT_LABELS.collected}</span>
          <b>{collected.toLocaleString()}</b>
        </button>
        <button
          type="button"
          className={`map-view-toggle map-view-toggle-shortcut ${sequencedOn ? 'is-active' : ''}`}
          aria-pressed={sequencedOn}
          title={MAP_SHORTCUT_DESCRIPTIONS.sequenced}
          onClick={() => onChange(toggleMapShortcut(slices, 'sequenced'))}
        >
          <span>{MAP_SHORTCUT_LABELS.sequenced}</span>
          <b>{sequenced.toLocaleString()}</b>
        </button>
      </div>

      <div className="map-view-toggles-row map-view-toggles-slices" role="group" aria-label="Flow slices">
        {FLOW_SLICES.map((slice: FlowSlice) => (
          <button
            key={slice}
            type="button"
            className={`map-view-toggle map-view-toggle-slice map-view-toggle-${slice} ${slices[slice] ? 'is-active' : ''}`}
            aria-pressed={slices[slice]}
            title={OUTREACH_MODE_DESCRIPTIONS[slice]}
            onClick={() => onChange(toggleMapSlice(slices, slice))}
          >
            <span>{OUTREACH_MODE_LABELS[slice]}</span>
            <b>{counts[slice].toLocaleString()}</b>
          </button>
        ))}
      </div>

      <p className="map-view-toggles-caption">
        Showing {activeCount.toLocaleString()} species on the map
      </p>
    </div>
  )
}
