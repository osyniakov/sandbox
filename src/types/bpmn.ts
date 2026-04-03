// BPMN 2.0 element type definitions

export enum BpmnNodeType {
  // Events
  StartEvent = 'StartEvent',
  EndEvent = 'EndEvent',
  IntermediateCatchEvent = 'IntermediateCatchEvent',
  IntermediateThrowEvent = 'IntermediateThrowEvent',
  BoundaryEvent = 'BoundaryEvent',

  // Tasks
  Task = 'Task',
  UserTask = 'UserTask',
  ServiceTask = 'ServiceTask',
  ScriptTask = 'ScriptTask',
  ManualTask = 'ManualTask',
  BusinessRuleTask = 'BusinessRuleTask',
  SendTask = 'SendTask',
  ReceiveTask = 'ReceiveTask',
  CallActivity = 'CallActivity',
  SubProcess = 'SubProcess',

  // Gateways
  ExclusiveGateway = 'ExclusiveGateway',
  ParallelGateway = 'ParallelGateway',
  InclusiveGateway = 'InclusiveGateway',
  EventBasedGateway = 'EventBasedGateway',
  ComplexGateway = 'ComplexGateway',

  // Artifacts
  DataObject = 'DataObject',
  DataStore = 'DataStore',
  Group = 'Group',
  TextAnnotation = 'TextAnnotation',

  // Swimlanes
  Pool = 'Pool',
  Lane = 'Lane',
}

export enum BpmnEdgeType {
  SequenceFlow = 'SequenceFlow',
  MessageFlow = 'MessageFlow',
  Association = 'Association',
  DataAssociation = 'DataAssociation',
  ConditionalFlow = 'ConditionalFlow',
  DefaultFlow = 'DefaultFlow',
}

export enum BpmnEventDefinition {
  None = 'None',
  Message = 'Message',
  Timer = 'Timer',
  Error = 'Error',
  Signal = 'Signal',
  Terminate = 'Terminate',
  Escalation = 'Escalation',
  Compensation = 'Compensation',
  Conditional = 'Conditional',
  Link = 'Link',
}

export enum PaletteCategory {
  Events = 'Events',
  Tasks = 'Tasks',
  Gateways = 'Gateways',
  Artifacts = 'Artifacts',
  Connecting = 'Connecting Objects',
  Swimlanes = 'Swimlanes',
}

export interface BpmnNodeData {
  type: BpmnNodeType
  label: string
  eventDefinition?: BpmnEventDefinition
  /** For tasks: icon marker hints */
  taskMarkers?: string[]
  /** Whether this is a looping/multi-instance task */
  isLooping?: boolean
  isMultiInstance?: boolean
  isCompensation?: boolean
}

export interface BpmnEdgeData {
  type: BpmnEdgeType
  label?: string
  conditionExpression?: string
}

export interface PaletteEntry {
  id: string
  label: string
  category: PaletteCategory
  nodeType?: BpmnNodeType
  edgeType?: BpmnEdgeType
  eventDefinition?: BpmnEventDefinition
  /** Default size of node when dropped */
  defaultWidth: number
  defaultHeight: number
}

