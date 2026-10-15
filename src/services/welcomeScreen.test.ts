/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { maybeShowWelcomeScreen } from './welcomeScreen';

const mocks = vi.hoisted(() => {
    const globalState = new Map<string, unknown>();
    const workspaceState = new Map<string, unknown>();
    return {
        globalState,
        workspaceState,
        globalGet: vi.fn((key: string, fallback?: unknown): unknown => globalState.get(key) ?? fallback),
        globalUpdate: vi.fn(async (key: string, value: unknown): Promise<void> => {
            globalState.set(key, value);
        }),
        workspaceUpdate: vi.fn(async (key: string, value: unknown): Promise<void> => {
            if (value === undefined) {
                workspaceState.delete(key);
            } else {
                workspaceState.set(key, value);
            }
        }),
        env: { sessionId: 'window-session-1' },
        executeCommand: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
        appendLog: vi.fn(),
    };
});

vi.mock('vscode', () => ({
    env: mocks.env,
    commands: { executeCommand: mocks.executeCommand },
}));

vi.mock('../extensionVariables', () => ({
    ext: {
        context: {
            globalState: { get: mocks.globalGet, update: mocks.globalUpdate },
            workspaceState: {
                get: (key: string): unknown => mocks.workspaceState.get(key),
                update: mocks.workspaceUpdate,
            },
        },
        outputChannel: { appendLog: mocks.appendLog },
    },
}));

const SHOWN_KEY = 'welcomeScreenShown_v1_0_0';
const LEGACY_SHOWN_KEY = 'welcomeScreenShown_v0_4_0';
const DEFERRED_SESSION_KEY = 'welcomeScreenDeferredSession_v1_0_0';

