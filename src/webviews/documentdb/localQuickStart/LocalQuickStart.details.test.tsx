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
    PROVISION_STAGES,
    type DockerReadiness,
    type StageEvent,
} from '../../../services/localQuickStart/quickStartTypes';
import { LocalQuickStart } from './LocalQuickStart';
import { SetupStageDetails } from './SetupStageDetails';
import { SetupStageRow } from './SetupStageRow';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class NoopResizeObserver {
    public observe(): void {}
    public unobserve(): void {}
    public disconnect(): void {}
}
window.ResizeObserver ??= NoopResizeObserver;

interface StreamHandlers {
    readonly onData: (event: StageEvent) => void;
    readonly onError: (error: unknown) => void;
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
        initialPhase: 'configure',
        trpc: {
            common: { openUrl: mutation(), openFeedback: mutation(), reportError: mutation(), reportEvent: mutation() },
            localQuickStart: {
                getDockerStatus: { query: vi.fn() },
                getWizardContext: { query: vi.fn() },
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
    useConfiguration: () => ({ initialPhase: client.initialPhase }),
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
    cli: 'docker',
    daemonReachable: true,
};
const failed: DockerReadiness = {
    ...ready,
    outcome: 'diagnosed',
    failureKind: 'permissionDenied',
    canContinueAnyway: false,
    daemonReachable: false,
};
const stoppedPodman: DockerReadiness = {
    ...failed,
    cli: 'podman',
    engine: 'podman',
    engineEvidence: 'selectedCli',
    provider: 'podman',
    providerEvidence: 'none',
    environment: 'macos',
    failureKind: 'daemonUnavailable',
    startAction: 'startPodmanMachine',
    podmanMachine: { kind: 'stopped', name: 'custom-vm' },
};
const startingPodman: DockerReadiness = {
    ...stoppedPodman,
    failureKind: 'daemonStarting',
    startAction: undefined,
    podmanMachine: { kind: 'starting', name: 'custom-vm' },
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
        client.initialPhase = 'configure';
        client.trpc.localQuickStart.reportDetailsOpened.mutate.mockReset().mockResolvedValue(undefined);
        client.trpc.common.reportError.mutate.mockClear();
        client.trpc.common.reportEvent.mutate.mockClear();
        client.trpc.localQuickStart.getDockerStatus.query.mockReset().mockResolvedValue(status(ready));
        client.trpc.localQuickStart.getWizardContext.query.mockReset().mockResolvedValue({
            status: { state: InstanceState.NotInstalled },
            busy: false, canReuseExistingData: false, suggestedPort: 10260,
        });
        client.trpc.localQuickStart.startQuickStart.subscribe.mockClear();
        client.trpc.localQuickStart.startDockerProvider.mutate.mockReset().mockResolvedValue(undefined);
        client.trpc.localQuickStart.copyRecoveryCommand.mutate.mockReset().mockResolvedValue(undefined);
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

    it.each([
        { docker: false, podman: true },
        { docker: false, podman: false },
        { docker: true, podman: true },
    ])('defaults to Docker with static choices and no pre-execution readiness (%o)', async (cliOnPath) => {
        client.trpc.localQuickStart.getDockerStatus.query.mockResolvedValue(status({ ...ready, cliOnPath }));
        client.initialPhase = 'introduction';
        await act(async () => root.render(<SSRProvider><LocalQuickStart key="introduction" /></SSRProvider>));
        expect(host.textContent).toContain(
            'You choose a preferred engine in the next step; setup uses the other if it is not installed.',
        );
        await click(button('Continue'));
        const labels = [...host.querySelectorAll('table tr')].map((row) => row.textContent);
        expect(labels[0]).toContain('Container engineDocker');
        await click(button('Change the container engine'));
        const docker = host.querySelector<HTMLInputElement>('input[value="docker"]')!;
        const podman = host.querySelector<HTMLInputElement>('input[value="podman"]')!;
        expect(docker.checked).toBe(true);
        expect(docker.disabled).toBe(false);
        expect(podman.disabled).toBe(false);
        expect(host.textContent).toContain('Setup uses your preferred engine if installed, or the other one otherwise.');
        expect(host.textContent).not.toMatch(/Found on PATH|Not found on PATH|Detected|not installed on this machine/);
        await click(podman);
        expect(podman.checked).toBe(true);
        await click(docker);
        expect(docker.checked).toBe(true);
        expect(client.trpc.localQuickStart.getDockerStatus.query).not.toHaveBeenCalled();
        expect(client.trpc.localQuickStart.getWizardContext.query).toHaveBeenCalled();
    });

    it('retains the chosen preference through navigation and sends it unchanged at execution', async () => {
        await click(button('Change the container engine'));
        await click(host.querySelector<HTMLInputElement>('input[value="podman"]')!);
        await click(button('Back'));
        await click(button('Continue'));
        expect(host.querySelector<HTMLInputElement>('input[value="podman"]')?.checked).toBe(true);
        expect(client.trpc.localQuickStart.getDockerStatus.query).not.toHaveBeenCalled();

        await start();
        expect(client.trpc.localQuickStart.startQuickStart.subscribe).toHaveBeenLastCalledWith(
            expect.objectContaining({ preferredEngine: 'podman' }), expect.any(Object),
        );
        await event({ stage: 'checking', status: 'done' });
        expect(client.trpc.localQuickStart.getDockerStatus.query).toHaveBeenLastCalledWith(
            { preferredEngine: 'podman' }, expect.any(Object),
        );
    });

    it('starts a new wizard with Docker rather than retaining the previous preference', async () => {
        await click(button('Change the container engine'));
        await click(host.querySelector<HTMLInputElement>('input[value="podman"]')!);

        await act(async () => root.render(<SSRProvider><LocalQuickStart key="new-wizard" /></SSRProvider>));

        expect(host.querySelector('table tr')?.textContent).toContain('Container engineDocker');
        await click(button('Change the container engine'));
        expect(host.querySelector<HTMLInputElement>('input[value="docker"]')?.checked).toBe(true);
        expect(client.trpc.localQuickStart.getDockerStatus.query).not.toHaveBeenCalled();
    });

    it('passes the selected preference to post-execution rechecks, provider start, and polling', async () => {
        await click(button('Change the container engine'));
        await click(host.querySelector<HTMLInputElement>('input[value="podman"]')!);
        client.trpc.localQuickStart.getDockerStatus.query.mockResolvedValue(status({
            ...failed,
            failureKind: 'daemonUnavailable',
            provider: 'dockerDesktop',
            environment: 'windows',
            startAction: 'startDockerDesktopWindows',
        }));
        await start();
        await event({ stage: 'checking', status: 'error' });
        await click(button('Check Docker again'));
        expect(client.trpc.localQuickStart.getDockerStatus.query).toHaveBeenLastCalledWith(
            { forceRefresh: true, resetProviderMemory: true, preferredEngine: 'podman' }, expect.any(Object),
        );
        client.trpc.localQuickStart.getDockerStatus.query.mockResolvedValue(status(ready));
        client.trpc.localQuickStart.startDockerProvider.mutate.mockResolvedValue('started');

        vi.useFakeTimers();
        try {
            await click(button('Start Docker Desktop'));
            await act(async () => vi.advanceTimersByTimeAsync(1000));

            expect(client.trpc.localQuickStart.startDockerProvider.mutate).toHaveBeenCalledWith(
                { preferredEngine: 'podman' },
            );
            expect(client.trpc.localQuickStart.getDockerStatus.query).toHaveBeenLastCalledWith(
                expect.objectContaining({ preferredEngine: 'podman', forceRefresh: true, polled: true }),
                expect.any(Object),
            );
        } finally {
            vi.useRealTimers();
        }
    });

    it('automatically waits for an initially starting Podman machine without sending a startup mutation', async () => {
        await start();
        client.trpc.localQuickStart.getDockerStatus.query.mockResolvedValue(status({
            ...ready, cli: 'podman', engine: 'podman', provider: 'podman',
        }));
        vi.useFakeTimers();
        try {
            await event({ stage: 'checking', status: 'error', dockerReadiness: startingPodman });
            expect(button('Stop waiting')).toBeDefined();
            expect(host.textContent).toContain('Waiting for Podman to start');
            expect(host.textContent).toContain('Waiting 00:00');
            expect(client.trpc.localQuickStart.startDockerProvider.mutate).not.toHaveBeenCalled();
            await act(async () => vi.advanceTimersByTimeAsync(1_100));
            await act(async () => vi.advanceTimersByTimeAsync(100));
            expect(host.textContent).toContain('Ready to set up');
            expect(host.textContent).toContain('Podman is ready now.');
            expect(host.textContent).toContain('Podman is ready. Setup has not run yet.');
            expect(client.trpc.localQuickStart.getDockerStatus.query).toHaveBeenLastCalledWith({
                preferredEngine: 'docker', forceRefresh: true, polled: true, suppressCommandEcho: false,
            }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
            expect(client.trpc.localQuickStart.startDockerProvider.mutate).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not automatically restart the same execution wait after Stop or new starting facts', async () => {
        await start();
        client.trpc.localQuickStart.getDockerStatus.query.mockImplementation(async () => status({ ...startingPodman }));
        vi.useFakeTimers();
        try {
            await event({ stage: 'checking', status: 'error', dockerReadiness: startingPodman });
            await act(async () => vi.advanceTimersByTimeAsync(1_000));
            expect(button('Stop waiting')).toBeDefined();
            await click(button('Stop waiting'));
            const count = client.trpc.localQuickStart.getDockerStatus.query.mock.calls.length;
            await act(async () => vi.advanceTimersByTimeAsync(10_000));
            expect(client.trpc.localQuickStart.getDockerStatus.query).toHaveBeenCalledTimes(count);
            await click(button('Check Docker again'));
            await act(async () => vi.advanceTimersByTimeAsync(10_000));
            expect(client.trpc.localQuickStart.getDockerStatus.query).toHaveBeenCalledTimes(count + 1);
            expect([...host.querySelectorAll('button')].some((candidate) =>
                candidate.textContent?.trim() === 'Stop waiting',
            )).toBe(false);
            expect(client.trpc.localQuickStart.startDockerProvider.mutate).not.toHaveBeenCalled();

            await click(button('Retry setup'));
            await event({ stage: 'checking', status: 'error', dockerReadiness: { ...startingPodman } });
            expect(button('Stop waiting')).toBeDefined();
            expect(client.trpc.localQuickStart.startDockerProvider.mutate).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not restart an automatic Podman wait after its deadline', async () => {
        await start();
        client.trpc.localQuickStart.getDockerStatus.query.mockImplementation(async () => status({ ...startingPodman }));
        vi.useFakeTimers();
        try {
            await event({ stage: 'checking', status: 'error', dockerReadiness: startingPodman });
            await act(async () => vi.advanceTimersByTimeAsync(90_100));
            await act(async () => vi.advanceTimersByTimeAsync(100));
            const count = client.trpc.localQuickStart.getDockerStatus.query.mock.calls.length;
            expect(host.textContent).toContain('Podman did not become ready before the wait timed out.');
            await act(async () => vi.advanceTimersByTimeAsync(10_000));
            expect(client.trpc.localQuickStart.getDockerStatus.query).toHaveBeenCalledTimes(count);
            expect(client.trpc.localQuickStart.startDockerProvider.mutate).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not automatically poll an initially starting Docker Desktop daemon', async () => {
        await start();
        vi.useFakeTimers();
        try {
            await event({
                stage: 'checking', status: 'error',
                dockerReadiness: {
                    ...failed, failureKind: 'daemonStarting', provider: 'dockerDesktop',
                    providerEvidence: 'rememberedProvider',
                },
            });
            await act(async () => vi.advanceTimersByTimeAsync(5_000));
            expect(client.trpc.localQuickStart.getDockerStatus.query).not.toHaveBeenCalled();
            expect(client.trpc.localQuickStart.startDockerProvider.mutate).not.toHaveBeenCalled();
            expect([...host.querySelectorAll('button')].some((candidate) =>
                candidate.textContent?.trim() === 'Stop waiting',
            )).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it('starts the wait timer on click and cancels waiting without canceling a pending Podman start', async () => {
        client.trpc.localQuickStart.getDockerStatus.query.mockResolvedValue(status(stoppedPodman));
        await click(button('Change the container engine'));
        await click(host.querySelector<HTMLInputElement>('input[value="podman"]')!);
        await start();
        await event({ stage: 'checking', status: 'error', dockerReadiness: stoppedPodman });
        let finishStart = (_result: string): void => undefined;
        client.trpc.localQuickStart.startDockerProvider.mutate.mockReturnValueOnce(new Promise((resolve) => {
            finishStart = resolve;
        }));
        vi.useFakeTimers();
        try {
            await click(button('Start Podman machine'));
            await act(async () => vi.advanceTimersByTimeAsync(2_000));
            expect(host.textContent).toContain('Waiting 00:02');
            expect(host.textContent).toContain('Waiting for Podman to start');
            expect(client.trpc.localQuickStart.startDockerProvider.mutate).toHaveBeenCalledExactlyOnceWith({
                preferredEngine: 'podman',
            });
            await click(button('Stop waiting'));
            await act(async () => vi.advanceTimersByTimeAsync(100));
            expect(host.textContent).toContain('Stopped waiting for Podman.');
            await act(async () => {
                finishStart('launchAttempted');
                await vi.advanceTimersByTimeAsync(5_000);
            });
            expect(client.trpc.localQuickStart.getDockerStatus.query.mock.calls.some(
                ([input]) => (input as { polled?: boolean } | undefined)?.polled,
            )).toBe(false);
            expect(host.textContent).not.toContain('Waiting 00:');
        } finally {
            vi.useRealTimers();
        }
    });

    it.each(['started', 'launchAttempted'] as const)(
        'continues readiness polling after a click-time race returns %s',
        async (launchResult) => {
            client.trpc.localQuickStart.getDockerStatus.query.mockResolvedValue(status(stoppedPodman));
            await start();
            await event({ stage: 'checking', status: 'error', dockerReadiness: stoppedPodman });
            client.trpc.localQuickStart.startDockerProvider.mutate.mockResolvedValueOnce(launchResult);
            client.trpc.localQuickStart.getDockerStatus.query.mockResolvedValue(status({
                ...ready, cli: 'podman', engine: 'podman', provider: 'podman',
            }));
            vi.useFakeTimers();
            try {
                await click(button('Start Podman machine'));
                await act(async () => vi.advanceTimersByTimeAsync(1_000));
                expect(client.trpc.localQuickStart.getDockerStatus.query).toHaveBeenLastCalledWith({
                    preferredEngine: 'docker', forceRefresh: true, polled: true, suppressCommandEcho: false,
                }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
                expect(host.textContent).toContain('Ready to set up');
                expect(host.textContent).not.toContain('could not be started');
            } finally {
                vi.useRealTimers();
            }
        },
    );

    it('stops active Podman readiness polling without sending a startup cancellation', async () => {
        client.trpc.localQuickStart.getDockerStatus.query.mockResolvedValue(status(stoppedPodman));
        await start();
        await event({ stage: 'checking', status: 'error', dockerReadiness: stoppedPodman });
        client.trpc.localQuickStart.startDockerProvider.mutate.mockResolvedValueOnce('launchAttempted');
        vi.useFakeTimers();
        try {
            await click(button('Start Podman machine'));
            await act(async () => vi.advanceTimersByTimeAsync(1_000));
            const calls = client.trpc.localQuickStart.getDockerStatus.query.mock.calls;
            const options = calls.at(-1)?.[1] as { signal: AbortSignal };
            const count = calls.length;
            expect(options.signal.aborted).toBe(false);
            await click(button('Stop waiting'));
            expect(options.signal.aborted).toBe(true);
            await act(async () => vi.advanceTimersByTimeAsync(10_000));
            expect(client.trpc.localQuickStart.getDockerStatus.query).toHaveBeenCalledTimes(count);
            expect(client.trpc.localQuickStart.startDockerProvider.mutate.mock.calls[0]).toHaveLength(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it.each([
        { machine: { kind: 'ambiguous', names: ['vm-one', '<img src=x onerror=alert(1)>'] }, text: 'vm-one, <img src=x onerror=alert(1)>' },
        { machine: { kind: 'otherActive', active: '<b>busy-vm</b>' }, text: '<b>busy-vm</b>' },
        { machine: { kind: 'running', name: '<em>running-vm</em>' }, text: '<em>running-vm</em>' },
    ] as const)('renders $machine.kind machine names as plain text with no start action', async ({ machine, text }) => {
        const readiness: DockerReadiness = { ...stoppedPodman, startAction: undefined, podmanMachine: machine };
        client.trpc.localQuickStart.getDockerStatus.query.mockResolvedValue(status(readiness));
        await start();
        await event({ stage: 'checking', status: 'error', dockerReadiness: readiness });
        expect(host.textContent).toContain(text);
        expect(host.querySelector('img, b, em')).toBeNull();
        expect([...host.querySelectorAll('button')].some((candidate) =>
            candidate.textContent?.trim() === 'Start Podman machine',
        )).toBe(false);
    });

    it.each([
        { environment: 'macos', machine: { kind: 'none' }, id: 'podmanMachineInit', commandLine: 'podman machine init' },
        { environment: 'linux', machine: undefined, id: 'linuxStartPodmanSocket', commandLine: 'systemctl --user start podman.socket' },
        { environment: 'wsl', machine: undefined, id: 'linuxStartPodmanSocket', commandLine: 'systemctl --user start podman.socket' },
    ] as const)('copies Podman recovery without starting anything on $environment', async ({ environment, machine, id, commandLine }) => {
        const readiness: DockerReadiness = {
            ...stoppedPodman, environment, startAction: undefined, podmanMachine: machine,
            recoveryCommand: { id, commandLine, requiresElevation: false },
        };
        client.trpc.localQuickStart.getDockerStatus.query.mockResolvedValue(status(readiness));
        await start();
        await event({ stage: 'checking', status: 'error', dockerReadiness: readiness });
        expect(host.textContent).toContain(commandLine);
        await click(button('Copy'));
        expect(client.trpc.localQuickStart.copyRecoveryCommand.mutate).toHaveBeenCalledExactlyOnceWith(id);
        expect(client.trpc.localQuickStart.startDockerProvider.mutate).not.toHaveBeenCalled();
        expect([...host.querySelectorAll('button')].some((candidate) =>
            /Start (?:Podman machine|Docker)/.test(candidate.textContent ?? ''),
        )).toBe(false);
    });

    it.each(['ssh', 'devContainer', 'codespaces', 'otherRemote'] as const)(
        'never offers a local Podman machine action in %s', async (environment) => {
            const readiness: DockerReadiness = {
                ...stoppedPodman, environment, startAction: undefined, podmanMachine: undefined,
            };
            client.trpc.localQuickStart.getDockerStatus.query.mockResolvedValue(status(readiness));
            await start();
            await event({ stage: 'checking', status: 'error', dockerReadiness: readiness });
            expect([...host.querySelectorAll('button')].some((candidate) =>
                candidate.textContent?.trim() === 'Start Podman machine',
            )).toBe(false);
            expect(client.trpc.localQuickStart.startDockerProvider.mutate).not.toHaveBeenCalled();
        },
    );

    it.each([
        ['podman', 'Podman · kept from the existing instance'],
        ['docker', 'Docker · kept from the existing instance'],
        ['notRecorded', 'Not recorded'],
    ])('locks the existing %s engine without readiness, including Start fresh', async (instanceEngine, summary) => {
        client.trpc.localQuickStart.getWizardContext.query.mockResolvedValue({
            status: { state: InstanceState.Stopped, missing: true },
            busy: false, canReuseExistingData: true, suggestedPort: 10273, instanceEngine,
        });
        await act(async () => root.render(<SSRProvider><LocalQuickStart key={instanceEngine} /></SSRProvider>));
        expect(host.textContent).toContain(summary);
        expect(host.querySelector('[aria-label="Change the container engine"]')).toBeNull();
        const fresh = host.querySelector<HTMLInputElement>('input[value="fresh"]')!;
        await click(fresh);
        expect(host.textContent).toContain(summary);
        expect(host.querySelector('input[value="podman"]')).toBeNull();
        expect(client.trpc.localQuickStart.getDockerStatus.query).not.toHaveBeenCalled();
    });

    it('restores a resumable timeout from metadata without a readiness query', async () => {
        client.trpc.localQuickStart.getWizardContext.query.mockResolvedValue({
            status: { state: InstanceState.Error, canResumeReadiness: true },
            busy: false, canReuseExistingData: true, suggestedPort: 10273, instanceEngine: 'podman',
        });
        await act(async () => root.render(<SSRProvider><LocalQuickStart key="resume" /></SSRProvider>));
        expect(button('Wait longer')).toBeDefined();
        expect(client.trpc.localQuickStart.getDockerStatus.query).not.toHaveBeenCalled();
    });

    it('reserves an inaccessible blank detail line for every pending and active stage', async () => {
        const focusFallback = { current: null };
        for (const stageStatus of ['pending', 'active'] as const) {
            await act(async () =>
                root.render(
                    <SSRProvider>
                        {PROVISION_STAGES.map((stage) => (
                            <SetupStageRow
                                key={stage}
                                stage={stage}
                                label={stage}
                                status={stageStatus}
                                facts={[{ label: 'Fact', value: 'Value' }]}
                                expanded={false}
                                onExpandedChange={() => undefined}
                                focusFallback={focusFallback}
                                mutedClassName=""
                                onShowOutput={() => undefined}
                            />
                        ))}
                    </SSRProvider>,
                ),
            );
            const rows = [...host.querySelectorAll('[role="listitem"]')];
            expect(rows).toHaveLength(5);
            for (const row of rows) {
                const text = row.querySelectorAll('.fui-Text');
                expect(text).toHaveLength(2);
                expect(text[1].textContent).toBe('\u00a0');
                expect(text[1].firstElementChild?.getAttribute('aria-hidden')).toBe('true');
                expect(text[1].firstElementChild?.className).toBe('');
                expect(row.querySelector('button')).toBeNull();
            }
        }
    });

    it('styles only the summary, leaving the label and Details toggle outside it', async () => {
        await act(async () =>
            root.render(
                <SSRProvider>
                    <SetupStageRow
                        stage="starting"
                        label="Starting container"
                        status="done"
                        detail="Running on port 10273"
                        facts={[{ label: 'Port', value: '10273' }]}
                        expanded={false}
                        onExpandedChange={() => undefined}
                        focusFallback={{ current: null }}
                        mutedClassName=""
                        onShowOutput={() => undefined}
                    />
                </SSRProvider>,
            ),
        );
        const [label, detail] = host.querySelectorAll<HTMLElement>('.fui-Text');
        const summary = detail.querySelector<HTMLElement>('span');
        const detailsButton = detail.querySelector('button');
        expect(summary?.textContent).toBe('Running on port 10273');
        expect(getComputedStyle(summary!).color).toBe('var(--colorNeutralForeground1)');
        expect(label.classList.contains(summary!.className)).toBe(false);
        expect(summary?.contains(detailsButton)).toBe(false);
        expect(detailsButton?.textContent).toContain('Details');
    });

    it('renders ordinary facts without code and distinguishes qualifications from muted notes', async () => {
        await act(async () =>
            root.render(
                <SSRProvider>
                    <SetupStageDetails
                        facts={[
                            { label: 'Image', value: 'image:tag', note: 'Custom tag' },
                            { label: 'Bound port', value: '10273', qualification: 'As requested' },
                            { label: 'Logs', value: 'Streaming to the setup log', action: 'showOutput' },
                        ]}
                        mutedClassName="muted-note"
                        onShowOutput={() => undefined}
                    />
                </SSRProvider>,
            ),
        );
        const terms = [...host.querySelectorAll<HTMLElement>('dt')];
        const values = [...host.querySelectorAll<HTMLElement>('dd')];
        expect(host.querySelector('code')).toBeNull();
        expect(terms.map((term) => term.textContent)).toEqual(['Image', 'Bound port', 'Logs']);
        expect(getComputedStyle(terms[0]).color).toBe('inherit');
        expect(values[0].textContent).toBe('image:tag · Custom tag');
        expect(values[0].querySelector('span')?.className).toContain('muted-note');
        expect(values[1].textContent).toBe('10273 · As requested');
        expect(values[1].querySelector('span')?.className).toBe('');
        const link = values[2].querySelector<HTMLElement>('button');
        expect(link?.textContent).toBe('View setup log');
        const linkStyle = getComputedStyle(link!);
        expect(linkStyle.fontFamily).toBe('inherit');
        expect(linkStyle.fontSize).toBe('inherit');
        expect(linkStyle.fontWeight).toBe('inherit');
        expect(linkStyle.lineHeight).toBe('inherit');
    });

    it('keeps the Creating summary and Details on the reserved line with full ID evidence', async () => {
        await start();
        const row = [...host.querySelectorAll('[role="listitem"]')].find((item) =>
            item.textContent?.includes('Creating container'),
        );
        expect(row).toBeDefined();
        const detail = row!.querySelectorAll('.fui-Text')[1];
        expect(detail?.textContent).toBe('\u00a0');
        expect(detail?.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
        await event({ stage: 'creating', status: 'active' });
        expect(row!.querySelectorAll('.fui-Text')[1]).toBe(detail);
        expect(toggle('Creating container')).toBeNull();
        const containerId = '123456789012345678';
        await event({
            stage: 'creating',
            status: 'done',
            facts: {
                kind: 'creating',
                containerName: 'test-instance',
                containerId,
                hostPort: 10273,
                containerPort: 10260,
                volumeName: 'test-volume',
                dataPath: '/data',
                volume: 'new',
                username: 'test-user',
            },
        });
        expect(row!.querySelectorAll('.fui-Text')).toHaveLength(2);
        expect(row!.querySelectorAll('.fui-Text')[1]).toBe(detail);
        expect(detail.textContent).toContain('Container test-instance');
        expect(detail.querySelectorAll('button')).toHaveLength(1);
        expect(detail.querySelector('button')).toBe(toggle('Creating container'));
        await click(toggle('Creating container')!);
        const region = row!.querySelector('[role="region"]');
        const id = region?.querySelector<HTMLElement>('[role="group"][tabindex="0"]');
        expect(id?.tagName).toBe('SPAN');
        expect(id?.getAttribute('aria-labelledby')).toBe(id?.firstElementChild?.id);
        expect(id?.textContent).toBe('123456789012…');
        await act(async () => {
            id!.focus();
            await new Promise((resolve) => setTimeout(resolve, 600));
        });
        expect(document.activeElement).toBe(id);
        const description = id?.getAttribute('aria-describedby');
        expect(description && document.getElementById(description)?.textContent).toBe(containerId);
        const tooltip = document.getElementById(description!);
        expect(getComputedStyle(tooltip!).fontFamily).toBe('var(--fontFamilyBase)');
        expect(getComputedStyle(tooltip!).fontSize).toBe('var(--fontSizeBase200)');
        expect(getComputedStyle(tooltip!).lineHeight).toBe('var(--lineHeightBase200)');
        expect(getComputedStyle(tooltip!).fontWeight).toBe('var(--fontWeightRegular)');
        expect(getComputedStyle(tooltip!).overflowWrap).toBe('anywhere');
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
        expect(checkRegion?.textContent).toContain('Engine is ready');
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

    it('shows each non-readiness stage table in Set up and Done, using plain facts and the existing log action', async () => {
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
        const regions = [...host.querySelectorAll('[role="region"]')];
        expect(regions.some((region) => region.textContent?.includes('official:test-tag'))).toBe(true);
        expect(regions.every((region) => !region.querySelector('code'))).toBe(true);
        const imageRegion = regions.find((region) => region.textContent?.includes('official:test-tag'))!;
        const imageNote = [...imageRegion.querySelectorAll<HTMLElement>('dd span')].find((node) =>
            node.textContent?.includes('Custom tag'),
        );
        expect(getComputedStyle(imageNote!).color).toBe(
            'var(--vscode-descriptionForeground, var(--colorNeutralForeground2))',
        );
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

    it('shows active image origin without disclosure and retains settled summaries on Done', async () => {
        await start();
        await event({
            stage: 'pulling',
            status: 'active',
            facts: { kind: 'pulling', imageRef: 'image:custom', imageOrigin: 'custom' },
        });
        expect(host.textContent).toContain('Image image:custom · Custom tag');
        expect(toggle('Pulling official image')).toBeNull();
        await event({
            stage: 'pulling',
            status: 'done',
            facts: { kind: 'pulling', imageRef: 'image:custom', imageOrigin: 'custom', result: 'updated' },
        });
        expect(host.textContent).toContain('Updated');
        expect(toggle('Pulling official image')).not.toBeNull();
        await event({ stage: 'done', status: 'done' });
        expect(host.textContent).toContain('Updated');
        expect(toggle('Pulling official image')).not.toBeNull();
    });

    it('replaces the active image summary with literal pull output without repeated step effects', async () => {
        await start();
        const pullingFacts = { kind: 'pulling', imageRef: 'image:custom', imageOrigin: 'custom' } as const;
        await event({ stage: 'pulling', status: 'active', facts: pullingFacts });
        const summary = 'Image image:custom · Custom tag';
        expect(host.textContent).toContain(summary);
        expect(host.textContent).not.toContain('Engine output:');
        const announcement = [...host.querySelectorAll('[role="status"][aria-live="polite"]')].find(
            (node) => node.textContent === 'Pulling official image…',
        );
        expect(announcement).toBeDefined();
        const mutations: MutationRecord[] = [];
        const observer = new MutationObserver((records) => mutations.push(...records));
        observer.observe(announcement!, { childList: true, characterData: true, subtree: true });
        const stepCalls = client.trpc.localQuickStart.reportStepChange.mutate.mock.calls.length;
        const detailsCalls = client.trpc.localQuickStart.reportDetailsOpened.mutate.mock.calls.length;
        const timer = vi.spyOn(globalThis, 'setInterval');
        const stopTimer = vi.spyOn(globalThis, 'clearInterval');
        const cancel = button('Cancel');
        const primary = button('Setting up…');
        const focus = document.activeElement;
        try {
            for (const progress of ['<b>Downloading layer</b>', 'Extracting layer', 'x'.repeat(160)]) {
                await event({ stage: 'pulling', status: 'active', facts: { ...pullingFacts, progress } });
                const outputs = [...host.querySelectorAll<HTMLSpanElement>('span[title]')].filter(
                    (node) => node.textContent === `Engine output: ${progress}`,
                );
                expect(outputs).toHaveLength(1);
                const output = outputs[0];
                expect(host.textContent).not.toContain(summary);
                expect(output?.title).toBe(`Engine output: ${progress}`);
                expect(output?.children).toHaveLength(0);
                expect(getComputedStyle(output).display).toBe('block');
                expect(getComputedStyle(output).whiteSpace).toBe('nowrap');
                expect(getComputedStyle(output).overflow).toBe('hidden');
                expect(getComputedStyle(output).textOverflow).toBe('ellipsis');
                expect(getComputedStyle(output.parentElement!).color).toBe('var(--colorNeutralForeground1)');
                expect(output?.querySelector('b')).toBeNull();
                expect(output?.closest('[aria-live], [role="status"], [role="alert"], [role="log"]')).toBeNull();
                expect(announcement?.textContent).toBe('Pulling official image…');
                expect(toggle('Pulling official image')).toBeNull();
                expect(button('Cancel')).toBe(cancel);
                expect(button('Setting up…')).toBe(primary);
                expect(primary.disabled).toBe(true);
                expect(document.activeElement).toBe(focus);
                expect(client.trpc.localQuickStart.reportStepChange.mutate).toHaveBeenCalledTimes(stepCalls);
                expect(client.trpc.localQuickStart.reportDetailsOpened.mutate).toHaveBeenCalledTimes(detailsCalls);
                expect(client.trpc.common.reportEvent.mutate).not.toHaveBeenCalled();
            }
            expect(host.textContent).not.toContain('Downloading layer');
            expect(mutations).toEqual([]);
            expect(timer).not.toHaveBeenCalled();
            expect(stopTimer).not.toHaveBeenCalled();
        } finally {
            observer.disconnect();
        }
        await event({ stage: 'pulling', status: 'done' });
        expect(host.textContent).not.toContain('Engine output:');
        expect(host.textContent).toContain('Image image:custom');
        expect(announcement?.textContent).toBe('');
        await event({ stage: 'done', status: 'done' });
        expect(host.textContent).not.toContain('Engine output:');
        expect(host.textContent).toContain('Image image:custom');
    });

    it('retains the full active image summary before pull output arrives', async () => {
        await start();
        const imageRef = `image:${'x'.repeat(160)}`;
        const summary = `Image ${imageRef} · Custom tag`;
        await event({
            stage: 'pulling',
            status: 'active',
            facts: { kind: 'pulling', imageRef, imageOrigin: 'custom' },
        });
        const image = [...host.querySelectorAll<HTMLSpanElement>('span[title]')].find(
            (node) => node.textContent === summary,
        );
        expect(image?.title).toBe(summary);
        expect(image?.children).toHaveLength(0);
        expect(host.textContent).not.toContain('Engine output:');
        expect(toggle('Pulling official image')).toBeNull();
    });

    it.each([undefined, '', ' \n\t'])(
        'replaces active pull output when the next facts have no nonblank line (%s)',
        async (progress) => {
            await start();
            const pullingFacts = { kind: 'pulling', imageRef: 'image:custom', imageOrigin: 'custom' } as const;
            await event({
                stage: 'pulling',
                status: 'active',
                facts: { ...pullingFacts, progress: 'Downloading layer' },
            });
            expect(host.textContent).toContain('Engine output: Downloading layer');
            await event({ stage: 'pulling', status: 'active', facts: { ...pullingFacts, progress } });
            expect(host.textContent).not.toContain('Engine output:');
            expect(host.textContent).not.toContain('Downloading layer');
            expect(host.textContent).toContain('Image image:custom · Custom tag');
            expect(toggle('Pulling official image')).toBeNull();
        },
    );

    it.each(['pulling', 'error'] as const)('clears pull output on a %s failure and retry', async (stage) => {
        await start();
        await event({
            stage: 'pulling',
            status: 'active',
            facts: { kind: 'pulling', imageRef: 'image:custom', imageOrigin: 'custom', progress: 'Downloading layer' },
        });
        await event({ stage, status: 'error' });
        expect(host.textContent).not.toContain('Engine output:');
        expect(host.textContent).toContain('Image image:custom');
        await click(button('Retry setup'));
        await event({ stage: 'pulling', status: 'active' });
        expect(host.textContent).not.toContain('Engine output:');
        expect(host.textContent).not.toContain('image:custom');
    });

    it('clears pull output on a stream error', async () => {
        await start();
        await event({
            stage: 'pulling',
            status: 'active',
            facts: { kind: 'pulling', imageRef: 'image:custom', imageOrigin: 'custom', progress: 'Downloading layer' },
        });
        await act(async () => client.streams.at(-1)?.onError(new Error('Stream failed')));
        expect(host.textContent).not.toContain('Engine output:');
        expect(host.textContent).toContain('Image image:custom · Custom tag');
        expect(host.textContent).toContain('Stream failed');
    });

    it('clears pull output on cancellation and ignores trailing output before a fresh run', async () => {
        await start();
        const activity: StageEvent = {
            stage: 'pulling',
            status: 'active',
            facts: { kind: 'pulling', imageRef: 'image:custom', imageOrigin: 'custom', progress: 'Downloading layer' },
        };
        await event(activity);
        await click(button('Cancel'));
        await event(activity);
        expect(host.textContent).not.toContain('Engine output:');
        await start();
        await event({ stage: 'pulling', status: 'active' });
        expect(host.textContent).not.toContain('Engine output:');
        expect(host.textContent).not.toContain('image:custom');
        expect(toggle('Pulling official image')).toBeNull();
    });

    it('keeps the image summary ahead of engine failure details', async () => {
        await start();
        await event({ stage: 'pulling', status: 'active' });
        await event({
            stage: 'error',
            status: 'error',
            dockerReadiness: failed,
            facts: { kind: 'pulling', imageRef: 'image:failed', imageOrigin: 'default' },
        });
        expect(host.textContent).toContain('Image image:failed');
        await click(toggle('Pulling official image')!);
        expect(host.textContent).toContain('Docker access denied');
    });

    it('makes shortened image IDs keyboard- and mouse-accessible with full descriptions', async () => {
        const imageId = 'sha256:012345678901234567890123456789';
        const previousImageId = 'sha256:987654321098765432109876543210';
        await start();
        await event({
            stage: 'pulling',
            status: 'done',
            facts: {
                kind: 'pulling',
                imageRef: 'image',
                imageOrigin: 'default',
                result: 'updated',
                imageId,
                previousImageId,
            },
        });
        await click(toggle('Pulling official image')!);
        const region = host.querySelector(`[aria-labelledby="${toggle('Pulling official image')!.id}"]`);
        const triggers = [...region!.querySelectorAll<HTMLElement>('[role="group"][tabindex="0"]')];
        expect(triggers.every((node) => node.tagName === 'SPAN')).toBe(true);
        expect(triggers.every((node) => node.getAttribute('aria-labelledby') === node.firstElementChild?.id)).toBe(
            true,
        );
        expect(triggers.map((node) => node.textContent)).toEqual(['sha256:012345678901…', 'sha256:987654321098…']);
        await act(async () => {
            triggers[0].focus();
            await new Promise((resolve) => setTimeout(resolve, 600));
        });
        expect(document.activeElement).toBe(triggers[0]);
        const description = triggers[0].getAttribute('aria-describedby');
        expect(description && document.getElementById(description)?.textContent).toBe(imageId);
        await act(async () => {
            triggers[0].blur();
            triggers[1].dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            await new Promise((resolve) => setTimeout(resolve, 600));
        });
        const previousDescription = triggers[1].getAttribute('aria-describedby');
        expect(previousDescription && document.getElementById(previousDescription)?.textContent).toBe(previousImageId);
    });

    it.each([
        ['local', 'Runs on this machine'],
        ['wsl', 'Runs in this WSL environment'],
        ['ssh', 'Runs on the remote SSH host'],
        ['devContainer', 'Runs in this dev container'],
        ['codespaces', 'Runs in this Codespace'],
        ['otherRemote', 'Runs on the remote extension host'],
    ] as const)('capitalizes the %s execution target segment', async (executionTarget, expected) => {
        client.trpc.localQuickStart.getDockerStatus.query.mockResolvedValue(status({ ...ready, executionTarget }));
        await act(async () =>
            root.render(
                <SSRProvider>
                    <LocalQuickStart key={executionTarget} />
                </SSRProvider>,
            ),
        );
        await start();
        await event({ stage: 'checking', status: 'done' });
        expect(host.textContent).toContain(expected);
    });

    it.each([
        ['cliMissing', 'No Docker or Podman CLI found'],
        ['permissionDenied', 'Access denied'],
        ['daemonUnavailable', 'Daemon not running'],
        ['daemonStarting', 'Daemon starting'],
        ['contextUnavailable', 'Context unavailable'],
        ['endpointUnreachable', 'Endpoint unreachable'],
        ['unsupportedHost', 'Unsupported host'],
        ['windowsContainers', 'Windows containers enabled'],
        ['probeTimedOut', 'Check timed out'],
        ['unknown', 'Daemon unreachable'],
    ] as const)('capitalizes the %s failure evidence', async (failureKind, expected) => {
        const indeterminate = failureKind === 'probeTimedOut' || failureKind === 'unknown';
        const readiness = {
            ...failed,
            outcome: indeterminate ? 'indeterminate' : 'diagnosed',
            canContinueAnyway: indeterminate,
            cliInstalled: failureKind !== 'cliMissing',
            failureKind,
            provider: 'unknown',
            cli: 'podman',
            cliVersion: '5.1',
        } as DockerReadiness;
        client.trpc.localQuickStart.getDockerStatus.query.mockResolvedValue(status(readiness));
        await start();
        await event({ stage: 'checking', status: 'error' });
        expect(host.textContent).toContain(expected);
        if (failureKind !== 'cliMissing') {
            expect(host.textContent).toContain('Podman CLI 5.1 found');
        }
    });

    it.each([
        ['linux', 'Not running'],
        ['wsl', 'Not available in this WSL distribution'],
    ] as const)('capitalizes Docker Desktop failure evidence on %s', async (environment, expected) => {
        client.trpc.localQuickStart.getDockerStatus.query.mockResolvedValue(
            status({
                ...failed,
                environment,
                provider: 'dockerDesktop',
                failureKind: 'daemonUnavailable',
            }),
        );
        await start();
        await event({ stage: 'checking', status: 'error' });
        expect(host.textContent).toContain(expected);
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
            expect(host.textContent).toContain('Ping on admin answered after 3 attempts');
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
        expect(host.textContent).not.toContain('Ping on admin answered');
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
        const region = host.querySelector(`[aria-labelledby="${toggle('Starting container')!.id}"]`);
        const boundPort = [...region!.querySelectorAll('dd')].find((node) =>
            node.textContent?.includes('As requested'),
        );
        expect(boundPort?.textContent).toBe('10273 · As requested');
        expect(boundPort?.querySelector('span')?.className).toBe('');
        expect(boundPort?.querySelector('code')).toBeNull();
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
