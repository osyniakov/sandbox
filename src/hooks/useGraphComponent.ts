/**
 * useGraphComponent — yFiles 3.0
 *
 * Manages the full lifecycle of a yFiles GraphComponent.
 *
 * Palette drag-and-drop uses the yFiles NodeDropInputMode.startDrag() API
 * (not native dataTransfer) so that itemCreator receives a proper SimpleNode
 * with the BPMN tag attached.
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

/** Default node sizes per BPMN element category */
function defaultSize(type: string): { width: number; height: number } {
  if (type.includes('Event'))   return { width: 48,  height: 48 }
  if (type.includes('Gateway')) return { width: 50,  height: 50 }
  if (type === 'DataObject')    return { width: 40,  height: 55 }
  if (type === 'DataStore')     return { width: 60,  height: 50 }
  if (type === 'Pool')          return { width: 600, height: 200 }
  if (type === 'Lane')          return { width: 600, height: 100 }
  if (type === 'Group')         return { width: 200, height: 150 }
  if (type === 'TextAnnotation') return { width: 100, height: 60 }
  return { width: 120, height: 60 }
}

export function useGraphComponent(
  containerRef: RefObject<HTMLDivElement | null>
): UseGraphComponentResult {
  const graphComponentRef = useRef<unknown>(null)
  // Hold yFiles classes for synchronous use in drag-start handlers
  const yfilesClassesRef = useRef<{
    NodeDropInputMode: { startDrag(e: DragEvent, node: unknown, effects: unknown): void }
    SimpleNode: new () => { tag: unknown; layout: unknown }
    Rect: new (x: number, y: number, w: number, h: number) => unknown
    DragDropEffects: { ALL: unknown }
  } | null>(null)

  const [isReady, setIsReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    let destroyed = false
    let graphComponent: { cleanUp: () => void } | null = null

    async function init() {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const yf = await import('yfiles') as any

        if (destroyed) return

        const {
          GraphComponent,
          GraphEditorInputMode,
          NodeDropInputMode,
          SimpleNode,
          Rect,
          DragDropEffects,
        } = yf

        // Store for use in the synchronous startPaletteDrag callback
        yfilesClassesRef.current = { NodeDropInputMode, SimpleNode, Rect, DragDropEffects }

        const gc = new GraphComponent(containerRef.current!)
        graphComponent = gc
        graphComponentRef.current = gc

        const editorMode = new GraphEditorInputMode()

        // NodeDropInputMode — receives SimpleNode templates from startDrag()
        const dropMode = new NodeDropInputMode()
        dropMode.enabled = true
        dropMode.isGroupNodePredicate = null
        editorMode.nodeDropInputMode = dropMode

        dropMode.itemCreator = (
          _ctx: unknown,
          graph: { createNode(params: unknown): unknown; addLabel(node: unknown, text: string): void },
          draggedItem: { tag?: BpmnNodeData } | null,
          _dropTarget: unknown,
          dropLocation: { x: number; y: number }
        ) => {
          const nodeData = draggedItem?.tag
          if (!nodeData) return null

          const { width, height } = defaultSize(nodeData.type)
          const layout = new Rect(
            dropLocation.x - width / 2,
            dropLocation.y - height / 2,
            width,
            height
          )

          // createNode(layout, style, tag) — tag is stored on the node
          const node = graph.createNode({ layout, tag: nodeData })
          graph.addLabel(node, nodeData.label ?? '')
          return node
        }

        if (editorMode.addEdgeMode) editorMode.addEdgeMode.enabled = true

        gc.inputMode = editorMode
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
      yfilesClassesRef.current = null
    }
  }, [containerRef])

  /**
   * Called on dragstart from a palette item.
   * Creates a SimpleNode template carrying the BPMN tag and hands it to
   * NodeDropInputMode.startDrag() so itemCreator receives it on drop.
   */
  const startPaletteDrag = useCallback((event: DragEvent, data: BpmnNodeData) => {
    const yf = yfilesClassesRef.current
    if (!yf) return

    const { NodeDropInputMode, SimpleNode, Rect, DragDropEffects } = yf
    const { width, height } = defaultSize(data.type)

    const templateNode = new SimpleNode()
    templateNode.tag = data
    templateNode.layout = new Rect(0, 0, width, height)

    NodeDropInputMode.startDrag(event, templateNode, DragDropEffects.ALL)
  }, [])

  return {
    graphComponent: graphComponentRef.current,
    graph: (graphComponentRef.current as { graph?: unknown } | null)?.graph ?? null,
    isReady,
    error,
    startPaletteDrag,
  }
}
