/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Outcome telemetry of a setup run (`documentDB.quickstart.provision` and its per-stage events):
 * where a run stopped, why, what the host knew about Docker beforehand, and whether it downloaded
 * the image. Kept apart from the other provision suites because it mocks `mongodb` (so a run can
 * succeed) and records every telemetry event.
 */

import {
    type callWithTelemetryAndErrorHandling,
    type IActionContext,
    type ITelemetryContext,
} from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { ext } from '../../extensionVariables';
import { StorageService } from '../storageService';
import { disposeQuickStartOutputChannel, type IContainerEngineOps, type IContainerRuntime } from './ContainerRuntime';
import { DockerCommandError } from './dockerCommand';
import { QuickStartServiceImpl } from './QuickStartService';
import { upsertInstance } from './quickStartStore';
import { DEFAULT_ALIAS, type DockerReadiness, QUICK_START_PORT, type StageEvent } from './quickStartTypes';

const mockTelemetryEvents: Array<{ readonly eventName: string; readonly telemetry: ITelemetryContext }> = [];

vi.mock('@microsoft/vscode-azext-utils', async () => ({
    ...(await vi.importActual<{ callWithTelemetryAndErrorHandling: typeof callWithTelemetryAndErrorHandling }>(
        '@microsoft/vscode-azext-utils',
    )),
    callWithTelemetryAndErrorHandling: vi.fn(
        async (eventName: string, callback: (context: IActionContext) => unknown): Promise<unknown> => {
            const context = {
                telemetry: { properties: {}, measurements: {} },
                errorHandling: { issueProperties: {} },
                valuesToMask: [],
            } as unknown as IActionContext;
            mockTelemetryEvents.push({ eventName, telemetry: context.telemetry });
            try {
                return await callback(context);
            } catch (error) {
                if (context.errorHandling.rethrow) {
                    throw error;
                }
                return undefined;
            }
        },
    ),
}));

/** Called on every readiness probe; throw from it to make the database refuse connections. */
let onProbe: () => void = () => undefined;

vi.mock('mongodb', () => ({
    MongoClient: class {
        public connect(): Promise<unknown> {
            onProbe();
            return Promise.resolve(this);
        }
        public db(): unknown {
            return { command: () => Promise.resolve({ ok: 1 }) };
        }
        public close(): Promise<void> {
            return Promise.resolve();
        }
    },
}));

vi.mock('../../documentdb/ClustersClient', () => ({
    ClustersClient: { deleteClient: () => Promise.resolve() },
}));

vi.mock('../../documentdb/CredentialCache', () => ({
    CredentialCache: { setAuthCredentials: vi.fn(), deleteCredentials: vi.fn() },
}));

function fakeMemento(): vscode.Memento {
    const store = new Map<string, unknown>();
    return {
        keys: () => Array.from(store.keys()),
        get: (key: string, defaultValue?: unknown) => (store.has(key) ? store.get(key) : defaultValue),
        update: (key: string, value: unknown) => {
            if (value === undefined) {
                store.delete(key);
            } else {
                store.set(key, value);
            }
            return Promise.resolve();
        },
    } as unknown as vscode.Memento;
}

function fakeSecretStorage(): vscode.SecretStorage {
    const store = new Map<string, string>();
    return {
        onDidChange: () => ({ dispose: () => undefined }),
        get: (key: string) => Promise.resolve(store.get(key)),
        store: (key: string, value: string) => {
            store.set(key, value);
            return Promise.resolve();
        },
        delete: (key: string) => {
            store.delete(key);
            return Promise.resolve();
        },
    } as unknown as vscode.SecretStorage;
}

function fakeContext(globalState: vscode.Memento): vscode.ExtensionContext {
    StorageService._resetForTests();
    return {
        globalState,
        subscriptions: [],
        extension: { id: 'ms-azuretools.vscode-documentdb' },
    } as unknown as vscode.ExtensionContext;
}

const READY: DockerReadiness = {
    outcome: 'ready',
    environment: 'linux',
    endpointKind: 'unixSocket',
    provider: 'dockerEngine',
    providerEvidence: 'liveDaemon',
    executionTarget: 'local',
    canContinueAnyway: false,
    checkedAtMs: 1,
    cliInstalled: true,
    daemonReachable: true,
};

