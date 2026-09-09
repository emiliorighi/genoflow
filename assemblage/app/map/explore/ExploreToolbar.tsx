'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Combobox, type ComboboxOption } from '../Combobox'
import {
  TAXON_RANKS,
  instituteKey,
  type RegionFlow,
  type Selection,
  type TaxonRank,
} from '../types'
import type { TaxonRankSummaries } from './exploreData'

export type SearchMode = 'species' | 'institute'

type ExploreToolbarProps = {
  mapFlows: RegionFlow[]
  rankSummaries: TaxonRankSummaries
  rankLevel: TaxonRank | ''
  rankTaxid: string
  rankTaxidLabel: string
  onPickTaxon: (rank: TaxonRank, taxid: string) => void
  onClearTaxon: () => void
  searchMode: SearchMode
  onSearchModeChange: (mode: SearchMode) => void
  selection: Selection
  onSelect: (selection: Selection) => void
  disabled?: boolean
}

const POPOVER_SEARCH_THRESHOLD = 20
const PAGE_SIZE = 50
const SCROLL_LOAD_THRESHOLD_PX = 40

function RankBadge({
  rank,
  summary,
  isActive,
  activeLabel,
  activeTaxid,
  onPick,
  onClear,
  disabled,
}: {
  rank: TaxonRank
  summary: { count: number; options: { taxid: string; name: string; speciesCount: number }[] }
  isActive: boolean
  activeLabel: string
  activeTaxid: string
  onPick: (taxid: string) => void
  onClear: () => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    if (!open) setQuery('')
    setVisibleCount(PAGE_SIZE)
  }, [open])

  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [query])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return summary.options
    return summary.options.filter((opt) => opt.name.toLowerCase().includes(q))
  }, [summary.options, query])

  const visible = filtered.slice(0, visibleCount)
  const hasMore = visible.length < filtered.length
  const showSearch = summary.options.length > POPOVER_SEARCH_THRESHOLD

  function onListScroll() {
    const el = listRef.current
    if (!el || !hasMore) return
    const nearBottom =
      el.scrollTop + el.clientHeight >= el.scrollHeight - SCROLL_LOAD_THRESHOLD_PX
    if (!nearBottom) return
    setVisibleCount((n) => Math.min(n + PAGE_SIZE, filtered.length))
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled || summary.count === 0}
        className={`explore-rank-badge ${isActive ? 'is-active' : ''}`}
        aria-label={
          isActive
            ? `${rank}: ${activeLabel}`
            : `${rank}, ${summary.count.toLocaleString()} taxa`
        }
      >
        <span className="explore-rank-badge-rank">{rank}</span>
        {isActive ? (
          <>
            <span className="explore-rank-badge-taxon" title={activeLabel}>
              {activeLabel}
            </span>
            <span
              role="button"
              tabIndex={0}
              className="explore-rank-badge-clear"
              aria-label={`Clear ${rank} filter`}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onClear()
                setOpen(false)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  event.stopPropagation()
                  onClear()
                  setOpen(false)
                }
              }}
            >
              <X size={11} />
            </span>
          </>
        ) : (
          <span className="explore-rank-badge-count">{summary.count.toLocaleString()}</span>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="explore-taxon-popover">
        <div className="explore-taxon-popover-head">
          <span>{rank}</span>
          <span>{summary.count.toLocaleString()} taxa</span>
        </div>
        {showSearch && (
          <label className="explore-taxon-search">
            <Search size={12} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${rank}…`}
              aria-label={`Search ${rank}`}
            />
          </label>
        )}
        <ul
          ref={listRef}
          className="explore-taxon-list"
          role="listbox"
          aria-label={`${rank} taxa`}
          onScroll={onListScroll}
        >
          {filtered.length === 0 ? (
            <li className="explore-taxon-empty">
              {query ? `No matches for “${query}”.` : 'No taxa in scope.'}
            </li>
          ) : (
            <>
              {visible.map((opt) => (
                <li key={opt.taxid}>
                  <button
                    type="button"
                    className="explore-taxon-row"
                    role="option"
                    aria-selected={isActive && opt.taxid === activeTaxid}
                    onClick={() => {
                      onPick(opt.taxid)
                      setOpen(false)
                    }}
                  >
                    <span className="explore-taxon-name">{opt.name}</span>
                    <span className="explore-taxon-count">
                      {opt.speciesCount.toLocaleString()}
                    </span>
                  </button>
                </li>
              ))}
              {hasMore && (
                <li className="explore-taxon-empty" aria-live="polite">
                  Showing {visible.length.toLocaleString()} of{' '}
                  {filtered.length.toLocaleString()}
                </li>
              )}
            </>
          )}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

export default function ExploreToolbar({
  mapFlows,
  rankSummaries,
  rankLevel,
  rankTaxid,
  rankTaxidLabel,
  onPickTaxon,
  onClearTaxon,
  searchMode,
  onSearchModeChange,
  selection,
  onSelect,
  disabled,
}: ExploreToolbarProps) {
  const searchOptions: ComboboxOption[] = useMemo(() => {
    if (searchMode === 'species') {
      return mapFlows
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
        .sort((a, b) => a.label.localeCompare(b.label))
    }

    const byKey = new Map<string, ComboboxOption>()
    for (const row of mapFlows) {
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
  }, [mapFlows, searchMode])

  const selectedKey =
    searchMode === 'species'
      ? selection?.type === 'species'
        ? selection.taxid
        : ''
      : selection?.type === 'institute'
        ? selection.key
        : ''

  const selectedLabel = selectedKey
    ? searchOptions.find((opt) => opt.key === selectedKey)?.label ?? ''
    : ''

  return (
    <div className="explore-toolbar">
      <div className="explore-rank-badges" role="group" aria-label="Taxonomic ranks">
        {TAXON_RANKS.map((rank) => (
          <RankBadge
            key={rank}
            rank={rank}
            summary={rankSummaries[rank]}
            isActive={rankLevel === rank && Boolean(rankTaxid)}
            activeLabel={rankTaxidLabel}
            activeTaxid={rankTaxid}
            onPick={(taxid) => onPickTaxon(rank, taxid)}
            onClear={onClearTaxon}
            disabled={disabled}
          />
        ))}
      </div>

      <div className="explore-toolbar-search">
        <div className="explore-search-mode" role="group" aria-label="Search mode">
          <button
            type="button"
            className={`explore-search-mode-btn ${searchMode === 'species' ? 'is-active' : ''}`}
            aria-pressed={searchMode === 'species'}
            onClick={() => onSearchModeChange('species')}
            disabled={disabled}
          >
            Species
          </button>
          <button
            type="button"
            className={`explore-search-mode-btn ${searchMode === 'institute' ? 'is-active' : ''}`}
            aria-pressed={searchMode === 'institute'}
            onClick={() => onSearchModeChange('institute')}
            disabled={disabled}
          >
            Institutes
          </button>
        </div>
        <Combobox
          placeholder={
            searchMode === 'species' ? 'Search species…' : 'Search institutes…'
          }
          value={selectedKey}
          selectedLabel={selectedLabel}
          options={searchOptions}
          onPick={(key) =>
            onSelect(
              searchMode === 'species'
                ? { type: 'species', taxid: key }
                : { type: 'institute', key },
            )
          }
          onClear={() => onSelect(null)}
          disabled={disabled || searchOptions.length === 0}
          className="explore-toolbar-combo"
        />
      </div>
    </div>
  )
}

