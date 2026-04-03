/**
 * layout.ts — yFiles 3.0
 *
 * Runs a layout algorithm on the current diagram.
 * BpmnLayout may not be in the core yfiles package; falls back to
 * HierarchicLayout which gives a clean left-to-right flow diagram.
 */

interface GraphComponent {
  morphLayout(layout: unknown, duration: string): Promise<void>
}

export async function applyBpmnLayout(graphComponent: unknown): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const yf = await import('yfiles') as any

  const LayoutClass = yf.BpmnLayout ?? yf.HierarchicLayout ?? yf.OrganicLayout

  if (!LayoutClass) {
    console.warn('[layout] No layout algorithm found in yfiles module')
    return
  }

  const layout = new LayoutClass()
  const gc = graphComponent as GraphComponent
  await gc.morphLayout(layout, '0.5s')
}
