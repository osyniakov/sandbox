/**
 * useGraphComponent — yFiles 3.0
 *
 * Manages the full lifecycle of a yFiles GraphComponent.
 *
 * Palette drag-and-drop uses NodeDropInputMode.startDrag() so itemCreator
 * receives a SimpleNode with the BPMN tag. Nodes are styled on creation
 * using ShapeNodeStyle (guaranteed available) with shapes matching BPMN
 * conventions; BpmnNodeStyle is applied asynchronously on top if available.
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

interface YFilesClasses {
  NodeDropInputMode: { startDrag(e: DragEvent, node: unknown, effects: unknown): void }
  SimpleNode: new () => { tag: unknown; layout: unknown }
  Rect: new (x: number, y: number, w: number, h: number) => unknown
  DragDropEffects: { ALL: unknown }
  ShapeNodeStyle: new (opts?: Record<string, unknown>) => unknown
}

function defaultSize(type: string): { width: number; height: number } {
  if (type.includes('Event'))    return { width: 48,  height: 48 }
  if (type.includes('Gateway'))  return { width: 50,  height: 50 }
  if (type === 'DataObject')     return { width: 40,  height: 55 }
  if (type === 'DataStore')      return { width: 60,  height: 50 }
  if (type === 'Pool')           return { width: 600, height: 200 }
  if (type === 'Lane')           return { width: 600, height: 100 }
  if (type === 'Group')          return { width: 200, height: 150 }
  if (type === 'TextAnnotation') return { width: 100, height: 60 }
  return { width: 120, height: 60 }
}

/** String shape names used as fallback when the enum isn't available */
function shapeFor(type: string): string {
  if (type.includes('Event'))    return 'ellipse'
  if (type.includes('Gateway'))  return 'diamond'
  return 'round-rectangle'
}

/** Map BPMN type to ShapeNodeStyleShape enum value (yFiles 3.0) */
function shapeEnumFor(ShapeNodeStyleShape: Record<string, unknown>, type: string): unknown {
  const pick = (...keys: string[]) => {
    for (const k of keys) if (k in ShapeNodeStyleShape) return ShapeNodeStyleShape[k]
    return undefined
  }

  if (type.includes('Event'))
    return pick('ELLIPSE', 'Ellipse', 'ellipse')
  if (type.includes('Gateway'))
    return pick('DIAMOND', 'Diamond', 'diamond')
  return pick('ROUND_RECTANGLE', 'RoundRectangle', 'roundRectangle', 'RECTANGLE', 'Rectangle', 'rectangle')
}

export function useGraphComponent(
  containerRef: RefObject<HTMLDivElement | null>
): UseGraphComponentResult {
  const graphComponentRef = useRef<unknown>(null)
  const yfilesRef = useRef<YFilesClasses | null>(null)

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

        const { GraphComponent, GraphEditorInputMode, NodeDropInputMode, SimpleNode, Rect, DragDropEffects, ShapeNodeStyle } = yf

        yfilesRef.current = { NodeDropInputMode, SimpleNode, Rect, DragDropEffects, ShapeNodeStyle }

        const gc = new GraphComponent(containerRef.current!)
        graphComponent = gc
        graphComponentRef.current = gc

        const editorMode = new GraphEditorInputMode()

        const dropMode = new NodeDropInputMode()
        dropMode.enabled = true
        dropMode.isGroupNodePredicate = null
        editorMode.nodeDropInputMode = dropMode

        // Resolve ShapeNodeStyleShape enum for correct shape values
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ShapeNodeStyleShape = (yf as any).ShapeNodeStyleShape

        dropMode.itemCreator = (
          _ctx: unknown,
          graph: {
            createNode(layout: unknown, style: unknown, tag: unknown): unknown
            setStyle(node: unknown, style: unknown): void
            addLabel(node: unknown, text: string): void
          },
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

          // Build ShapeNodeStyle — try multiple construction approaches
          let style: unknown
          if (ShapeNodeStyle) {
            const instance = new ShapeNodeStyle() as Record<string, unknown>
            if (ShapeNodeStyleShape) {
              // yFiles 3.0: assign enum value via property
              const shapeEnum = shapeEnumFor(ShapeNodeStyleShape, nodeData.type)
              instance.shape = shapeEnum
            } else {
              // Fallback: try string value
              instance.shape = shapeFor(nodeData.type)
            }
            style = instance
          }

          console.log('[bpmn] itemCreator', {
            type: nodeData.type,
            ShapeNodeStyle: !!ShapeNodeStyle,
            ShapeNodeStyleShape: ShapeNodeStyleShape ? Object.keys(ShapeNodeStyleShape).slice(0, 8) : null,
            styleShape: style ? (style as Record<string,unknown>).shape : null,
          })

          // Use positional overload: createNode(layout, style, tag)
          const node = style
            ? graph.createNode(layout, style, nodeData)
            : graph.createNode(layout, null, nodeData)

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
      yfilesRef.current = null
    }
  }, [containerRef])

  const startPaletteDrag = useCallback((event: DragEvent, data: BpmnNodeData) => {
    const yf = yfilesRef.current
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
