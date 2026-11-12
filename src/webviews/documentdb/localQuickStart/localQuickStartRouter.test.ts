/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type initWebviewTrpc as InitWebviewTrpc } from '@microsoft/vscode-ext-webview';
import * as vscode from 'vscode';
import { API } from '../../../DocumentDBExperiences';
import { type DockerReadiness, type StageEvent } from '../../../services/localQuickStart/quickStartTypes';

const mockStartDockerProvider = vi.fn();
const mockIsDockerReady = vi.fn();
const mockGetStatus = vi.fn();
const mockRefreshLiveState = vi.fn();
const mockCanReuseExistingData = vi.fn();
const mockSuggestPort = vi.fn();
const mockProvision = vi.fn();
const mockProcedureTelemetry = vi.fn();
const mockGetWizardContext = vi.fn();
const mockGetInstanceEngine = vi.fn();

vi.mock('../../../services/survey/SurveyService', (): object => ({ recordSurveyActivity: vi.fn() }));

/** Drives `QuickStartService.onDidChangeStatus` so a test can push status changes at the router. */
const statusListeners = new Set<() => void>();
const fireStatusChange = (): void => statusListeners.forEach((listener) => listener());

vi.mock('vscode', () => ({
    commands: { executeCommand: vi.fn() },
    env: { clipboard: { writeText: vi.fn() } },
}));

vi.mock('../../../services/localQuickStart/ContainerRuntime', () => ({
    ContainerRuntime: { isDockerReady: (...args: unknown[]) => mockIsDockerReady(...args) as unknown },
    getQuickStartOutputChannel: () => ({ show: vi.fn() }),
}));

vi.mock('../../../services/localQuickStart/QuickStartService', () => ({
    QuickStartService: {
        discardTimedOutInstance: vi.fn(),
        checkInstanceDockerReadiness: (...args: unknown[]) => mockIsDockerReady(...args) as unknown,
        startDockerProvider: (...args: unknown[]) => mockStartDockerProvider(...args) as unknown,
        getStatus: (...args: unknown[]) => mockGetStatus(...args) as unknown,
        isBusy: false,
        provision: (...args: unknown[]) => mockProvision(...args) as unknown,
        refreshLiveState: (...args: unknown[]) => mockRefreshLiveState(...args) as unknown,
        canReuseExistingData: (...args: unknown[]) => mockCanReuseExistingData(...args) as unknown,
        suggestPort: (...args: unknown[]) => mockSuggestPort(...args) as unknown,
        getWizardContext: (...args: unknown[]) => mockGetWizardContext(...args) as unknown,
        getInstanceEngine: (...args: unknown[]) => mockGetInstanceEngine(...args) as unknown,
        checkPort: vi.fn(),
        onDidChangeStatus: (listener: () => void) => {
            statusListeners.add(listener);
            return { dispose: () => statusListeners.delete(listener) };
        },
    },
}));

// The reveal helper pulls in the tree + azext-utils, whose module-level `vscode.l10n.t` call fails
// against this file's minimal `vscode` stub. What it does is covered by its own test
// (`src/tree/connections-view/LocalQuickStart/revealQuickStartInstance.test.ts`); here we only care
// that the router calls it.
const mockRevealQuickStartInstance = vi.fn();
vi.mock('../../../tree/connections-view/LocalQuickStart/revealQuickStartInstance', () => ({
    revealQuickStartInstance: (...args: unknown[]) => mockRevealQuickStartInstance(...args) as unknown,
}));

vi.mock('../../_integration/trpc', async () => {
    const { initWebviewTrpc } = await vi.importActual<{ initWebviewTrpc: typeof InitWebviewTrpc }>(
        '@microsoft/vscode-ext-webview',
    );
    const trpc = initWebviewTrpc();
    return {
        createCallerFactory: trpc.createCallerFactory,
        publicProcedure: trpc.publicProcedure,
        publicProcedureWithTelemetry: trpc.publicProcedure.use(({ next }): ReturnType<typeof next> => {
            mockProcedureTelemetry();
            return next();
        }),
        router: trpc.router,
    };
});

// Emits through azext-utils, which this file's minimal `vscode` stub cannot load (see above).
const mockReportWizardStep = vi.fn();
const mockReportWizardDetailsOpened = vi.fn();
vi.mock('./wizardTelemetry', () => ({
    reportWizardStep: (...args: unknown[]) => mockReportWizardStep(...args) as unknown,
    reportWizardDetailsOpened: (...args: unknown[]) => mockReportWizardDetailsOpened(...args) as unknown,
}));

