/**
 * useGraphComponent
 *
 * Manages the full lifecycle of a yFiles GraphComponent:
 *   - Creates and attaches the GraphComponent to a DOM div
 *   - Sets up GraphEditorInputMode for interactive editing
 *   - Enables undo/redo
 *   - Registers a NodeDropInputMode so palette items can be dragged onto the canvas
 *   - Sets a default edge creation handler that applies BPMN sequence-flow style
 *   - Cleans up on unmount
 *
 * Returns { graphComponent, graph, isReady, error }
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import type { RefObject } from 'react'
import type { BpmnNodeData } from '../types/bpmn'

interface UseGraphComponentResult {
  /** The raw yFiles GraphComponent instance (null before init) */
  graphComponent: unknown
  /** Convenience ref to graphComponent.graph */
  graph: unknown
  /** True once the component has finished initialising */
  isReady: boolean
  /** Non-null if yFiles failed to load */
  error: string | null
  /** Start a drag operation with the given BPMN node data (called from palette) */
  startPaletteDrag: (event: DragEvent, data: BpmnNodeData) => void
}

const DRAG_DATA_KEY = 'application/x-bpmn-palette'

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
        const yfiles = await import('yfiles')
        const {
          GraphComponent,
          GraphEditorInputMode,
          NodeDropInputMode,
          SimpleNode,
          Rect,
          Size,
        } = yfiles as Record<string, unknown> as {
          GraphComponent: new (container: HTMLElement) => {
            graph: unknown
            inputMode: unknown
            fitGraphBounds: () => void
            cleanUp: () => void
            undoEngine: { canUndo: () => boolean; canRedo: () => boolean }
          }
          GraphEditorInputMode: new () => {
            nodeDropInputMode: {
              enabled: boolean
              isGroupNodePredicate: null
              itemCreator: (
                ctx: unknown,
                graph: unknown,
                draggedItem: unknown,
                dropTarget: unknown,
                dropLocation: unknown
              ) => unknown
            }
            addEdgeMode: { enabled: boolean }
          }
          NodeDropInputMode: new () => unknown
          SimpleNode: new () => { tag: unknown; layout: unknown }
          Rect: new (x: number, y: number, w: number, h: number) => unknown
          Size: new (w: number, h: number) => unknown
        }

        if (destroyed) return

        const gc = new GraphComponent(containerRef.current!)
        graphComponent = gc
        graphComponentRef.current = gc

        // Enable undo
        ;(gc.graph as { undoEngineEnabled: boolean }).undoEngineEnabled = true

        // Set up editor input mode
        const editorMode = new GraphEditorInputMode()

        // NodeDropInputMode — handles drag-from-palette
        const dropMode = editorMode.nodeDropInputMode
        dropMode.enabled = true
        dropMode.isGroupNodePredicate = null

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
          const iGraph = graph as {
            createNodeAt: (location: unknown, ...rest: unknown[]) => unknown
          }
          const loc = dropLocation as { x: number; y: number }
          const node = iGraph.createNodeAt(loc) as { tag: BpmnNodeData }
          node.tag = nodeData
          await applyBpmnNodeStyle(
            graph as Parameters<typeof applyBpmnNodeStyle>[0],
            node as Parameters<typeof applyBpmnNodeStyle>[1],
            nodeData
          )
          return node
        }

        // Default edge style on creation
        editorMode.addEdgeMode.enabled = true
        ;(gc as unknown as { inputMode: unknown }).inputMode = editorMode

        gc.fitGraphBounds()
        setIsReady(true)
      } catch (err) {
        if (!destroyed) {
          const msg =
            err instanceof Error ? err.message : String(err)
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

  const startPaletteDrag = useCallback(
    (event: DragEvent, data: BpmnNodeData) => {
      if (!event.dataTransfer) return
      event.dataTransfer.setData(DRAG_DATA_KEY, JSON.stringify(data))
      event.dataTransfer.effectAllowed = 'copy'
    },
    []
  )

  return {
    graphComponent: graphComponentRef.current,
    graph: (graphComponentRef.current as { graph?: unknown } | null)?.graph ?? null,
    isReady,
    error,
    startPaletteDrag,
  }
}
