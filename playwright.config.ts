import { defineConfig, devices } from '@playwright/test';

// Support testing against local, staging, or production via BASE_URL env var
const baseURL = process.env.BASE_URL || 'http://localhost:3000';

export default defineConfig({
  testDir: 'tests',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});