import { createCallerFactory } from '../../_integration/trpc';
import { localQuickStartRouter, type RouterContext } from './localQuickStartRouter';
import { type QuickStartWizardSession } from './wizardTelemetry';

function wizardSession(): QuickStartWizardSession {
    return {
        id: 'session-1',
        openedAt: 0,
        initialPhase: 'introduction',
        phase: 'configure',
        phaseEnteredAt: 0,
        stepChangeCount: 1,
        setupAttemptCount: 0,
        waitLongerCount: 0,
        detailsOpenedStages: new Set(),
        detailsOpenCount: 0,
        setupSucceeded: false,
    };
}

function createContext(): RouterContext & {
    actionContext: {
        telemetry: {
            properties: Record<string, string>;
            measurements: Record<string, number>;
            suppressAll?: boolean;
        };
    };
} {
    return {
        dbExperience: API.DocumentDB,
        webviewName: 'localQuickStart',
        closePanel: vi.fn(),
        actionContext: {
            telemetry: { properties: {}, measurements: {} },
        },
    };
}

describe('localQuickStartRouter', () => {
    beforeEach(() => {
        mockSuggestPort.mockResolvedValue(10260);
        mockGetInstanceEngine.mockReset().mockResolvedValue(undefined);
    });

    it.each(['docker', 'podman', 'notRecorded', undefined] as const)(
        'returns metadata-only wizard context for engine %s without leaking credentials or probing',
        async (instanceEngine) => {
            mockIsDockerReady.mockClear();
            mockRefreshLiveState.mockClear();
            mockGetWizardContext.mockResolvedValue({
                status: {
                    state: 'NotInstalled',
                    canResumeReadiness: true,
                    metadata: { connectionString: 'secret', username: 'secret' },
                },
                busy: false,
                canReuseExistingData: true,
                suggestedPort: 10273,
                instanceEngine,
            });
            const caller = createCallerFactory(localQuickStartRouter)(createContext());

            const result = await caller.getWizardContext();

            expect(result).toMatchObject({
                status: { state: 'NotInstalled', canResumeReadiness: true },
                busy: false,
                canReuseExistingData: true,
                suggestedPort: 10273,
                instanceEngine,
            });
            expect(result.status.metadata).toBeUndefined();
            expect(mockIsDockerReady).not.toHaveBeenCalled();
            expect(mockRefreshLiveState).not.toHaveBeenCalled();
        },
    );

    /**
     * The success screen's primary action. It used to be wired to `connectionsView.focus` alone,
     * which does nothing visible when that view is already active — the normal case, since Quick
     * Start is opened FROM it — so the button appeared dead. It must reach the navigation that
     * actually opens the instance.
     */
    it('opens the managed instance rather than only focusing the view', async () => {
        mockRevealQuickStartInstance.mockResolvedValue(undefined);
        const context = createContext();
        const caller = createCallerFactory(localQuickStartRouter)(context);

        await caller.openConnection();

        expect(mockRevealQuickStartInstance).toHaveBeenCalledWith(context.actionContext);
    });

    it('suppresses telemetry for polled Docker readiness queries', async () => {
        mockIsDockerReady.mockResolvedValue({
            outcome: 'ready',
            environment: 'local',
            endpointKind: 'unixSocket',
            provider: 'dockerEngine',
            providerEvidence: 'infoOperatingSystem',
            executionTarget: 'localHost',
            checkedAtMs: 1,
            cliInstalled: true,
            canContinueAnyway: false,
            daemonReachable: true,
        });
        mockGetStatus.mockReturnValue({ state: 'Stopped' });
        mockCanReuseExistingData.mockResolvedValue(false);
        const context = createContext();
        const caller = createCallerFactory(localQuickStartRouter)(context);

        await caller.getDockerStatus({ polled: true });

        expect(context.actionContext.telemetry.suppressAll).toBe(true);
    });

    it('forwards an explicit provider-memory reset to Docker readiness', async () => {
        mockIsDockerReady.mockResolvedValue({
            outcome: 'ready',
            environment: 'local',
            endpointKind: 'unixSocket',
            provider: 'dockerEngine',
            providerEvidence: 'infoOperatingSystem',
            executionTarget: 'localHost',
            checkedAtMs: 1,
            cliInstalled: true,
            canContinueAnyway: false,
            daemonReachable: true,
        });
        mockGetStatus.mockReturnValue({ state: 'Stopped' });
        mockCanReuseExistingData.mockResolvedValue(false);
        const caller = createCallerFactory(localQuickStartRouter)(createContext());

        await caller.getDockerStatus({ forceRefresh: true, resetProviderMemory: true });

        expect(mockIsDockerReady).toHaveBeenCalledWith(
            expect.objectContaining({ forceRefresh: true, resetProviderMemory: true }),
            undefined,
        );
    });

    it.each([
        ['linuxStartPodmanSocket', 'systemctl --user start podman.socket'],
        ['podmanMachineInit', 'podman machine init'],
    ] as const)('copies the fixed %s command without starting an engine', async (id, commandLine) => {
        const context = createContext();
        const caller = createCallerFactory(localQuickStartRouter)(context);
        await caller.copyRecoveryCommand({ id });
        expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith(commandLine);
        expect(mockStartDockerProvider).not.toHaveBeenCalled();
        expect(context.actionContext.telemetry.properties.recoveryCommandId).toBe(id);
    });

    it('builds the Windows machine clipboard command on the host and records only its id', async () => {
        vi.mocked(vscode.env.clipboard.writeText).mockClear();
        mockStartDockerProvider.mockClear();
        const context = createContext();
        const caller = createCallerFactory(localQuickStartRouter)(context);

        await caller.copyRecoveryCommand({ id: 'podmanMachineStartOnWindows', machineName: 'podman-machine-default' });

        expect(vscode.env.clipboard.writeText).toHaveBeenCalledExactlyOnceWith(
            'podman machine start podman-machine-default',
        );
        expect(mockStartDockerProvider).not.toHaveBeenCalled();
        expect(context.actionContext.telemetry.properties).toEqual({
            recoveryCommandId: 'podmanMachineStartOnWindows',
        });
    });

    it.each([undefined, 'vm;whoami', '-vm'])(
        'rejects Windows copy with invalid machine name %j without touching the clipboard',
        async (machineName) => {
            vi.mocked(vscode.env.clipboard.writeText).mockClear();
            const caller = createCallerFactory(localQuickStartRouter)(createContext());

            await expect(
                caller.copyRecoveryCommand({ id: 'podmanMachineStartOnWindows', machineName }),
            ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
            expect(vscode.env.clipboard.writeText).not.toHaveBeenCalled();
        },
    );

    it('rejects a machine name on a fixed command', async () => {
        vi.mocked(vscode.env.clipboard.writeText).mockClear();
        const caller = createCallerFactory(localQuickStartRouter)(createContext());

        await expect(
            caller.copyRecoveryCommand({ id: 'linuxStartPodmanSocket', machineName: 'vm' }),
        ).rejects.toMatchObject({
            code: 'BAD_REQUEST',
        });
        expect(vscode.env.clipboard.writeText).not.toHaveBeenCalled();
    });

    it('returns and records the typed provider launch result', async () => {
        mockStartDockerProvider.mockResolvedValue('failed');
        const context = createContext();
        const caller = createCallerFactory(localQuickStartRouter)(context);

        await expect(caller.startDockerProvider()).resolves.toBe('failed');
        expect(context.actionContext.telemetry.properties.dockerLaunchResult).toBe('failed');
    });

    describe('preferred engine', () => {
        it.each(['done', 'error'] as const)(
            'records original checking readiness on the %s subscription event without a query',
            async (status) => {
                const base = {
                    environment: 'linux',
                    endpointKind: 'unixSocket',
                    provider: 'podman',
                    providerEvidence: 'none',
                    executionTarget: 'local',
                    checkedAtMs: 1,
                    cliInstalled: true,
                    cli: 'podman',
                    preferredEngine: 'docker',
                    cliFallback: true,
                    canContinueAnyway: false,
                } as const;
                const readiness: DockerReadiness =
                    status === 'done'
                        ? { ...base, outcome: 'ready', daemonReachable: true }
                        : { ...base, outcome: 'diagnosed', daemonReachable: false, failureKind: 'daemonUnavailable' };
                mockProvision.mockImplementation(async function* (): AsyncGenerator<StageEvent> {
                    yield { stage: 'checking', status, dockerReadiness: readiness };
                });
                mockIsDockerReady.mockClear();
                const context = createContext();
                const caller = createCallerFactory(localQuickStartRouter)(context);
                const stream = await caller.startQuickStart({ preferredEngine: 'docker' });

                for await (const event of stream) {
                    expect(event.dockerReadiness).toBe(readiness);
                }

                expect(context.actionContext.telemetry.properties).toMatchObject({
                    preferredContainerEngine: 'docker',
                    containerCliFallback: 'true',
                    containerCli: 'podman',
                    dockerReadinessOutcome: readiness.outcome,
                });
                expect(mockIsDockerReady).not.toHaveBeenCalled();
                mockProvision.mockReset();
            },
        );

        it.each(['docker', 'podman'] as const)(
            'forwards %s to readiness, provider start and provision',
            async (preferredEngine) => {
                const caller = createCallerFactory(localQuickStartRouter)(createContext());
                mockProvision.mockImplementation(async function* () {});

                await caller.getDockerStatus({ preferredEngine });
                await caller.startDockerProvider({ preferredEngine });
                const stream = (await caller.startQuickStart({ preferredEngine })) as AsyncGenerator<unknown>;
                await stream.next();

                expect(mockIsDockerReady).toHaveBeenLastCalledWith(expect.anything(), preferredEngine);
                expect(mockStartDockerProvider).toHaveBeenLastCalledWith(preferredEngine, undefined);
                expect(mockProvision).toHaveBeenLastCalledWith(
                    expect.anything(),
                    { preferredEngine },
                    undefined,
                    expect.any(String),
                );
                mockProvision.mockReset();
            },
        );

        it('forwards the start action the button named and rejects an unknown one', async () => {
            const caller = createCallerFactory(localQuickStartRouter)(createContext());
            await caller.startDockerProvider({ preferredEngine: 'docker', expectedAction: 'startPodmanMachine' });
            expect(mockStartDockerProvider).toHaveBeenLastCalledWith('docker', 'startPodmanMachine');
            await expect(
                caller.startDockerProvider({ expectedAction: 'startAnything' } as unknown as Parameters<
                    typeof caller.startDockerProvider
                >[0]),
            ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
        });

        it('defaults provider start to Docker for omitted input and an empty object', async () => {
            const caller = createCallerFactory(localQuickStartRouter)(createContext());
            await caller.startDockerProvider();
            expect(mockStartDockerProvider).toHaveBeenLastCalledWith('docker', undefined);
            await caller.startDockerProvider({});
            expect(mockStartDockerProvider).toHaveBeenLastCalledWith('docker', undefined);
        });

        it.each(['containerd', 'Docker', '', null, 1])(
            'rejects invalid preference %j on every entry point',
            async (preferredEngine) => {
                const caller = createCallerFactory(localQuickStartRouter)(createContext());
                await expect(
                    caller.getDockerStatus({ preferredEngine } as Parameters<typeof caller.getDockerStatus>[0]),
                ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
                await expect(
                    caller.startDockerProvider({ preferredEngine } as Parameters<typeof caller.startDockerProvider>[0]),
                ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
                await expect(
                    caller.startQuickStart({ preferredEngine } as Parameters<typeof caller.startQuickStart>[0]),
                ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
            },
        );
    });

    // Each of these used to reach Docker and fail there: a readiness timeout, a container that
    // exited at once, or an instance reported as running whose writes all failed.
    describe('startQuickStart credentials', () => {
        it.each([
            ['a username over 63 bytes', { username: 'é'.repeat(32), password: 'Passw0rd' }],
            ['a password SASLprep rejects', { username: 'devuser', password: 'pass😀word' }],
            ['a reserved username', { username: 'documentdb', password: 'Passw0rd' }],
            ['a username with a space', { username: 'my user', password: 'Passw0rd' }],
            ['a password with surrounding spaces', { username: 'devuser', password: '  abc  ' }],
            ['a password with a line separator', { username: 'devuser', password: 'ab\u2028cd' }],
            ['a password with a next-line character', { username: 'devuser', password: 'ab\u0085cd' }],
            ['a username with a lone surrogate', { username: 'dev\ud800', password: 'Passw0rd' }],
            ['a username without a password', { username: 'devuser' }],
        ])('rejects %s', async (_label, input) => {
            const caller = createCallerFactory(localQuickStartRouter)(createContext());

            await expect(caller.startQuickStart(input)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
            expect(mockProvision).not.toHaveBeenCalled();
        });

        it('says which field is wrong, in the wording the webview shows', async () => {
            const caller = createCallerFactory(localQuickStartRouter)(createContext());

            await expect(caller.startQuickStart({ username: 'devuser', password: 'pass😀word' })).rejects.toThrow(
                /"path": \[\s*"password"\s*\][\s\S]*such as an emoji/,
            );
        });

        it('passes valid credentials through to provisioning', async () => {
            mockProvision.mockReturnValue((async function* () {})());
            const caller = createCallerFactory(localQuickStartRouter)(createContext());

            const stream = (await caller.startQuickStart({
                username: 'devuser',
                password: 'correct horse',
            })) as AsyncIterable<unknown>;
            const events = stream[Symbol.asyncIterator]();
            while (!(await events.next()).done) {
                // drain
            }

            expect(mockProvision).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ username: 'devuser', password: 'correct horse' }),
                undefined,
                expect.any(String),
            );
        });

        afterEach(() => mockProvision.mockReset());
    });

    describe('wizard session', () => {
        beforeEach(() => {
            mockProcedureTelemetry.mockClear();
            mockReportWizardDetailsOpened.mockClear();
        });

        it.each(['checking', 'pulling', 'creating', 'starting', 'waiting'] as const)(
            'records a %s disclosure without procedure telemetry or an action context',
            async (stage) => {
                const session = wizardSession();
                const context: RouterContext = {
                    dbExperience: API.DocumentDB,
                    webviewName: 'localQuickStart',
                    closePanel: vi.fn(),
                    wizardSession: session,
                };
                const caller = createCallerFactory(localQuickStartRouter)(context);

                await caller.reportDetailsOpened({ stage });

                expect(mockReportWizardDetailsOpened).toHaveBeenCalledExactlyOnceWith(session, stage);
                expect(mockProcedureTelemetry).not.toHaveBeenCalled();
            },
        );

        it.each(['unknown', 'done', 'error'])('rejects the non-disclosure stage %s', async (stage) => {
            const context = {
                ...createContext(),
                wizardSession: wizardSession(),
            };
            const caller = createCallerFactory(localQuickStartRouter)(context);

            await expect(
                caller.reportDetailsOpened({ stage } as Parameters<typeof caller.reportDetailsOpened>[0]),
            ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

            expect(mockReportWizardDetailsOpened).not.toHaveBeenCalled();
            expect(mockProcedureTelemetry).not.toHaveBeenCalled();
        });

        it('ignores a disclosure when no panel session is present', async () => {
            const caller = createCallerFactory(localQuickStartRouter)(createContext());

            await expect(caller.reportDetailsOpened({ stage: 'checking' })).resolves.toBeUndefined();

            expect(mockReportWizardDetailsOpened).not.toHaveBeenCalled();
            expect(mockProcedureTelemetry).not.toHaveBeenCalled();
        });

        it('reports a step change against the panel session', async () => {
            const session = wizardSession();
            const context = { ...createContext(), wizardSession: session };
            const caller = createCallerFactory(localQuickStartRouter)(context);

            await caller.reportStepChange({ to: 'provisioning', trigger: 'startSetup' });

            expect(mockReportWizardStep).toHaveBeenCalledWith(session, 'provisioning', 'startSetup');
        });

        it('stamps the session on procedure events and records an explicit Close', async () => {
            const session = wizardSession();
            const context = { ...createContext(), wizardSession: session };
            const caller = createCallerFactory(localQuickStartRouter)(context);

            await caller.closePanel();

            expect(context.closePanel).toHaveBeenCalled();
            expect(session.closeReason).toBe('closeButton');
            expect(context.actionContext.telemetry.properties).toMatchObject({
                quickStartSessionId: 'session-1',
                wizardStep: 'configure',
            });
        });

        it('counts setup attempts and records a successful setup', async () => {
            mockProvision.mockImplementation(async function* () {
                yield { stage: 'done', status: 'done' };
            });
            const session = wizardSession();
            const context = { ...createContext(), wizardSession: session };
            const caller = createCallerFactory(localQuickStartRouter)(context);

            const events = ((await caller.startQuickStart()) as AsyncIterable<unknown>)[Symbol.asyncIterator]();
            while (!(await events.next()).done) {
                // drain
            }

            expect(session.setupAttemptCount).toBe(1);
            expect(session.setupSucceeded).toBe(true);
            expect(context.actionContext.telemetry.measurements.setupAttempt).toBe(1);
            mockProvision.mockReset();
        });
    });

    describe('checkPassword', () => {
        it('reports what SASLprep rejects so Configure can show it', async () => {
            const caller = createCallerFactory(localQuickStartRouter)(createContext());

            await expect(caller.checkPassword({ password: 'pass😀word' })).resolves.toBe('unsupportedCharacter');
            await expect(caller.checkPassword({ password: 'pässwörd' })).resolves.toBe('ok');
        });
    });

    // Review N1: the panel used to read the instance's status once on open, so a container removed
    // in a terminal (or a tree action, or another window) left its guard describing an instance
    // that no longer existed.
    describe('onInstanceChanged', () => {
        beforeEach(() => {
            // Earlier cases in this file call getDockerStatus, which probes Docker.
            mockIsDockerReady.mockClear();
            mockRefreshLiveState.mockClear();
        });

        afterEach(() => statusListeners.clear());

        async function drain(count: number): Promise<unknown[]> {
            const controller = new AbortController();
            const context = { ...createContext(), signal: controller.signal };
            const caller = createCallerFactory(localQuickStartRouter)(context);
            const iterator = (await caller.onInstanceChanged()) as AsyncGenerator<unknown>;

            const received: unknown[] = [];
            for (let i = 0; i < count; i++) {
                const next = iterator.next();
                // The generator parks on the status event after its first snapshot; wake it.
                await Promise.resolve();
                fireStatusChange();
                const result = await next;
                if (result.done) break;
                received.push(result.value);
            }
            controller.abort();
            fireStatusChange();
            await iterator.return(undefined).catch(() => undefined);
            return received;
        }

        it('pushes an immediate snapshot so a panel opened after a change is never behind', async () => {
            mockGetStatus.mockReturnValue({ state: 'Stopped', missing: true });
            mockCanReuseExistingData.mockResolvedValue(true);

            const [first] = await drain(1);

            expect(first).toEqual({
                status: expect.objectContaining({ state: 'Stopped', missing: true }),
                canReuseExistingData: true,
            });
        });

        // The wizard's "no longer in Docker" notice reads it from both.
        it('passes dataRemoved through the status query and the subscription', async () => {
            mockGetStatus.mockReturnValue({ state: 'NotInstalled', dataRemoved: true });
            mockCanReuseExistingData.mockResolvedValue(false);
            const caller = createCallerFactory(localQuickStartRouter)(createContext());

            expect(await caller.getStatus()).toMatchObject({ state: 'NotInstalled', dataRemoved: true });
            const [first] = await drain(1);

            expect(first).toEqual({
                status: expect.objectContaining({ dataRemoved: true }),
                canReuseExistingData: false,
            });
        });

        it('pushes the new status when the instance changes', async () => {
            mockGetStatus.mockReturnValueOnce({ state: 'Stopped', missing: false });
            mockGetStatus.mockReturnValue({ state: 'Stopped', missing: true });
            mockCanReuseExistingData.mockResolvedValue(true);

            const received = (await drain(2)) as Array<{ status: { missing?: boolean } }>;

            // The removal is what the guard needs: same state, different `missing`.
            expect(received[0].status.missing).toBe(false);
            expect(received[1].status.missing).toBe(true);
        });

        it('pushes engine-only changes, including deletion, without re-reading wizard context or checking readiness', async () => {
            mockGetStatus.mockReturnValue({ state: 'NotInstalled' });
            mockCanReuseExistingData.mockResolvedValue(false);
            mockGetInstanceEngine.mockResolvedValueOnce('podman').mockResolvedValue(undefined);
            mockGetWizardContext.mockClear();

            const received = await drain(2);

            expect(received).toMatchObject([{ instanceEngine: 'podman' }, { instanceEngine: undefined }]);
            expect(mockGetWizardContext).not.toHaveBeenCalled();
            expect(mockIsDockerReady).not.toHaveBeenCalled();
        });

        it('never calls Docker, because the tree fires this event on a cooldown', async () => {
            mockGetStatus.mockReturnValue({ state: 'Running' });
            mockCanReuseExistingData.mockResolvedValue(true);

            await drain(1);

            expect(mockIsDockerReady).not.toHaveBeenCalled();
            expect(mockRefreshLiveState).not.toHaveBeenCalled();
        });
    });
});
