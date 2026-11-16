import Link from 'next/link'
import { buildMapHref } from '../map/types'
import type { LandingCharts } from './chartTypes'

export default function TaxonCoverageBars({ classes }: { classes: LandingCharts['classes'] }) {
  const rows = classes.items
  const max = Math.max(...rows.map((r) => r.species), classes.other.species, 1)

  const bar = (species: number, fullFlow: number) => (
    <span className="taxon-bar" style={{ width: `${(species / max) * 100}%` }} aria-hidden="true">
      <span className="taxon-bar-full" style={{ width: `${species ? (fullFlow / species) * 100 : 0}%` }} />
    </span>
  )

  return (
    <div className="taxon-bars">
      <ul className="taxon-bar-list">
        {rows.map((row) => (
          <li key={row.taxid}>
            <Link
              href={buildMapHref({ rank: classes.rank, taxon: row.taxid })}
              className="taxon-bar-row"
              title={`${row.name}: ${row.species.toLocaleString()} species, ${row.fullFlow.toLocaleString()} with a full flow. Open on the map.`}
            >
              <span className="taxon-bar-name">{row.name}</span>
              {bar(row.species, row.fullFlow)}
              <span className="taxon-bar-count">{row.species.toLocaleString()}</span>
            </Link>
          </li>
        ))}
        <li>
          <div className="taxon-bar-row is-other">
            <span className="taxon-bar-name">Other classes</span>
            {bar(classes.other.species, classes.other.fullFlow)}
            <span className="taxon-bar-count">{classes.other.species.toLocaleString()}</span>
          </div>
        </li>
      </ul>
      <div className="taxon-legend" aria-hidden="true">
        <span><i className="is-full" />Full flow (collection + institute)</span>
        <span><i className="is-partial" />Collection only</span>
      </div>
    </div>
  )
}
