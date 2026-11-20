import { cumulativeAreaPaths } from '../map/explore/yearRange'
import type { YearlyPoint } from './chartTypes'

const W = 440
const H = 300
const PAD = { top: 14, right: 18, bottom: 28, left: 48 }
const PLOT_W = W - PAD.left - PAD.right
const PLOT_H = H - PAD.top - PAD.bottom

/** 1/2/2.5/5 × 10ⁿ step giving roughly `target` gridlines. */
function niceStep(total: number, target = 5): number {
  const raw = total / target
  const pow = 10 ** Math.floor(Math.log10(raw))
  const f = raw / pow
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow
}

export default function GrowthChart({
  yearly,
  partialYear,
}: {
  yearly: YearlyPoint[]
  /** Calendar year of the data snapshot; flagged as year-to-date when it is the last point. */
  partialYear: number | null
}) {
  const cumulative: number[] = []
  let running = 0
  for (const point of yearly) {
    running += point.species
    cumulative.push(running)
  }
  const paths = cumulativeAreaPaths(cumulative, PLOT_W, PLOT_H)
  if (!paths) return null

  const total = paths.total
  const first = yearly[0].year
  const last = yearly[yearly.length - 1].year
  const colW = PLOT_W / (yearly.length - 1)
  const yFor = (value: number) => PLOT_H - 1 - (value / total) * (PLOT_H - 3)

  const step = niceStep(total)
  const ticks: number[] = []
  for (let v = 0; v <= total; v += step) ticks.push(v)

  const xTicks = yearly.map((p) => p.year).filter((y) => y % 5 === 0 || y === first)
  const endX = PLOT_W
  const endY = yFor(total)

  return (
    <div className="landing-chart-scroll">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="landing-chart-svg growth-chart"
        role="img"
        aria-label={`Cumulative atlas species by assembly release year, ${first} to ${last}, reaching ${total.toLocaleString()}.`}
      >
        <g transform={`translate(${PAD.left} ${PAD.top})`}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={0} x2={PLOT_W} y1={yFor(v)} y2={yFor(v)} className="chart-grid" />
              <text x={-8} y={yFor(v) + 3} textAnchor="end" className="chart-axis-text">
                {v === 0 ? '0' : v.toLocaleString()}
              </text>
            </g>
          ))}
          <path d={paths.area} className="growth-area" />
          <path d={paths.line} className="growth-line" />
          {xTicks.map((year) => (
            <text
              key={year}
              x={((year - first) / (last - first)) * PLOT_W}
              y={PLOT_H + 18}
              textAnchor={year === first ? 'start' : 'middle'}
              className="chart-axis-text"
            >
              {year}
            </text>
          ))}
          <circle cx={endX} cy={endY} r={3.5} className="growth-dot" />
          <text x={endX - 8} y={endY - 4} textAnchor="end" className="growth-end-label">
            {total.toLocaleString()} species
          </text>
          {yearly.map((point, i) => (
            <rect
              key={point.year}
              x={Math.max(i * colW - colW / 2, 0)}
              y={0}
              width={i === 0 || i === yearly.length - 1 ? colW / 2 : colW}
              height={PLOT_H}
              className="chart-hit"
            >
              <title>
                {`${point.year}${partialYear === point.year ? ' (year to date)' : ''}: +${point.species.toLocaleString()} species · ${cumulative[i].toLocaleString()} cumulative`}
              </title>
            </rect>
          ))}
        </g>
      </svg>
    </div>
  )
}
