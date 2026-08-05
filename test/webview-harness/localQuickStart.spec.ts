/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Visual + behavioral regression suite for the Local Quick Start webview.
 *
 * Every test here pins a defect found in the `0.10.0-bug-bash-1` bug bash, so a regression fails
 * the build instead of waiting for the next bash to rediscover it. The suite drives the REAL built
 * `dist/views.js` in a browser; only the extension host is stubbed (see README.md).
 *
 *   npm run webpack-dev-wv && npm run test:visual
 *
 * Issues covered here are the ones with a webview surface — #852, #854, #855, #856, #857. The two
 * without one are covered by Jest instead: #851 in `contributions.test.ts` (package.json menu
 * gating) and #858 in `src/commands/newLocalConnection/localEndpoint.test.ts`.
 */

import { expect, type Page, test, type TestInfo } from '@playwright/test';

import * as fs from 'fs/promises';
import * as path from 'path';

/** Where the reviewable state images land, in addition to the Playwright report. */
const SCREENSHOT_DIR = path.join(__dirname, '..', '..', 'testOutput', 'screenshots');

type HarnessCall = { readonly path: string; readonly input: unknown };

declare global {
    interface Window {
        __harnessCalls: HarnessCall[];
        __harnessReady: boolean;
    }
}

type Scenario =
    | 'introduction'
    | 'configure'
    | 'provisioning'
    | 'success'
    | 'success-relocated-port'
    | 'failed-port-in-use'
    | 'failed-timeout'
    | 'docker-missing-windows'
    | 'docker-missing-mac'
    | 'docker-missing-linux';

/**
 * Open a scenario and wait until the wizard has settled on the phase it asks for. The harness
 * advances the wizard by clicking, so the ready flag — not a sleep — is the signal.
 */
async function openScenario(page: Page, scenario: Scenario, theme: 'dark' | 'light' = 'dark'): Promise<void> {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`/quickstart-harness.html?scenario=${scenario}&theme=${theme}`);
    await page.waitForFunction(() => window.__harnessReady === true);
    // A render that threw would leave assertions passing against a half-mounted tree.
    expect(errors, `uncaught page errors in scenario "${scenario}"`).toEqual([]);
}

/** Host calls the webview made, in order. */
function callsTo(page: Page, path: string): Promise<HarnessCall[]> {
    return page.evaluate((wanted) => window.__harnessCalls.filter((call) => call.path === wanted), path);
}

/**
 * Capture the state as a report artifact rather than diffing it against a committed baseline.
 *
 * Pixel baselines are deliberately NOT used here: text in this panel is rendered by the OS, so a
 * baseline recorded on one contributor's machine fails on another's for reasons that have nothing
 * to do with the UI. The behavioral assertions above are the gate; these images are for a human to
 * look at (`npx playwright show-report`, or the files under `testOutput/screenshots/`). If the team
 * ever standardizes runs on one container image, these can become `toHaveScreenshot` baselines.
 */
async function captureState(page: Page, testInfo: TestInfo, name: string): Promise<void> {
    const screenshot = await page.screenshot({ fullPage: true, animations: 'disabled' });
    await testInfo.attach(name, { body: screenshot, contentType: 'image/png' });
    await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
    await fs.writeFile(path.join(SCREENSHOT_DIR, `${name}.png`), screenshot);
}

