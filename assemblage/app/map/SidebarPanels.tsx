'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, ChevronRight, ExternalLink, Search, X } from 'lucide-react'
import { Combobox, type ComboboxOption } from './Combobox'
import {
  formatCoord,
  instituteKey,
  type GeoFilter,
  type RegionFlow,
  type RegionStats,
  type Selection,
  type SpeciesFlow,
} from './types'

type FlowRow = RegionFlow | SpeciesFlow

const PAGE_SIZE = 30

function Breadcrumb({ regionLabel, current }: { regionLabel: string | null; current: string }) {
  return (
    <div className="detail-breadcrumb" aria-label="Breadcrumb">
      <span>{regionLabel || 'All regions'}</span>
      <ChevronRight size={11} aria-hidden="true" />
      <span className="detail-breadcrumb-current">{current}</span>
    </div>
  )
}

export function SpeciesSearch({
  flows,
  selection,
  onSelect,
}: {
  flows: FlowRow[]
  selection: Selection
  onSelect: (selection: Selection) => void
}) {
  const options: ComboboxOption[] = useMemo(
    () =>
      flows
        .filter((row) => row.species_taxid && row.species_scientific_name)
        .map((row) => {
          const label = row.species_scientific_name
          const sub = row.collection_country || undefined
          return {
            key: row.species_taxid,
            label,
            sub,
            searchText: `${label} ${sub ?? ''}`.toLowerCase(),
          }
        })
        .sort((a, b) => a.label.localeCompare(b.label)),
    [flows],
  )
  const selectedKey = selection?.type === 'species' ? selection.taxid : ''
  const selectedLabel = selectedKey
    ? options.find((opt) => opt.key === selectedKey)?.label ?? ''
    : ''

  return (
    <Combobox
      placeholder="Search species…"
      value={selectedKey}
      selectedLabel={selectedLabel}
      options={options}
      onPick={(key) => onSelect({ type: 'species', taxid: key })}
      onClear={() => onSelect(null)}
    />
  )
}

export function InstituteSearch({
  flows,
  selection,
  onSelect,
}: {
  flows: FlowRow[]
  selection: Selection
  onSelect: (selection: Selection) => void
}) {
  const options: ComboboxOption[] = useMemo(() => {
    const byKey = new Map<string, ComboboxOption>()
    for (const row of flows) {
      const key = instituteKey(row)
      if (!key || !row.institute_name) continue
      if (!byKey.has(key)) {
        const label = row.institute_name
        const sub = row.institute_country || undefined
        byKey.set(key, {
          key,
          label,
          sub,
          searchText: `${label} ${sub ?? ''}`.toLowerCase(),
        })
      }
    }
    return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label))
  }, [flows])

  const selectedKey = selection?.type === 'institute' ? selection.key : ''
  const selectedLabel = selectedKey
    ? options.find((opt) => opt.key === selectedKey)?.label ?? ''
    : ''

  return (
    <Combobox
      placeholder="Search institutes…"
      value={selectedKey}
      selectedLabel={selectedLabel}
      options={options}
      onPick={(key) => onSelect({ type: 'institute', key })}
      onClear={() => onSelect(null)}
    />
  )
}

function pct(part: number, total: number): string {
  if (!total) return '0%'
  return `${Math.round((100 * part) / total)}%`
}

