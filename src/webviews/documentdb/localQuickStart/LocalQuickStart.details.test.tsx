/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { SSRProvider } from '@fluentui/react-components';
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client'; // eslint-disable-line import/no-internal-modules
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    InstanceState,
    type DockerReadiness,
    type StageEvent,
} from '../../../services/localQuickStart/quickStartTypes';
import { LocalQuickStart } from './LocalQuickStart';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class NoopResizeObserver {
    public observe(): void {}
    public unobserve(): void {}
    public disconnect(): void {}
}
window.ResizeObserver ??= NoopResizeObserver;

interface StreamHandlers {
    readonly onData: (event: StageEvent) => void;
}

const client = vi.hoisted(() => {
    const streams: StreamHandlers[] = [];
    const mutation = (): { mutate: ReturnType<typeof vi.fn> } => ({ mutate: vi.fn(async () => undefined) });
    const subscribe = vi.fn((_input: unknown, handlers: StreamHandlers) => {
        streams.push(handlers);
        return { unsubscribe: vi.fn() };
    });
    return {
        streams,
        trpc: {
            common: { openUrl: mutation(), openFeedback: mutation(), reportError: mutation(), reportEvent: mutation() },
            localQuickStart: {
                getDockerStatus: { query: vi.fn() },
                checkPort: { query: vi.fn(async () => 'available') },
                onInstanceChanged: { subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) },
                startQuickStart: { subscribe },
                waitLonger: { subscribe },
                discardTimedOut: { mutate: vi.fn(async () => true) },
                reportStepChange: mutation(),
                reportDetailsOpened: mutation(),
                closePanel: mutation(),
                showOutput: mutation(),
                openConnection: mutation(),
                copyRecoveryCommand: mutation(),
                startDockerProvider: mutation(),
            },
        },
    };
});

vi.mock('@vscode/l10n', () => ({
    t: (message: string, ...args: unknown[]): string =>
        args.reduce<string>((result, value, index) => result.replace(`{${index}}`, String(value)), message),
}));
vi.mock('@microsoft/vscode-ext-webview/react', () => ({
    useConfiguration: () => ({ initialPhase: 'configure' }),
}));
vi.mock('../../_integration/useTrpcClient', () => ({ useTrpcClient: () => client.trpc }));

const ready: DockerReadiness = {
    outcome: 'ready',
    environment: 'linux',
    endpointKind: 'unixSocket',
    provider: 'dockerEngine',
    providerEvidence: 'liveDaemon',
    executionTarget: 'local',
    canContinueAnyway: false,
    checkedAtMs: 1_700_000_000_000,
    cliInstalled: true,
    daemonReachable: true,
};
const failed: DockerReadiness = {
    ...ready,
    outcome: 'diagnosed',
    failureKind: 'permissionDenied',
    canContinueAnyway: false,
    daemonReachable: false,
};

function status(readiness: DockerReadiness): object {
    return { readiness, status: { state: InstanceState.NotInstalled }, canReuseExistingData: false };
}

let host: HTMLDivElement;
let root: Root;

function button(name: string): HTMLButtonElement {
    const found = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
        (candidate) => candidate.textContent?.trim() === name || candidate.getAttribute('aria-label') === name,
    );
    if (!found) throw new Error(`Missing button: ${name}`);
    return found;
}

function toggle(stage: string): HTMLButtonElement | null {
    return host.querySelector<HTMLButtonElement>(`button[aria-label="Details for ${stage}"]`);
}

async function click(element: HTMLElement): Promise<void> {
    await act(async () => element.click());
}

async function event(value: StageEvent): Promise<void> {
    await act(async () => client.streams.at(-1)?.onData(value));
}

async function start(): Promise<void> {
    await click(button('Start DocumentDB Local'));
}

