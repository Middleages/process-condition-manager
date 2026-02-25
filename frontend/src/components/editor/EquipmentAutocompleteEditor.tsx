import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from 'react'
import type { ICellEditorParams } from 'ag-grid-community'

export interface EquipmentOption {
  id: number
  equipment_name: string
  equipment_model: string | null
}

interface EquipmentAutocompleteEditorProps extends ICellEditorParams {
  equipments: EquipmentOption[]
}

export const EquipmentAutocompleteEditor = forwardRef(
  (props: EquipmentAutocompleteEditorProps, ref) => {
    const { value: initialValue, equipments } = props
    const inputRef = useRef<HTMLInputElement>(null)
    const listRef = useRef<HTMLDivElement>(null)

    const [inputValue, setInputValue] = useState<string>(
      initialValue != null ? String(initialValue) : ''
    )
    const [selectedValue, setSelectedValue] = useState<string | null>(null)
    const [highlightIndex, setHighlightIndex] = useState<number>(0)

    const filteredEquipments = useMemo(() => {
      if (!inputValue.trim()) return equipments
      const query = inputValue.toLowerCase()
      return equipments.filter(
        (eq) => eq.equipment_name.toLowerCase().includes(query)
      )
    }, [inputValue, equipments])

    // Expose AG Grid cell editor interface
    useImperativeHandle(ref, () => ({
      getValue(): string | null {
        if (selectedValue !== null) return selectedValue
        // Allow free-text input for legacy data
        const trimmed = inputValue.trim()
        return trimmed === '' ? null : trimmed
      },
      isPopup(): boolean {
        return true
      },
      isCancelAfterEnd(): boolean {
        return false
      },
    }))

    // Auto-focus input on mount
    useEffect(() => {
      // Small delay to ensure DOM is ready
      const timer = setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 0)
      return () => clearTimeout(timer)
    }, [])

    // Reset highlight when filtered list changes
    useEffect(() => {
      setHighlightIndex(0)
    }, [filteredEquipments.length])

    // Scroll highlighted item into view
    useEffect(() => {
      if (!listRef.current) return
      const items = listRef.current.querySelectorAll('[data-eq-item]')
      const item = items[highlightIndex] as HTMLElement | undefined
      if (item) {
        item.scrollIntoView({ block: 'nearest' })
      }
    }, [highlightIndex])

    const handleSelect = useCallback(
      (equipmentName: string) => {
        setInputValue(equipmentName)
        setSelectedValue(equipmentName)
        // Stop editing after selection
        setTimeout(() => {
          props.stopEditing()
        }, 0)
      },
      [props]
    )

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setHighlightIndex((prev) =>
            prev < filteredEquipments.length - 1 ? prev + 1 : prev
          )
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          setHighlightIndex((prev) => (prev > 0 ? prev - 1 : 0))
        } else if (e.key === 'Enter') {
          e.preventDefault()
          if (filteredEquipments.length > 0 && highlightIndex < filteredEquipments.length) {
            handleSelect(filteredEquipments[highlightIndex].equipment_name)
          } else {
            // Accept free-text input
            props.stopEditing()
          }
        } else if (e.key === 'Escape') {
          props.stopEditing(true)
        } else if (e.key === 'Tab') {
          // Allow Tab to accept current value and move to next cell
          if (filteredEquipments.length > 0 && highlightIndex < filteredEquipments.length) {
            setSelectedValue(filteredEquipments[highlightIndex].equipment_name)
          }
        }
      },
      [filteredEquipments, highlightIndex, handleSelect, props]
    )

    const handleInputChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        setInputValue(e.target.value)
        setSelectedValue(null)
      },
      []
    )

    return (
      <div className="bg-white border border-gray-300 rounded shadow-lg min-w-[200px]">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          className="w-full px-2 py-1.5 text-sm border-b border-gray-200 outline-none focus:ring-1 focus:ring-blue-400"
          placeholder="설비명 검색..."
        />
        <div
          ref={listRef}
          className="max-h-[200px] overflow-y-auto"
        >
          {filteredEquipments.length === 0 ? (
            <div className="px-3 py-2 text-sm text-gray-400">
              검색 결과 없음
            </div>
          ) : (
            filteredEquipments.map((eq, index) => (
              <div
                key={eq.id}
                data-eq-item
                className={`px-3 py-1.5 text-sm cursor-pointer ${
                  index === highlightIndex
                    ? 'bg-blue-100 text-blue-900'
                    : 'hover:bg-gray-50'
                }`}
                onMouseDown={(e) => {
                  // Use mouseDown instead of click to fire before blur
                  e.preventDefault()
                  handleSelect(eq.equipment_name)
                }}
                onMouseEnter={() => setHighlightIndex(index)}
              >
                <span>{eq.equipment_name}</span>
                {eq.equipment_model && (
                  <span className="ml-1.5 text-gray-400">
                    ({eq.equipment_model})
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    )
  }
)

EquipmentAutocompleteEditor.displayName = 'EquipmentAutocompleteEditor'
