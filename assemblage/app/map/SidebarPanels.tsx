'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ExternalLink, X } from 'lucide-react'
import {
  formatCoord,
  instituteKey,
  type GeoFilter,
  type RegionStats,
  type Selection,
  type SpeciesFlow,
} from './types'

const PAGE_SIZE = 30
const SEARCH_DEBOUNCE_MS = 120

type SearchOption = { key: string; label: string; sub?: string; searchText: string }

function SearchCombobox({
  label,
  placeholder,
  value,
  options,
  onPick,
  onClear,
}: {
  label: string
  placeholder: string
  value: string
  options: SearchOption[]
  onPick: (key: string) => void
  onClear: () => void
}) {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLLabelElement>(null)

  useEffect(() => {
    if (!open) {
      setQuery('')
      setDebouncedQuery('')
    }
  }, [open, value])

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(handle)
  }, [query])

  useEffect(() => {
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const filtered = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase()
    if (!q) return options.slice(0, 20)
    return options.filter((opt) => opt.searchText.includes(q)).slice(0, 20)
  }, [options, debouncedQuery])

  return (
    <label className="map-filter search-filter" ref={rootRef}>
      <span>{label}</span>
      <div className="search-box">
        <input
          value={open ? query : value}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          aria-autocomplete="list"
          aria-expanded={open}
        />
        {value && (
          <button
            type="button"
            className="search-clear"
            aria-label={`Clear ${label}`}
            onClick={(e) => {
              e.preventDefault()
              onClear()
              setQuery('')
              setDebouncedQuery('')
              setOpen(false)
            }}
          >
            <X size={12} />
          </button>
        )}
        {open && (
          <div className="search-popover" role="listbox">
            {filtered.length === 0 ? (
              <div className="search-empty">No matches</div>
            ) : (
              filtered.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  role="option"
                  className="search-option"
                  onClick={() => {
                    onPick(opt.key)
                    setOpen(false)
                    setQuery('')
                    setDebouncedQuery('')
                  }}
                >
                  <span>{opt.label}</span>
                  {opt.sub && <small>{opt.sub}</small>}
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </label>
  )
}

export function SpeciesSearch({
  flows,
  selection,
  onSelect,
}: {
  flows: SpeciesFlow[]
  selection: Selection
  onSelect: (selection: Selection) => void
}) {
  const options = useMemo(
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
  const selectedLabel =
    selection?.type === 'species'
      ? options.find((opt) => opt.key === selection.taxid)?.label ?? ''
      : ''

  return (
    <SearchCombobox
      label="Species"
      placeholder="Search species…"
      value={selectedLabel}
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
  flows: SpeciesFlow[]
  selection: Selection
  onSelect: (selection: Selection) => void
}) {
  const options = useMemo(() => {
    const byKey = new Map<string, SearchOption>()
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

  const selectedLabel =
    selection?.type === 'institute'
      ? options.find((opt) => opt.key === selection.key)?.label ?? ''
      : ''

  return (
    <SearchCombobox
      label="Institute"
      placeholder="Search institutes…"
      value={selectedLabel}
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
  row: SpeciesFlow
  regionLabel: string | null
  onBack: () => void
  onClear: () => void
  onSelectInstitute: (key: string) => void
}) {
  const key = instituteKey(row)
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
                {formatCoord(row.collection_lat, 'lat')} / {formatCoord(row.collection_lon, 'lng')}
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
  rows: SpeciesFlow[]
  regionLabel: string | null
  onBack: () => void
  onClear: () => void
  onSelectSpecies: (taxid: string) => void
}) {
  const [visible, setVisible] = useState(PAGE_SIZE)
  useEffect(() => setVisible(PAGE_SIZE), [keyName])

  const sample = rows[0]
  const name = sample?.institute_name || keyName
  const country = sample?.institute_country
  const continent = sample?.institute_continent
  const ror = sample?.institute_ror_id
  const lat = sample?.institute_lat
  const lon = sample?.institute_lon
  const shown = rows.slice(0, visible)

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
            {Math.min(visible, rows.length).toLocaleString()} / {rows.length.toLocaleString()}
          </span>
        </div>
        {shown.map((row) => (
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
        ))}
        {visible < rows.length && (
          <button type="button" className="show-more" onClick={() => setVisible((n) => n + PAGE_SIZE)}>
            Show more ({(rows.length - visible).toLocaleString()} remaining)
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
