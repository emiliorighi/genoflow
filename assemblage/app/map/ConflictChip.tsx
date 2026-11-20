import { TriangleAlert } from 'lucide-react'
import type { RegionFlow } from './types'

/** Why a sample is flagged: the submitted country label vs where the coordinates fall. */
export function conflictMessage(row: RegionFlow): string {
  const label = row.collection_country_label || 'unknown'
  // The label was kept (open water far from that country): the point is not in another country.
  if (!row.collection_country || row.collection_country === row.collection_country_label) {
    return `Submitted as “${label}”, but the coordinates fall in open water far from it.`
  }
  return `Submitted as “${label}”, but the coordinates fall in ${row.collection_country}. Shown by coordinates.`
}

/** Small badge for rows whose country label disagrees with their coordinates. */
export default function ConflictChip({
  row,
  label = 'Country mismatch',
}: {
  row: RegionFlow
  label?: string
}) {
  if (!row.collection_label_conflict) return null
  return (
    <span className="conflict-chip" title={conflictMessage(row)}>
      <TriangleAlert size={9} aria-hidden="true" />
      {label}
    </span>
  )
}
