'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { InstituteDetail, SpeciesDetail, regionTitle } from '../SidebarPanels'
import {
  type GeoFilter,
  type RegionFlow,
  type Selection,
} from '../types'
import type {
  CountryInstituteLink,
  CountryTotal,
  CoverageStats,
} from './regionData'
import { topInstitutesFromLinks } from './regionData'

const ALL_VALUE = '__all__'

type CountryOption = { country: string; continent: string; iso3: string | null }

function formatPct(value: number | null): string {
  if (value == null) return '—'
  return `${value}%`
}

function CoverageBlock({ coverage }: { coverage: CoverageStats }) {
  return (
    <section className="coverage-block">
      <div className="section-label">Sequencing coverage</div>
      <p className="coverage-note">
        Sequenced species in this scope vs. GBIF / iNaturalist eukaryote species counts
        for the same countries.
      </p>
      <div className="kpi-grid coverage-kpi-grid">
        <div className="kpi-card">
          <span>Sequenced</span>
          <b>{coverage.sequenced.toLocaleString()}</b>
          <small>INSDC assemblies</small>
        </div>
        <div className="kpi-card">
          <span>vs GBIF</span>
          <b>{coverage.gbif != null ? coverage.gbif.toLocaleString() : '—'}</b>
          <small>
            {coverage.gbifPct != null
              ? `${formatPct(coverage.gbifPct)} sequenced`
              : 'no GBIF count'}
          </small>
        </div>
        <div className="kpi-card">
          <span>vs iNat</span>
          <b>{coverage.inat != null ? coverage.inat.toLocaleString() : '—'}</b>
          <small>
            {coverage.inatPct != null
              ? `${formatPct(coverage.inatPct)} sequenced`
              : 'no iNat count'}
          </small>
        </div>
      </div>
    </section>
  )
}

