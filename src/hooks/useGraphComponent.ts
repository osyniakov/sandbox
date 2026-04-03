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
        } = yfiles as Record<string, unknown> as {
          GraphComponent: new (container: HTMLElement) => {
            graph: unknown
            inputMode: unknown
            fitGraphBounds: () => void
            cleanUp: () => void
            undoEngine: { canUndo: () => boolean; canRedo: () => boolean }
          }
          GraphEditorInputMode: new () => unknown
          NodeDropInputMode: new () => unknown
        }

        if (destroyed) return

        const gc = new GraphComponent(containerRef.current!)
        graphComponent = gc
        graphComponentRef.current = gc

        // Enable undo — yFiles 2.x used undoEngineEnabled boolean on IGraph;
        // yFiles 3.0 exposes an undoEngine object that is enabled when present.
        const graphObj = gc.graph as Record<string, unknown>
        if ('undoEngineEnabled' in graphObj) {
          // yFiles 2.x
          ;(graphObj as { undoEngineEnabled: boolean }).undoEngineEnabled = true
        }
        // yFiles 3.0: undoEngine exists by default when the graph is created;
        // no explicit enabling required.

        // Set up editor input mode
        const editorMode = new GraphEditorInputMode()

        // NodeDropInputMode — handles drag-from-palette.
        // In yFiles 3.0 the mode is NOT pre-created on GraphEditorInputMode;
        // create it explicitly and assign it back.
        let dropMode = (editorMode as unknown as Record<string, unknown>).nodeDropInputMode as {
          enabled: boolean
          isGroupNodePredicate: unknown
          itemCreator: unknown
        } | undefined

        if (!dropMode) {
          // yFiles 3.0+: instantiate and assign explicitly
          const NodeDropInputModeClass = NodeDropInputMode as new () => {
            enabled: boolean
            isGroupNodePredicate: unknown
            itemCreator: unknown
          }
          dropMode = new NodeDropInputModeClass()
          ;(editorMode as unknown as Record<string, unknown>).nodeDropInputMode = dropMode
        }

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

        // Enable edge creation (addEdgeMode may be undefined in some yFiles 3.0 builds)
        const addEdgeMode = (editorMode as unknown as Record<string, unknown>).addEdgeMode as
          | { enabled: boolean }
          | undefined
        if (addEdgeMode) {
          addEdgeMode.enabled = true
        }

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
