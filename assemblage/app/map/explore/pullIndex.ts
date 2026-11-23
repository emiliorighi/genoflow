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
 * Retention index: log2 of (collected here, sequenced here) / (collected here, sequenced elsewhere).
 * Above 0 a place mostly sequences its own species; below 0 it mostly sends them abroad.
 * Species with an unknown sequencing place are left out. Null when either side is 0.
 */
export function retentionIndex(card: OutreachSliceCounts): number | null {
  if (card.local <= 0 || card.exported <= 0) return null
  return Math.log2(card.local / card.exported)
}

export function formatRetentionIndex(value: number | null): string {
  if (value == null) return '—'
  const rounded = Math.round(100 * value) / 100
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(2)}`
}

/** Highest retention first; nulls last; tie-break by name. */
export function sortCardsByRetentionIndex(cards: RegionCard[]): RegionCard[] {
  return [...cards].sort((a, b) => {
    const pa = retentionIndex(a)
    const pb = retentionIndex(b)
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
