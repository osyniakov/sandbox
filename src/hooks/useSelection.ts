/**
 * useSelection — yFiles 3.0
 *
 * Subscribes to the yFiles GraphComponent selection collection and
 * returns the currently selected BPMN element as typed React state.
 *
 * yFiles 3.0: graphComponent.selection exposes
 *   addItemAddedListener / addItemRemovedListener
 */
import { useEffect, useState } from 'react'
import type { SelectionState } from '../types/graph-state'
import type { BpmnNodeData, BpmnEdgeData } from '../types/bpmn'

type Listener = (...args: unknown[]) => void

interface SelectionCollection {
  size: number
  first(): unknown
  addItemAddedListener(l: Listener): void
  removeItemAddedListener(l: Listener): void
  addItemRemovedListener(l: Listener): void
  removeItemRemovedListener(l: Listener): void
}

function isNode(item: unknown): boolean {
  return typeof item === 'object' && item !== null && 'ports' in item
}

function isEdge(item: unknown): boolean {
  return typeof item === 'object' && item !== null && 'sourceNode' in item
}

function readSelection(sel: SelectionCollection): SelectionState {
  if (sel.size === 0) return null
  const item = sel.first()
  if (!item) return null

  if (isNode(item)) {
    const node = item as { tag?: BpmnNodeData }
    return {
      kind: 'node',
      id: String(item),
      data: node.tag ?? ({ type: 'Task', label: '' } as BpmnNodeData),
    }
  }
  if (isEdge(item)) {
    const edge = item as { tag?: BpmnEdgeData }
    return {
      kind: 'edge',
      id: String(item),
      data: edge.tag ?? ({ type: 'SequenceFlow' } as BpmnEdgeData),
    }
  }
  return null
}

export function useSelection(
  graphComponent: unknown,
  isReady: boolean
): SelectionState {
  const [selection, setSelection] = useState<SelectionState>(null)

  useEffect(() => {
    if (!isReady || !graphComponent) return

    const sel = (graphComponent as { selection: SelectionCollection }).selection
    if (!sel) return

    const update = () => setSelection(readSelection(sel))

    sel.addItemAddedListener(update)
    sel.addItemRemovedListener(update)
    update()

    return () => {
      sel.removeItemAddedListener(update)
      sel.removeItemRemovedListener(update)
    }
  }, [graphComponent, isReady])

  return selection
}
