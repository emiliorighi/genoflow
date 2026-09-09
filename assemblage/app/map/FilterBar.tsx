'use client'

import { useMemo, useState } from 'react'
import { Layers3, SlidersHorizontal, X } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Combobox, type ComboboxOption } from './Combobox'
import { InstituteSearch, SpeciesSearch } from './SidebarPanels'
import { TAXON_RANKS, type GeoFilter, type Selection, type SpeciesFlow, type TaxonRank } from './types'
import type { Layers } from './DeckMap'

const ALL_VALUE = '__all__'

type CountryOption = { country: string; continent: string; iso3: string | null }
type TaxonOption = { taxid: string; name: string }

export type FilterBarProps = {
  flows: SpeciesFlow[] | null
  filteredFlows: SpeciesFlow[]
  rankLevel: TaxonRank | ''
  rankTaxid: string
  rankTaxidLabel: string
  onRankLevelChange: (value: string) => void
  onRankTaxidChange: (value: string) => void
  taxonOptions: TaxonOption[]
  geoFilter: GeoFilter
  continentOptions: string[]
  countryOptions: CountryOption[]
  onContinentChange: (value: string) => void
  onCountryChange: (value: string) => void
  onClearAll: () => void
  selection: Selection
  onSelect: (selection: Selection) => void
  layers: Layers
  onToggleLayer: (key: keyof Layers) => void
}

const LAYER_META: { key: keyof Layers; label: string; color: 'amber' | 'blue' | 'flow' }[] = [
  { key: 'collection', label: 'Collection sites', color: 'amber' },
  { key: 'submitter', label: 'Submitter sites', color: 'blue' },
  { key: 'flow', label: 'Flow arcs', color: 'flow' },
]

function LayerToggleRow({
  meta,
  checked,
  onChange,
}: {
  meta: { key: keyof Layers; label: string; color: 'amber' | 'blue' | 'flow' }
  checked: boolean
  onChange: () => void
}) {
  return (
    <label className="fb-layer-row">
      <span className={`toggle-key ${meta.color}`} aria-hidden="true" />
      <span className="fb-layer-row-label">{meta.label}</span>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        aria-label={`${checked ? 'Hide' : 'Show'} ${meta.label.toLowerCase()}`}
      />
    </label>
  )
}

