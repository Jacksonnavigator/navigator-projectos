import { defineConfig, devices } from "@playwright/test";

const PORT = 8765;
const DB = process.env.E2E_DATABASE_URL ?? "postgresql+psycopg://nav:nav@localhost:5432/navigator_e2e";

// Runs the real FastAPI app (serving the built frontend) against a throwaway database.
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
      },
    },
  ],
  webServer: {
    command: `cd ../backend && . .venv/bin/activate && PYTHONPATH=. python scripts/e2e_reset.py && uvicorn app.main:app --port ${PORT}`,
    url: `http://localhost:${PORT}/api/v1/health/ready`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      DATABASE_URL: DB,
      ENVIRONMENT: "development",
      DEV_LOGIN_ENABLED: "true",
      ALLOWED_GITHUB_USER_IDS: "1",
      PUBLIC_BASE_URL: `http://localhost:${PORT}`,
      ENCRYPTION_KEY: "x5Gb8n2CqK3rS9tVwYzA1bC4dE6fG7hJ8kL0mN2pQ4s=",
      SESSION_SECRET: "e2e-session-secret-0123456789",
      LOCAL_STORAGE_DIR: "/tmp/projectos-e2e-storage",
      FRONTEND_DIST_DIR: "../frontend/dist",
    },
  },
});
