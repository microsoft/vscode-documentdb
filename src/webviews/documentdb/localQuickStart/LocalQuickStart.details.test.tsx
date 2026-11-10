/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { SSRProvider } from '@fluentui/react-components';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client'; // eslint-disable-line import/no-internal-modules
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstanceState, type DockerReadiness, type StageEvent } from '../../../services/localQuickStart/quickStartTypes';
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
            common: { openUrl: mutation(), openFeedback: mutation() },
            localQuickStart: {
                getDockerStatus: { query: vi.fn() },
                checkPort: { query: vi.fn(async () => 'available') },
                onInstanceChanged: { subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) },
                startQuickStart: { subscribe },
                waitLonger: { subscribe },
                discardTimedOut: { mutate: vi.fn(async () => true) },
                reportStepChange: mutation(),
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
            return selector === ':modal' ? false : matches.call(this, selector);
        });
        client.streams.length = 0;
        client.trpc.localQuickStart.getDockerStatus.query.mockReset().mockResolvedValue(status(ready));
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        await act(async () => root.render(<SSRProvider><LocalQuickStart /></SSRProvider>));
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        host.remove();
        vi.restoreAllMocks();
    });

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
    });
});
