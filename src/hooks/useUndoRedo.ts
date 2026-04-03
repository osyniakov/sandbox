/**
 * useUndoRedo
 *
 * Subscribes to a yFiles GraphComponent's undo engine and exposes
 * undo/redo actions + availability flags as React state.
 */
import { useEffect, useState, useCallback } from 'react'

interface UndoEngine {
  canUndo(): boolean
  canRedo(): boolean
  undo(): void
  redo(): void
  addPropertyChangedListener(listener: () => void): void
  removePropertyChangedListener(listener: () => void): void
}

interface GraphComponentWithUndo {
  undoEngine: UndoEngine
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

    const gc = graphComponent as GraphComponentWithUndo
    const engine = gc.undoEngine

    const update = () => {
      setCanUndo(engine.canUndo())
      setCanRedo(engine.canRedo())
    }

    engine.addPropertyChangedListener(update)
    update()

    return () => {
      engine.removePropertyChangedListener(update)
    }
  }, [graphComponent, isReady])

  const undo = useCallback(() => {
    if (!graphComponent) return
    ;(graphComponent as GraphComponentWithUndo).undoEngine.undo()
  }, [graphComponent])

  const redo = useCallback(() => {
    if (!graphComponent) return
    ;(graphComponent as GraphComponentWithUndo).undoEngine.redo()
  }, [graphComponent])

  return { canUndo, canRedo, undo, redo }
}
