/**
 * layout.ts
 *
 * Runs the yFiles BpmnLayout algorithm on the current diagram with an
 * animated transition (morphLayout).
 */

interface GraphComponent {
  morphLayout(layout: unknown, duration: string): Promise<void>
}

export async function applyBpmnLayout(graphComponent: unknown): Promise<void> {
  const { BpmnLayout } = await import('yfiles') as unknown as {
    BpmnLayout: new () => unknown
  }

  const layout = new BpmnLayout()
  const gc = graphComponent as GraphComponent
  await gc.morphLayout(layout, '0.5s')
}
