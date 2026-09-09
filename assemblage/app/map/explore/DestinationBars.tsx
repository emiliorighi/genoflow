'use client'

import {
  DESTINATION_OTHER_KEY,
  type DestinationContinentGroup,
  type DestinationMode,
} from './exploreData'

type DestinationBarsProps = {
  regionLabel: string
  total: number
  mode: DestinationMode
  groups: DestinationContinentGroup[]
  onSelectInstitute: (key: string) => void
}

function pctOf(part: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((1000 * part) / total) / 10
}

function formatPct(part: number, total: number): string {
  return `${pctOf(part, total)}%`
}

function ChildRowContent({
  label,
  country,
  count,
  total,
  tipFullName,
}: {
  label: string
  country?: string | null
  count: number
  total: number
  tipFullName?: boolean
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
  mode,
  groups,
  onSelectInstitute,
}: DestinationBarsProps) {
  if (total <= 0 || groups.length === 0) {
    return (
      <div className="dest-empty">
        <p>No sequencing destinations in this scope.</p>
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
          return (
            <li key={group.continent} className="dest-continent">
              <details open>
                <summary className="dest-continent-summary">
                  <div className="dest-meta">
                    <span className="dest-label">{group.continent}</span>
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
                    const clickable =
                      mode === 'institute' && child.key !== DESTINATION_OTHER_KEY
                    const tipFullName =
                      mode === 'institute' && child.key !== DESTINATION_OTHER_KEY
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
    </div>
  )
}