test.describe('Local Quick Start — Docker setup guidance', () => {
    /**
     * #856: the install CTA hardcoded the Docker Engine URL — a Linux-only install — and ignored
     * the per-platform guide the host resolved. Assert the label AND the URL it would open, since
     * the label alone was never the broken part.
     */
    test('Windows sends the user to Docker Desktop, not Docker Engine (#856)', async ({ page }) => {
        await openScenario(page, 'docker-missing-windows');

        const cta = page.getByRole('button', { name: 'Get Docker Desktop for Windows' });
        await expect(cta).toBeVisible();
        await cta.click();

        await expect
            .poll(() => callsTo(page, 'common.openUrl').then((calls) => calls.at(-1)?.input))
            .toEqual({ url: 'https://docs.docker.com/desktop/setup/install/windows-install/' });
    });

    test('macOS sends the user to Docker Desktop for Mac (#856)', async ({ page }) => {
        await openScenario(page, 'docker-missing-mac');

        await page.getByRole('button', { name: 'Get Docker Desktop for Mac' }).click();

        await expect
            .poll(() => callsTo(page, 'common.openUrl').then((calls) => calls.at(-1)?.input))
            .toEqual({ url: 'https://docs.docker.com/desktop/setup/install/mac-install/' });
    });

    /** Linux must NOT be redirected to Desktop — the Engine guide is correct there. */
    test('Linux keeps the Docker Engine install guide (#856)', async ({ page }) => {
        await openScenario(page, 'docker-missing-linux');

        await expect(page.getByRole('button', { name: 'Get Docker Desktop' })).toHaveCount(0);
        await page.getByRole('button', { name: 'Open Docker install guide' }).click();

        await expect
            .poll(() => callsTo(page, 'common.openUrl').then((calls) => calls.at(-1)?.input))
            .toEqual({ url: 'https://docs.docker.com/engine/install/' });
    });

    /**
     * #855: after installing Docker Desktop, a VS Code that was already running keeps its old PATH,
     * so Docker stays undetected and the setup looks broken. The guidance has to say to restart —
     * and to say that reloading the window is not enough, which is the wrong thing users try first.
     */
    test('Windows guidance asks for a VS Code restart and rules out a window reload (#855)', async ({ page }) => {
        await openScenario(page, 'docker-missing-windows');

        const guidance = page.getByText('Install Docker Desktop, then restart VS Code');
        await expect(guidance).toBeVisible();
        await expect(guidance).toContainText('reloading the window is not enough');
    });

    test('macOS guidance asks for a VS Code restart (#855)', async ({ page }) => {
        await openScenario(page, 'docker-missing-mac');

        await expect(page.getByText('Install Docker Desktop, then restart VS Code')).toBeVisible();
    });

    /** Linux guidance is unchanged — no restart claim that does not apply there. */
    test('Linux guidance makes no VS Code restart claim (#855)', async ({ page }) => {
        await openScenario(page, 'docker-missing-linux');

        await expect(page.getByText('Install Docker Engine or Docker Desktop')).toBeVisible();
        await expect(page.getByText('restart VS Code')).toHaveCount(0);
    });

    test('captures the Windows Docker-missing screen', async ({ page }, testInfo) => {
        await openScenario(page, 'docker-missing-windows');
        await captureState(page, testInfo, 'docker-missing-windows-dark');
    });
});

