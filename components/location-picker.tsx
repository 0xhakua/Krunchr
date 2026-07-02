'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { searchZipCodes, type ZipCodeEntry } from '@/lib/data/zip-codes'

export interface LocationPickerProps {
  value?: string
  onChange: (entry: ZipCodeEntry | null) => void
  placeholder?: string
  disabled?: boolean
  id?: string
}

export function LocationPicker({
  value,
  onChange,
  placeholder = 'Search ZIP code, city, or province',
  disabled,
  id,
}: LocationPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  const results = useMemo(() => searchZipCodes(query), [query])

  const selected = useMemo(() => {
    if (!value) return undefined
    return searchZipCodes(value).find((r) => r.zipCode === value) ?? undefined
  }, [value])

  function handleSelect(entry: ZipCodeEntry) {
    onChange(entry)
    setQuery('')
    setOpen(false)
  }

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div ref={containerRef} className="relative w-full">
      <Button
        id={id}
        variant="outline"
        role="combobox"
        aria-expanded={open}
        className="w-full justify-between"
        disabled={disabled}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="truncate">
          {selected
            ? `${selected.zipCode} — ${selected.cityMunicipality}${selected.province ? `, ${selected.province}` : ''}`
            : placeholder}
        </span>
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </Button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover text-popover-foreground shadow-md">
          <div className="p-2">
            <Input
              placeholder="Type ZIP code, city, or province"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
          </div>
          <ul className="max-h-60 overflow-auto py-1">
            {results.length === 0 ? (
              <li className="px-3 py-2 text-sm text-muted-foreground">No location found.</li>
            ) : (
              results.map((entry) => {
                const isSelected = value === entry.zipCode
                return (
                  <li key={`${entry.zipCode}-${entry.cityMunicipality}`}>
                    <button
                      type="button"
                      className={cn(
                        'flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground',
                        isSelected && 'bg-accent'
                      )}
                      onClick={() => handleSelect(entry)}
                    >
                      <Check
                        className={cn(
                          'mt-0.5 h-4 w-4 shrink-0',
                          isSelected ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                      <div className="flex flex-col">
                        <span className="font-medium">
                          {entry.zipCode} — {entry.cityMunicipality}
                        </span>
                        <span className="text-xs text-muted-foreground">{entry.province}</span>
                      </div>
                    </button>
                  </li>
                )
              })
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
