import * as React from 'react'
import { useState, useRef, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { ChevronDown, ChevronUp, Check, Search } from 'lucide-react'

export interface ComboboxOption {
  value: string
  label: string
}

interface ComboboxProps {
  options: ComboboxOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  className?: string
  disabled?: boolean
  required?: boolean
}

export function Combobox({
  options,
  value,
  onChange,
  placeholder = '선택하세요',
  searchPlaceholder = '검색...',
  className,
  disabled = false,
  required = false,
}: ComboboxProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(-1)

  const containerRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const selectedOption = options.find((opt) => opt.value === value)

  const filtered = options.filter((opt) =>
    opt.label.toLowerCase().includes(search.toLowerCase())
  )

  // Focus search input when dropdown opens
  useEffect(() => {
    if (open && searchRef.current) {
      searchRef.current.focus()
    }
    if (!open) {
      setSearch('')
      setHighlightedIndex(-1)
    }
  }, [open])

  // Reset highlighted index when search changes
  useEffect(() => {
    setHighlightedIndex(-1)
  }, [search])

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightedIndex >= 0 && listRef.current) {
      const item = listRef.current.children[highlightedIndex] as HTMLElement
      if (item) {
        item.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [highlightedIndex])

  // Click outside to close
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Keyboard navigation
  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault()
        setOpen(true)
      }
      return
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setHighlightedIndex((prev) => (prev < filtered.length - 1 ? prev + 1 : prev))
        break
      case 'ArrowUp':
        e.preventDefault()
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : 0))
        break
      case 'Enter':
        e.preventDefault()
        if (highlightedIndex >= 0 && filtered[highlightedIndex]) {
          selectOption(filtered[highlightedIndex].value)
        }
        break
      case 'Escape':
        e.preventDefault()
        setOpen(false)
        break
    }
  }

  function selectOption(optValue: string) {
    onChange(optValue)
    setOpen(false)
  }

  return (
    <div ref={containerRef} className={cn('relative w-full', className)}>
      {/* Hidden native input for form validation */}
      <input
        type="hidden"
        value={value}
        required={required}
      />

      {/* Trigger button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={handleKeyDown}
        className={cn(
          'flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          'disabled:cursor-not-allowed disabled:opacity-50',
          open && 'ring-1 ring-ring'
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={cn(!selectedOption && 'text-muted-foreground')}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 opacity-50 shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-input bg-popover shadow-md">
          {/* Search input */}
          <div className="flex items-center border-b border-input px-2">
            <Search className="h-4 w-4 shrink-0 opacity-50 mr-1" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={searchPlaceholder}
              className="flex h-8 w-full bg-transparent py-1 text-sm placeholder:text-muted-foreground focus-visible:outline-none"
            />
          </div>

          {/* Options list */}
          <ul
            ref={listRef}
            role="listbox"
            className="max-h-48 overflow-y-auto py-1"
          >
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-muted-foreground text-center">
                검색 결과 없음
              </li>
            ) : (
              filtered.map((opt, idx) => (
                <li
                  key={opt.value}
                  role="option"
                  aria-selected={opt.value === value}
                  onMouseDown={(e) => {
                    // Prevent blur before click registers
                    e.preventDefault()
                    selectOption(opt.value)
                  }}
                  onMouseEnter={() => setHighlightedIndex(idx)}
                  className={cn(
                    'flex items-center justify-between px-3 py-1.5 text-sm cursor-pointer select-none',
                    idx === highlightedIndex && 'bg-accent text-accent-foreground',
                    opt.value === value && idx !== highlightedIndex && 'bg-accent/50'
                  )}
                >
                  <span>{opt.label}</span>
                  {opt.value === value && (
                    <Check className="h-4 w-4 shrink-0 text-primary" />
                  )}
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
