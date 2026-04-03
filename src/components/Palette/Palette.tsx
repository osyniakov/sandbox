import { useMemo } from 'react'
import { PALETTE_ENTRIES, PaletteCategory } from '../../types/bpmn'
import type { BpmnNodeData } from '../../types/bpmn'
import { PaletteItem } from './PaletteItem'
import './Palette.css'

interface PaletteProps {
  onDragStart: (event: DragEvent, data: BpmnNodeData) => void
  disabled?: boolean
}

const CATEGORY_ORDER: PaletteCategory[] = [
  PaletteCategory.Events,
  PaletteCategory.Tasks,
  PaletteCategory.Gateways,
  PaletteCategory.Artifacts,
  PaletteCategory.Swimlanes,
]

export function Palette({ onDragStart, disabled }: PaletteProps) {
  const grouped = useMemo(() => {
    const map = new Map<PaletteCategory, typeof PALETTE_ENTRIES>()
    for (const cat of CATEGORY_ORDER) map.set(cat, [])
    for (const entry of PALETTE_ENTRIES) {
      if (entry.nodeType) {
        map.get(entry.category)?.push(entry)
      }
    }
    return map
  }, [])

  return (
    <aside className={`palette${disabled ? ' palette--disabled' : ''}`} aria-label="BPMN element palette">
      <div className="palette__header">Elements</div>
      <div className="palette__scroll">
        {CATEGORY_ORDER.map((cat) => {
          const items = grouped.get(cat) ?? []
          if (!items.length) return null
          return (
            <section key={cat} className="palette__category">
              <h3 className="palette__category-title">{cat}</h3>
              <div className="palette__items" role="list">
                {items.map((entry) => (
                  <PaletteItem key={entry.id} entry={entry} onDragStart={onDragStart} />
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </aside>
  )
}
