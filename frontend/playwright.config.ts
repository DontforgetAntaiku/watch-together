import { defineConfig } from '@playwright/test'

/**
 * End-to-end tests: a real backend, the real frontend and real Chromium windows playing real (generated) video.
 *   npm run test:e2e              (needs ffmpeg, and uv for the backend)
 * Set CHROMIUM_PATH to use an installed Chromium instead of Playwright's own (`npx playwright install chromium`).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: 'http://localhost:5191',
    serviceWorkers: 'block',
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ['--autoplay-policy=no-user-gesture-required', '--disable-features=WebRtcHideLocalIpsWithMdns', '--no-sandbox'],
    },
  },
  webServer: [
    {
      command: 'cd ../backend && uv run python -m uvicorn main:app --host 127.0.0.1 --port 8031',
      url: 'http://127.0.0.1:8031/api/health',
      env: { BACKEND_DEBUG: 'False', CREATE_PER_MINUTE: '10000', MSG_PER_SECOND: '200', MSG_BURST: '600' },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'npx vite --port 5191 --strictPort',
      url: 'http://localhost:5191',
      env: { BACKEND_PORT: '8031' },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
})
