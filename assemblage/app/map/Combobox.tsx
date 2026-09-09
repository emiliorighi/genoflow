'use client'

import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronsUpDown, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { cn } from '@/lib/utils'

const SEARCH_DEBOUNCE_MS = 120
const MAX_RESULTS = 20

export type ComboboxOption = { key: string; label: string; sub?: string; searchText: string }

/**
 * Keyboard-navigable search combobox (Popover + Command) shared by species/institute
 * search and the taxon picker. Filtering is debounced and capped client-side (not via
 * cmdk's built-in fuzzy filter) so behavior matches the previous custom implementation
 * at large option-list sizes.
 */
export function Combobox({
  placeholder,
  emptyLabel = 'No matches',
  value,
  selectedLabel,
  options,
  onPick,
  onClear,
  disabled,
  className,
}: {
  placeholder: string
  emptyLabel?: string
  value: string
  selectedLabel: string
  options: ComboboxOption[]
  onPick: (key: string) => void
  onClear: () => void
  disabled?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')

  useEffect(() => {
    if (!open) {
      setQuery('')
      setDebouncedQuery('')
    }
  }, [open])

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(handle)
  }, [query])

  const filtered = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase()
    if (!q) return options.slice(0, MAX_RESULTS)
    return options.filter((opt) => opt.searchText.includes(q)).slice(0, MAX_RESULTS)
  }, [options, debouncedQuery])

  return (
    <div className={cn('combo-field', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          disabled={disabled}
          aria-label={selectedLabel || placeholder}
          className={cn(
            'combo-trigger',
            !selectedLabel && 'combo-trigger-placeholder',
          )}
        >
          <span className="combo-trigger-text">{selectedLabel || placeholder}</span>
          {value ? (
            <span
              role="button"
              tabIndex={0}
              className="combo-clear"
              aria-label="Clear selection"
              onClick={(event) => {
                event.stopPropagation()
                onClear()
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  event.stopPropagation()
                  onClear()
                }
              }}
            >
              <X size={12} />
            </span>
          ) : (
            <ChevronsUpDown size={12} className="combo-caret" aria-hidden="true" />
          )}
        </PopoverTrigger>
        <PopoverContent align="start" className="combo-popover-content">
          <Command shouldFilter={false}>
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder={placeholder}
            />
            <CommandList>
              <CommandEmpty>{emptyLabel}</CommandEmpty>
              <CommandGroup>
                {filtered.map((opt) => (
                  <CommandItem
                    key={opt.key}
                    value={opt.key}
                    onSelect={() => {
                      onPick(opt.key)
                      setOpen(false)
                    }}
                    className="combo-item"
                  >
                    <Check
                      size={13}
                      className={cn('combo-item-check', value === opt.key ? 'opacity-100' : 'opacity-0')}
                    />
                    <span className="combo-item-label">
                      <i>{opt.label}</i>
                    </span>
                    {opt.sub && <span className="combo-item-sub">{opt.sub}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}
