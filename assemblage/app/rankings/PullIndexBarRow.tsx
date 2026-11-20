'use client'

import Link from 'next/link'
import type { RegionCard } from '../map/explore/exploreData'
import {
  collectedCount,
  formatPullIndex,
  mapHrefForCard,
  pullIndex,
  sequencedCount,
} from '../map/explore/pullIndex'

type PullIndexBarRowProps = {
  card: RegionCard
  /** Shared max for sequenced and collected so left/right lengths are comparable. */
  maxCount: number
}

export default function PullIndexBarRow({ card, maxCount }: PullIndexBarRowProps) {
  const sequenced = sequencedCount(card)
  const collected = collectedCount(card)
  const pullLabel = formatPullIndex(pullIndex(card))

  const sequencedWidth =
    maxCount > 0 ? Math.min(100, (100 * sequenced) / maxCount) : 0
  const collectedWidth =
    maxCount > 0 ? Math.min(100, (100 * collected) / maxCount) : 0

  const localShare = sequenced > 0 ? (100 * card.local) / sequenced : 0
  const importedShare = sequenced > 0 ? (100 * card.imported) / sequenced : 0

  const kept = card.local + card.unknown
  const keptShare = collected > 0 ? (100 * kept) / collected : 0
  const exportedShare = collected > 0 ? (100 * card.exported) / collected : 0

  return (
    <Link
      href={mapHrefForCard(card)}
      className="pull-rank-row"
      title={`${card.name} · pull ${pullLabel}`}
    >
      <div className="pull-rank-track is-collected">
        <span
          className="pull-rank-parts"
          aria-label={`Exported ${card.exported.toLocaleString()}, kept ${kept.toLocaleString()}`}
        >
          <span className="pull-rank-part is-exported">
            {card.exported.toLocaleString()}
          </span>
          <span className="pull-rank-parts-sep" aria-hidden="true">
            ·
          </span>
          <span className="pull-rank-part is-kept">
            {kept.toLocaleString()}
          </span>
        </span>
        <div
          className="pull-rank-stack is-collected"
          style={{ width: `${collectedWidth}%` }}
        >
          {exportedShare > 0 ? (
            <span
              className="pull-rank-seg is-exported"
              style={{ flexGrow: exportedShare, flexBasis: 0 }}
            />
          ) : null}
          {keptShare > 0 ? (
            <span
              className="pull-rank-seg is-kept"
              style={{ flexGrow: keptShare, flexBasis: 0 }}
            />
          ) : null}
        </div>
      </div>

      <div className="pull-rank-axis">
        <span className="pull-rank-name">{card.name}</span>
        <span className="pull-rank-pull">{pullLabel}</span>
      </div>

      <div className="pull-rank-track is-sequenced">
        <div
          className="pull-rank-stack is-sequenced"
          style={{ width: `${sequencedWidth}%` }}
        >
          {localShare > 0 ? (
            <span
              className="pull-rank-seg is-local"
              style={{ flexGrow: localShare, flexBasis: 0 }}
            />
          ) : null}
          {importedShare > 0 ? (
            <span
              className="pull-rank-seg is-imported"
              style={{ flexGrow: importedShare, flexBasis: 0 }}
            />
          ) : null}
        </div>
        <span
          className="pull-rank-parts"
          aria-label={`Local ${card.local.toLocaleString()}, imported ${card.imported.toLocaleString()}`}
        >
          <span className="pull-rank-part is-local">
            {card.local.toLocaleString()}
          </span>
          <span className="pull-rank-parts-sep" aria-hidden="true">
            ·
          </span>
          <span className="pull-rank-part is-imported">
            {card.imported.toLocaleString()}
          </span>
        </span>
      </div>
    </Link>
  )
}
