/**
 * import-export.ts
 *
 * Provides import and export capabilities for BPMN diagrams:
 *   - Import:  GraphML string/file
 *   - Export:  GraphML string, SVG blob, PNG blob
 *
 * BPMN XML (ISO 19510) round-trip would require a dedicated parser;
 * this implementation uses GraphML as the primary interchange format
 * and offers SVG/PNG for presentation-quality image export.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

interface GraphComponent {
  graph: unknown
  fitGraphBounds(): void
  updateContentRect(): void
  viewport: { toRectangle(): { x: number; y: number; width: number; height: number } }
  exportContent(options: Record<string, unknown>): Promise<string>
  size: { width: number; height: number }
  contentRect: { x: number; y: number; width: number; height: number }
}

// ─── GraphML Import ───────────────────────────────────────────────────────────

/**
 * Load a GraphML string into the graph component.
 * Replaces the current diagram contents.
 */
export async function importGraphML(
  graphComponent: unknown,
  graphmlString: string
): Promise<void> {
  const { GraphMLIOHandler } = await import('yfiles') as unknown as {
    GraphMLIOHandler: new () => {
      readFromGraphMLText(graph: unknown, text: string): Promise<void>
    }
  }

  const gc = graphComponent as GraphComponent
  const handler = new GraphMLIOHandler()
  await handler.readFromGraphMLText(gc.graph, graphmlString)
  gc.fitGraphBounds()
}

/**
 * Open a file-picker dialog and import the chosen GraphML file.
 */
export function importGraphMLFromFile(graphComponent: unknown): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.graphml,.xml'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    const text = await file.text()
    await importGraphML(graphComponent, text)
  }
  input.click()
}

// ─── GraphML Export ───────────────────────────────────────────────────────────

/**
 * Serialise the current diagram to a GraphML string and trigger a download.
 */
export async function exportGraphML(graphComponent: unknown): Promise<void> {
  const { GraphMLIOHandler } = await import('yfiles') as unknown as {
    GraphMLIOHandler: new () => {
      write(graph: unknown): Promise<string>
    }
  }

  const gc = graphComponent as GraphComponent
  const handler = new GraphMLIOHandler()
  const graphml = await handler.write(gc.graph)
  downloadText(graphml, 'diagram.graphml', 'application/xml')
}

// ─── SVG Export ───────────────────────────────────────────────────────────────

/**
 * Export the current diagram as an SVG file.
 */
export async function exportSvg(graphComponent: unknown): Promise<void> {
  const { SvgExport } = await import('yfiles') as unknown as {
    SvgExport: new (bounds: unknown, options?: Record<string, unknown>) => {
      exportSvg(gc: unknown): Promise<SVGElement>
    }
  }

  const gc = graphComponent as GraphComponent
  gc.updateContentRect()
  const rect = gc.contentRect

  // Create an SVGRect-like object from the content rect
  const bounds = { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  const exporter = new SvgExport(bounds, { scale: 1 })
  const svgElement = await exporter.exportSvg(gc)

  const svgString = new XMLSerializer().serializeToString(svgElement)
  const blob = new Blob([svgString], { type: 'image/svg+xml' })
  downloadBlob(blob, 'diagram.svg')
}

// ─── PNG Export ───────────────────────────────────────────────────────────────

/**
 * Export the current diagram as a PNG file (renders SVG via an off-screen canvas).
 */
export async function exportPng(graphComponent: unknown, scale = 2): Promise<void> {
  const { SvgExport } = await import('yfiles') as unknown as {
    SvgExport: new (bounds: unknown, options?: Record<string, unknown>) => {
      exportSvg(gc: unknown): Promise<SVGElement>
    }
  }

  const gc = graphComponent as GraphComponent
  gc.updateContentRect()
  const rect = gc.contentRect

  const bounds = { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  const exporter = new SvgExport(bounds, { scale })
  const svgElement = await exporter.exportSvg(gc)

  const svgString = new XMLSerializer().serializeToString(svgElement)
  const svgBlob = new Blob([svgString], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(svgBlob)

  const img = new Image()
  img.onload = () => {
    const canvas = document.createElement('canvas')
    canvas.width = rect.width * scale
    canvas.height = rect.height * scale
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    URL.revokeObjectURL(url)

    canvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, 'diagram.png')
    }, 'image/png')
  }
  img.src = url
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function downloadText(text: string, filename: string, mimeType: string): void {
  const blob = new Blob([text], { type: mimeType })
  downloadBlob(blob, filename)
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
