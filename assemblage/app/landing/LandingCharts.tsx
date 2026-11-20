import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import FlowSankey from './FlowSankey'
import GrowthChart from './GrowthChart'
import TaxonCoverageBars from './TaxonCoverageBars'
import type { LandingCharts as LandingChartsData } from './chartTypes'

export default function LandingCharts({
  charts,
  generatedAt,
  speciesInAtlas,
}: {
  charts: LandingChartsData
  generatedAt: string
  speciesInAtlas: number
}) {
  const snapshotYear = Number.parseInt(generatedAt.slice(0, 4), 10)
  const lastYear = charts.yearly[charts.yearly.length - 1]?.year
  const partialYear = lastYear != null && lastYear === snapshotYear ? snapshotYear : null

  return (
    <section className="about-section charts-section" id="data" aria-label="The data at a glance">
      <div className="section-intro">
        <h2>The data at a glance.</h2>
        <p>
          {speciesInAtlas.toLocaleString()} species in the atlas: when they arrived, where they
          went, and what they are.
        </p>
      </div>

      <div className="chart-grid-layout">
        <article className="chart-card">
          <header>
            <span className="card-kicker">01 / Growth</span>
            <h3>Atlas species by assembly release year.</h3>
            <p>Cumulative count, using the release date of each species&apos; displayed assembly.</p>
          </header>
          <GrowthChart yearly={charts.yearly} partialYear={partialYear} />
          <footer>
            {partialYear != null && <small>{partialYear} is year to date.</small>}
            <Link href="/map" className="card-link">
              Filter the map by year <ArrowUpRight size={14} />
            </Link>
          </footer>
        </article>

        <article className="chart-card">
          <header>
            <span className="card-kicker">02 / Taxa</span>
            <h3>What the atlas is made of.</h3>
            <p>Species per taxonomic class. Select one to open it on the map.</p>
          </header>
          <TaxonCoverageBars classes={charts.classes} />
        </article>
        <article className="chart-card is-wide">
          <header>
            <span className="card-kicker">03 / Flow</span>
            <h3>From where collected to where submitted.</h3>
            <p>Continent of collection against continent of the submitting institute.</p>
          </header>
          <FlowSankey links={charts.flow.links} unresolvedLabel={charts.flow.unresolvedLabel} />
          <footer>
            <small>&ldquo;Unresolved&rdquo;: no geocoded submitter institute.</small>
          </footer>
        </article>

      </div>
    </section>
  )
}
