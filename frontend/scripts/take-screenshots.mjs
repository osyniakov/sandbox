// Generates documentation screenshots for the README / PR.
//
// Usage:  node scripts/take-screenshots.mjs
// Requires the Spring Boot backend on :8080 and the Angular dev server on :4200.

import { chromium } from '@playwright/test';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '../../docs/screenshots');
const SAMPLES_DIR = resolve(__dirname, '../../backend/src/main/resources/sample-diagrams');
const FRONTEND = 'http://localhost:4200';
const API = 'http://localhost:8080/api';

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

function humanize(filename) {
  const base = filename.replace(/\.bpmn$/, '').replace(/^\d+-/, '');
  const spaced = base.replace(/[-_]/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

async function seedFromDisk() {
  const files = (await readdir(SAMPLES_DIR)).filter((f) => f.endsWith('.bpmn')).sort();
  for (const f of files) {
    const xml = await readFile(`${SAMPLES_DIR}/${f}`, 'utf8');
    await api('POST', '/diagrams', { name: humanize(f), xml });
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

  console.log('Seeding sample diagrams from disk…');
  await seedFromDisk();

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

  console.log(`4) Editing an existing diagram (${first.name})`);
  await page.goto(`${FRONTEND}/diagrams/${first.id}/edit`);
  await page.waitForSelector('[data-testid="modeler-canvas"] svg[data-element-id]');
  await page.waitForTimeout(500);
  await shoot(page, '04-modeler-edit');

  console.log('5) Read-only viewer');
  await page.goto(`${FRONTEND}/diagrams/${first.id}`);
  await page.waitForSelector('[data-testid="viewer-canvas"] svg[data-element-id]');
  await page.waitForTimeout(500);
  await shoot(page, '05-viewer');

  console.log('6) Modeler with element selected (properties panel)');
  await page.goto(`${FRONTEND}/diagrams/${first.id}/edit`);
  await page.waitForSelector('[data-testid="modeler-canvas"] svg[data-element-id]');
  await page.waitForTimeout(500);
  // Click the first start event shape to populate the properties panel
  await page.locator('[data-testid="modeler-canvas"] [data-element-id^="StartEvent"]').first().click();
  await page.waitForTimeout(300);
  await shoot(page, '06-modeler-properties');

  await browser.close();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
