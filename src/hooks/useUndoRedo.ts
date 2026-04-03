/**
 * useUndoRedo
 *
 * Subscribes to a yFiles GraphComponent's undo engine and exposes
 * undo/redo actions + availability flags as React state.
 *
 * yFiles 3.0 notes:
 *  - The UndoEngine is on graphComponent.graph.undoEngine (not graphComponent.undoEngine)
 *  - addPropertyChangedListener was removed; use addCanUndoChangedListener /
 *    addCanRedoChangedListener, or fall back to addUndoUnitAddedListener
 */
import { useEffect, useState, useCallback } from 'react'

interface UndoEngine {
  canUndo(): boolean
  canRedo(): boolean
  undo(): void
  redo(): void
  // yFiles 2.x
  addPropertyChangedListener?(listener: () => void): void
  removePropertyChangedListener?(listener: () => void): void
  // yFiles 3.0
  addCanUndoChangedListener?(listener: () => void): void
  removeCanUndoChangedListener?(listener: () => void): void
  addCanRedoChangedListener?(listener: () => void): void
  removeCanRedoChangedListener?(listener: () => void): void
  // fallback — fires after every undo unit is added/executed
  addUndoUnitAddedListener?(listener: () => void): void
  removeUndoUnitAddedListener?(listener: () => void): void
}

interface GraphWithUndo {
  undoEngine: UndoEngine | null | undefined
}

interface UseUndoRedoResult {
  canUndo: boolean
  canRedo: boolean
  undo: () => void
  redo: () => void
}

export function useUndoRedo(
  graphComponent: unknown,
  isReady: boolean
): UseUndoRedoResult {
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  useEffect(() => {
    if (!isReady || !graphComponent) return

    // yFiles 3.0: undoEngine lives on graph, not on GraphComponent
    const graph = (graphComponent as { graph?: GraphWithUndo }).graph
    const engine = graph?.undoEngine
    if (!engine) return

    const update = () => {
      setCanUndo(engine.canUndo())
      setCanRedo(engine.canRedo())
    }

    // Register using whichever listener API is available
    if (engine.addCanUndoChangedListener) {
      // yFiles 3.0
      engine.addCanUndoChangedListener(update)
      engine.addCanRedoChangedListener?.(update)
    } else if (engine.addPropertyChangedListener) {
      // yFiles 2.x
      engine.addPropertyChangedListener(update)
    } else if (engine.addUndoUnitAddedListener) {
      // last-resort fallback
      engine.addUndoUnitAddedListener(update)
    }

    update()

    return () => {
      if (engine.removeCanUndoChangedListener) {
        engine.removeCanUndoChangedListener(update)
        engine.removeCanRedoChangedListener?.(update)
      } else if (engine.removePropertyChangedListener) {
        engine.removePropertyChangedListener(update)
      } else if (engine.removeUndoUnitAddedListener) {
        engine.removeUndoUnitAddedListener(update)
      }
    }
  }, [graphComponent, isReady])

  const undo = useCallback(() => {
    const graph = (graphComponent as { graph?: GraphWithUndo } | null)?.graph
    graph?.undoEngine?.undo()
  }, [graphComponent])

  const redo = useCallback(() => {
    const graph = (graphComponent as { graph?: GraphWithUndo } | null)?.graph
    graph?.undoEngine?.redo()
  }, [graphComponent])

  return { canUndo, canRedo, undo, redo }
}
