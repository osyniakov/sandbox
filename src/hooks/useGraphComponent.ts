/**
 * useGraphComponent — yFiles 3.0
 *
 * Manages the full lifecycle of a yFiles GraphComponent:
 *   - Creates and attaches the GraphComponent to a DOM div
 *   - Sets up GraphEditorInputMode for interactive editing
 *   - Registers a NodeDropInputMode for palette drag-and-drop
 *   - Cleans up on unmount
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import type { RefObject } from 'react'
import type { BpmnNodeData } from '../types/bpmn'

interface UseGraphComponentResult {
  graphComponent: unknown
  graph: unknown
  isReady: boolean
  error: string | null
  startPaletteDrag: (event: DragEvent, data: BpmnNodeData) => void
}

export function useGraphComponent(
  containerRef: RefObject<HTMLDivElement | null>
): UseGraphComponentResult {
  const graphComponentRef = useRef<unknown>(null)
  const [isReady, setIsReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    let destroyed = false
    let graphComponent: { cleanUp: () => void } | null = null

    async function init() {
      try {
        const { GraphComponent, GraphEditorInputMode, NodeDropInputMode } =
          await import('yfiles') as unknown as {
            GraphComponent: new (container: HTMLElement) => {
              graph: unknown
              inputMode: unknown
              fitGraphBounds: () => void
              cleanUp: () => void
            }
            GraphEditorInputMode: new () => unknown
            NodeDropInputMode: new () => {
              enabled: boolean
              isGroupNodePredicate: unknown
              itemCreator: unknown
            }
          }

        if (destroyed) return

        const gc = new GraphComponent(containerRef.current!)
        graphComponent = gc
        graphComponentRef.current = gc

        // yFiles 3.0: undo is enabled by default on the graph

        const editorMode = new GraphEditorInputMode()

        // yFiles 3.0: NodeDropInputMode is not pre-created — instantiate and assign
        const dropMode = new NodeDropInputMode()
        dropMode.enabled = true
        dropMode.isGroupNodePredicate = null
        ;(editorMode as unknown as Record<string, unknown>).nodeDropInputMode = dropMode

        dropMode.itemCreator = async (
          _ctx: unknown,
          graph: unknown,
          draggedItem: unknown,
          _dropTarget: unknown,
          dropLocation: unknown
        ) => {
          const nodeData = (draggedItem as { tag: BpmnNodeData } | null)?.tag
          if (!nodeData) return null

          const { applyBpmnNodeStyle } = await import('../yfiles/bpmn-styles')
          const iGraph = graph as { createNodeAt: (loc: unknown) => unknown }
          const node = iGraph.createNodeAt(dropLocation) as { tag: BpmnNodeData }
          node.tag = nodeData
          await applyBpmnNodeStyle(
            graph as Parameters<typeof applyBpmnNodeStyle>[0],
            node as Parameters<typeof applyBpmnNodeStyle>[1],
            nodeData
          )
          return node
        }

        const addEdgeMode = (editorMode as unknown as Record<string, unknown>).addEdgeMode as
          | { enabled: boolean } | undefined
        if (addEdgeMode) addEdgeMode.enabled = true

        ;(gc as unknown as { inputMode: unknown }).inputMode = editorMode
        gc.fitGraphBounds()
        setIsReady(true)
      } catch (err) {
        if (!destroyed) {
          const msg = err instanceof Error ? err.message : String(err)
          setError(
            msg.includes('Cannot find module') || msg.includes('Failed to resolve')
              ? 'yFiles for HTML is not installed.\n\nDownload the evaluation package from https://my.yworks.com/, place it at lib/yfiles.tgz, then run npm install.'
              : `yFiles initialisation error: ${msg}`
          )
        }
      }
    }

    init()

    return () => {
      destroyed = true
      graphComponent?.cleanUp()
      graphComponentRef.current = null
    }
  }, [containerRef])

  const startPaletteDrag = useCallback((event: DragEvent, data: BpmnNodeData) => {
    if (!event.dataTransfer) return
    event.dataTransfer.setData('application/x-bpmn-palette', JSON.stringify(data))
    event.dataTransfer.effectAllowed = 'copy'
  }, [])

  return {
    graphComponent: graphComponentRef.current,
    graph: (graphComponentRef.current as { graph?: unknown } | null)?.graph ?? null,
    isReady,
    error,
    startPaletteDrag,
  }
}