// Palette entries grouped by category
export const PALETTE_ENTRIES: PaletteEntry[] = [
  // Events
  { id: 'start-event', label: 'Start Event', category: PaletteCategory.Events, nodeType: BpmnNodeType.StartEvent, eventDefinition: BpmnEventDefinition.None, defaultWidth: 48, defaultHeight: 48 },
  { id: 'end-event', label: 'End Event', category: PaletteCategory.Events, nodeType: BpmnNodeType.EndEvent, eventDefinition: BpmnEventDefinition.None, defaultWidth: 48, defaultHeight: 48 },
  { id: 'intermediate-catch', label: 'Intermediate Event', category: PaletteCategory.Events, nodeType: BpmnNodeType.IntermediateCatchEvent, eventDefinition: BpmnEventDefinition.None, defaultWidth: 48, defaultHeight: 48 },
  { id: 'message-start', label: 'Message Start', category: PaletteCategory.Events, nodeType: BpmnNodeType.StartEvent, eventDefinition: BpmnEventDefinition.Message, defaultWidth: 48, defaultHeight: 48 },
  { id: 'timer-start', label: 'Timer Start', category: PaletteCategory.Events, nodeType: BpmnNodeType.StartEvent, eventDefinition: BpmnEventDefinition.Timer, defaultWidth: 48, defaultHeight: 48 },
  { id: 'error-end', label: 'Error End', category: PaletteCategory.Events, nodeType: BpmnNodeType.EndEvent, eventDefinition: BpmnEventDefinition.Error, defaultWidth: 48, defaultHeight: 48 },
  { id: 'terminate-end', label: 'Terminate End', category: PaletteCategory.Events, nodeType: BpmnNodeType.EndEvent, eventDefinition: BpmnEventDefinition.Terminate, defaultWidth: 48, defaultHeight: 48 },

  // Tasks
  { id: 'task', label: 'Task', category: PaletteCategory.Tasks, nodeType: BpmnNodeType.Task, defaultWidth: 120, defaultHeight: 60 },
  { id: 'user-task', label: 'User Task', category: PaletteCategory.Tasks, nodeType: BpmnNodeType.UserTask, defaultWidth: 120, defaultHeight: 60 },
  { id: 'service-task', label: 'Service Task', category: PaletteCategory.Tasks, nodeType: BpmnNodeType.ServiceTask, defaultWidth: 120, defaultHeight: 60 },
  { id: 'script-task', label: 'Script Task', category: PaletteCategory.Tasks, nodeType: BpmnNodeType.ScriptTask, defaultWidth: 120, defaultHeight: 60 },
  { id: 'business-rule-task', label: 'Business Rule Task', category: PaletteCategory.Tasks, nodeType: BpmnNodeType.BusinessRuleTask, defaultWidth: 120, defaultHeight: 60 },
  { id: 'send-task', label: 'Send Task', category: PaletteCategory.Tasks, nodeType: BpmnNodeType.SendTask, defaultWidth: 120, defaultHeight: 60 },
  { id: 'receive-task', label: 'Receive Task', category: PaletteCategory.Tasks, nodeType: BpmnNodeType.ReceiveTask, defaultWidth: 120, defaultHeight: 60 },
  { id: 'sub-process', label: 'Sub-Process', category: PaletteCategory.Tasks, nodeType: BpmnNodeType.SubProcess, defaultWidth: 150, defaultHeight: 80 },

  // Gateways
  { id: 'exclusive-gateway', label: 'Exclusive (XOR)', category: PaletteCategory.Gateways, nodeType: BpmnNodeType.ExclusiveGateway, defaultWidth: 50, defaultHeight: 50 },
  { id: 'parallel-gateway', label: 'Parallel (AND)', category: PaletteCategory.Gateways, nodeType: BpmnNodeType.ParallelGateway, defaultWidth: 50, defaultHeight: 50 },
  { id: 'inclusive-gateway', label: 'Inclusive (OR)', category: PaletteCategory.Gateways, nodeType: BpmnNodeType.InclusiveGateway, defaultWidth: 50, defaultHeight: 50 },
  { id: 'event-gateway', label: 'Event-Based', category: PaletteCategory.Gateways, nodeType: BpmnNodeType.EventBasedGateway, defaultWidth: 50, defaultHeight: 50 },

  // Artifacts
  { id: 'data-object', label: 'Data Object', category: PaletteCategory.Artifacts, nodeType: BpmnNodeType.DataObject, defaultWidth: 40, defaultHeight: 55 },
  { id: 'data-store', label: 'Data Store', category: PaletteCategory.Artifacts, nodeType: BpmnNodeType.DataStore, defaultWidth: 60, defaultHeight: 50 },
  { id: 'group', label: 'Group', category: PaletteCategory.Artifacts, nodeType: BpmnNodeType.Group, defaultWidth: 200, defaultHeight: 150 },
  { id: 'annotation', label: 'Text Annotation', category: PaletteCategory.Artifacts, nodeType: BpmnNodeType.TextAnnotation, defaultWidth: 100, defaultHeight: 60 },

  // Swimlanes
  { id: 'pool', label: 'Pool', category: PaletteCategory.Swimlanes, nodeType: BpmnNodeType.Pool, defaultWidth: 600, defaultHeight: 200 },
  { id: 'lane', label: 'Lane', category: PaletteCategory.Swimlanes, nodeType: BpmnNodeType.Lane, defaultWidth: 600, defaultHeight: 100 },
]
