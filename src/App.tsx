import { useRef, useCallback } from 'react'
import { useGraphComponent } from './hooks/useGraphComponent'
import { useUndoRedo } from './hooks/useUndoRedo'
import { useSelection } from './hooks/useSelection'
import { Toolbar } from './components/Toolbar/Toolbar'
import { Palette } from './components/Palette/Palette'
import { Canvas } from './components/Canvas/Canvas'
import { PropertiesPanel } from './components/PropertiesPanel/PropertiesPanel'
import { ErrorBanner } from './components/ErrorBanner/ErrorBanner'
import { applyBpmnLayout } from './services/layout'
import {
  exportGraphML,
  exportSvg,
  exportPng,
  importGraphMLFromFile,
} from './services/import-export'
import type { BpmnNodeData, BpmnEdgeData } from './types/bpmn'
import './App.css'

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null)
  const { graphComponent, isReady, error, startPaletteDrag } = useGraphComponent(containerRef)
  const { canUndo, canRedo, undo, redo } = useUndoRedo(graphComponent, isReady)
  const selection = useSelection(graphComponent, isReady)

  // ── Toolbar handlers ────────────────────────────────────────────────────────

  const handleFitGraph = useCallback(() => {
    if (!graphComponent) return
    ;(graphComponent as { fitGraphBounds(): void }).fitGraphBounds()
  }, [graphComponent])

  const handleZoomIn = useCallback(() => {
    if (!graphComponent) return
    const gc = graphComponent as { zoom: number }
    gc.zoom = Math.min(gc.zoom * 1.2, 8)
  }, [graphComponent])

  const handleZoomOut = useCallback(() => {
    if (!graphComponent) return
    const gc = graphComponent as { zoom: number }
    gc.zoom = Math.max(gc.zoom / 1.2, 0.05)
  }, [graphComponent])

  const handleLayout = useCallback(() => {
    if (!graphComponent) return
    applyBpmnLayout(graphComponent).catch(console.error)
  }, [graphComponent])

  const handleImport = useCallback(() => {
    if (!graphComponent) return
    importGraphMLFromFile(graphComponent)
  }, [graphComponent])

  const handleExportGraphML = useCallback(() => {
    if (!graphComponent) return
    exportGraphML(graphComponent).catch(console.error)
  }, [graphComponent])

  const handleExportSvg = useCallback(() => {
    if (!graphComponent) return
    exportSvg(graphComponent).catch(console.error)
  }, [graphComponent])

  const handleExportPng = useCallback(() => {
    if (!graphComponent) return
    exportPng(graphComponent).catch(console.error)
  }, [graphComponent])

  // ── Properties panel handlers ───────────────────────────────────────────────

  const handleNodeChange = useCallback(
    (_id: string, patch: Partial<BpmnNodeData>) => {
      if (!graphComponent || !selection || selection.kind !== 'node') return
      const gc = graphComponent as {
        graph: { setLabelText(label: unknown, text: string): void }
        selection: { first(): unknown }
        invalidate(): void
      }
      const node = gc.selection.first() as { tag: BpmnNodeData; labels: { size: number; first(): unknown } } | null
      if (!node) return

      // yFiles 3.0: assign tag directly (setNodeTag was removed)
      node.tag = { ...selection.data, ...patch }

      // Update the visual label if label changed
      if (patch.label !== undefined && node.labels.size > 0) {
        gc.graph.setLabelText(node.labels.first(), patch.label)
      }

      gc.invalidate()
    },
    [graphComponent, selection]
  )

  const handleEdgeChange = useCallback(
    (_id: string, patch: Partial<BpmnEdgeData>) => {
      if (!graphComponent || !selection || selection.kind !== 'edge') return
      const gc = graphComponent as {
        selection: { first(): unknown }
        invalidate(): void
      }
      const edge = gc.selection.first() as { tag: BpmnEdgeData } | null
      if (!edge) return

      // yFiles 3.0: assign tag directly (setEdgeTag was removed)
      edge.tag = { ...selection.data, ...patch }
      gc.invalidate()
    },
    [graphComponent, selection]
  )

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="app">
      <Toolbar
        canUndo={canUndo}
        canRedo={canRedo}
        isReady={isReady}
        onUndo={undo}
        onRedo={redo}
        onFitGraph={handleFitGraph}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onLayout={handleLayout}
        onImport={handleImport}
        onExportGraphML={handleExportGraphML}
        onExportSvg={handleExportSvg}
        onExportPng={handleExportPng}
      />

      <div className="app__body">
        <Palette onDragStart={startPaletteDrag} disabled={!isReady} />

        <main className="app__canvas-area">
          {error && <ErrorBanner message={error} />}
          <Canvas ref={containerRef} isReady={isReady && !error} />
        </main>

        <PropertiesPanel
          selection={selection}
          onNodeChange={handleNodeChange}
          onEdgeChange={handleEdgeChange}
        />
      </div>
    </div>
  )
}
