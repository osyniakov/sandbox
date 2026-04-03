import type { SelectionState } from '../../types/graph-state'
import type { BpmnNodeData, BpmnEdgeData } from '../../types/bpmn'
import { NodeProperties } from './NodeProperties'
import { EdgeProperties } from './EdgeProperties'
import './PropertiesPanel.css'

interface PropertiesPanelProps {
  selection: SelectionState
  onNodeChange: (id: string, patch: Partial<BpmnNodeData>) => void
  onEdgeChange: (id: string, patch: Partial<BpmnEdgeData>) => void
}

export function PropertiesPanel({
  selection,
  onNodeChange,
  onEdgeChange,
}: PropertiesPanelProps) {
  return (
    <aside className="properties-panel" aria-label="Element properties">
      <div className="properties-panel__header">Properties</div>

      {!selection && (
        <div className="properties-panel__empty">
          <p>Select an element to view and edit its properties.</p>
        </div>
      )}

      {selection?.kind === 'node' && (
        <>
          <div className="properties-panel__type-badge">
            {selection.data.type.replace(/([A-Z])/g, ' $1').trim()}
          </div>
          <NodeProperties
            data={selection.data}
            onChange={(patch) => onNodeChange(selection.id, patch)}
          />
        </>
      )}

      {selection?.kind === 'edge' && (
        <>
          <div className="properties-panel__type-badge edge">Edge</div>
          <EdgeProperties
            data={selection.data}
            onChange={(patch) => onEdgeChange(selection.id, patch)}
          />
        </>
      )}
    </aside>
  )
}