describe('Local Quick Start stage details', () => {
    beforeEach(async () => {
        const matches = Element.prototype.matches;
        vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string): boolean {
            return selector === ':modal' ? false : matches.call(this, selector) === true;
        });
        client.streams.length = 0;
        client.trpc.localQuickStart.reportDetailsOpened.mutate.mockReset().mockResolvedValue(undefined);
        client.trpc.common.reportError.mutate.mockClear();
        client.trpc.common.reportEvent.mutate.mockClear();
        client.trpc.localQuickStart.getDockerStatus.query.mockReset().mockResolvedValue(status(ready));
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        await act(async () =>
            root.render(
                <SSRProvider>
                    <LocalQuickStart />
                </SSRProvider>,
            ),
        );
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        host.remove();
        vi.restoreAllMocks();
    });

    it('reports only openings, once each in StrictMode, including reopenings on Done', async () => {
        await act(async () =>
            root.render(
                <SSRProvider>
                    <StrictMode>
                        <LocalQuickStart />
                    </StrictMode>
                </SSRProvider>,
            ),
        );
        await start();
        await event({ stage: 'checking', status: 'done', facts: { kind: 'checking', port: 10333, portFree: true } });
        const report = client.trpc.localQuickStart.reportDetailsOpened.mutate;
        expect(report).not.toHaveBeenCalled();

        await click(toggle('Checking container engine')!);
        expect(report).toHaveBeenCalledExactlyOnceWith({ stage: 'checking' });
        await click(toggle('Checking container engine')!);
        expect(report).toHaveBeenCalledTimes(1);
        await click(toggle('Checking container engine')!);
        expect(report).toHaveBeenCalledTimes(2);
        await event({ stage: 'done', status: 'done' });
        expect(report).toHaveBeenCalledTimes(2);
        await click(toggle('Checking container engine')!);
        expect(report).toHaveBeenCalledTimes(2);
        await click(toggle('Checking container engine')!);
        expect(report.mock.calls).toEqual([[{ stage: 'checking' }], [{ stage: 'checking' }], [{ stage: 'checking' }]]);
        expect(client.trpc.common.reportEvent.mutate).not.toHaveBeenCalled();
    });

    it.each([new Error('Disclosure reporting failed'), 'Disclosure reporting failed'])(
        'reports a failed disclosure mutation without preventing expansion (%s)',
        async (error) => {
            client.trpc.localQuickStart.reportDetailsOpened.mutate.mockRejectedValueOnce(error);
            await start();
            await event({ stage: 'checking', status: 'done' });

            await click(toggle('Checking container engine')!);

            expect(toggle('Checking container engine')?.getAttribute('aria-expanded')).toBe('true');
            expect(client.trpc.common.reportError.mutate).toHaveBeenCalledExactlyOnceWith({
                message: 'Disclosure reporting failed',
                stack: error instanceof Error ? error.stack : '',
            });
        },
    );

    it('shows collapsed details only for a settled checking row and carries them to Done', async () => {
        await start();
        await event({ stage: 'checking', status: 'active' });
        expect(toggle('Checking container engine')).toBeNull();
        await event({ stage: 'checking', status: 'done' });
        const checking = toggle('Checking container engine');
        expect(checking?.getAttribute('aria-expanded')).toBe('false');
        await click(checking!);
        expect(host.textContent).toContain('Docker Engine');
        expect(toggle('Pulling official image')).toBeNull();
        await event({ stage: 'done', status: 'done' });
        expect(toggle('Checking container engine')?.getAttribute('aria-expanded')).toBe('true');
    });

    it.each(['pulling', 'creating'] as const)('keeps engine failure evidence on the failed %s row', async (stage) => {
        await start();
        await event({ stage: 'checking', status: 'done' });
        await event({ stage, status: 'active' });
        await event({ stage: 'error', status: 'error', dockerReadiness: failed });
        const name = stage === 'pulling' ? 'Pulling official image' : 'Creating container';
        const check = toggle('Checking container engine');
        const failure = toggle(name);
        expect(failure?.getAttribute('aria-expanded')).toBe('false');
        const description = failure?.getAttribute('aria-describedby');
        expect(description && document.getElementById(description)?.textContent).toBe('Docker access denied');
        await click(failure!);
        expect(host.textContent).toContain('Docker access denied');
        expect(host.textContent).toContain('View setup log');
        await click(check!);
        const regions = [...host.querySelectorAll('[role="region"]')];
        const checkRegion = regions.find((region) => region.getAttribute('aria-labelledby') === check?.id);
        expect(checkRegion?.textContent).toContain('Docker is ready');
    });

    it('shows failed check evidence and moves focus to the focusable disabled footer when rechecking', async () => {
        client.trpc.localQuickStart.getDockerStatus.query.mockResolvedValue(status(failed));
        await start();
        await event({ stage: 'checking', status: 'active' });
        await event({ stage: 'checking', status: 'error' });
        const checking = toggle('Checking container engine');
        expect(checking?.getAttribute('aria-expanded')).toBe('false');
        await click(checking!);
        expect(host.textContent).toContain('Last checked');
        expect(host.textContent).toContain('Docker access denied');
        expect(host.textContent).toContain('View setup log');
        checking!.focus();
        let resolveRecheck: (value: object) => void = () => undefined;
        client.trpc.localQuickStart.getDockerStatus.query.mockImplementationOnce(
            () => new Promise((resolve) => (resolveRecheck = resolve)),
        );
        await click(button('Check Docker again'));
        expect(toggle('Checking container engine')).toBeNull();
        expect(document.activeElement).toBe(button('Retry setup'));
        expect(button('Retry setup').getAttribute('aria-disabled')).toBe('true');
        await act(async () => resolveRecheck(status(failed)));
        expect(toggle('Checking container engine')?.getAttribute('aria-expanded')).toBe('false');
        expect(client.trpc.localQuickStart.reportDetailsOpened.mutate).toHaveBeenCalledExactlyOnceWith({
            stage: 'checking',
        });
        await click(toggle('Checking container engine')!);
        expect(client.trpc.localQuickStart.reportDetailsOpened.mutate).toHaveBeenCalledTimes(2);
    });

    it('moves focus from the recheck action to the footer while checking Docker again', async () => {
        client.trpc.localQuickStart.getDockerStatus.query.mockResolvedValue(status(failed));
        await start();
        await event({ stage: 'checking', status: 'active' });
        await event({ stage: 'checking', status: 'error' });
        let resolveRecheck: (value: object) => void = () => undefined;
        client.trpc.localQuickStart.getDockerStatus.query.mockImplementationOnce(
            () => new Promise((resolve) => (resolveRecheck = resolve)),
        );
        const recheck = button('Check Docker again');
        recheck.focus();
        expect(document.activeElement).toBe(recheck);
        await click(recheck);
        expect(recheck.isConnected).toBe(false);
        expect(document.activeElement).toBe(button('Retry setup'));
        expect(button('Retry setup').getAttribute('aria-disabled')).toBe('true');
        await act(async () => resolveRecheck(status(failed)));
        expect(document.activeElement).toBe(button('Retry setup'));
    });

    it('collapses an expanded check on retry', async () => {
        await start();
        await event({ stage: 'checking', status: 'done' });
        await event({ stage: 'pulling', status: 'active' });
        await event({ stage: 'error', status: 'error' });
        await click(toggle('Checking container engine')!);
        await click(button('Retry setup'));
        expect(toggle('Checking container engine')).toBeNull();
        await event({ stage: 'checking', status: 'done' });
        expect(toggle('Checking container engine')?.getAttribute('aria-expanded')).toBe('false');
        expect(client.trpc.localQuickStart.reportDetailsOpened.mutate).toHaveBeenCalledTimes(1);
        await click(toggle('Checking container engine')!);
        expect(client.trpc.localQuickStart.reportDetailsOpened.mutate.mock.calls).toEqual([
            [{ stage: 'checking' }],
            [{ stage: 'checking' }],
        ]);
    });

    it('clears open rows when waiting longer and starting over', async () => {
        await start();
        await event({ stage: 'checking', status: 'done' });
        await event({ stage: 'waiting', status: 'active' });
        await event({ stage: 'error', status: 'error', timedOut: true });
        await click(toggle('Checking container engine')!);
        await click(button('Wait longer'));
        expect(toggle('Checking container engine')?.getAttribute('aria-expanded')).toBe('false');
        await event({ stage: 'waiting', status: 'active' });
        await event({ stage: 'error', status: 'error', timedOut: true });
        await click(toggle('Checking container engine')!);
        await click(button('Start over'));
        await start();
        await event({ stage: 'checking', status: 'done' });
        expect(toggle('Checking container engine')?.getAttribute('aria-expanded')).toBe('false');
        expect(client.trpc.localQuickStart.reportDetailsOpened.mutate).toHaveBeenCalledTimes(2);
        await click(toggle('Checking container engine')!);
        expect(client.trpc.localQuickStart.reportDetailsOpened.mutate.mock.calls).toEqual([
            [{ stage: 'checking' }],
            [{ stage: 'checking' }],
            [{ stage: 'checking' }],
        ]);
    });

    it('shows each non-readiness stage table in Set up and Done, using code and the existing log action', async () => {
        await start();
        await event({ stage: 'checking', status: 'done', facts: { kind: 'checking', port: 10273, portFree: true } });
        await event({ stage: 'pulling', status: 'active' });
        expect(toggle('Pulling official image')).toBeNull();
        await event({
            stage: 'pulling',
            status: 'done',
            facts: { kind: 'pulling', imageRef: 'official:test-tag', imageOrigin: 'custom', result: 'downloaded' },
        });
        await event({
            stage: 'creating',
            status: 'done',
            facts: {
                kind: 'creating',
                containerName: 'test-instance',
                containerId: 'container-id',
                hostPort: 10273,
                containerPort: 10260,
                volumeName: 'test-volume',
                dataPath: '/data',
                volume: 'new',
                username: 'test-user',
            },
        });
        await event({
            stage: 'starting',
            status: 'done',
            facts: { kind: 'starting', running: true, boundPort: 10273, boundPortReported: true },
        });
        for (const stage of [
            'Checking container engine',
            'Pulling official image',
            'Creating container',
            'Starting container',
        ]) {
            expect(toggle(stage)?.getAttribute('aria-expanded')).toBe('false');
            await click(toggle(stage)!);
        }
        expect(toggle('Waiting for DocumentDB to accept connections')).toBeNull();
        expect([...host.querySelectorAll('code')].map((node) => node.textContent)).toContain('official:test-tag');
        expect(host.textContent).toContain('(hidden)');
        expect(host.textContent).toContain('Passed in a temporary file');
        const calls = client.trpc.localQuickStart.showOutput.mutate.mock.calls.length;
        const logLink = [...host.querySelectorAll<HTMLElement>('[role="button"], button, a')].find(
            (element) => element.textContent === 'View setup log',
        );
        expect(logLink).toBeDefined();
        await click(logLink!);
        expect(client.trpc.localQuickStart.showOutput.mutate).toHaveBeenCalledTimes(calls + 1);
        await event({ stage: 'waiting', status: 'done', facts: { kind: 'waiting', port: 10273 } });
        await event({ stage: 'done', status: 'done' });
        expect(host.textContent).toContain('official:test-tag');
        expect(host.textContent).toContain('test-volume');
        expect(host.textContent).toContain('10273');
        await click(toggle('Waiting for DocumentDB to accept connections')!);
        expect(client.trpc.localQuickStart.reportDetailsOpened.mutate.mock.calls).toEqual([
            [{ stage: 'checking' }],
            [{ stage: 'pulling' }],
            [{ stage: 'creating' }],
            [{ stage: 'starting' }],
            [{ stage: 'waiting' }],
        ]);
        expect(client.trpc.common.reportEvent.mutate).not.toHaveBeenCalled();
    });

    it('stores terminal error facts by kind rather than the error event stage', async () => {
        await start();
        await event({ stage: 'checking', status: 'done' });
        await event({ stage: 'pulling', status: 'active' });
        await event({
            stage: 'error',
            status: 'error',
            facts: { kind: 'pulling', imageRef: 'official:failed-tag', imageOrigin: 'custom' },
        });
        expect(toggle('Pulling official image')?.getAttribute('aria-expanded')).toBe('false');
        await click(toggle('Pulling official image')!);
        expect(host.textContent).toContain('official:failed-tag');
        await click(button('Retry setup'));
        await event({ stage: 'pulling', status: 'done' });
        expect(toggle('Pulling official image')).toBeNull();
        expect(host.textContent).not.toContain('official:failed-tag');
    });

    it.each(['loaded', 'notRequested', 'keptExisting', 'failed'] as const)(
        'keeps waiting done and shows a visible sample-data sentence only for failed loading (%s)',
        async (sampleData) => {
            await start();
            await event({
                stage: 'waiting',
                status: 'done',
                facts: { kind: 'waiting', port: 10333, attempts: 3, sampleData, displayName: 'DocumentDB Local' },
            });
            await event({ stage: 'done', status: 'done' });
            const waiting = toggle('Waiting for DocumentDB to accept connections');
            expect(waiting?.getAttribute('aria-expanded')).toBe('false');
            const sentence = 'Sample data was not loaded. View the setup log for the reason.';
            expect(host.textContent?.includes(sentence)).toBe(sampleData === 'failed');
            await click(waiting!);
            expect(host.textContent).toContain('localhost:10333');
            expect(host.textContent).toContain('ping on admin answered after 3 attempts');
            expect(host.textContent).toContain('Credentials in VS Code secret storage');
            if (sampleData === 'failed') {
                const region = host.querySelector(`[aria-labelledby="${waiting!.id}"]`);
                expect(region?.textContent).toContain('Info: Sample data was not loaded');
                expect(region?.textContent).toContain('The instance is ready to use without sample data.');
                expect(region?.textContent).toContain('Next: View setup log');
                const calls = client.trpc.localQuickStart.showOutput.mutate.mock.calls.length;
                const link = [...region!.querySelectorAll<HTMLElement>('a, button')].find(
                    (element) => element.textContent === 'View setup log',
                );
                expect(link).toBeDefined();
                await click(link!);
                expect(client.trpc.localQuickStart.showOutput.mutate).toHaveBeenCalledTimes(calls + 1);
            } else {
                expect(host.textContent).not.toContain('Sample data was not loaded');
            }
        },
    );

    it('shows failed readiness evidence without a success claim and clears it on Wait longer', async () => {
        await start();
        await event({ stage: 'waiting', status: 'active' });
        await event({
            stage: 'waiting',
            status: 'error',
            timedOut: true,
            facts: {
                kind: 'waiting',
                port: 10333,
                attempts: 4,
                lastProbeError: 'masked ***',
                exitCode: 1,
                lastLogLine: 'fatal ***',
            },
        });
        await click(toggle('Waiting for DocumentDB to accept connections')!);
        expect(host.textContent).toContain('4 attempts');
        expect(host.textContent).toContain('masked ***');
        expect(host.textContent).toContain('fatal ***');
        expect(host.textContent).not.toContain('ping on admin answered');
        expect(host.textContent).not.toContain('Credentials in VS Code secret storage');
        await click(button('Wait longer'));
        expect(toggle('Waiting for DocumentDB to accept connections')).toBeNull();
        expect(host.textContent).not.toContain('masked ***');
    });

    it('does not claim logs started streaming when starting failed before log following', async () => {
        await start();
        await event({ stage: 'starting', status: 'active' });
        await event({
            stage: 'error',
            status: 'error',
            facts: { kind: 'starting', boundPort: 10273, boundPortReported: false },
        });
        await click(toggle('Starting container')!);
        expect(host.textContent).toContain('10273');
        expect(host.textContent).not.toContain('Streaming to the setup log');
    });

    it('keeps earlier facts when waiting longer, but removes them on start over', async () => {
        await start();
        await event({ stage: 'checking', status: 'done', facts: { kind: 'checking', port: 10273, portFree: true } });
        await event({
            stage: 'pulling',
            status: 'done',
            facts: { kind: 'pulling', imageRef: 'official:retained', imageOrigin: 'default' },
        });
        await event({ stage: 'waiting', status: 'active' });
        await event({ stage: 'waiting', status: 'error', timedOut: true, facts: { kind: 'waiting', port: 10273 } });
        await click(toggle('Pulling official image')!);
        await click(button('Wait longer'));
        expect(toggle('Pulling official image')?.getAttribute('aria-expanded')).toBe('false');
        await click(toggle('Pulling official image')!);
        expect(host.textContent).toContain('official:retained');
        await event({ stage: 'waiting', status: 'error', timedOut: true });
        await click(button('Start over'));
        await start();
        await event({ stage: 'pulling', status: 'done' });
        expect(toggle('Pulling official image')).toBeNull();
        expect(host.textContent).not.toContain('official:retained');
    });
});
