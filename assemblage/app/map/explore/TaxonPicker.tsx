'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Search, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { TAXON_RANKS, type TaxonRank } from '../types'
import type { TaxonRankSummaries } from './exploreData'

const POPOVER_SEARCH_THRESHOLD = 20
const PAGE_SIZE = 50
const SCROLL_LOAD_THRESHOLD_PX = 40

type TaxonPickerProps = {
  rankSummaries: TaxonRankSummaries
  rankLevel: TaxonRank | ''
  rankTaxid: string
  rankTaxidLabel: string
  onPickTaxon: (rank: TaxonRank, taxid: string) => void
  onClearTaxon: () => void
  disabled?: boolean
}

export default function TaxonPicker({
  rankSummaries,
  rankLevel,
  rankTaxid,
  rankTaxidLabel,
  onPickTaxon,
  onClearTaxon,
  disabled,
}: TaxonPickerProps) {
  const [open, setOpen] = useState(false)
  const [activeRank, setActiveRank] = useState<TaxonRank>(
    () => rankLevel || 'kingdom',
  )
  const [query, setQuery] = useState('')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    if (!open) {
      setQuery('')
      setVisibleCount(PAGE_SIZE)
      return
    }
    setActiveRank(rankLevel || 'kingdom')
  }, [open, rankLevel])

  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [query, activeRank])

  const summary = rankSummaries[activeRank]
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return summary.options
    return summary.options.filter((opt) => opt.name.toLowerCase().includes(q))
  }, [summary.options, query])

  const visible = filtered.slice(0, visibleCount)
  const hasMore = visible.length < filtered.length
  const showSearch = summary.options.length > POPOVER_SEARCH_THRESHOLD
  const hasTaxon = Boolean(rankLevel && rankTaxid)
  const pillLabel = hasTaxon
    ? `${rankLevel} · ${rankTaxidLabel}`
    : 'Any'

  function onListScroll() {
    const el = listRef.current
    if (!el || !hasMore) return
    const nearBottom =
      el.scrollTop + el.clientHeight >= el.scrollHeight - SCROLL_LOAD_THRESHOLD_PX
    if (!nearBottom) return
    setVisibleCount((n) => Math.min(n + PAGE_SIZE, filtered.length))
  }

  return (
    <div className="sidebar-filter-peer">
      <span className="sidebar-filter-peer-label">Taxon</span>
      <div className={`sidebar-filter-pill ${hasTaxon ? 'is-set' : ''}`}>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            disabled={disabled}
            className="sidebar-filter-pill-trigger"
            aria-label={hasTaxon ? `Taxon: ${pillLabel}` : 'Pick taxon'}
          >
            <span className="sidebar-filter-pill-text" title={pillLabel}>
              {pillLabel}
            </span>
            <ChevronDown size={12} aria-hidden="true" />
          </PopoverTrigger>
          <PopoverContent align="start" className="explore-taxon-popover taxon-picker-popover">
            <div className="explore-taxon-popover-head">
              <span>Taxon</span>
              <span>{summary.count.toLocaleString()} at this rank</span>
            </div>
            <div className="taxon-picker-ranks" role="tablist" aria-label="Taxonomic rank">
              {TAXON_RANKS.map((rank) => (
                <button
                  key={rank}
                  type="button"
                  role="tab"
                  aria-selected={activeRank === rank}
                  className={`taxon-picker-rank ${activeRank === rank ? 'is-active' : ''}`}
                  onClick={() => setActiveRank(rank)}
                >
                  {rank}
                  <em>{rankSummaries[rank].count.toLocaleString()}</em>
                </button>
              ))}
            </div>
            {showSearch && (
              <label className="explore-taxon-search">
                <Search size={12} aria-hidden="true" />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={`Search ${activeRank}…`}
                  aria-label={`Search ${activeRank}`}
                />
              </label>
            )}
            <ul
              ref={listRef}
              className="explore-taxon-list"
              role="listbox"
              aria-label={`${activeRank} taxa`}
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
                        aria-selected={
                          rankLevel === activeRank && opt.taxid === rankTaxid
                        }
                        onClick={() => {
                          onPickTaxon(activeRank, opt.taxid)
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
        {hasTaxon ? (
          <button
            type="button"
            className="sidebar-filter-pill-clear"
            aria-label="Clear taxon"
            onClick={onClearTaxon}
          >
            <X size={12} />
          </button>
        ) : null}
      </div>
    </div>
  )
}
