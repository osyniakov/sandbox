import { clearAllDiagrams, expect, NAMED_START_BPMN, seedDiagram, test } from './fixtures';

test.beforeEach(async ({ request }) => {
  await clearAllDiagrams(request);
});

test.describe('diagram list', () => {
  test('shows empty state when no diagrams exist', async ({ page }) => {
    await page.goto('/diagrams');
    await expect(page.getByTestId('list-empty')).toBeVisible();
    await expect(page.getByTestId('diagram-table')).toHaveCount(0);
  });

  test('shows rows for diagrams seeded via the API', async ({ page, request }) => {
    const seeded = await seedDiagram(request, 'Seeded diagram');
    await page.goto('/diagrams');
    const row = page.getByTestId(`diagram-row-${seeded.id}`);
    await expect(row).toBeVisible();
    await expect(row.getByTestId('diagram-name')).toHaveText('Seeded diagram');
  });
});

test.describe('modeler', () => {
  test('creates a new diagram and returns it to the list', async ({ page }) => {
    await page.goto('/diagrams');
    await page.getByTestId('new-diagram-link').click();

    await expect(page).toHaveURL(/\/diagrams\/new$/);
    await expect(page.getByTestId('modeler')).toBeVisible();
    await waitForBpmnCanvas(page);

    const nameInput = page.getByTestId('name-input');
    await nameInput.fill('Created via UI');

    await page.getByTestId('save-button').click();

    // After saving a NEW diagram the component navigates to /diagrams/{id}/edit
    // and re-mounts, so we only assert on the URL change here. The list page
    // assertion below confirms the create actually persisted.
    await expect(page).toHaveURL(/\/diagrams\/\d+\/edit$/);

    await page.goto('/diagrams');
    await expect(
      page.getByTestId('diagram-table').getByTestId('diagram-name').filter({ hasText: 'Created via UI' })
    ).toHaveCount(1);
  });

  test('opens an existing diagram for editing and saves a renamed copy', async ({ page, request }) => {
    const seeded = await seedDiagram(request, 'Original');

    await page.goto('/diagrams');
    await page.getByTestId(`diagram-row-${seeded.id}`).getByTestId('open-link').click();

    await expect(page).toHaveURL(new RegExp(`/diagrams/${seeded.id}/edit$`));
    await waitForBpmnCanvas(page);
    await expect(page.getByTestId('name-input')).toHaveValue('Original');

    await page.getByTestId('name-input').fill('Renamed');
    await page.getByTestId('save-button').click();
    await expect(page.getByTestId('modeler-status')).toContainText(/Saved at/);

    const updated = await request.get(`http://localhost:8080/api/diagrams/${seeded.id}`);
    expect(updated.ok()).toBeTruthy();
    expect((await updated.json()).name).toBe('Renamed');
  });

  test('exports the diagram as .bpmn via a browser download', async ({ page, request }) => {
    const seeded = await seedDiagram(request, 'Exportable');
    await page.goto(`/diagrams/${seeded.id}/edit`);
    await waitForBpmnCanvas(page);

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('export-xml-button').click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/Exportable\.bpmn$/);
  });
});

test.describe('viewer', () => {
  test('renders the read-only viewer with the diagram name', async ({ page, request }) => {
    const seeded = await seedDiagram(request, 'For viewing');

    await page.goto('/diagrams');
    await page.getByTestId(`diagram-row-${seeded.id}`).getByTestId('view-link').click();

    await expect(page).toHaveURL(new RegExp(`/diagrams/${seeded.id}$`));
    await expect(page.getByTestId('viewer')).toBeVisible();
    await expect(page.getByTestId('viewer-name')).toHaveText('For viewing');
    await waitForBpmnCanvas(page);
    await expect(
      page.getByTestId('viewer-canvas').locator('svg[data-element-id="Process_1"]')
    ).toBeVisible();

    // No editor toolbar in the viewer
    await expect(page.getByTestId('save-button')).toHaveCount(0);
  });
});

test.describe('properties panel', () => {
  test('shows the selected element\'s properties and can be collapsed', async ({ page, request }) => {
    const seeded = await seedDiagram(request, 'With named start', NAMED_START_BPMN);

    await page.goto(`/diagrams/${seeded.id}/edit`);
    await waitForBpmnCanvas(page);

    const panel = page.getByTestId('properties-panel');
    await expect(panel).toBeVisible();
    // Default selection is the Process — header reads "PROCESS"
    await expect(panel).toContainText('Process', { ignoreCase: true });

    // Click the StartEvent shape -> panel switches to the event's properties
    await page
      .locator('[data-testid="modeler-canvas"] [data-element-id="StartEvent_1"]')
      .first()
      .click();

    await expect(panel).toContainText('Start event', { ignoreCase: true });
    await expect(panel).toContainText('Order received');

    // Collapse the panel
    await page.getByTestId('panel-toggle').click();
    await expect(panel).toHaveClass(/collapsed/);
    await expect(page.getByTestId('properties-panel-host')).toBeHidden();

    // Restore
    await page.getByTestId('panel-toggle').click();
    await expect(panel).not.toHaveClass(/collapsed/);
    await expect(page.getByTestId('properties-panel-host')).toBeVisible();
  });
});

test.describe('delete', () => {
  test('removes a diagram from the list', async ({ page, request }) => {
    const a = await seedDiagram(request, 'Keeper');
    const b = await seedDiagram(request, 'Removable');

    await page.goto('/diagrams');
    await expect(page.getByTestId(`diagram-row-${a.id}`)).toBeVisible();
    await expect(page.getByTestId(`diagram-row-${b.id}`)).toBeVisible();

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId(`diagram-row-${b.id}`).getByTestId('delete-button').click();

    await expect(page.getByTestId(`diagram-row-${b.id}`)).toHaveCount(0);
    await expect(page.getByTestId(`diagram-row-${a.id}`)).toBeVisible();

    const stillThere = await request.get(`http://localhost:8080/api/diagrams/${a.id}`);
    expect(stillThere.ok()).toBeTruthy();
    const gone = await request.get(`http://localhost:8080/api/diagrams/${b.id}`);
    expect(gone.status()).toBe(404);
  });
});

/**
 * bpmn-js renders the canvas asynchronously after importXML resolves.
 * Wait until at least one SVG element is mounted under the canvas host.
 */
async function waitForBpmnCanvas(page: import('@playwright/test').Page): Promise<void> {
  const canvas = page.locator('[data-testid="modeler-canvas"], [data-testid="viewer-canvas"]').first();
  await expect(canvas).toBeVisible();
  await expect(canvas.locator('svg').first()).toBeVisible();
}

