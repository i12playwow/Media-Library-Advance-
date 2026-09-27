// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 120000,
  // Shared-runner launches (xvfb, cold caches) occasionally fail on the
  // first attempt; CI gets 2 retries, local runs stay strict at 0.
  retries: process.env.CI ? 2 : 0,
  use: {
    headless: false,
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
    video: 'retain-on-failure',
    // Failure evidence is only captured when it can exist: CI keeps a
    // full trace for any test that fails on some attempt, and offlines
    // screenshots come along for free with it. Local runs skip both —
    // the failing run itself is the evidence there.
    trace: process.env.CI ? 'retain-on-failure' : 'off',
    screenshot: process.env.CI ? 'only-on-failure' : 'off',
  },
  projects: [
    {
      name: 'Electron',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