export function RegionOverview({
  title,
  stats,
  onSelectInstitute,
}: {
  title: string
  stats: RegionStats
  onSelectInstitute: (key: string) => void
}) {
  return (
    <div className="region-panel">
      <div className="region-title">
        <span className="detail-kicker">Region overview</span>
        <h2>{title}</h2>
        <p>{stats.total.toLocaleString()} species with assemblies</p>
      </div>
      <div className="kpi-grid">
        <div className="kpi-card">
          <span>In-region / domestic</span>
          <b>{stats.domestic.toLocaleString()}</b>
          <small>{pct(stats.domestic, stats.total)}</small>
        </div>
        <div className="kpi-card">
          <span>Offshore</span>
          <b>{stats.offshore.toLocaleString()}</b>
          <small>{pct(stats.offshore, stats.total)}</small>
        </div>
        <div className="kpi-card">
          <span>Submitter unknown</span>
          <b>{stats.unknown.toLocaleString()}</b>
          <small>{pct(stats.unknown, stats.total)}</small>
        </div>
      </div>
      <section className="rank-block">
        <div className="section-label">Top submitter institutes</div>
        {stats.topInstitutes.length === 0 ? (
          <p className="rank-empty">No resolved institutes in this scope.</p>
        ) : (
          <ol className="rank-list">
            {stats.topInstitutes.map((item, index) => (
              <li key={item.key}>
                <button type="button" className="rank-row" onClick={() => onSelectInstitute(item.key)}>
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
        <div className="section-label">Top submitter countries</div>
        {stats.topSubmitterCountries.length === 0 ? (
          <p className="rank-empty">No resolved submitter countries in this scope.</p>
        ) : (
          <ol className="rank-list">
            {stats.topSubmitterCountries.map((item, index) => (
              <li key={item.key} className="rank-row static">
                <span className="rank-index">{index + 1}</span>
                <span className="rank-label">{item.label}</span>
                <span className="rank-count">{item.count.toLocaleString()}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}

export function SpeciesDetail({
  row,
  regionLabel,
  onBack,
  onClear,
  onSelectInstitute,
}: {
  row: FlowRow
  regionLabel: string | null
  onBack: () => void
  onClear: () => void
  onSelectInstitute: (key: string) => void
}) {
  const key = instituteKey(row)
  const hasCollectionCoords = row.collection_lat != null && row.collection_lon != null
  return (
    <div className="detail-panel">
      <div className="detail-head">
        <button className="back-index" onClick={onBack}>
          <ArrowLeft size={15} /> {regionLabel ? `Back to ${regionLabel}` : 'Back to overview'}
        </button>
        <button className="icon-button" onClick={onClear} aria-label="Clear selection">
          <X size={17} />
        </button>
      </div>
      <div className="detail-title">
        <Breadcrumb regionLabel={regionLabel} current={row.species_scientific_name} />
        <span className="detail-kicker">Species</span>
        <h2>
          <i>{row.species_scientific_name}</i>
        </h2>
        <p>NCBI taxid {row.species_taxid || '—'}</p>
        <div className="detail-flow">
          <span>{row.collection_country || 'Unknown origin'}</span>
          <span className="spark-arrow">→</span>
          <span>{row.institute_name || 'Submitter unresolved'}</span>
        </div>
      </div>
      <div className="location-stack">
        <section className="location-card">
          <div className="location-card-head">
            <span className="card-dot amber" />
            Collected <span className="location-label">field site</span>
          </div>
          <strong>{row.collection_country || 'Unknown country'}</strong>
          <p>{row.collection_continent}</p>
          <dl>
            <div>
              <dt>Coordinates</dt>
              <dd>
                {hasCollectionCoords
                  ? `${formatCoord(row.collection_lat as number, 'lat')} / ${formatCoord(row.collection_lon as number, 'lng')}`
                  : 'Country-level record (no coordinates)'}
              </dd>
            </div>
          </dl>
        </section>
        <section className="location-card">
          <div className="location-card-head">
            <span className="card-dot blue" />
            Submitted <span className="location-label">assembly site</span>
          </div>
          <strong>{row.institute_name || 'Unresolved institute'}</strong>
          <p>
            {[row.institute_country, row.institute_continent].filter(Boolean).join(' · ') ||
              'No submitter geography'}
          </p>
          <dl>
            {row.has_institute_coordinates && row.institute_lat != null && row.institute_lon != null && (
              <div>
                <dt>Coordinates</dt>
                <dd>
                  {formatCoord(row.institute_lat, 'lat')} / {formatCoord(row.institute_lon, 'lng')}
                </dd>
              </div>
            )}
            {row.institute_ror_id && (
              <div>
                <dt>ROR</dt>
                <dd>
                  <a href={row.institute_ror_id} target="_blank" rel="noreferrer">
                    Open <ExternalLink size={11} />
                  </a>
                </dd>
              </div>
            )}
          </dl>
          {key && (
            <button type="button" className="pivot-link" onClick={() => onSelectInstitute(key)}>
              View all species from this institute <ArrowRight size={13} />
            </button>
          )}
        </section>
      </div>
      <section className="assembly-block">
        <div className="section-label">Assembly</div>
        <div className="assembly-grid">
          <div>
            <span>Accession</span>
            <b>{row.assembly_accession || '—'}</b>
          </div>
          <div>
            <span>Submitter</span>
            <b>{row.submitter_name || '—'}</b>
          </div>
        </div>
      </section>
      <section className="taxonomy">
        <div className="section-label">Taxonomy</div>
        <p>
          {[row.kingdom_name, row.phylum_name, row.class_name, row.order_name, row.family_name, row.genus_name]
            .filter(Boolean)
            .map((part, index, arr) => (
              <span key={`${part}-${index}`}>
                {part}
                {index < arr.length - 1 ? <span> / </span> : null}
              </span>
            ))}
        </p>
      </section>
    </div>
  )
}

export function InstituteDetail({
  keyName,
  rows,
  regionLabel,
  onBack,
  onClear,
  onSelectSpecies,
}: {
  keyName: string
  rows: FlowRow[]
  regionLabel: string | null
  onBack: () => void
  onClear: () => void
  onSelectSpecies: (taxid: string) => void
}) {
  const [visible, setVisible] = useState(PAGE_SIZE)
  const [query, setQuery] = useState('')
  useEffect(() => {
    setVisible(PAGE_SIZE)
    setQuery('')
  }, [keyName])

  const sample = rows[0]
  const name = sample?.institute_name || keyName
  const country = sample?.institute_country
  const continent = sample?.institute_continent
  const ror = sample?.institute_ror_id
  const lat = sample?.institute_lat
  const lon = sample?.institute_lon

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (row) =>
        row.species_scientific_name.toLowerCase().includes(q) ||
        row.collection_country.toLowerCase().includes(q),
    )
  }, [rows, query])
  const shown = filteredRows.slice(0, visible)

  return (
    <div className="detail-panel">
      <div className="detail-head">
        <button className="back-index" onClick={onBack}>
          <ArrowLeft size={15} /> {regionLabel ? `Back to ${regionLabel}` : 'Back to overview'}
        </button>
        <button className="icon-button" onClick={onClear} aria-label="Clear selection">
          <X size={17} />
        </button>
      </div>
      <div className="detail-title">
        <Breadcrumb regionLabel={regionLabel} current={name} />
        <span className="detail-kicker">Institute</span>
        <h2>{name}</h2>
        <p>{[country, continent].filter(Boolean).join(' · ') || 'Geography unresolved'}</p>
        <div className="detail-flow">
          <span>{rows.length.toLocaleString()} species in current scope</span>
        </div>
      </div>
      <div className="location-stack">
        <section className="location-card">
          <div className="location-card-head">
            <span className="card-dot blue" />
            Submitter site
          </div>
          <dl>
            {lat != null && lon != null && (
              <div>
                <dt>Coordinates</dt>
                <dd>
                  {formatCoord(lat, 'lat')} / {formatCoord(lon, 'lng')}
                </dd>
              </div>
            )}
            {ror && (
              <div>
                <dt>ROR</dt>
                <dd>
                  <a href={ror} target="_blank" rel="noreferrer">
                    Open <ExternalLink size={11} />
                  </a>
                </dd>
              </div>
            )}
          </dl>
        </section>
      </div>
      <div className="species-index">
        <div className="index-heading">
          <span>Species submitted</span>
          <span>
            {Math.min(visible, filteredRows.length).toLocaleString()} / {filteredRows.length.toLocaleString()}
            {query && ` (of ${rows.length.toLocaleString()})`}
          </span>
        </div>
        {rows.length > PAGE_SIZE && (
          <div className="species-filter-box">
            <Search size={12} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setVisible(PAGE_SIZE)
              }}
              placeholder="Filter species in this list…"
              aria-label="Filter species submitted by this institute"
            />
          </div>
        )}
        {shown.length === 0 ? (
          <p className="rank-empty species-filter-empty">No species match &ldquo;{query}&rdquo;.</p>
        ) : (
          shown.map((row) => (
            <button
              key={row.species_taxid}
              type="button"
              className="species-row"
              onClick={() => onSelectSpecies(row.species_taxid)}
            >
              <span>
                <i>{row.species_scientific_name}</i>
                <small>{row.collection_country || 'Unknown collection country'}</small>
              </span>
              <span className="species-flow">
                <b>{row.collection_continent}</b>
              </span>
            </button>
          ))
        )}
        {visible < filteredRows.length && (
          <button type="button" className="show-more" onClick={() => setVisible((n) => n + PAGE_SIZE)}>
            Show more ({(filteredRows.length - visible).toLocaleString()} remaining)
          </button>
        )}
      </div>
    </div>
  )
}

export function regionTitle(geoFilter: GeoFilter): string {
  if (geoFilter.country) return geoFilter.country
  if (geoFilter.continent) return geoFilter.continent
  return 'All regions'
}
