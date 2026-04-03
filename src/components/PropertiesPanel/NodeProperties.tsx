import { BpmnNodeType, BpmnEventDefinition } from '../../types/bpmn'
import type { BpmnNodeData } from '../../types/bpmn'

interface NodePropertiesProps {
  data: BpmnNodeData
  onChange: (patch: Partial<BpmnNodeData>) => void
}

const EVENT_TYPES = Object.values(BpmnEventDefinition)

const TASK_TYPES: BpmnNodeType[] = [
  BpmnNodeType.Task,
  BpmnNodeType.UserTask,
  BpmnNodeType.ServiceTask,
  BpmnNodeType.ScriptTask,
  BpmnNodeType.ManualTask,
  BpmnNodeType.BusinessRuleTask,
  BpmnNodeType.SendTask,
  BpmnNodeType.ReceiveTask,
]

const GATEWAY_TYPES: BpmnNodeType[] = [
  BpmnNodeType.ExclusiveGateway,
  BpmnNodeType.ParallelGateway,
  BpmnNodeType.InclusiveGateway,
  BpmnNodeType.EventBasedGateway,
  BpmnNodeType.ComplexGateway,
]

const EVENT_NODE_TYPES: BpmnNodeType[] = [
  BpmnNodeType.StartEvent,
  BpmnNodeType.EndEvent,
  BpmnNodeType.IntermediateCatchEvent,
  BpmnNodeType.IntermediateThrowEvent,
  BpmnNodeType.BoundaryEvent,
]

export function NodeProperties({ data, onChange }: NodePropertiesProps) {
  const isEvent = EVENT_NODE_TYPES.includes(data.type)
  const isTask = TASK_TYPES.includes(data.type)
  const isGateway = GATEWAY_TYPES.includes(data.type)

  return (
    <div className="properties-form">
      {/* Label */}
      <div className="prop-field">
        <label className="prop-label" htmlFor="prop-label">Label</label>
        <input
          id="prop-label"
          className="prop-input"
          type="text"
          value={data.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="Enter element name…"
        />
      </div>

      {/* Node type (tasks and gateways) */}
      {(isTask || isGateway) && (
        <div className="prop-field">
          <label className="prop-label" htmlFor="prop-node-type">Type</label>
          <select
            id="prop-node-type"
            className="prop-select"
            value={data.type}
            onChange={(e) => onChange({ type: e.target.value as BpmnNodeType })}
          >
            {(isTask ? TASK_TYPES : GATEWAY_TYPES).map((t) => (
              <option key={t} value={t}>{formatType(t)}</option>
            ))}
          </select>
        </div>
      )}

      {/* Event definition */}
      {isEvent && (
        <div className="prop-field">
          <label className="prop-label" htmlFor="prop-event-def">Event Definition</label>
          <select
            id="prop-event-def"
            className="prop-select"
            value={data.eventDefinition ?? BpmnEventDefinition.None}
            onChange={(e) => onChange({ eventDefinition: e.target.value as BpmnEventDefinition })}
          >
            {EVENT_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      )}

      {/* Task markers */}
      {isTask && (
        <div className="prop-field">
          <label className="prop-label">Markers</label>
          <div className="prop-checkboxes">
            {(['isLooping', 'isMultiInstance', 'isCompensation'] as const).map((key) => (
              <label key={key} className="prop-checkbox-label">
                <input
                  type="checkbox"
                  checked={!!data[key]}
                  onChange={(e) => onChange({ [key]: e.target.checked })}
                />
                {formatMarkerKey(key)}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function formatType(t: BpmnNodeType): string {
  return t.replace(/([A-Z])/g, ' $1').trim()
}

function formatMarkerKey(key: string): string {
  return key.replace(/^is/, '').replace(/([A-Z])/g, ' $1').trim()
}
