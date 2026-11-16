import type { FlowLink } from './chartTypes'

const W = 760
const H = 360
const NODE_W = 12
const LABEL_W = 132
const PAD_TOP = 26
const PAD_BOTTOM = 8
const GAP = 8
const LEFT_X = LABEL_W
const RIGHT_X = W - LABEL_W - NODE_W

type Node = { name: string; total: number; y: number; h: number; offset: number }

const LABEL_STEP = 14

/** Vertical label positions: node centres, pushed apart so small nodes stay legible. */
function spreadLabels(nodes: Node[]): number[] {
  const ys = nodes.map((n) => n.y + n.h / 2)
  for (let i = 1; i < ys.length; i++) ys[i] = Math.max(ys[i], ys[i - 1] + LABEL_STEP)
  const overflow = ys.length ? ys[ys.length - 1] - (H - PAD_BOTTOM) : 0
  if (overflow > 0) {
    ys[ys.length - 1] -= overflow
    for (let i = ys.length - 2; i >= 0; i--) ys[i] = Math.min(ys[i], ys[i + 1] - LABEL_STEP)
  }
  return ys
}

function orderNodes(totals: Map<string, number>, lastName: string | null): string[] {
  return [...totals.keys()].sort((a, b) => {
    if (a === lastName) return 1
    if (b === lastName) return -1
    return totals.get(b)! - totals.get(a)!
  })
}

function layoutNodes(order: string[], totals: Map<string, number>, k: number): Map<string, Node> {
  const nodes = new Map<string, Node>()
  let y = PAD_TOP
  for (const name of order) {
    const total = totals.get(name)!
    const h = Math.max(total * k, 1.5)
    nodes.set(name, { name, total, y, h, offset: 0 })
    y += h + GAP
  }
  return nodes
}

export default function FlowSankey({
  links,
  unresolvedLabel,
}: {
  links: FlowLink[]
  unresolvedLabel: string
}) {
  if (links.length === 0) return null

  const sourceTotals = new Map<string, number>()
  const targetTotals = new Map<string, number>()
  let total = 0
  for (const link of links) {
    sourceTotals.set(link.source, (sourceTotals.get(link.source) ?? 0) + link.value)
    targetTotals.set(link.target, (targetTotals.get(link.target) ?? 0) + link.value)
    total += link.value
  }

  const sourceOrder = orderNodes(sourceTotals, 'Unknown')
  const targetOrder = orderNodes(targetTotals, unresolvedLabel)
  // One scale for both columns so ribbons keep their thickness end to end.
  const k = Math.min(
    (H - PAD_TOP - PAD_BOTTOM - GAP * (sourceOrder.length - 1)) / total,
    (H - PAD_TOP - PAD_BOTTOM - GAP * (targetOrder.length - 1)) / total,
  )
  const left = layoutNodes(sourceOrder, sourceTotals, k)
  const right = layoutNodes(targetOrder, targetTotals, k)

  const leftNodes = [...left.values()]
  const rightNodes = [...right.values()]
  const leftLabelY = spreadLabels(leftNodes)
  const rightLabelY = spreadLabels(rightNodes)

  const sourceRank = new Map(sourceOrder.map((n, i) => [n, i]))
  const targetRank = new Map(targetOrder.map((n, i) => [n, i]))

  // Stack ribbons inside each node in the order of the opposite column (fewer crossings).
  const bySource = [...links].sort(
    (a, b) => sourceRank.get(a.source)! - sourceRank.get(b.source)! || targetRank.get(a.target)! - targetRank.get(b.target)!,
  )
  const sourceY = new Map<FlowLink, number>()
  for (const link of bySource) {
    const node = left.get(link.source)!
    sourceY.set(link, node.y + node.offset)
    node.offset += link.value * k
  }
  const byTarget = [...links].sort(
    (a, b) => targetRank.get(a.target)! - targetRank.get(b.target)! || sourceRank.get(a.source)! - sourceRank.get(b.source)!,
  )
  const targetY = new Map<FlowLink, number>()
  for (const link of byTarget) {
    const node = right.get(link.target)!
    targetY.set(link, node.y + node.offset)
    node.offset += link.value * k
  }

  const x1 = LEFT_X + NODE_W
  const x2 = RIGHT_X
  const xm = (x1 + x2) / 2

  return (
    <div className="landing-chart-scroll">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="landing-chart-svg sankey-chart"
        role="img"
        aria-label="Flow of species from the continent where they were collected to the continent of the submitting institute. Details in the table below."
      >
        <defs>
          <linearGradient id="sankey-grad" gradientUnits="userSpaceOnUse" x1={x1} x2={x2} y1={0} y2={0}>
            <stop offset="0%" stopColor="var(--amber)" />
            <stop offset="100%" stopColor="var(--blue)" />
          </linearGradient>
        </defs>
        <text x={LEFT_X + NODE_W} y={10} className="chart-axis-text sankey-col-head">
          COLLECTED IN
        </text>
        <text x={RIGHT_X} y={10} textAnchor="end" className="chart-axis-text sankey-col-head">
          SUBMITTED FROM
        </text>
        {links.map((link) => {
          const h = Math.max(link.value * k, 0.4)
          const ya = sourceY.get(link)!
          const yb = targetY.get(link)!
          const d =
            `M${x1},${ya} C${xm},${ya} ${xm},${yb} ${x2},${yb} ` +
            `L${x2},${yb + h} C${xm},${yb + h} ${xm},${ya + h} ${x1},${ya + h} Z`
          return (
            <path key={`${link.source}>${link.target}`} d={d} className="sankey-link">
              <title>{`${link.source} → ${link.target}: ${link.value.toLocaleString()} species`}</title>
            </path>
          )
        })}
        {leftNodes.map((node, i) => (
          <g key={`l-${node.name}`}>
            <rect x={LEFT_X} y={node.y} width={NODE_W} height={node.h} className="sankey-node is-source" />
            <text x={LEFT_X - 8} y={leftLabelY[i] + 4} textAnchor="end" className="sankey-label">
              {node.name} <tspan className="sankey-count">{node.total.toLocaleString()}</tspan>
            </text>
          </g>
        ))}
        {rightNodes.map((node, i) => (
          <g key={`r-${node.name}`}>
            <rect
              x={RIGHT_X}
              y={node.y}
              width={NODE_W}
              height={node.h}
              className={`sankey-node ${node.name === unresolvedLabel ? 'is-unresolved' : 'is-target'}`}
            />
            <text x={RIGHT_X + NODE_W + 8} y={rightLabelY[i] + 4} className="sankey-label">
              {node.name} <tspan className="sankey-count">{node.total.toLocaleString()}</tspan>
            </text>
          </g>
        ))}
      </svg>
      <table className="sr-only">
        <caption>Species by collection continent and submitter continent</caption>
        <thead>
          <tr>
            <th>Collected in</th>
            <th>Submitted from</th>
            <th>Species</th>
          </tr>
        </thead>
        <tbody>
          {links.map((link) => (
            <tr key={`${link.source}>${link.target}`}>
              <td>{link.source}</td>
              <td>{link.target}</td>
              <td>{link.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
