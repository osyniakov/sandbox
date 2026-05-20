import { APIRequestContext, expect, test as base } from '@playwright/test';

const API_BASE = 'http://localhost:8080/api';

const MINIMAL_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  id="Definitions_1"
                  targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:startEvent id="StartEvent_1"/>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="_BPMNShape_StartEvent_2" bpmnElement="StartEvent_1">
        <dc:Bounds x="180" y="160" width="36" height="36"/>
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

export interface DiagramSummary {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface Diagram extends DiagramSummary {
  xml: string;
}

export async function clearAllDiagrams(request: APIRequestContext): Promise<void> {
  const listRes = await request.get(`${API_BASE}/diagrams`);
  expect(listRes.ok()).toBeTruthy();
  const items = (await listRes.json()) as DiagramSummary[];
  for (const item of items) {
    const del = await request.delete(`${API_BASE}/diagrams/${item.id}`);
    expect(del.status()).toBe(204);
  }
}

export async function seedDiagram(
  request: APIRequestContext,
  name: string,
  xml: string = MINIMAL_BPMN
): Promise<Diagram> {
  const res = await request.post(`${API_BASE}/diagrams`, {
    data: { name, xml },
    headers: { 'Content-Type': 'application/json' }
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as Diagram;
}

export { MINIMAL_BPMN };

export const test = base.extend({});
export { expect };
