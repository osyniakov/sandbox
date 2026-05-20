// Generates documentation screenshots for the README / PR.
//
// Usage:  node scripts/take-screenshots.mjs
// Requires the Spring Boot backend on :8080 and the Angular dev server on :4200.

import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '../../docs/screenshots');
const FRONTEND = 'http://localhost:4200';
const API = 'http://localhost:8080/api';

const SAMPLE_PROCESS_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                  id="Definitions_1"
                  targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:startEvent id="StartEvent_1" name="Order received">
      <bpmn:outgoing>Flow_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:task id="Task_1" name="Review order">
      <bpmn:incoming>Flow_1</bpmn:incoming>
      <bpmn:outgoing>Flow_2</bpmn:outgoing>
    </bpmn:task>
    <bpmn:exclusiveGateway id="Gateway_1" name="Approved?">
      <bpmn:incoming>Flow_2</bpmn:incoming>
      <bpmn:outgoing>Flow_yes</bpmn:outgoing>
      <bpmn:outgoing>Flow_no</bpmn:outgoing>
    </bpmn:exclusiveGateway>
    <bpmn:task id="Task_Ship" name="Ship order">
      <bpmn:incoming>Flow_yes</bpmn:incoming>
      <bpmn:outgoing>Flow_3</bpmn:outgoing>
    </bpmn:task>
    <bpmn:endEvent id="End_Done" name="Order shipped">
      <bpmn:incoming>Flow_3</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:endEvent id="End_Rejected" name="Order rejected">
      <bpmn:incoming>Flow_no</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="StartEvent_1" targetRef="Task_1" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="Gateway_1" />
    <bpmn:sequenceFlow id="Flow_yes" name="yes" sourceRef="Gateway_1" targetRef="Task_Ship" />
    <bpmn:sequenceFlow id="Flow_no" name="no" sourceRef="Gateway_1" targetRef="End_Rejected" />
    <bpmn:sequenceFlow id="Flow_3" sourceRef="Task_Ship" targetRef="End_Done" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="_StartEvent" bpmnElement="StartEvent_1">
        <dc:Bounds x="160" y="180" width="36" height="36" />
        <bpmndi:BPMNLabel><dc:Bounds x="140" y="222" width="80" height="14" /></bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="_Task1" bpmnElement="Task_1">
        <dc:Bounds x="250" y="158" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="_Gateway1" bpmnElement="Gateway_1" isMarkerVisible="true">
        <dc:Bounds x="405" y="173" width="50" height="50" />
        <bpmndi:BPMNLabel><dc:Bounds x="402" y="143" width="56" height="14" /></bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="_TaskShip" bpmnElement="Task_Ship">
        <dc:Bounds x="510" y="158" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="_EndDone" bpmnElement="End_Done">
        <dc:Bounds x="662" y="180" width="36" height="36" />
        <bpmndi:BPMNLabel><dc:Bounds x="641" y="222" width="80" height="14" /></bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="_EndRejected" bpmnElement="End_Rejected">
        <dc:Bounds x="412" y="282" width="36" height="36" />
        <bpmndi:BPMNLabel><dc:Bounds x="385" y="324" width="90" height="14" /></bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="_Flow1" bpmnElement="Flow_1">
        <di:waypoint x="196" y="198" /><di:waypoint x="250" y="198" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="_Flow2" bpmnElement="Flow_2">
        <di:waypoint x="350" y="198" /><di:waypoint x="405" y="198" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="_FlowYes" bpmnElement="Flow_yes">
        <di:waypoint x="455" y="198" /><di:waypoint x="510" y="198" />
        <bpmndi:BPMNLabel><dc:Bounds x="475" y="180" width="18" height="14" /></bpmndi:BPMNLabel>
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="_FlowNo" bpmnElement="Flow_no">
        <di:waypoint x="430" y="223" /><di:waypoint x="430" y="282" />
        <bpmndi:BPMNLabel><dc:Bounds x="437" y="246" width="14" height="14" /></bpmndi:BPMNLabel>
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="_Flow3" bpmnElement="Flow_3">
        <di:waypoint x="610" y="198" /><di:waypoint x="662" y="198" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`${method} ${path} -> ${res.status}: ${await res.text()}`);
  }
  return res.status === 204 ? null : res.json();
}

async function reset() {
  const items = await api('GET', '/diagrams');
  for (const d of items) {
    await api('DELETE', `/diagrams/${d.id}`);
  }
}

async function shoot(page, name) {
  const target = `${OUT_DIR}/${name}.png`;
  await page.screenshot({ path: target, fullPage: false });
  console.log(`  -> ${target}`);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  console.log('Resetting database…');
  await reset();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 800 },
    deviceScaleFactor: 1
  });
  const page = await context.newPage();

  console.log('1) Empty diagram list');
  await page.goto(`${FRONTEND}/diagrams`);
  await page.waitForSelector('[data-testid="list-empty"]');
  await shoot(page, '01-diagrams-empty');

  console.log('Seeding sample diagrams…');
  await api('POST', '/diagrams', { name: 'Order fulfillment', xml: SAMPLE_PROCESS_BPMN });
  await api('POST', '/diagrams', { name: 'Customer onboarding', xml: SAMPLE_PROCESS_BPMN });
  await api('POST', '/diagrams', { name: 'Invoice review', xml: SAMPLE_PROCESS_BPMN });

  console.log('2) Diagram list with rows');
  await page.goto(`${FRONTEND}/diagrams`);
  await page.waitForSelector('[data-testid="diagram-table"]');
  await page.waitForTimeout(200);
  await shoot(page, '02-diagrams-list');

  console.log('3) New diagram (modeler)');
  await page.goto(`${FRONTEND}/diagrams/new`);
  await page.waitForSelector('[data-testid="modeler-canvas"] svg');
  await page.waitForTimeout(400);
  await shoot(page, '03-modeler-new');

  // Pick first diagram for editor/viewer screenshots
  const list = await api('GET', '/diagrams');
  const first = list[0];

  console.log('4) Editing an existing diagram');
  await page.goto(`${FRONTEND}/diagrams/${first.id}/edit`);
  await page.waitForSelector('[data-testid="modeler-canvas"] svg[data-element-id]');
  await page.waitForTimeout(500);
  await shoot(page, '04-modeler-edit');

  console.log('5) Read-only viewer');
  await page.goto(`${FRONTEND}/diagrams/${first.id}`);
  await page.waitForSelector('[data-testid="viewer-canvas"] svg[data-element-id="Process_1"]');
  await page.waitForTimeout(500);
  await shoot(page, '05-viewer');

  await browser.close();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
