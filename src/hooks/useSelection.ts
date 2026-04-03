/**
 * useSelection
 *
 * Subscribes to the yFiles GraphComponent selection model and
 * returns the currently selected BPMN element as typed React state.
 */
import { useEffect, useState } from 'react'
import type { SelectionState } from '../types/graph-state'
import type { BpmnNodeData, BpmnEdgeData } from '../types/bpmn'

interface SelectionModel {
  size: number
  first(): unknown
  addItemSelectionChangedListener(listener: () => void): void
  removeItemSelectionChangedListener(listener: () => void): void
}

interface GraphComponentWithSelection {
  selection: SelectionModel
}

interface YFilesNode {
  tag?: BpmnNodeData
  ports?: unknown
  edges?: unknown
}

interface YFilesEdge {
  tag?: BpmnEdgeData
  sourceNode?: unknown
  targetNode?: unknown
}

function isNode(item: unknown): item is YFilesNode {
  // yFiles INode has a `ports` collection
  return typeof item === 'object' && item !== null && 'ports' in item
}

function isEdge(item: unknown): item is YFilesEdge {
  // yFiles IEdge has sourceNode / targetNode
  return typeof item === 'object' && item !== null && 'sourceNode' in item
}

export function useSelection(
  graphComponent: unknown,
  isReady: boolean
): SelectionState {
  const [selection, setSelection] = useState<SelectionState>(null)

  useEffect(() => {
    if (!isReady || !graphComponent) return

    const gc = graphComponent as GraphComponentWithSelection

    const update = () => {
      const sel = gc.selection
      if (sel.size === 0) {
        setSelection(null)
        return
      }
      const item = sel.first()

      if (isNode(item)) {
        const data = item.tag ?? { type: 'Task' as unknown as BpmnNodeData['type'], label: '' }
        setSelection({ kind: 'node', id: String(item), data: data as BpmnNodeData })
      } else if (isEdge(item)) {
        const data = item.tag ?? { type: 'SequenceFlow' as unknown as BpmnEdgeData['type'] }
        setSelection({ kind: 'edge', id: String(item), data: data as BpmnEdgeData })
      } else {
        setSelection(null)
      }
    }

    gc.selection.addItemSelectionChangedListener(update)
    update()

    return () => {
      gc.selection.removeItemSelectionChangedListener(update)
    }
  }, [graphComponent, isReady])

  return selection
}