test.describe('Local Quick Start — success screen', () => {
    /**
     * #857: "Copy Connection String" sat beside "Open Connection" in the footer and read as the
     * next REQUIRED step. A bug-bash user followed it and created the connection by hand, ending
     * up with a duplicate. The footer must no longer offer it.
     */
    test('the footer no longer offers Copy Connection String (#857)', async ({ page }) => {
        await openScenario(page, 'success');

        const footer = page.locator('main > div').last();
        await expect(footer.getByRole('button', { name: 'Open Connection' })).toBeVisible();
        await expect(footer.getByRole('button', { name: 'Close' })).toBeVisible();
        await expect(footer.getByRole('button', { name: /copy/i })).toHaveCount(0);
    });

    test('the success message says the connection already exists (#857)', async ({ page }) => {
        await openScenario(page, 'success');

        await expect(page.getByText('This instance is already in the Connections view')).toBeVisible();
        await expect(page.getByText('You do not need to create a connection for it')).toBeVisible();
        await expect(page.getByText('The connection already exists in the Connections view')).toBeVisible();
    });

    /**
     * The copy action still EXISTS — it is the only way to reach the instance from mongosh or an
     * app — but as an optional step, described as being for clients outside VS Code.
     */
    test('copy survives as an optional inline action, and still works (#857)', async ({ page }) => {
        await openScenario(page, 'success');

        await expect(page.getByText('Optional — to reach this instance from a tool outside VS Code')).toBeVisible();

        await page.getByRole('button', { name: 'Copy connection string' }).click();

        await expect.poll(() => callsTo(page, 'localQuickStart.copyConnectionString')).toHaveLength(1);
    });

    /**
     * The primary action has to reach the host. It used to land on a handler that only ran
     * `connectionsView.focus`, which is invisible when that view is already active — the button
     * looked dead. What the host does with the call is asserted in
     * `src/tree/connections-view/LocalQuickStart/revealQuickStartInstance.test.ts`.
     */
    test('Open Connection asks the host to open the instance', async ({ page }) => {
        await openScenario(page, 'success');

        await page.getByRole('button', { name: 'Open Connection' }).click();

        await expect.poll(() => callsTo(page, 'localQuickStart.openConnection')).toHaveLength(1);
    });

    /**
     * #854: when the preferred port is taken, Docker now assigns one at bind time. The port the
     * user is told to connect on must be the one Docker actually bound, not the canonical default.
     */
    test('a Docker-assigned host port reaches the connection details (#854)', async ({ page }) => {
        await openScenario(page, 'success-relocated-port');

        await expect(page.getByText('DocumentDB Local is running on localhost:61146.')).toBeVisible();
        await expect(page.getByText('(localhost:61146)')).toBeVisible();
        await expect(page.getByText('10260')).toHaveCount(0);
    });

    test('captures the success screen in both themes', async ({ page }, testInfo) => {
        await openScenario(page, 'success');
        await captureState(page, testInfo, 'success-dark');

        await openScenario(page, 'success', 'light');
        await captureState(page, testInfo, 'success-light');
    });
});

test.describe('Local Quick Start — failure screens', () => {
    /**
     * #852: this message was a raw template literal that never passed through `l10n.t()`. The
     * extraction check lives in Jest; what matters here is that the string still reaches the user
     * intact, with the port interpolated, after being rewritten.
     */
    test('an explicit port conflict is reported with the port in it (#852)', async ({ page }) => {
        await openScenario(page, 'failed-port-in-use');

        const message = 'Port 12345 is already in use. Choose a different port or free it, then retry.';
        await expect(page.locator('.fui-MessageBarBody').getByText(message)).toBeVisible();
        // The same sentence must also reach screen readers, not just the message bar.
        await expect(page.locator('[aria-live="assertive"]').filter({ hasText: message })).toHaveCount(1);
    });

    /** The retry affordance has to survive the rewrite, or the message is a dead end. */
    test('a failed setup still offers Retry (#852)', async ({ page }) => {
        await openScenario(page, 'failed-port-in-use');

        await expect(page.getByRole('button', { name: 'Retry setup' })).toBeVisible();
    });

    test('a readiness timeout keeps the Wait longer / Start over choice', async ({ page }) => {
        await openScenario(page, 'failed-timeout');

        await expect(page.getByRole('button', { name: 'Wait longer' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Start over' })).toBeVisible();
    });

    test('captures the port-conflict screen', async ({ page }, testInfo) => {
        await openScenario(page, 'failed-port-in-use');
        await captureState(page, testInfo, 'failed-port-in-use-dark');
    });
});

test.describe('Local Quick Start — wizard walkthrough', () => {
    test('renders the introduction step', async ({ page }, testInfo) => {
        await openScenario(page, 'introduction');

        await expect(page.getByRole('heading', { name: 'Develop and test locally' })).toBeVisible();
        await captureState(page, testInfo, 'introduction-dark');
    });

    test('renders the configure step', async ({ page }, testInfo) => {
        await openScenario(page, 'configure');

        await expect(page.getByRole('heading', { name: 'Configure setup' })).toBeVisible();
        await captureState(page, testInfo, 'configure-dark');
    });

    test('renders the provisioning step with a working Cancel', async ({ page }, testInfo) => {
        await openScenario(page, 'provisioning');

        // Mid-provision the wizard must stay put and stay cancellable; it used to be possible to
        // fall back to the settings page when a stream ended without a terminal event.
        await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Setting up…' })).toBeDisabled();
        await captureState(page, testInfo, 'provisioning-dark');
    });
});
