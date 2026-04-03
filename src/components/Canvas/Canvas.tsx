import { forwardRef } from 'react'
import './Canvas.css'

interface CanvasProps {
  isReady: boolean
}

/**
 * Canvas wraps the div that yFiles attaches its GraphComponent to.
 * The ref is forwarded to the parent so `useGraphComponent` can mount
 * the GraphComponent into the exact DOM element.
 */
export const Canvas = forwardRef<HTMLDivElement, CanvasProps>(
  function Canvas({ isReady }, ref) {
    return (
      <div className="canvas-wrapper">
        {!isReady && (
          <div className="canvas-loading">
            <span className="canvas-loading__spinner" />
            <span>Initialising graph engine…</span>
          </div>
        )}
        {/* yFiles GraphComponent mounts itself here */}
        <div
          ref={ref}
          className="canvas-graph"
          style={{ visibility: isReady ? 'visible' : 'hidden' }}
        />
      </div>
    )
  }
)
