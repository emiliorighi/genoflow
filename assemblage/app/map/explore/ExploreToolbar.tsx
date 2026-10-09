'use client'

import { useMemo } from 'react'
import { Combobox, type ComboboxOption } from '../Combobox'
import { instituteKey, type RegionFlow, type Selection } from '../types'

export type SearchMode = 'species' | 'institute'

type ExploreToolbarProps = {
  mapFlows: RegionFlow[]
  searchMode: SearchMode
  onSearchModeChange: (mode: SearchMode) => void
  selection: Selection
  onSelect: (selection: Selection) => void
  disabled?: boolean
}

export default function ExploreToolbar({
  mapFlows,
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
