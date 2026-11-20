import { Network } from 'lucide-react'
import type { RegionFlow } from './types'

export const INFERRED_HINT =
  'Inferred from the BioProject (consortium), not from the assembly submitter. Not 100% certain.'

export function inferredMessage(row: RegionFlow): string {
  const parts = [INFERRED_HINT]
  if (row.institute_inferred_confidence) parts.push(`Confidence: ${row.institute_inferred_confidence}.`)
  if (row.institute_inferred_evidence) parts.push(row.institute_inferred_evidence)
  return parts.join(' ')
}

/** Badge for rows whose institute comes from BioProject inference rather than the submitter. */
export default function InferredChip({
  row,
  label = 'Inferred (BioProject)',
}: {
  row: RegionFlow
  label?: string
}) {
  if (!row.institute_inferred) return null
  return (
    <span className="inferred-chip" title={inferredMessage(row)}>
      <Network size={9} aria-hidden="true" />
      {label}
    </span>
  )
}
