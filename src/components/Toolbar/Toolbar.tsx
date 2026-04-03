import './Toolbar.css'

interface ToolbarProps {
  canUndo: boolean
  canRedo: boolean
  isReady: boolean
  onUndo: () => void
  onRedo: () => void
  onFitGraph: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onLayout: () => void
  onImport: () => void
  onExportGraphML: () => void
  onExportSvg: () => void
  onExportPng: () => void
}

export function Toolbar({
  canUndo,
  canRedo,
  isReady,
  onUndo,
  onRedo,
  onFitGraph,
  onZoomIn,
  onZoomOut,
  onLayout,
  onImport,
  onExportGraphML,
  onExportSvg,
  onExportPng,
}: ToolbarProps) {
  return (
    <header className="toolbar" role="toolbar" aria-label="Editor toolbar">
      <div className="toolbar__brand">
        <span className="toolbar__logo">⬡</span>
        <span className="toolbar__title">BPMN Editor</span>
      </div>

      <div className="toolbar__divider" />

      {/* Undo / Redo */}
      <div className="toolbar__group" aria-label="Undo / Redo">
        <button
          className="toolbar__btn"
          title="Undo (Ctrl+Z)"
          disabled={!isReady || !canUndo}
          onClick={onUndo}
        >
          ↩ Undo
        </button>
        <button
          className="toolbar__btn"
          title="Redo (Ctrl+Y)"
          disabled={!isReady || !canRedo}
          onClick={onRedo}
        >
          ↪ Redo
        </button>
      </div>

      <div className="toolbar__divider" />

      {/* Zoom */}
      <div className="toolbar__group" aria-label="Zoom controls">
        <button className="toolbar__btn" title="Zoom In" disabled={!isReady} onClick={onZoomIn}>+</button>
        <button className="toolbar__btn" title="Zoom Out" disabled={!isReady} onClick={onZoomOut}>−</button>
        <button className="toolbar__btn" title="Fit graph in view" disabled={!isReady} onClick={onFitGraph}>
          ⤢ Fit
        </button>
      </div>

      <div className="toolbar__divider" />

      {/* Layout */}
      <div className="toolbar__group">
        <button className="toolbar__btn toolbar__btn--primary" disabled={!isReady} onClick={onLayout} title="Run BPMN auto-layout">
          ⊞ Auto Layout
        </button>
      </div>

      <div className="toolbar__divider" />

      {/* Import / Export */}
      <div className="toolbar__group" aria-label="Import and export">
        <button className="toolbar__btn" disabled={!isReady} onClick={onImport} title="Import GraphML file">
          ↑ Import
        </button>
        <div className="toolbar__dropdown">
          <button className="toolbar__btn" disabled={!isReady} title="Export diagram">
            ↓ Export ▾
          </button>
          <ul className="toolbar__dropdown-menu">
            <li><button onClick={onExportGraphML}>GraphML (.graphml)</button></li>
            <li><button onClick={onExportSvg}>SVG image (.svg)</button></li>
            <li><button onClick={onExportPng}>PNG image (.png)</button></li>
          </ul>
        </div>
      </div>
    </header>
  )
}