const CLI_MISSING: DockerReadiness = {
    outcome: 'diagnosed',
    environment: 'linux',
    endpointKind: 'unknown',
    provider: 'unknown',
    providerEvidence: 'none',
    executionTarget: 'local',
    failureKind: 'cliMissing',
    canContinueAnyway: false,
    checkedAtMs: 1,
    cliInstalled: false,
    daemonReachable: false,
};

const RUNNING = {
    id: 'c1',
    status: 'running',
    ports: [{ containerPort: QUICK_START_PORT, hostPort: QUICK_START_PORT }],
};

type RuntimeOverrides = Partial<IContainerRuntime & IContainerEngineOps>;

/** Docker's closing line on a pull, delivered through the progress callback like the real CLI. */
function pullReporting(statusLine: string): IContainerEngineOps['pullImage'] {
    return vi.fn((_imageRef: string, _token?: vscode.CancellationToken, onProgress?: (line: string) => void) => {
        onProgress?.('latest: Pulling from documentdb/documentdb-local');
        onProgress?.(statusLine);
        return Promise.resolve();
    });
}

// One object serves as the runtime and as the engine it resolves (`forCli` returns itself).
function runtimeFor(overrides: RuntimeOverrides = {}): IContainerRuntime {
    const runtime = {
        resolveCli: vi.fn(() => ({
            cli: 'docker',
            executable: 'docker',
            onPath: { docker: true, podman: false },
            preferred: 'docker',
            fellBack: false,
        })),
        forCli: vi.fn(() => runtime),
        startAvailableDockerProvider: vi.fn().mockResolvedValue('notAvailable'),
        isDockerReady: vi.fn().mockResolvedValue(READY),
        isPortFree: vi.fn().mockResolvedValue(true),
        listByLabel: vi.fn().mockResolvedValue([]),
        // Not on this machine yet, so setup downloads it.
        inspectImage: vi.fn().mockResolvedValue('absent'),
        pullImage: pullReporting('Status: Downloaded newer image for documentdb-local:latest'),
        createAndRunContainer: vi.fn().mockResolvedValue('c1'),
        inspectContainer: vi.fn().mockResolvedValue(RUNNING),
        startContainer: vi.fn().mockResolvedValue(undefined),
        stopContainer: vi.fn().mockResolvedValue(undefined),
        removeContainer: vi.fn().mockResolvedValue(undefined),
        removeVolume: vi.fn().mockResolvedValue(undefined),
        volumeExists: vi.fn().mockResolvedValue(false),
        execShellInContainer: vi.fn().mockResolvedValue(undefined),
        followLogs: vi.fn().mockResolvedValue(undefined),
        readRecentLogs: vi.fn().mockResolvedValue(''),
        ...overrides,
    } as unknown as IContainerRuntime;
    return runtime;
}

async function collect(generator: AsyncGenerator<StageEvent>): Promise<StageEvent[]> {
    const events: StageEvent[] = [];
    for await (const event of generator) {
        events.push(event);
    }
    return events;
}

function provisionProperties(): ITelemetryContext['properties'] | undefined {
    return mockTelemetryEvents.filter((event) => event.eventName === 'documentDB.quickstart.provision').at(-1)
        ?.telemetry.properties;
}

function stageProperties(stage: string): ITelemetryContext['properties'] | undefined {
    return mockTelemetryEvents
        .filter(
            (event) =>
                event.eventName === 'documentDB.quickstart.provision.stage' &&
                event.telemetry.properties.stage === stage,
        )
        .at(-1)?.telemetry.properties;
}