export function TaxonomyFields({
  rankLevel,
  rankTaxid,
  rankTaxidLabel,
  onRankLevelChange,
  onRankTaxidChange,
  taxonOptions,
  disabled,
}: {
  rankLevel: TaxonRank | ''
  rankTaxid: string
  rankTaxidLabel: string
  onRankLevelChange: (value: string) => void
  onRankTaxidChange: (value: string) => void
  taxonOptions: TaxonOption[]
  disabled: boolean
}) {
  const taxonComboOptions: ComboboxOption[] = useMemo(
    () =>
      taxonOptions.map((opt) => ({
        key: opt.taxid,
        label: opt.name,
        searchText: opt.name.toLowerCase(),
      })),
    [taxonOptions],
  )

  return (
    <div className="fb-group" role="group" aria-label="Taxonomy filters">
      <span className="fb-group-label">Taxonomy</span>
      <div className="fb-fields">
        <label className="fb-select-field">
          <span className="fb-select-label">Rank</span>
          <Select
            value={rankLevel || ALL_VALUE}
            onValueChange={(value) => onRankLevelChange(!value || value === ALL_VALUE ? '' : value)}
            disabled={disabled}
          >
            <SelectTrigger className="fb-select-trigger" aria-label="Filter by taxonomic rank">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>Any rank</SelectItem>
              {TAXON_RANKS.map((rank) => (
                <SelectItem key={rank} value={rank}>
                  {rank}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <Combobox
          placeholder={rankLevel ? 'All taxa' : 'Pick a rank first'}
          emptyLabel="No matching taxa"
          value={rankTaxid}
          selectedLabel={rankTaxidLabel}
          options={taxonComboOptions}
          onPick={onRankTaxidChange}
          onClear={() => onRankTaxidChange('')}
          disabled={disabled || !rankLevel || taxonOptions.length === 0}
        />
      </div>
      {!rankLevel && (
        <p className="fb-hint">Choose a rank, then search for a taxon within it.</p>
      )}
    </div>
  )
}

function GeographyFields({
  geoFilter,
  continentOptions,
  countryOptions,
  onContinentChange,
  onCountryChange,
  disabled,
}: {
  geoFilter: GeoFilter
  continentOptions: string[]
  countryOptions: CountryOption[]
  onContinentChange: (value: string) => void
  onCountryChange: (value: string) => void
  disabled: boolean
}) {
  return (
    <div className="fb-group" role="group" aria-label="Geography filters">
      <span className="fb-group-label">Geography</span>
      <div className="fb-fields">
        <label className="fb-select-field">
          <span className="fb-select-label">Continent</span>
          <Select
            value={geoFilter.continent || ALL_VALUE}
            onValueChange={(value) => onContinentChange(!value || value === ALL_VALUE ? '' : value)}
            disabled={disabled}
          >
            <SelectTrigger className="fb-select-trigger" aria-label="Filter by collection continent">
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
            disabled={disabled}
          >
            <SelectTrigger className="fb-select-trigger" aria-label="Filter by collection country">
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
    </div>
  )
}

export default function FilterBar(props: FilterBarProps) {
  const {
    flows,
    filteredFlows,
    rankLevel,
    rankTaxid,
    rankTaxidLabel,
    onRankLevelChange,
    onRankTaxidChange,
    taxonOptions,
    geoFilter,
    continentOptions,
    countryOptions,
    onContinentChange,
    onCountryChange,
    onClearAll,
    selection,
    onSelect,
    layers,
    onToggleLayer,
  } = props

  const [sheetOpen, setSheetOpen] = useState(false)
  const disabled = !flows

  const chips = useMemo(() => {
    const list: { id: string; label: string; onRemove: () => void }[] = []
    if (rankLevel && rankTaxid) {
      list.push({
        id: 'taxon',
        label: `${rankLevel}: ${rankTaxidLabel || rankTaxid}`,
        onRemove: () => onRankTaxidChange(''),
      })
    }
    if (geoFilter.continent) {
      list.push({
        id: 'continent',
        label: `Continent: ${geoFilter.continent}`,
        onRemove: () => onContinentChange(''),
      })
    }
    if (geoFilter.country) {
      list.push({
        id: 'country',
        label: `Country: ${geoFilter.country}`,
        onRemove: () => onCountryChange(''),
      })
    }
    return list
  }, [rankLevel, rankTaxid, rankTaxidLabel, geoFilter, onRankTaxidChange, onContinentChange, onCountryChange])

  const activeLayerCount = LAYER_META.filter((meta) => layers[meta.key]).length

  return (
    <div className="fb-bar">
      <div className="fb-bar-desktop">
        <TaxonomyFields
          rankLevel={rankLevel}
          rankTaxid={rankTaxid}
          rankTaxidLabel={rankTaxidLabel}
          onRankLevelChange={onRankLevelChange}
          onRankTaxidChange={onRankTaxidChange}
          taxonOptions={taxonOptions}
          disabled={disabled}
        />
        <div className="fb-divider" aria-hidden="true" />
        <GeographyFields
          geoFilter={geoFilter}
          continentOptions={continentOptions}
          countryOptions={countryOptions}
          onContinentChange={onContinentChange}
          onCountryChange={onCountryChange}
          disabled={disabled}
        />
        <div className="fb-divider" aria-hidden="true" />
        <div className="fb-group" role="group" aria-label="Search">
          <span className="fb-group-label">Search</span>
          <div className="fb-fields">
            <SpeciesSearch flows={filteredFlows} selection={selection} onSelect={onSelect} />
            <InstituteSearch flows={filteredFlows} selection={selection} onSelect={onSelect} />
          </div>
        </div>
        <Popover>
          <PopoverTrigger
            className="fb-layers-trigger"
            aria-label={`Map layers, ${activeLayerCount} of ${LAYER_META.length} visible`}
          >
            <Layers3 size={14} aria-hidden="true" />
            <span>Layers</span>
            <Badge variant="secondary" className="fb-layers-count">
              {activeLayerCount}/{LAYER_META.length}
            </Badge>
          </PopoverTrigger>
          <PopoverContent align="end" className="fb-layers-popover">
            {LAYER_META.map((meta) => (
              <LayerToggleRow
                key={meta.key}
                meta={meta}
                checked={layers[meta.key]}
                onChange={() => onToggleLayer(meta.key)}
              />
            ))}
          </PopoverContent>
        </Popover>
      </div>

      <div className="fb-bar-mobile">
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger
            className="fb-mobile-trigger"
            aria-label={`Open filters${chips.length ? `, ${chips.length} active` : ''}`}
          >
            <SlidersHorizontal size={14} aria-hidden="true" />
            <span>Filters</span>
            {chips.length > 0 && (
              <Badge variant="secondary" className="fb-layers-count">
                {chips.length}
              </Badge>
            )}
          </SheetTrigger>
          <SheetContent side="bottom" className="fb-sheet-content">
            <SheetHeader>
              <SheetTitle>Filters &amp; layers</SheetTitle>
            </SheetHeader>
            <div className="fb-sheet-body">
              <TaxonomyFields
                rankLevel={rankLevel}
                rankTaxid={rankTaxid}
                rankTaxidLabel={rankTaxidLabel}
                onRankLevelChange={onRankLevelChange}
                onRankTaxidChange={onRankTaxidChange}
                taxonOptions={taxonOptions}
                disabled={disabled}
              />
              <GeographyFields
                geoFilter={geoFilter}
                continentOptions={continentOptions}
                countryOptions={countryOptions}
                onContinentChange={onContinentChange}
                onCountryChange={onCountryChange}
                disabled={disabled}
              />
              <div className="fb-group" role="group" aria-label="Search">
                <span className="fb-group-label">Search</span>
                <div className="fb-fields fb-fields-stack">
                  <SpeciesSearch flows={filteredFlows} selection={selection} onSelect={onSelect} />
                  <InstituteSearch flows={filteredFlows} selection={selection} onSelect={onSelect} />
                </div>
              </div>
              <div className="fb-group" role="group" aria-label="Map layers">
                <span className="fb-group-label">Layers</span>
                <div className="fb-layer-stack">
                  {LAYER_META.map((meta) => (
                    <LayerToggleRow
                      key={meta.key}
                      meta={meta}
                      checked={layers[meta.key]}
                      onChange={() => onToggleLayer(meta.key)}
                    />
                  ))}
                </div>
              </div>
              {chips.length > 0 && (
                <Button variant="outline" className="fb-clear-all-button" onClick={onClearAll}>
                  Clear all filters
                </Button>
              )}
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {chips.length > 0 && (
        <div className="fb-chip-row" aria-label="Active filters">
          {chips.map((chip) => (
            <Badge key={chip.id} variant="outline" className="fb-chip">
              {chip.label}
              <button
                type="button"
                className="fb-chip-remove"
                aria-label={`Remove filter: ${chip.label}`}
                onClick={chip.onRemove}
              >
                <X size={11} />
              </button>
            </Badge>
          ))}
          <button type="button" className="fb-clear-all-link" onClick={onClearAll}>
            Clear all
          </button>
        </div>
      )}
    </div>
  )
}
