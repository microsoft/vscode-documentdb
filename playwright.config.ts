/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Playwright config for the webview visual suite (`npm run test:visual`).
 *
 * The suite drives the real built webview bundle in a browser against a stubbed extension host —
 * see `test/webview-harness/README.md`. It is separate from Jest, which owns `src/**\/*.test.ts`
 * and never sees these specs.
 *
 * `webServer` starts the harness server itself, so a run is a single command. It does NOT build the
 * bundle: run `npm run webpack-dev-wv` first (the server warns when `dist/views.js` is missing).
 */

import { defineConfig, devices } from '@playwright/test';

const PORT = 18099;

export default defineConfig({
    testDir: './test/webview-harness',
    outputDir: './testOutput/playwright',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI
        ? [['github'], ['list']]
        : // The html report is where the captured state images are reviewed: `npx playwright
          // show-report testOutput/playwright-report`.
          [['list'], ['html', { open: 'never', outputFolder: 'testOutput/playwright-report' }]],
    use: {
        baseURL: `http://127.0.0.1:${PORT}`,
        // The panel is a tall single column; this is roughly an editor group on a laptop.
        viewport: { width: 1100, height: 900 },
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    webServer: {
        command: `node test/webview-harness/serve.js ${PORT}`,
        url: `http://127.0.0.1:${PORT}/quickstart-harness.html`,
        reuseExistingServer: !process.env.CI,
        stdout: 'pipe',
        timeout: 30_000,
    },
});
