/**
 * useSelection
 *
 * Subscribes to the yFiles GraphComponent selection model and
 * returns the currently selected BPMN element as typed React state.
 *
 * yFiles 3.0: graphComponent.selection uses addItemAddedListener /
 * addItemRemovedListener (not addItemSelectionChangedListener from 2.x).
 */
import { useEffect, useState } from 'react'
import type { SelectionState } from '../types/graph-state'
import type { BpmnNodeData, BpmnEdgeData } from '../types/bpmn'

type Listener = (...args: unknown[]) => void

interface SelectionCollection {
  size: number
  first?(): unknown
  [Symbol.iterator]?(): Iterator<unknown>
  // yFiles 3.0
  addItemAddedListener?(l: Listener): void
  removeItemAddedListener?(l: Listener): void
  addItemRemovedListener?(l: Listener): void
  removeItemRemovedListener?(l: Listener): void
  // yFiles 2.x
  addItemSelectionChangedListener?(l: Listener): void
  removeItemSelectionChangedListener?(l: Listener): void
}

function getFirstItem(sel: SelectionCollection): unknown {
  if (sel.size === 0) return null
  if (typeof sel.first === 'function') return sel.first()
  if (typeof sel[Symbol.iterator] === 'function') {
    const iter = sel[Symbol.iterator]!()
    const result = iter.next()
    return result.done ? null : result.value
  }
  return null
}

function subscribe(sel: SelectionCollection, listener: Listener): () => void {
  if (typeof sel.addItemAddedListener === 'function') {
    // yFiles 3.0
    sel.addItemAddedListener(listener)
    sel.addItemRemovedListener?.(listener)
    return () => {
      sel.removeItemAddedListener?.(listener)
      sel.removeItemRemovedListener?.(listener)
    }
  }
  if (typeof sel.addItemSelectionChangedListener === 'function') {
    // yFiles 2.x
    sel.addItemSelectionChangedListener(listener)
    return () => sel.removeItemSelectionChangedListener?.(listener)
  }
  console.warn('[useSelection] No known selection listener API found.')
  return () => {}
}

function isNode(item: unknown): boolean {
  return typeof item === 'object' && item !== null && 'ports' in item
}

function isEdge(item: unknown): boolean {
  return typeof item === 'object' && item !== null && 'sourceNode' in item
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

    const update = () => {
      const item = getFirstItem(sel)
      if (!item) {
        setSelection(null)
        return
      }
      if (isNode(item)) {
        const node = item as { tag?: BpmnNodeData }
        setSelection({
          kind: 'node',
          id: String(item),
          data: node.tag ?? ({ type: 'Task', label: '' } as BpmnNodeData),
        })
      } else if (isEdge(item)) {
        const edge = item as { tag?: BpmnEdgeData }
        setSelection({
          kind: 'edge',
          id: String(item),
          data: edge.tag ?? ({ type: 'SequenceFlow' } as BpmnEdgeData),
        })
      } else {
        setSelection(null)
      }
    }

    const unsubscribe = subscribe(sel, update)
    update()
    return unsubscribe
  }, [graphComponent, isReady])

  return selection
}
