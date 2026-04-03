import { BpmnEdgeType } from '../../types/bpmn'
import type { BpmnEdgeData } from '../../types/bpmn'

interface EdgePropertiesProps {
  data: BpmnEdgeData
  onChange: (patch: Partial<BpmnEdgeData>) => void
}

const EDGE_TYPES = Object.values(BpmnEdgeType)

export function EdgeProperties({ data, onChange }: EdgePropertiesProps) {
  return (
    <div className="properties-form">
      <div className="prop-field">
        <label className="prop-label" htmlFor="prop-edge-type">Edge Type</label>
        <select
          id="prop-edge-type"
          className="prop-select"
          value={data.type}
          onChange={(e) => onChange({ type: e.target.value as BpmnEdgeType })}
        >
          {EDGE_TYPES.map((t) => (
            <option key={t} value={t}>{t.replace(/([A-Z])/g, ' $1').trim()}</option>
          ))}
        </select>
      </div>

      <div className="prop-field">
        <label className="prop-label" htmlFor="prop-edge-label">Label</label>
        <input
          id="prop-edge-label"
          className="prop-input"
          type="text"
          value={data.label ?? ''}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="Optional label…"
        />
      </div>

      {data.type === BpmnEdgeType.ConditionalFlow && (
        <div className="prop-field">
          <label className="prop-label" htmlFor="prop-condition">Condition Expression</label>
          <textarea
            id="prop-condition"
            className="prop-textarea"
            value={data.conditionExpression ?? ''}
            onChange={(e) => onChange({ conditionExpression: e.target.value })}
            placeholder="e.g. ${approved == true}"
            rows={3}
          />
        </div>
      )}
    </div>
  )
}
