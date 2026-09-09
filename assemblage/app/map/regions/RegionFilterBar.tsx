'use client'

import { useState } from 'react'
import { Layers3, SlidersHorizontal } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { TaxonomyFields } from '../FilterBar'
import { InstituteSearch, SpeciesSearch } from '../SidebarPanels'
import type { Selection, TaxonRank, RegionFlow } from '../types'
import type { RegionLayers } from './RegionMap'

type TaxonOption = { taxid: string; name: string }

export type RegionFilterBarProps = {
  flows: RegionFlow[] | null
  filteredFlows: RegionFlow[]
  rankLevel: TaxonRank | ''
  rankTaxid: string
  rankTaxidLabel: string
  onRankLevelChange: (value: string) => void
  onRankTaxidChange: (value: string) => void
  taxonOptions: TaxonOption[]
  selection: Selection
  onSelect: (selection: Selection) => void
  layers: RegionLayers
  onToggleLayer: (key: keyof RegionLayers) => void
}

const LAYER_META: { key: keyof RegionLayers; label: string; color: 'amber' | 'blue' | 'flow' }[] = [
  { key: 'countries', label: 'Countries', color: 'amber' },
  { key: 'institutes', label: 'Institutes', color: 'blue' },
  { key: 'flow', label: 'Country → institute arcs', color: 'flow' },
]

function LayerToggleRow({
  meta,
  checked,
  onChange,
}: {
  meta: { key: keyof RegionLayers; label: string; color: 'amber' | 'blue' | 'flow' }
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

export default function RegionFilterBar(props: RegionFilterBarProps) {
  const {
    flows,
    filteredFlows,
    rankLevel,
    rankTaxid,
    rankTaxidLabel,
    onRankLevelChange,
    onRankTaxidChange,
    taxonOptions,
    selection,
    onSelect,
    layers,
    onToggleLayer,
  } = props

  const [sheetOpen, setSheetOpen] = useState(false)
  const disabled = !flows
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
          <SheetTrigger className="fb-mobile-trigger" aria-label="Open filters">
            <SlidersHorizontal size={14} aria-hidden="true" />
            <span>Filters</span>
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
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </div>
  )
}
