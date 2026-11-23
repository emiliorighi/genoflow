'use client'

import { CircleHelp } from 'lucide-react'
import { formatRetentionIndex, retentionIndex } from './pullIndex'
import {
  FLOW_SLICES,
  FLOW_SLICE_LABELS,
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

const PULL_INDEX_TIP =
  'log₂ of species collected here and sequenced here ÷ species collected here and sequenced elsewhere. Above 0: mostly sequenced at home. Below 0: mostly sent abroad.'

function PullIndexHelp() {
  return (
    <span
      className="dest-help"
      title={PULL_INDEX_TIP}
      role="img"
      aria-label={PULL_INDEX_TIP}
    >
      <CircleHelp size={12} aria-hidden="true" />
    </span>
  )
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
  const pullIndexLabel = formatRetentionIndex(retentionIndex(counts))

  return (
    <div className="flow-slice-panel">
      <div className="flow-slice-head">
        <div className="section-label">Flows</div>
        <div className="region-card-quiet-metrics pull-index-metrics">
          <span>Retention index</span>
          <span className="pull-index-value">{pullIndexLabel}</span>
          <PullIndexHelp />
        </div>
      </div>

      <div className="flow-slice-list" role="group" aria-label="Flows to show">
        {FLOW_SLICES.map((slice) => {
          const checked = slices[slice]
          return (
            <label key={slice} className="explore-taxon-row flow-slice-row">
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
