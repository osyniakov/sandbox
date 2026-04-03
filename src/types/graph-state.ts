import type { BpmnNodeData, BpmnEdgeData } from './bpmn'

export interface SelectedNodeState {
  kind: 'node'
  id: string
  data: BpmnNodeData
}

export interface SelectedEdgeState {
  kind: 'edge'
  id: string
  data: BpmnEdgeData
}

export type SelectionState = SelectedNodeState | SelectedEdgeState | null

export interface GraphState {
  isReady: boolean
  canUndo: boolean
  canRedo: boolean
  selection: SelectionState
  yfilesError: string | null
}