function RegionSelector({
  geoFilter,
  continentOptions,
  countryOptions,
  onContinentChange,
  onCountryChange,
}: {
  geoFilter: GeoFilter
  continentOptions: string[]
  countryOptions: CountryOption[]
  onContinentChange: (value: string) => void
  onCountryChange: (value: string) => void
}) {
  return (
    <div className="region-selector" role="group" aria-label="Region selector">
      <span className="section-label">Region</span>
      <div className="region-selector-fields">
        <label className="fb-select-field">
          <span className="fb-select-label">Continent</span>
          <Select
            value={geoFilter.continent || ALL_VALUE}
            onValueChange={(value) => onContinentChange(!value || value === ALL_VALUE ? '' : value)}
          >
            <SelectTrigger className="fb-select-trigger" aria-label="Select continent">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>All continents</SelectItem>
              {continentOptions.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="fb-select-field">
          <span className="fb-select-label">Country</span>
          <Select
            value={geoFilter.country || ALL_VALUE}
            onValueChange={(value) => onCountryChange(!value || value === ALL_VALUE ? '' : value)}
          >
            <SelectTrigger className="fb-select-trigger" aria-label="Select country">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>All countries</SelectItem>
              {countryOptions.map((opt) => (
                <SelectItem key={opt.country} value={opt.country}>
                  {opt.country}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>
      {(geoFilter.continent || geoFilter.country) && (
        <button
          type="button"
          className="region-clear-link"
          onClick={() => {
            onContinentChange('')
          }}
        >
          Clear region
        </button>
      )}
    </div>
  )
}

function OverviewPanel({
  title,
  coverage,
  links,
  countryTotals,
  geoFilter,
  onSelectInstitute,
  onSelectCountry,
}: {
  title: string
  coverage: CoverageStats
  links: CountryInstituteLink[]
  countryTotals: CountryTotal[]
  geoFilter: GeoFilter
  onSelectInstitute: (key: string) => void
  onSelectCountry: (iso3: string, country: string, continent: string) => void
}) {
  const topInstitutes = topInstitutesFromLinks(links, 8)
  const showCountryList = Boolean(geoFilter.continent && !geoFilter.country)

  return (
    <div className="region-panel">
      <div className="region-title">
        <span className="detail-kicker">Region overview</span>
        <h2>{title}</h2>
        <p>{coverage.sequenced.toLocaleString()} sequenced species in scope</p>
      </div>
      <CoverageBlock coverage={coverage} />
      <section className="rank-block">
        <div className="section-label">Top submitter institutes</div>
        {topInstitutes.length === 0 ? (
          <p className="rank-empty">No resolved institutes in this scope.</p>
        ) : (
          <ol className="rank-list">
            {topInstitutes.map((item, index) => (
              <li key={item.key}>
                <button
                  type="button"
                  className="rank-row"
                  onClick={() => onSelectInstitute(item.key)}
                >
                  <span className="rank-index">{index + 1}</span>
                  <span className="rank-label">{item.label}</span>
                  <span className="rank-count">{item.count.toLocaleString()}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section className="rank-block">
        <div className="section-label">Top country → institute links</div>
        {links.length === 0 ? (
          <p className="rank-empty">No country–institute links in this scope.</p>
        ) : (
          <ol className="rank-list">
            {links.slice(0, 8).map((link, index) => (
              <li key={`${link.countryIso3}::${link.instituteKey}`}>
                <button
                  type="button"
                  className="rank-row"
                  onClick={() => onSelectInstitute(link.instituteKey)}
                >
                  <span className="rank-index">{index + 1}</span>
                  <span className="rank-label">
                    {link.countryName}
                    <span className="rank-sub"> → {link.instituteName}</span>
                  </span>
                  <span className="rank-count">{link.count.toLocaleString()}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>
      {showCountryList && (
        <section className="rank-block">
          <div className="section-label">Countries in {geoFilter.continent}</div>
          <ol className="rank-list">
            {countryTotals.map((t, index) => (
              <li key={t.iso3}>
                <button
                  type="button"
                  className="rank-row"
                  onClick={() => onSelectCountry(t.iso3, t.countryName, t.continent)}
                >
                  <span className="rank-index">{index + 1}</span>
                  <span className="rank-label">{t.countryName}</span>
                  <span className="rank-count">{t.total.toLocaleString()}</span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  )
}

export type RegionSidebarProps = {
  geoFilter: GeoFilter
  continentOptions: string[]
  countryOptions: CountryOption[]
  onContinentChange: (value: string) => void
  onCountryChange: (value: string) => void
  coverage: CoverageStats
  links: CountryInstituteLink[]
  countryTotals: CountryTotal[]
  selection: Selection
  selectedSpeciesRow: RegionFlow | null
  selectedInstituteRows: RegionFlow[]
  onSelect: (selection: Selection) => void
  onClearSelection: () => void
}

export default function RegionSidebar({
  geoFilter,
  continentOptions,
  countryOptions,
  onContinentChange,
  onCountryChange,
  coverage,
  links,
  countryTotals,
  selection,
  selectedSpeciesRow,
  selectedInstituteRows,
  onSelect,
  onClearSelection,
}: RegionSidebarProps) {
  const title = regionTitle(geoFilter)

  if (selectedSpeciesRow) {
    return (
      <SpeciesDetail
        row={selectedSpeciesRow}
        regionLabel={title}
        onBack={onClearSelection}
        onClear={onClearSelection}
        onSelectInstitute={(key) => onSelect({ type: 'institute', key })}
      />
    )
  }

  if (selection?.type === 'institute' && selectedInstituteRows.length > 0) {
    return (
      <InstituteDetail
        keyName={selection.key}
        rows={selectedInstituteRows}
        regionLabel={title}
        onBack={onClearSelection}
        onClear={onClearSelection}
        onSelectSpecies={(taxid) => onSelect({ type: 'species', taxid })}
      />
    )
  }

  return (
    <>
      <RegionSelector
        geoFilter={geoFilter}
        continentOptions={continentOptions}
        countryOptions={countryOptions}
        onContinentChange={onContinentChange}
        onCountryChange={onCountryChange}
      />
      <OverviewPanel
        title={title}
        coverage={coverage}
        links={links}
        countryTotals={countryTotals}
        geoFilter={geoFilter}
        onSelectInstitute={(key) => onSelect({ type: 'institute', key })}
        onSelectCountry={(_iso3, country) => {
          onCountryChange(country)
        }}
      />
    </>
  )
}