describe('welcome screen session deferral', () => {
    let context: Pick<IActionContext, 'telemetry'>;

    beforeEach((): void => {
        vi.clearAllMocks();
        mocks.globalState.clear();
        mocks.workspaceState.clear();
        mocks.env.sessionId = 'window-session-1';
        mocks.executeCommand.mockReset().mockResolvedValue(undefined);
        context = { telemetry: { properties: {}, measurements: {} } };
    });

    it('opens onboarding for a fresh install without deferring', async (): Promise<void> => {
        const opening = maybeShowWelcomeScreen(context);
        expect(mocks.executeCommand).not.toHaveBeenCalled();
        await opening;

        expect(mocks.executeCommand).toHaveBeenCalledExactlyOnceWith(
            'workbench.action.openWalkthrough',
            'ms-azuretools.vscode-documentdb#documentdb-welcome',
        );
        expect(mocks.globalState.get(SHOWN_KEY)).toBe(true);
        expect(context.telemetry.properties.welcomeScreenShown).toBe('true');
        expect(mocks.workspaceUpdate).not.toHaveBeenCalledWith(DEFERRED_SESSION_KEY, mocks.env.sessionId);
    });

    it('treats an unset or false legacy welcome flag as a fresh install', async (): Promise<void> => {
        mocks.globalState.set(LEGACY_SHOWN_KEY, false);
        await maybeShowWelcomeScreen(context);
        expect(mocks.executeCommand).toHaveBeenCalledTimes(1);
    });

    it('defers the first upgraded activation without consuming the welcome opportunity', async (): Promise<void> => {
        mocks.globalState.set(LEGACY_SHOWN_KEY, true);
        await maybeShowWelcomeScreen(context);

        expect(mocks.workspaceState.get(DEFERRED_SESSION_KEY)).toBe('window-session-1');
        expect(mocks.executeCommand).not.toHaveBeenCalled();
        expect(mocks.globalState.has(SHOWN_KEY)).toBe(false);
        expect(context.telemetry.properties.welcomeScreenShown).toBeUndefined();
        expect(mocks.appendLog).toHaveBeenCalledWith(
            'Deferring the updated welcome screen until a later window session.',
        );
    });

    it('keeps deferring when the extension host restarts in the same window session', async (): Promise<void> => {
        mocks.globalState.set(LEGACY_SHOWN_KEY, true);
        await maybeShowWelcomeScreen(context);
        vi.resetModules();
        const reactivated = await import('./welcomeScreen');
        await reactivated.maybeShowWelcomeScreen(context);

        expect(mocks.executeCommand).not.toHaveBeenCalled();
        expect(mocks.workspaceUpdate).toHaveBeenCalledExactlyOnceWith(DEFERRED_SESSION_KEY, 'window-session-1');
        expect(mocks.globalState.has(SHOWN_KEY)).toBe(false);
    });

    it('opens the updated walkthrough on a later window session and clears the pending state', async (): Promise<void> => {
        mocks.globalState.set(LEGACY_SHOWN_KEY, true);
        await maybeShowWelcomeScreen(context);
        mocks.env.sessionId = 'window-session-2';
        await maybeShowWelcomeScreen(context);

        expect(mocks.executeCommand).toHaveBeenCalledTimes(1);
        expect(mocks.globalState.get(SHOWN_KEY)).toBe(true);
        expect(mocks.workspaceState.has(DEFERRED_SESSION_KEY)).toBe(false);
        expect(context.telemetry.properties.welcomeScreenShown).toBe('true');
    });

    it('does not reopen the walkthrough on subsequent activations or patch updates', async (): Promise<void> => {
        mocks.globalState.set(SHOWN_KEY, true);
        mocks.globalState.set(LEGACY_SHOWN_KEY, true);
        await maybeShowWelcomeScreen(context);
        mocks.env.sessionId = 'window-session-2';
        await maybeShowWelcomeScreen(context);

        expect(mocks.executeCommand).not.toHaveBeenCalled();
        expect(mocks.workspaceUpdate).not.toHaveBeenCalled();
    });

    it('defers independently in another workspace instead of consuming its first activation', async (): Promise<void> => {
        mocks.globalState.set(LEGACY_SHOWN_KEY, true);
        await maybeShowWelcomeScreen(context);
        mocks.workspaceState.clear();
        mocks.env.sessionId = 'another-workspace-session';
        await maybeShowWelcomeScreen(context);

        expect(mocks.executeCommand).not.toHaveBeenCalled();
        expect(mocks.workspaceState.get(DEFERRED_SESSION_KEY)).toBe('another-workspace-session');
    });

    it('honors the shared shown flag when another workspace already opened the guide', async (): Promise<void> => {
        mocks.globalState.set(LEGACY_SHOWN_KEY, true);
        await maybeShowWelcomeScreen(context);
        mocks.globalState.set(SHOWN_KEY, true);
        mocks.env.sessionId = 'window-session-2';
        await maybeShowWelcomeScreen(context);

        expect(mocks.executeCommand).not.toHaveBeenCalled();
    });

    it('does not mark the walkthrough as shown before the open command resolves', async (): Promise<void> => {
        let finishOpening: () => void = (): never => {
            throw new Error('The command has not started');
        };
        mocks.executeCommand.mockImplementationOnce(
            (): Promise<void> =>
                new Promise<void>((resolve): void => {
                    finishOpening = resolve;
                }),
        );
        const opening = maybeShowWelcomeScreen(context);
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect(mocks.executeCommand).toHaveBeenCalledTimes(1);
        expect(mocks.globalState.has(SHOWN_KEY)).toBe(false);
        finishOpening();
        await opening;
        expect(mocks.globalState.get(SHOWN_KEY)).toBe(true);
    });

    it('logs command failures, preserves pending state and retries a deferred upgrade', async (): Promise<void> => {
        mocks.globalState.set(LEGACY_SHOWN_KEY, true);
        mocks.workspaceState.set(DEFERRED_SESSION_KEY, 'previous-window-session');
        mocks.executeCommand.mockRejectedValueOnce(new Error('Walkthrough unavailable'));
        await maybeShowWelcomeScreen(context);

        expect(mocks.globalState.has(SHOWN_KEY)).toBe(false);
        expect(mocks.workspaceState.get(DEFERRED_SESSION_KEY)).toBe('previous-window-session');
        expect(context.telemetry.properties.welcomeScreenError).toBe('true');
        expect(mocks.appendLog).toHaveBeenCalledWith('Welcome screen error: Walkthrough unavailable');

        await maybeShowWelcomeScreen(context);
        expect(mocks.executeCommand).toHaveBeenCalledTimes(2);
        expect(mocks.globalState.get(SHOWN_KEY)).toBe(true);
        expect(mocks.workspaceState.has(DEFERRED_SESSION_KEY)).toBe(false);
    });

    it('leaves fresh-install onboarding retryable after an opening failure', async (): Promise<void> => {
        mocks.executeCommand.mockRejectedValueOnce('Command failed');
        await maybeShowWelcomeScreen(context);
        expect(mocks.globalState.has(SHOWN_KEY)).toBe(false);
        expect(mocks.appendLog).toHaveBeenCalledWith('Welcome screen error: Command failed');

        await maybeShowWelcomeScreen(context);
        expect(mocks.globalState.get(SHOWN_KEY)).toBe(true);
    });

    it('does not open the guide when persisting the deferral fails', async (): Promise<void> => {
        mocks.globalState.set(LEGACY_SHOWN_KEY, true);
        mocks.workspaceUpdate.mockRejectedValueOnce(new Error('Storage unavailable'));
        await maybeShowWelcomeScreen(context);

        expect(mocks.executeCommand).not.toHaveBeenCalled();
        expect(mocks.globalState.has(SHOWN_KEY)).toBe(false);
        expect(context.telemetry.properties.welcomeScreenError).toBe('true');
        expect(mocks.appendLog).toHaveBeenCalledWith('Welcome screen error: Storage unavailable');

        await maybeShowWelcomeScreen(context);
        expect(mocks.workspaceState.get(DEFERRED_SESSION_KEY)).toBe('window-session-1');
        expect(mocks.executeCommand).not.toHaveBeenCalled();
    });

    it('logs state-read failures without rejecting activation', async (): Promise<void> => {
        mocks.globalGet.mockImplementationOnce((): never => {
            throw new Error('State unavailable');
        });
        await expect(maybeShowWelcomeScreen(context)).resolves.toBeUndefined();
        expect(mocks.executeCommand).not.toHaveBeenCalled();
        expect(mocks.appendLog).toHaveBeenCalledWith('Welcome screen error: State unavailable');
        expect(context.telemetry.properties.welcomeScreenError).toBe('true');
    });

    it('leaves an unsuccessful shown-state write retryable', async (): Promise<void> => {
        mocks.globalUpdate.mockRejectedValueOnce(new Error('Write failed'));
        await maybeShowWelcomeScreen(context);

        expect(mocks.globalState.has(SHOWN_KEY)).toBe(false);
        expect(context.telemetry.properties.welcomeScreenShown).toBeUndefined();
        expect(mocks.appendLog).toHaveBeenCalledWith('Welcome screen error: Write failed');

        await maybeShowWelcomeScreen(context);
        expect(mocks.globalState.get(SHOWN_KEY)).toBe(true);
    });
});
