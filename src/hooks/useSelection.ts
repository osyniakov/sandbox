/**
 * useSelection
 *
 * Subscribes to the yFiles GraphComponent selection model and
 * returns the currently selected BPMN element as typed React state.
 *
 * yFiles 3.0 notes:
 *  - graphComponent.selection still exists
 *  - addItemSelectionChangedListener callback signature changed:
 *    it now receives (sender, evt) where evt has .item and .itemSelected
 *  - Safe to call with no args as a plain update trigger
 */
import { useEffect, useState } from 'react'
import type { SelectionState } from '../types/graph-state'
import type { BpmnNodeData, BpmnEdgeData } from '../types/bpmn'

interface SelectionCollection {
  size: number
  /** Returns first selected item, or null/undefined if empty */
  first?(): unknown
  /** Iterable in yFiles 3.0 */
  [Symbol.iterator]?(): Iterator<unknown>
  addItemSelectionChangedListener(listener: (...args: unknown[]) => void): void
  removeItemSelectionChangedListener(listener: (...args: unknown[]) => void): void
}

interface GraphComponentWithSelection {
  selection: SelectionCollection
}

function isNode(item: unknown): boolean {
  // INode has a `ports` collection
  return typeof item === 'object' && item !== null && 'ports' in item
}

function isEdge(item: unknown): boolean {
  // IEdge has sourceNode / targetNode
  return typeof item === 'object' && item !== null && 'sourceNode' in item
}

function getFirstSelected(sel: SelectionCollection): unknown {
  if (sel.size === 0) return null
  if (typeof sel.first === 'function') return sel.first()
  // yFiles 3.0 fallback: iterate
  if (sel[Symbol.iterator]) {
    const iter = sel[Symbol.iterator]!()
    const result = iter.next()
    return result.done ? null : result.value
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

    const gc = graphComponent as GraphComponentWithSelection
    if (!gc.selection) return

    const update = () => {
      const sel = gc.selection
      if (sel.size === 0) {
        setSelection(null)
        return
      }

      const item = getFirstSelected(sel)
      if (!item) {
        setSelection(null)
        return
      }

      if (isNode(item)) {
        const node = item as { tag?: BpmnNodeData }
        const data = node.tag ?? ({ type: 'Task', label: '' } as BpmnNodeData)
        setSelection({ kind: 'node', id: String(item), data })
      } else if (isEdge(item)) {
        const edge = item as { tag?: BpmnEdgeData }
        const data = edge.tag ?? ({ type: 'SequenceFlow' } as BpmnEdgeData)
        setSelection({ kind: 'edge', id: String(item), data })
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
