import { defineConfig, devices } from '@playwright/test';

const FRONTEND_PORT = 4200;
const BACKEND_PORT = 8080;
const isCI = !!process.env['CI'];

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],

  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ],

  webServer: [
    {
      command: './mvnw -q spring-boot:run',
      cwd: '../backend',
      url: `http://localhost:${BACKEND_PORT}/api/diagrams`,
      reuseExistingServer: !isCI,
      stdout: 'ignore',
      stderr: 'pipe',
      timeout: 180_000
    },
    {
      command: 'npm run start',
      url: `http://localhost:${FRONTEND_PORT}`,
      reuseExistingServer: !isCI,
      stdout: 'ignore',
      stderr: 'pipe',
      timeout: 180_000,
      env: {
        NG_CLI_ANALYTICS: 'false'
      }
    }
  ]
});
