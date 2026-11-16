/** Shape of `charts` in public/data/landing-stats.json (see scripts/build_landing_stats.py). */
export type YearlyPoint = { year: number; species: number }

export type FlowLink = { source: string; target: string; value: number }

export type ClassItem = {
  taxid: string
  name: string
  species: number
  fullFlow: number
}

export type LandingCharts = {
  yearly: YearlyPoint[]
  flow: { unresolvedLabel: string; links: FlowLink[] }
  classes: {
    rank: 'class'
    items: ClassItem[]
    other: { species: number; fullFlow: number }
  }
}
