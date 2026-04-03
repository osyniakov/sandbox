/**
 * useUndoRedo — yFiles 3.0
 *
 * Subscribes to the graph undo engine and exposes undo/redo
 * actions + availability flags as React state.
 *
 * yFiles 3.0: undoEngine is on graphComponent.graph, not graphComponent.
 * Events: addCanUndoChangedListener / addCanRedoChangedListener.
 */
import { useEffect, useState, useCallback } from 'react'

interface UndoEngine {
  canUndo(): boolean
  canRedo(): boolean
  undo(): void
  redo(): void
  addCanUndoChangedListener(listener: () => void): void
  removeCanUndoChangedListener(listener: () => void): void
  addCanRedoChangedListener(listener: () => void): void
  removeCanRedoChangedListener(listener: () => void): void
}

interface UseUndoRedoResult {
  canUndo: boolean
  canRedo: boolean
  undo: () => void
  redo: () => void
}

function getEngine(graphComponent: unknown): UndoEngine | null {
  const graph = (graphComponent as { graph?: Record<string, unknown> } | null)?.graph
  return (graph?.undoEngine as UndoEngine | null | undefined) ?? null
}

export function useUndoRedo(
  graphComponent: unknown,
  isReady: boolean
): UseUndoRedoResult {
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  useEffect(() => {
    if (!isReady || !graphComponent) return
    const engine = getEngine(graphComponent)
    if (!engine) return

    const onUndoChanged = () => setCanUndo(engine.canUndo())
    const onRedoChanged = () => setCanRedo(engine.canRedo())

    engine.addCanUndoChangedListener(onUndoChanged)
    engine.addCanRedoChangedListener(onRedoChanged)
    onUndoChanged()
    onRedoChanged()

    return () => {
      engine.removeCanUndoChangedListener(onUndoChanged)
      engine.removeCanRedoChangedListener(onRedoChanged)
    }
  }, [graphComponent, isReady])

  const undo = useCallback(() => getEngine(graphComponent)?.undo(), [graphComponent])
  const redo = useCallback(() => getEngine(graphComponent)?.redo(), [graphComponent])

  return { canUndo, canRedo, undo, redo }
}
