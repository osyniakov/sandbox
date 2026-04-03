import { BpmnNodeType } from '../../types/bpmn'
import type { PaletteEntry, BpmnNodeData } from '../../types/bpmn'

interface PaletteItemProps {
  entry: PaletteEntry
  onDragStart: (event: DragEvent, data: BpmnNodeData) => void
}

export function PaletteItem({ entry, onDragStart }: PaletteItemProps) {
  const data: BpmnNodeData = {
    type: entry.nodeType!,
    label: entry.label,
    eventDefinition: entry.eventDefinition,
  }

  function handleDragStart(e: React.DragEvent<HTMLDivElement>) {
    onDragStart(e.nativeEvent, data)
  }

  return (
    <div
      className="palette-item"
      draggable
      onDragStart={handleDragStart}
      title={`Drag to add: ${entry.label}`}
      role="listitem"
    >
      <span className="palette-item__icon" aria-hidden="true">
        {ICONS[entry.nodeType!] ?? '▭'}
      </span>
      <span className="palette-item__label">{entry.label}</span>
    </div>
  )
}

/**
 * Per-type icons using Unicode symbols that match BPMN 2.0 visual conventions:
 *  - Events:    circles (○ ◎ ●)
 *  - Tasks:     distinct icons matching the task marker in the shape corner
 *  - Gateways:  diamond (◇)
 *  - Artifacts: document / data symbols
 */
const ICONS: Partial<Record<BpmnNodeType, string>> = {
  // ── Events ────────────────────────────────────────────────────────────────
  [BpmnNodeType.StartEvent]:              '○',
  [BpmnNodeType.EndEvent]:               '●',
  [BpmnNodeType.IntermediateCatchEvent]: '◎',
  [BpmnNodeType.IntermediateThrowEvent]: '◉',
  [BpmnNodeType.BoundaryEvent]:          '◎',

  // ── Tasks — icons match the BPMN task-type marker shown in the top-left ──
  [BpmnNodeType.Task]:                   '▭',   // abstract — no marker
  [BpmnNodeType.UserTask]:               '👤',   // user/human
  [BpmnNodeType.ServiceTask]:            '⚙',   // automated service
  [BpmnNodeType.ScriptTask]:             '📜',  // script
  [BpmnNodeType.ManualTask]:             '✋',   // manual (no automation)
  [BpmnNodeType.BusinessRuleTask]:       '📋',  // business rule / decision table
  [BpmnNodeType.SendTask]:               '✉',   // send message
  [BpmnNodeType.ReceiveTask]:            '📩',  // receive message
  [BpmnNodeType.CallActivity]:           '⬡',   // global reference (thick border)
  [BpmnNodeType.SubProcess]:             '⊞',   // collapsed sub-process (+ marker)

  // ── Gateways ──────────────────────────────────────────────────────────────
  [BpmnNodeType.ExclusiveGateway]:       '✕',   // X marker
  [BpmnNodeType.ParallelGateway]:        '✚',   // + marker
  [BpmnNodeType.InclusiveGateway]:       '◯',   // ○ marker
  [BpmnNodeType.EventBasedGateway]:      '⬡',   // pentagon/event marker
  [BpmnNodeType.ComplexGateway]:         '✳',   // * marker

  // ── Artifacts ─────────────────────────────────────────────────────────────
  [BpmnNodeType.DataObject]:             '📄',
  [BpmnNodeType.DataStore]:              '🗄',
  [BpmnNodeType.Group]:                  '⬜',
  [BpmnNodeType.TextAnnotation]:         '📝',

  // ── Swimlanes ─────────────────────────────────────────────────────────────
  [BpmnNodeType.Pool]:                   '▬',
  [BpmnNodeType.Lane]:                   '━',
}
