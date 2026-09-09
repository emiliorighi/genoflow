'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowRight, ExternalLink, Search, X } from 'lucide-react'
import {
  formatCoord,
  instituteKey,
  type GeoFilter,
  type RegionFlow,
} from './types'
import { customRegionLabel } from './explore/customRegions'

const PAGE_SIZE = 30

function ncbiGenomeUrl(accession: string): string {
  return `https://www.ncbi.nlm.nih.gov/datasets/genome/${accession}/`
}

function DetailTitle({
  kicker,
  title,
  subtitle,
  italicTitle,
  onClear,
  children,
}: {
  kicker: string
  title: string
  subtitle?: string
  italicTitle?: boolean
  onClear: () => void
  children?: ReactNode
}) {
  return (
    <div className="explore-detail-head detail-panel-head">
      <div className="detail-title explore-detail-title">
        <div className="detail-title-top">
          <span className="detail-kicker">{kicker}</span>
          <button
            type="button"
            className="icon-button"
            onClick={onClear}
            aria-label="Close details panel"
          >
            <X size={17} />
          </button>
        </div>
        <h2>{italicTitle ? <i>{title}</i> : title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
        {children}
      </div>
    </div>
  )
}

function SpeciesListSection({
  rows,
  heading,
  listKey,
  renderRight,
  onSelect,
}: {
  rows: RegionFlow[]
  heading: string
  listKey: string
  renderRight: (row: RegionFlow) => ReactNode
  onSelect: (taxid: string) => void
}) {
  const [visible, setVisible] = useState(PAGE_SIZE)
  const [query, setQuery] = useState('')

  useEffect(() => {
    setVisible(PAGE_SIZE)
    setQuery('')
  }, [listKey])

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (row) =>
        row.species_scientific_name.toLowerCase().includes(q) ||
        row.collection_country.toLowerCase().includes(q) ||
        (row.institute_name?.toLowerCase().includes(q) ?? false) ||
        (row.institute_country?.toLowerCase().includes(q) ?? false),
    )
  }, [rows, query])
  const shown = filteredRows.slice(0, visible)

  return (
    <div className="species-index">
      <div className="index-heading">
        <span>{heading}</span>
        <span>
          {Math.min(visible, filteredRows.length).toLocaleString()} /{' '}
          {filteredRows.length.toLocaleString()}
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
            aria-label="Filter species"
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
            onClick={() => onSelect(row.species_taxid)}
          >
            <span>
              <i>{row.species_scientific_name}</i>
              <small>{row.collection_country || 'Unknown collection country'}</small>
            </span>
            <span className="species-flow">{renderRight(row)}</span>
          </button>
        ))
      )}
      {visible < filteredRows.length && (
        <button type="button" className="show-more" onClick={() => setVisible((n) => n + PAGE_SIZE)}>
          Show more ({(filteredRows.length - visible).toLocaleString()} remaining)
        </button>
      )}
    </div>
  )
}

export function SpeciesDetail({
  row,
  onClear,
  onSelectInstitute,
}: {
  row: RegionFlow
  onClear: () => void
  onSelectInstitute: (key: string) => void
}) {
  const key = instituteKey(row)
  const hasCollectionCoords = row.collection_lat != null && row.collection_lon != null
  const accession = row.assembly_accession

  return (
    <div className="detail-panel">
      <DetailTitle
        kicker="Species details"
        title={row.species_scientific_name}
        subtitle={`NCBI taxid ${row.species_taxid || '—'}`}
        italicTitle
        onClear={onClear}
      >
        <div className="detail-flow">
          <span>{row.collection_country || 'Unknown origin'}</span>
          <span className="spark-arrow">→</span>
          <span>{row.institute_name || 'Submitter unresolved'}</span>
        </div>
      </DetailTitle>
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
            <b>
              {accession ? (
                <a href={ncbiGenomeUrl(accession)} target="_blank" rel="noreferrer">
                  {accession} <ExternalLink size={11} />
                </a>
              ) : (
                '—'
              )}
            </b>
          </div>
          <div>
            <span>Quality</span>
            <b>{row.assembly_level || '—'}</b>
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
  onClear,
  onSelectSpecies,
}: {
  keyName: string
  rows: RegionFlow[]
  onClear: () => void
  onSelectSpecies: (taxid: string) => void
}) {
  const sample = rows[0]
  const name = sample?.institute_name || keyName
  const country = sample?.institute_country
  const continent = sample?.institute_continent
  const ror = sample?.institute_ror_id
  const lat = sample?.institute_lat
  const lon = sample?.institute_lon

  return (
    <div className="detail-panel">
      <DetailTitle
        kicker="Institute details"
        title={name}
        subtitle={[country, continent].filter(Boolean).join(' · ') || 'Geography unresolved'}
        onClear={onClear}
      >
        <div className="detail-flow">
          <span>{rows.length.toLocaleString()} species in current scope</span>
        </div>
      </DetailTitle>
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
      <SpeciesListSection
        rows={rows}
        heading="Species submitted"
        listKey={keyName}
        onSelect={onSelectSpecies}
        renderRight={(row) => <b>{row.collection_continent}</b>}
      />
    </div>
  )
}

export function PointSpeciesList({
  rows,
  onClear,
  onSelectSpecies,
}: {
  rows: RegionFlow[]
  onClear: () => void
  onSelectSpecies: (taxid: string) => void
}) {
  const sample = rows[0]
  const country = sample?.collection_country || 'Unknown location'
  const isCentroid =
    sample != null && (sample.collection_lat == null || sample.collection_lon == null)
  const listKey = sample
    ? `${sample.collection_country_iso3 ?? country}:${rows.length}`
    : 'empty'

  return (
    <div className="detail-panel">
      <DetailTitle
        kicker="Location details"
        title={country}
        subtitle={
          isCentroid
            ? 'Country-level centroid · multiple species'
            : 'Shared collection coordinates'
        }
        onClear={onClear}
      >
        <div className="detail-flow">
          <span>{rows.length.toLocaleString()} species at this point</span>
        </div>
      </DetailTitle>
      <SpeciesListSection
        rows={rows}
        heading="Species here"
        listKey={listKey}
        onSelect={onSelectSpecies}
        renderRight={(row) => (
          <span>
            <b>{row.institute_name || 'Unresolved institute'}</b>
            <small>{row.institute_country || '—'}</small>
          </span>
        )}
      />
    </div>
  )
}

export function regionTitle(geoFilter: GeoFilter): string {
  if (geoFilter.customId) return customRegionLabel(geoFilter.customId) ?? geoFilter.customId
  if (geoFilter.country) return geoFilter.country
  if (geoFilter.continent) return geoFilter.continent
  return 'All regions'
}
