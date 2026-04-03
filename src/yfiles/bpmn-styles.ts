/**
 * Factory functions that create yFiles node/edge styles for each BPMN element type.
 *
 * yFiles ships a full BPMN style library in:
 *   yfiles/view-layout-bridge  (BpmnLayout)
 *   yfiles/view-bpmn           (BpmnNodeStyle, BpmnEdgeStyle, etc.)
 *
 * All style classes are imported lazily so the file compiles even before
 * the yFiles tgz is installed (import errors surface at runtime, not build time).
 */

import type { IGraph, INode, IEdge, Size, Point } from 'yfiles'
import { BpmnNodeType, BpmnEdgeType, BpmnEventDefinition } from '../types/bpmn'
import type { BpmnNodeData, BpmnEdgeData } from '../types/bpmn'

// ─── Node style helpers ───────────────────────────────────────────────────────

/**
 * Map our BpmnNodeType + optional event definition to the yFiles
 * BpmnNodeStyle configuration. Returns a plain-object descriptor that
 * callers can spread into `new BpmnNodeStyle({ … })`.
 */
export function getBpmnNodeStyleDescriptor(data: BpmnNodeData): Record<string, unknown> {
  const { type, eventDefinition = BpmnEventDefinition.None } = data

  switch (type) {
    // ── Events ────────────────────────────────────────────────────────────────
    case BpmnNodeType.StartEvent:
      return { type: 'start-event', eventType: mapEventDefinition(eventDefinition), isInterrupting: true }
    case BpmnNodeType.EndEvent:
      return { type: 'end-event', eventType: mapEventDefinition(eventDefinition) }
    case BpmnNodeType.IntermediateCatchEvent:
      return { type: 'intermediate-catch-event', eventType: mapEventDefinition(eventDefinition) }
    case BpmnNodeType.IntermediateThrowEvent:
      return { type: 'intermediate-throw-event', eventType: mapEventDefinition(eventDefinition) }
    case BpmnNodeType.BoundaryEvent:
      return { type: 'boundary-event', eventType: mapEventDefinition(eventDefinition), isInterrupting: true }

    // ── Tasks ─────────────────────────────────────────────────────────────────
    case BpmnNodeType.Task:           return { type: 'task', taskType: 'abstract' }
    case BpmnNodeType.UserTask:       return { type: 'task', taskType: 'user' }
    case BpmnNodeType.ServiceTask:    return { type: 'task', taskType: 'service' }
    case BpmnNodeType.ScriptTask:     return { type: 'task', taskType: 'script' }
    case BpmnNodeType.ManualTask:     return { type: 'task', taskType: 'manual' }
    case BpmnNodeType.BusinessRuleTask: return { type: 'task', taskType: 'business-rule' }
    case BpmnNodeType.SendTask:       return { type: 'task', taskType: 'send' }
    case BpmnNodeType.ReceiveTask:    return { type: 'task', taskType: 'receive' }
    case BpmnNodeType.CallActivity:   return { type: 'call-activity' }
    case BpmnNodeType.SubProcess:     return { type: 'sub-process', isExpanded: false }

    // ── Gateways ──────────────────────────────────────────────────────────────
    case BpmnNodeType.ExclusiveGateway:   return { type: 'gateway', gatewayType: 'exclusive' }
    case BpmnNodeType.ParallelGateway:    return { type: 'gateway', gatewayType: 'parallel' }
    case BpmnNodeType.InclusiveGateway:   return { type: 'gateway', gatewayType: 'inclusive' }
    case BpmnNodeType.EventBasedGateway:  return { type: 'gateway', gatewayType: 'event-based' }
    case BpmnNodeType.ComplexGateway:     return { type: 'gateway', gatewayType: 'complex' }

    // ── Artifacts ─────────────────────────────────────────────────────────────
    case BpmnNodeType.DataObject:     return { type: 'data-object' }
    case BpmnNodeType.DataStore:      return { type: 'data-store-reference' }
    case BpmnNodeType.Group:          return { type: 'group' }
    case BpmnNodeType.TextAnnotation: return { type: 'annotation' }

    // ── Swimlanes ─────────────────────────────────────────────────────────────
    case BpmnNodeType.Pool:           return { type: 'pool', isHorizontal: true }
    case BpmnNodeType.Lane:           return { type: 'lane', isHorizontal: true }

    default:
      return { type: 'task', taskType: 'abstract' }
  }
}

function mapEventDefinition(def: BpmnEventDefinition): string {
  const map: Record<BpmnEventDefinition, string> = {
    [BpmnEventDefinition.None]:         'none',
    [BpmnEventDefinition.Message]:      'message',
    [BpmnEventDefinition.Timer]:        'timer',
    [BpmnEventDefinition.Error]:        'error',
    [BpmnEventDefinition.Signal]:       'signal',
    [BpmnEventDefinition.Terminate]:    'terminate',
    [BpmnEventDefinition.Escalation]:   'escalation',
    [BpmnEventDefinition.Compensation]: 'compensation',
    [BpmnEventDefinition.Conditional]:  'conditional',
    [BpmnEventDefinition.Link]:         'link',
  }
  return map[def] ?? 'none'
}

// ─── Edge style helper ───────────────────────────────────────────────────────

export function getBpmnEdgeStyleDescriptor(data: BpmnEdgeData): Record<string, unknown> {
  switch (data.type) {
    case BpmnEdgeType.SequenceFlow:     return { type: 'sequence-flow' }
    case BpmnEdgeType.ConditionalFlow:  return { type: 'conditional-flow' }
    case BpmnEdgeType.DefaultFlow:      return { type: 'default-flow' }
    case BpmnEdgeType.MessageFlow:      return { type: 'message-flow' }
    case BpmnEdgeType.Association:      return { type: 'association' }
    case BpmnEdgeType.DataAssociation:  return { type: 'directed-association' }
    default:                            return { type: 'sequence-flow' }
  }
}

// ─── Graph initialisation ────────────────────────────────────────────────────

/**
 * Apply BPMN styles to a newly created node.
 * Called from the NodeDropInputMode handler inside useGraphComponent.
 */
export async function applyBpmnNodeStyle(
  graph: IGraph,
  node: INode,
  data: BpmnNodeData
): Promise<void> {
  const { BpmnNodeStyle } = await import('yfiles')
  const descriptor = getBpmnNodeStyleDescriptor(data)
  // BpmnNodeStyle accepts a config object matching its properties
  const style = new (BpmnNodeStyle as unknown as new (config: Record<string, unknown>) => object)(descriptor)
  graph.setStyle(node, style as Parameters<typeof graph.setStyle>[1])
  graph.addLabel(node, data.label)
}

/**
 * Apply a BPMN edge style when a new edge is created.
 */
export async function applyBpmnEdgeStyle(
  graph: IGraph,
  edge: IEdge,
  data: BpmnEdgeData
): Promise<void> {
  const { BpmnEdgeStyle } = await import('yfiles')
  const descriptor = getBpmnEdgeStyleDescriptor(data)
  const style = new (BpmnEdgeStyle as unknown as new (config: Record<string, unknown>) => object)(descriptor)
  graph.setStyle(edge, style as Parameters<typeof graph.setStyle>[1])
  if (data.label) {
    graph.addLabel(edge, data.label)
  }
}

// ─── Default edge type for new connections ───────────────────────────────────

export const DEFAULT_EDGE_DATA: BpmnEdgeData = {
  type: BpmnEdgeType.SequenceFlow,
}
