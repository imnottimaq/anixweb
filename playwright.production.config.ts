import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests/production',
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    workers: 1,
    retries: process.env.CI ? 1 : 0,
    reporter: 'list',
    outputDir: './test-results/production-artifacts',
    expect: { timeout: 10000 },
    use: { baseURL: 'http://127.0.0.1:5181/anixweb/', trace: 'retain-on-failure' },
    webServer: {
        command: 'npx vite build --outDir test-results/production-dist && npx vite preview --outDir test-results/production-dist --host 127.0.0.1 --port 5181 --strictPort',
        env: { BASE_PATH: '/anixweb/' },
        url: 'http://127.0.0.1:5181/anixweb/',
        reuseExistingServer: false,
        timeout: 60000,
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
        { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    ],
});