describe('QuickStartService — provision outcome telemetry', () => {
    let originalSecretStorage: vscode.SecretStorage;
    let originalContext: vscode.ExtensionContext;

    beforeAll(() => {
        vi.spyOn(vscode.window, 'createOutputChannel').mockReturnValue({
            name: 'test',
            append: vi.fn(),
            appendLine: vi.fn(),
            replace: vi.fn(),
            clear: vi.fn(),
            show: vi.fn(),
            hide: vi.fn(),
            dispose: vi.fn(),
        } as unknown as vscode.LogOutputChannel);
        disposeQuickStartOutputChannel();
    });

    afterAll(() => {
        disposeQuickStartOutputChannel();
        vi.restoreAllMocks();
    });

    beforeEach(() => {
        originalSecretStorage = ext.secretStorage;
        originalContext = ext.context;
        ext.secretStorage = fakeSecretStorage();
        ext.context = fakeContext(fakeMemento());
        mockTelemetryEvents.length = 0;
        onProbe = () => undefined;
    });

    afterEach(() => {
        ext.secretStorage = originalSecretStorage;
        ext.context = originalContext;
        onProbe = () => undefined;
    });

    it('reports a successful run that downloaded the image at the suggested port', async () => {
        const service = new QuickStartServiceImpl(runtimeFor());
        await service.checkDockerReadiness({ engine: { kind: 'pinned', cli: 'docker' } });
        const suggested = await service.suggestPort();

        const events = await collect(service.provision(new AbortController().signal, { port: suggested }));

        expect(events.at(-1)).toMatchObject({ stage: 'done', status: 'done' });
        const properties = provisionProperties();
        expect(properties).toMatchObject({
            provisionResult: 'success',
            dockerReadinessAtStart: 'ready',
            failedStage: 'none',
            failureCode: 'none',
            imagePulled: 'true',
            portChanged: 'false',
            dockerFailureKind: 'none',
            containerEngineChanged: 'false',
        });
        // Replaced by portChanged: the panel always sends a port, so it was always "true".
        expect(properties).not.toHaveProperty('customPort');
        expect(stageProperties('pulling')).not.toHaveProperty('failureCode');
        // The cached credentials mark the managed instance for the `connect.*` events.
        expect(vi.mocked(CredentialCache.setAuthCredentials).mock.calls.at(-1)?.at(-1)).toEqual({
            localQuickStartInstance: true,
        });
    });

    it.each([
        ['docker', 'podman', 'true'],
        ['podman', 'podman', 'false'],
        [undefined, 'podman', 'legacy'],
        ['docker', 'docker', 'false'],
    ] as const)(
        'classifies Start fresh from owner %s to resolved %s as containerEngineChanged=%s',
        async (engineCli, cli, containerEngineChanged) => {
            await upsertInstance({
                alias: DEFAULT_ALIAS,
                displayName: 'Existing',
                phase: 'ready',
                port: QUICK_START_PORT,
                engineCli,
            });
            const runtime = runtimeFor({
                resolveCli: vi.fn().mockReturnValue({
                    cli,
                    executable: cli,
                    preferred: 'podman',
                    fellBack: cli !== 'podman',
                    onPath: { docker: true, podman: cli === 'podman' },
                }),
            });
            const service = new QuickStartServiceImpl(runtime);

            const events = await collect(
                service.provision(new AbortController().signal, { preferredEngine: 'podman', startFresh: true }),
            );

            expect(events.at(-1)).toMatchObject({ stage: 'done', status: 'done' });
            expect(provisionProperties()).toMatchObject({
                containerEngineChanged,
                preferredContainerEngine: 'podman',
                containerCliFallback: cli === 'podman' ? 'false' : 'true',
                startFresh: 'true',
            });
            expect(
                mockTelemetryEvents.filter((event) => event.eventName === 'documentDB.quickstart.provision'),
            ).toHaveLength(1);
        },
    );

    it('reports an image that was already present and a port the user changed', async () => {
        const service = new QuickStartServiceImpl(
            runtimeFor({ pullImage: pullReporting('Status: Image is up to date for documentdb-local:latest') }),
        );
        const suggested = await service.suggestPort();

        await collect(service.provision(new AbortController().signal, { port: suggested + 5 }));

        expect(provisionProperties()).toMatchObject({
            provisionResult: 'success',
            dockerReadinessAtStart: 'notChecked',
            imagePulled: 'false',
            portChanged: 'true',
        });
    });

    // dockerFailureKind used to read only the follow-up check after a pull/create failure, so a run
    // stopped by Docker at its own `checking` stage always reported "none".
    it('reports the Docker failure when Docker is missing at the checking stage', async () => {
        const service = new QuickStartServiceImpl(
            runtimeFor({ isDockerReady: vi.fn().mockResolvedValue(CLI_MISSING) }),
        );

        const events = await collect(service.provision(new AbortController().signal, { port: QUICK_START_PORT }));

        expect(events.at(-1)).toMatchObject({ stage: 'checking', status: 'error' });
        expect(provisionProperties()).toMatchObject({
            provisionResult: 'error',
            dockerReadinessAtStart: 'notChecked',
            failedStage: 'checking',
            failureCode: 'dockerCliMissing',
            dockerFailureKind: 'cliMissing',
            imagePulled: 'unknown',
        });
        expect(stageProperties('checking')).toMatchObject({ failureCode: 'dockerCliMissing' });
        expect(provisionProperties()).not.toHaveProperty('containerEngineChanged');
    });

    it('reports where a cancelled run stopped', async () => {
        const controller = new AbortController();
        const pullImage = vi.fn().mockImplementation(() => {
            controller.abort();
            return Promise.reject(new Error('Command cancelled'));
        });
        const service = new QuickStartServiceImpl(
            runtimeFor({ pullImage: pullImage as IContainerEngineOps['pullImage'] }),
        );

        await collect(service.provision(controller.signal, { port: QUICK_START_PORT }));

        expect(provisionProperties()).toMatchObject({
            provisionResult: 'cancelled',
            failedStage: 'pulling',
            failureCode: 'cancelled',
            imagePulled: 'unknown',
            dockerFailureKind: 'none',
        });
        expect(stageProperties('pulling')).toMatchObject({ failureCode: 'cancelled' });
    });

    it('classifies a port taken while the image downloaded at the creating stage', async () => {
        const createAndRunContainer = vi
            .fn()
            .mockRejectedValue(
                new DockerCommandError(125, 'docker: Error response from daemon: port is already allocated.'),
            );
        const service = new QuickStartServiceImpl(runtimeFor({ createAndRunContainer }));

        await collect(service.provision(new AbortController().signal, { port: QUICK_START_PORT }));

        expect(provisionProperties()).toMatchObject({
            provisionResult: 'error',
            failedStage: 'creating',
            failureCode: 'portInUse',
            portTaken: 'true',
            imagePulled: 'true',
        });
        expect(stageProperties('creating')).toMatchObject({ failureCode: 'portInUse' });
    });

    it('classifies a failed image download without quoting Docker', async () => {
        const pullImage = vi
            .fn()
            .mockRejectedValue(new DockerCommandError(1, 'Error response from daemon: Get "https://mcr": timeout'));
        const service = new QuickStartServiceImpl(
            runtimeFor({ pullImage: pullImage as IContainerEngineOps['pullImage'] }),
        );

        await collect(service.provision(new AbortController().signal, { port: QUICK_START_PORT }));

        expect(provisionProperties()).toMatchObject({ failedStage: 'pulling', failureCode: 'imagePullFailed' });
        expect(stageProperties('pulling')).toMatchObject({ failureCode: 'imagePullFailed' });
    });

    it('classifies a disk-full download', async () => {
        const pullImage = vi
            .fn()
            .mockRejectedValue(new DockerCommandError(1, 'write /var/lib/docker/tmp: no space left on device'));
        const service = new QuickStartServiceImpl(
            runtimeFor({ pullImage: pullImage as IContainerEngineOps['pullImage'] }),
        );

        await collect(service.provision(new AbortController().signal, { port: QUICK_START_PORT }));

        expect(provisionProperties()).toMatchObject({ failedStage: 'pulling', failureCode: 'diskFull' });
    });

    it('classifies a container that exited during the readiness wait', async () => {
        onProbe = () => {
            throw new Error('connect ECONNREFUSED');
        };
        const inspectContainer = vi
            .fn()
            .mockResolvedValueOnce(RUNNING)
            .mockResolvedValue({ id: 'c1', status: 'exited', raw: JSON.stringify({ State: { ExitCode: 1 } }) });
        const service = new QuickStartServiceImpl(runtimeFor({ inspectContainer }));

        await collect(service.provision(new AbortController().signal, { port: QUICK_START_PORT }));

        expect(provisionProperties()).toMatchObject({
            provisionResult: 'error',
            failedStage: 'waiting',
            failureCode: 'containerExited',
            imagePulled: 'true',
        });
        expect(stageProperties('waiting')).toMatchObject({ failureCode: 'containerExited' });
    });
});
