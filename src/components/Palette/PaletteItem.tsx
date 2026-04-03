import type { PaletteEntry } from '../../types/bpmn'
import type { BpmnNodeData } from '../../types/bpmn'

interface PaletteItemProps {
  entry: PaletteEntry
  onDragStart: (event: DragEvent, data: BpmnNodeData) => void
}

export function PaletteItem({ entry, onDragStart }: PaletteItemProps) {
  const data: BpmnNodeData = {
    type: entry.nodeType!,
    label: entry.label,
    eventDefinition: entry.eventDefinition,
  }

  function handleDragStart(e: React.DragEvent<HTMLDivElement>) {
    onDragStart(e.nativeEvent, data)
  }

  return (
    <div
      className="palette-item"
      draggable
      onDragStart={handleDragStart}
      title={`Drag to add: ${entry.label}`}
      role="listitem"
    >
      <span className="palette-item__icon" aria-hidden="true">
        {getIcon(entry)}
      </span>
      <span className="palette-item__label">{entry.label}</span>
    </div>
  )
}

function getIcon(entry: PaletteEntry): string {
  const { nodeType } = entry
  if (!nodeType) return '→'

  if (nodeType.includes('StartEvent')) return '○'
  if (nodeType.includes('EndEvent')) return '●'
  if (nodeType.includes('Event')) return '◎'
  if (nodeType.includes('Task') || nodeType === 'SubProcess' || nodeType === 'CallActivity') return '▭'
  if (nodeType.includes('Gateway')) return '◇'
  if (nodeType === 'DataObject') return '📄'
  if (nodeType === 'DataStore') return '🗄'
  if (nodeType === 'Group') return '⬜'
  if (nodeType === 'TextAnnotation') return '📝'
  if (nodeType === 'Pool') return '▬'
  if (nodeType === 'Lane') return '━'
  return '▭'
}
