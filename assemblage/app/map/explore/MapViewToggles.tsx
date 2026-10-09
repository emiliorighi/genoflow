'use client'

import {
  FLOW_PRESETS,
  FLOW_SLICES,
  FLOW_SLICE_LABELS,
  applyFlowPreset,
  matchingFlowPreset,
  toggleFlowSlice,
  type FlowSlice,
  type MapSliceSelection,
  type OutreachCounts,
} from './outreachFilter'

/** Collected-here flows share the collection color. Inbound sequencing uses submitted blue. */
const SLICE_CHECK: Record<FlowSlice, 'amber' | 'blue'> = {
  local: 'amber',
  exported: 'amber',
  unknown: 'amber',
  imported: 'blue',
}

type MapViewTogglesProps = {
  slices: MapSliceSelection
  counts: OutreachCounts
  onChange: (next: MapSliceSelection) => void
  /** Species currently plotted (active slice union). */
  activeCount: number
}

export default function MapViewToggles({
  slices,
  counts,
  onChange,
  activeCount,
}: MapViewTogglesProps) {
  const activePreset = matchingFlowPreset(slices)

  return (
    <div className="flow-slice-panel">
      <div className="section-label">Quick select</div>
      <div className="explore-tabs" role="group" aria-label="Quick select">
        {FLOW_PRESETS.map((preset) => {
          const active = activePreset === preset.id
          return (
            <button
              key={preset.id}
              type="button"
              className={`explore-tab ${active ? 'is-active' : ''}`}
              aria-pressed={active}
              onClick={() => onChange(applyFlowPreset(preset.id))}
            >
              {preset.label}
            </button>
          )
        })}
      </div>

      <div className="flow-slice-list" role="group" aria-label="Flows to show">
        {FLOW_SLICES.map((slice) => {
          const checked = slices[slice]
          return (
            <label
              key={slice}
              className={`explore-taxon-row flow-slice-row ${checked ? 'is-checked' : ''}`}
            >
              <input
                type="checkbox"
                className={`flow-slice-check is-${SLICE_CHECK[slice]}`}
                checked={checked}
                onChange={() => onChange(toggleFlowSlice(slices, slice))}
              />
              <span className="flow-slice-label">
                <span className="explore-taxon-name">{FLOW_SLICE_LABELS[slice]}</span>
              </span>
              <span className="explore-taxon-count">{counts[slice].toLocaleString()}</span>
            </label>
          )
        })}
      </div>

      <p className="explore-taxon-caption flow-slice-caption">
        Showing {activeCount.toLocaleString()} species
      </p>
    </div>
  )
}
