'use client'

import { CircleHelp } from 'lucide-react'
import {
  DESTINATION_UNRESOLVED,
  type DestinationContinentGroup,
  type DestinationMode,
} from './exploreData'

type DestinationBarsProps = {
  regionLabel: string
  total: number
  /** Collected rows in scope whose sequencing institute could not be placed. */
  unknownPlaceCount: number
  mode: DestinationMode
  groups: DestinationContinentGroup[]
  onSelectInstitute: (key: string) => void
}

const UNRESOLVED_PARENT_TIP =
  'Assemblies whose submitting institute has no known continent in the metadata.'
const UNRESOLVED_COUNTRY_TIP =
  'Assemblies whose submitting institute country is missing or unknown.'
const UNRESOLVED_INSTITUTE_TIP =
  'Assemblies whose submitting institute could not be identified.'
const UNKNOWN_PLACE_TIP =
  'Assemblies collected in this scope whose sequencing institute could not be placed.'

function UnknownPlaceRow({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <div className="dest-meta dest-unknown-place">
      <span className="dest-label">
        <span className="legend-dot amber" aria-hidden="true" />
        <span className="dest-label-main">Sequencing place unknown</span>
        <DestHelpTip text={UNKNOWN_PLACE_TIP} />
      </span>
      <span className="dest-stats">
        <b>{count.toLocaleString()}</b>
      </span>
    </div>
  )
}

function pctOf(part: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((1000 * part) / total) / 10
}

function formatPct(part: number, total: number): string {
  return `${pctOf(part, total)}%`
}

function DestHelpTip({ text }: { text: string }) {
  // Span (not button): may sit inside institute row <button> or <summary>.
  return (
    <span
      className="dest-help"
      title={text}
      role="img"
      aria-label={text}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      onMouseDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      <CircleHelp size={12} aria-hidden="true" />
    </span>
  )
}

function ChildRowContent({
  label,
  country,
  count,
  total,
  tipFullName,
  helpTip,
}: {
  label: string
  country?: string | null
  count: number
  total: number
  tipFullName?: boolean
  helpTip?: string
}) {
  const childPct = pctOf(count, total)
  return (
    <>
      <div className="dest-meta">
        <span
          className="dest-label"
          title={tipFullName ? label : undefined}
        >
          <span className="dest-label-main">{label}</span>
          {country ? (
            <span className="dest-label-sub"> ({country})</span>
          ) : null}
          {helpTip ? <DestHelpTip text={helpTip} /> : null}
        </span>
        <span className="dest-stats">
          <b>{count.toLocaleString()}</b>
          <span>{formatPct(count, total)}</span>
        </span>
      </div>
      <div className="dest-bar-track thin" aria-hidden="true">
        <div
          className="dest-bar-fill country"
          style={{ width: `${Math.min(100, childPct)}%` }}
        />
      </div>
    </>
  )
}

export default function DestinationBars({
  regionLabel,
  total,
  unknownPlaceCount,
  mode,
  groups,
  onSelectInstitute,
}: DestinationBarsProps) {
  if ((total <= 0 || groups.length === 0) && unknownPlaceCount <= 0) {
    return (
      <div className="dest-empty">
        <p>No sequencing destinations in this scope.</p>
      </div>
    )
  }

  if (total <= 0 || groups.length === 0) {
    return (
      <div
        className="dest-bars"
        role="group"
        aria-label={`Sequencing destinations for ${regionLabel}`}
      >
        <UnknownPlaceRow count={unknownPlaceCount} />
      </div>
    )
  }

  return (
    <div
      className="dest-bars"
      role="group"
      aria-label={`Sequencing destinations for ${regionLabel}${
        mode === 'institute' ? ' by institute' : ''
      }`}
    >
      <ul className="dest-list">
        {groups.map((group) => {
          const continentPct = pctOf(group.total, total)
          const parentUnresolved = group.continent === DESTINATION_UNRESOLVED
          return (
            <li key={group.continent} className="dest-continent">
              <details open>
                <summary className="dest-continent-summary">
                  <div className="dest-meta">
                    <span className="dest-label">
                      <span className="dest-label-main">{group.continent}</span>
                      {parentUnresolved ? (
                        <DestHelpTip text={UNRESOLVED_PARENT_TIP} />
                      ) : null}
                    </span>
                    <span className="dest-stats">
                      <b>{group.total.toLocaleString()}</b>
                      <span>{formatPct(group.total, total)}</span>
                    </span>
                  </div>
                  <div
                    className="dest-bar-track"
                    aria-hidden="true"
                    title={`${group.continent}: ${continentPct}% of scope`}
                  >
                    <div
                      className="dest-bar-fill continent"
                      style={{ width: `${Math.min(100, continentPct)}%` }}
                    />
                  </div>
                </summary>
                <ul className="dest-countries">
                  {group.children.map((child) => {
                    const clickable = mode === 'institute'
                    const tipFullName = mode === 'institute'
                    const childUnresolved =
                      child.label === DESTINATION_UNRESOLVED ||
                      child.key === DESTINATION_UNRESOLVED
                    const helpTip = childUnresolved
                      ? mode === 'institute'
                        ? UNRESOLVED_INSTITUTE_TIP
                        : UNRESOLVED_COUNTRY_TIP
                      : undefined
                    return (
                      <li
                        key={`${group.continent}:${child.key}`}
                        className="dest-country"
                      >
                        {clickable ? (
                          <button
                            type="button"
                            className="dest-country-btn"
                            onClick={() => onSelectInstitute(child.key)}
                          >
                            <ChildRowContent
                              label={child.label}
                              country={child.country}
                              count={child.count}
                              total={total}
                              tipFullName={tipFullName}
                              helpTip={helpTip}
                            />
                          </button>
                        ) : (
                          <div>
                            <ChildRowContent
                              label={child.label}
                              country={child.country}
                              count={child.count}
                              total={total}
                              tipFullName={tipFullName}
                              helpTip={helpTip}
                            />
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </details>
            </li>
          )
        })}
      </ul>
      <UnknownPlaceRow count={unknownPlaceCount} />
    </div>
  )
}
