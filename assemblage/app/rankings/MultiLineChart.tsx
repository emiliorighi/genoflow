'use client'

import { memo, useEffect, useMemo, useRef, useState } from 'react'

export type LineSeries = {
  id: string
  label: string
  color: string
  values: (number | null)[]
}

const DEFAULT_W = 480
const H = 170
const PAD = { top: 8, right: 16, bottom: 22, left: 48 }
const PLOT_H = H - PAD.top - PAD.bottom

function niceMax(value: number): number {
  if (value <= 0) return 1
  const pow = 10 ** Math.floor(Math.log10(value))
  const f = value / pow
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow
}

type MultiLineChartProps = {
  title: string
  years: number[]
  series: LineSeries[]
  /** Fixed y maximum (e.g. 100 for percentages); otherwise derived from the data. */
  yMax?: number
  formatValue: (value: number) => string
  /** Plot on a log(1 + v) axis so zeros stay drawable. */
  logScale?: boolean
  /** Symmetric axis around 0 for signed values (e.g. log ratios). */
  diverging?: boolean
  /** Plain-language description of the chart under the current options. */
  help?: string
}

function MultiLineChart({ title, years, series, yMax, formatValue, logScale = false, diverging = false, help }: MultiLineChartProps) {
  const [hover, setHover] = useState<number | null>(null)
  // Draw in real pixels (viewBox = rendered width) so axis text keeps its CSS size.
  const frameRef = useRef<HTMLDivElement>(null)
  const [W, setW] = useState(DEFAULT_W)
  useEffect(() => {
    const el = frameRef.current
    if (!el) return
    const update = () => setW(Math.max(260, Math.round(el.clientWidth)))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const PLOT_W = W - PAD.left - PAD.right

  const max = useMemo(() => {
    if (yMax != null) return yMax
    let m = 0
    for (const s of series)
      for (const v of s.values) {
        const a = v == null ? 0 : diverging ? Math.abs(v) : v
        if (a > m) m = a
      }
    return niceMax(m)
  }, [series, yMax, diverging])

  const n = years.length
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * PLOT_W : 0)
  const tf = (v: number) => (logScale ? Math.log10(1 + v) : v)
  const y = (v: number) =>
    diverging ? ((max - v) / (2 * max)) * PLOT_H : PLOT_H - (tf(v) / tf(max)) * PLOT_H

  const paths = useMemo(
    () =>
      series.map((s) => {
        let d = ''
        let pen = false
        s.values.forEach((v, i) => {
          if (v == null) {
            pen = false
            return
          }
          d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `
          pen = true
        })
        return d
      }),
    // x/y close over n and max
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series, n, max, PLOT_W, logScale, diverging],
  )

  const ticks = useMemo(() => {
    if (diverging) return [-max, -max / 2, 0, max / 2, max]
    if (!logScale) return [0, 0.25, 0.5, 0.75, 1].map((f) => f * max)
    const t = [0]
    for (let v = 1; v < max; v *= 10) t.push(v)
    t.push(max)
    return t
  }, [logScale, max, diverging])
  const xTicks = years.filter(
    (yr, i) => i === 0 || i === n - 1 || (yr % 5 === 0 && n - 1 - i >= 3),
  )

  const hoverRows =
    hover == null
      ? []
      : series
          .map((s) => ({ s, v: s.values[hover] }))
          .filter((r): r is { s: LineSeries; v: number } => r.v != null)
          .sort((a, b) => b.v - a.v)

  return (
    <figure className="time-chart">
      <figcaption>{title}</figcaption>
      <div className="time-chart-frame" ref={frameRef}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`${title}, ${years[0]} to ${years[n - 1]}`}
          onPointerLeave={() => setHover(null)}
          onPointerMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            const px = ((event.clientX - rect.left) / rect.width) * W - PAD.left
            setHover(Math.max(0, Math.min(n - 1, Math.round((px / PLOT_W) * (n - 1)))))
          }}
        >
          <g transform={`translate(${PAD.left} ${PAD.top})`}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={0} x2={PLOT_W} y1={y(t)} y2={y(t)} className="chart-grid" />
                <text x={-7} y={y(t) + 3} textAnchor="end" className="chart-axis-text">
                  {formatValue(t)}
                </text>
              </g>
            ))}
            {diverging && (
              <line x1={0} x2={PLOT_W} y1={y(0)} y2={y(0)} stroke="var(--dim)" strokeWidth={1} />
            )}
            {xTicks.map((yr) => (
              <text
                key={yr}
                x={x(years.indexOf(yr))}
                y={PLOT_H + 16}
                textAnchor="middle"
                className="chart-axis-text"
              >
                {yr}
              </text>
            ))}
            {series.map((s, i) => (
              <path key={s.id} d={paths[i]} fill="none" stroke={s.color} className="time-chart-line" />
            ))}
            {hover != null && (
              <line x1={x(hover)} x2={x(hover)} y1={0} y2={PLOT_H} className="time-chart-cursor" />
            )}
            {hover != null &&
              hoverRows.map(({ s, v }) => (
                <circle key={s.id} cx={x(hover)} cy={y(v)} r={3.5} fill={s.color} className="time-chart-dot" />
              ))}
          </g>
        </svg>
        {hover != null && (
          <div
            className="time-chart-tip"
            style={{
              left: `${((PAD.left + x(hover)) / W) * 100}%`,
              transform: hover > n / 2 ? 'translateX(calc(-100% - 10px))' : 'translateX(10px)',
            }}
          >
            <b>{years[hover]}</b>
            {hoverRows.length === 0 && <span className="time-chart-tip-empty">Not enough data</span>}
            {hoverRows.map(({ s, v }) => (
              <span key={s.id} className="time-chart-tip-row">
                <i style={{ background: s.color }} />
                {s.label}
                <em>{formatValue(v)}</em>
              </span>
            ))}
          </div>
        )}
      </div>
      {help && <p className="time-chart-help">{help}</p>}
    </figure>
  )
}

export default memo(MultiLineChart)
