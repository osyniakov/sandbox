/**
 * useSelection
 *
 * Subscribes to the yFiles GraphComponent selection model and
 * returns the currently selected BPMN element as typed React state.
 *
 * yFiles 3.0 compatibility:
 *  - addItemSelectionChangedListener was removed from the selection collection
 *  - yFiles 3.0 exposes selection changes via GraphComponent-level events or
 *    via selectedItems observable collections
 *  - We probe for the available API and register accordingly
 */
import { useEffect, useState } from 'react'
import type { SelectionState } from '../types/graph-state'
import type { BpmnNodeData, BpmnEdgeData } from '../types/bpmn'

type Listener = (...args: unknown[]) => void

function getFirstItem(sel: unknown): unknown {
  if (!sel || typeof sel !== 'object') return null
  const s = sel as Record<string, unknown>

  // yFiles 2.x: .first() method
  if (typeof s.first === 'function') return (s.first as () => unknown)()

  // yFiles 3.0: iterable collection
  const iterable = sel as Iterable<unknown>
  if (typeof iterable[Symbol.iterator] === 'function') {
    const iter = iterable[Symbol.iterator]()
    const result = iter.next()
    return result.done ? null : result.value
  }

  return null
}

function getSize(sel: unknown): number {
  if (!sel || typeof sel !== 'object') return 0
  const s = sel as Record<string, unknown>
  if (typeof s.size === 'number') return s.size
  if (typeof s.count === 'number') return s.count  // yFiles 3.0 possible name
  return 0
}

function subscribeSelection(gc: unknown, listener: Listener): (() => void) | null {
  if (!gc || typeof gc !== 'object') return null
  const comp = gc as Record<string, unknown>

  // ── Approach 1: graphComponent.selection.addItemSelectionChangedListener (yFiles 2.x)
  const sel = comp.selection as Record<string, unknown> | undefined
  if (sel && typeof sel.addItemSelectionChangedListener === 'function') {
    sel.addItemSelectionChangedListener(listener)
    return () => {
      if (typeof sel.removeItemSelectionChangedListener === 'function') {
        sel.removeItemSelectionChangedListener(listener)
      }
    }
  }

  // ── Approach 2: graphComponent.selection uses addChangedListener (some 3.0 builds)
  if (sel && typeof sel.addChangedListener === 'function') {
    sel.addChangedListener(listener)
    return () => {
      if (typeof sel.removeChangedListener === 'function') {
        sel.removeChangedListener(listener)
      }
    }
  }

  // ── Approach 3: graphComponent.addSelectionChangedListener (3.0 top-level event)
  if (typeof comp.addSelectionChangedListener === 'function') {
    ;(comp.addSelectionChangedListener as (l: Listener) => void)(listener)
    return () => {
      if (typeof comp.removeSelectionChangedListener === 'function') {
        ;(comp.removeSelectionChangedListener as (l: Listener) => void)(listener)
      }
    }
  }

  // ── Approach 4: graphComponent.selection.selectedItems observable (3.0)
  const selectedItems = sel?.selectedItems as Record<string, unknown> | undefined
  if (selectedItems && typeof selectedItems.addItemAdded === 'function') {
    selectedItems.addItemAdded(listener)
    selectedItems.addItemRemoved?.(listener)
    return () => {
      selectedItems.removeItemAdded?.(listener)
      selectedItems.removeItemRemoved?.(listener)
    }
  }

  // ── Approach 5: graphComponent.currentItem changed (single-select fallback)
  if (typeof comp.addCurrentItemChangedListener === 'function') {
    ;(comp.addCurrentItemChangedListener as (l: Listener) => void)(listener)
    return () => {
      if (typeof comp.removeCurrentItemChangedListener === 'function') {
        ;(comp.removeCurrentItemChangedListener as (l: Listener) => void)(listener)
      }
    }
  }

  console.warn('[useSelection] Could not find a selection change API on GraphComponent. Selection panel will not update.')
  const gcObj = gc as Record<string, unknown>
  const selObj = gcObj.selection
  console.info('[useSelection] graphComponent methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(gc)).filter(k => k.toLowerCase().includes('select') || k.toLowerCase().includes('current') || k.toLowerCase().includes('listen') || k.toLowerCase().includes('changed')))
  if (selObj && typeof selObj === 'object') {
    console.info('[useSelection] selection methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(selObj)).filter(k => k.toLowerCase().includes('listen') || k.toLowerCase().includes('changed') || k.toLowerCase().includes('add') || k.toLowerCase().includes('on')))
  }
  return null
}

function isNode(item: unknown): boolean {
  return typeof item === 'object' && item !== null && 'ports' in item
}

function isEdge(item: unknown): boolean {
  return typeof item === 'object' && item !== null && 'sourceNode' in item
}

function readSelection(gc: unknown): SelectionState {
  const comp = gc as Record<string, unknown>
  const sel = comp.selection

  if (getSize(sel) === 0) {
    // Also check currentItem for single-select fallback (approach 5)
    const current = comp.currentItem
    if (!current) return null
    if (isNode(current)) {
      const node = current as { tag?: BpmnNodeData }
      return { kind: 'node', id: String(current), data: node.tag ?? ({ type: 'Task', label: '' } as BpmnNodeData) }
    }
    if (isEdge(current)) {
      const edge = current as { tag?: BpmnEdgeData }
      return { kind: 'edge', id: String(current), data: edge.tag ?? ({ type: 'SequenceFlow' } as BpmnEdgeData) }
    }
    return null
  }

  const item = getFirstItem(sel)
  if (!item) return null

  if (isNode(item)) {
    const node = item as { tag?: BpmnNodeData }
    return { kind: 'node', id: String(item), data: node.tag ?? ({ type: 'Task', label: '' } as BpmnNodeData) }
  }
  if (isEdge(item)) {
    const edge = item as { tag?: BpmnEdgeData }
    return { kind: 'edge', id: String(item), data: edge.tag ?? ({ type: 'SequenceFlow' } as BpmnEdgeData) }
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

    const update = () => setSelection(readSelection(graphComponent))

    const unsubscribe = subscribeSelection(graphComponent, update)
    update()

    return () => {
      unsubscribe?.()
    }
  }, [graphComponent, isReady])

  return selection
}
