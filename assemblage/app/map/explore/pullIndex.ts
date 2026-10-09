import type { RegionCard } from './exploreData'
import { buildMapHref } from '../types'

export type OutreachSliceCounts = Pick<
  RegionCard,
  'local' | 'exported' | 'unknown' | 'imported'
>

/** Species sequenced in the region (local + inbound). */
export function sequencedCount(card: OutreachSliceCounts): number {
  return card.local + card.imported
}

/** Species collected in the region (local + exported + unresolved submitter). */
export function collectedCount(card: OutreachSliceCounts): number {
  return card.local + card.exported + card.unknown
}

/**
 * Pull index: of species sequenced here, the fraction collected elsewhere.
 * Null when nothing is sequenced.
 */
export function pullIndex(card: OutreachSliceCounts): number | null {
  const sequenced = sequencedCount(card)
  if (sequenced <= 0) return null
  return card.imported / sequenced
}

export function formatPullIndex(value: number | null): string {
  if (value == null) return '—'
  return `${Math.round(1000 * value) / 10}%`
}

/** Highest pull first; nulls last; tie-break by name. */
export function sortCardsByPullIndex(cards: RegionCard[]): RegionCard[] {
  return [...cards].sort((a, b) => {
    const pa = pullIndex(a)
    const pb = pullIndex(b)
    if (pa == null && pb == null) return a.name.localeCompare(b.name)
    if (pa == null) return 1
    if (pb == null) return -1
    if (pb !== pa) return pb - pa
    return a.name.localeCompare(b.name)
  })
}

export function mapHrefForCard(card: RegionCard): string {
  if (card.kind === 'custom') {
    const customId = card.id.startsWith('custom:')
      ? card.id.slice('custom:'.length)
      : card.id
    return buildMapHref({ customId })
  }
  if (card.kind === 'continent') {
    return buildMapHref({ continent: card.name })
  }
  return buildMapHref({
    continent: card.continent,
    country: card.name,
  })
}
