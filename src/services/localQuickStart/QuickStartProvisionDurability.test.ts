/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
    type Mock,
    type MockInstance,
} from 'vitest';

/**
 * WP-3 (review 798): provisioning durability + the always-explicit port model.
 *
 * Kept in its own file because it mocks `mongodb`, so the readiness probe resolves immediately and
 * a provision can be driven end to end — the other suites deliberately stop at pull/create.
 */

import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { StorageService } from '../storageService';
import { type ContainerCli } from './containerCli';
import {
    disposeQuickStartOutputChannel,
    SETUP_CLEANUP_TIMEOUT_MS,
    type IContainerRuntime as ContainerRuntimeHost,
    type IContainerEngineOps,
} from './ContainerRuntime';
import { DockerCommandError, DockerCommandTimeoutError } from './dockerCommand';
import { QuickStartServiceImpl } from './QuickStartService';
import {
    getInstance,
    listInstances,
    readConnectionString,
    removeInstance,
    upsertInstance,
    writeConnectionString,
} from './quickStartStore';
import {
    DEFAULT_ALIAS,
    InstanceState,
    QUICK_START_ALIAS_LABEL_KEY,
    QUICK_START_IMAGE_REPOSITORY,
    QUICK_START_LABEL_KEY,
    QUICK_START_OPERATION_LABEL_KEY,
    QUICK_START_PORT,
    type DockerReadiness,
    type StageEvent,
} from './quickStartTypes';

/** Called on every readiness/sample-data probe, so a test can observe the world mid-provision. */
let onProbe: () => void | Promise<void> = () => undefined;
let onHello: () => unknown = () => ({ ok: 1 });
const probeCommand = vi.fn(
    async (command: { ping?: number; hello?: number }): Promise<unknown> =>
        command.hello ? await onHello() : { ok: 1 },
);
const closeProbe = vi.fn(async (): Promise<void> => undefined);
const connectProbe = vi.fn();

// Real fs, with `rm` and `writeFile` spyable so a test can fail one env-file write or delete.
vi.mock('fs/promises', async () => {
    const actual = await vi.importActual<typeof fsPromises>('fs/promises');
    return { ...actual, rm: vi.fn(actual.rm), writeFile: vi.fn(actual.writeFile) };
});

vi.mock('mongodb', () => ({
    MongoClient: class {
        public async connect(): Promise<unknown> {
            connectProbe();
            // Awaited so a hook can read the durable store, which is async since I3-1.
            await onProbe();
            return this;
        }
        public db(): unknown {
            return {
                command: probeCommand,
            };
        }
        public close(): Promise<void> {
            return closeProbe();
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

function fakeSecretStorage(seed: Record<string, string> = {}): vscode.SecretStorage & {
    snapshot: () => Record<string, string>;
} {
    const store = new Map<string, string>(Object.entries(seed));
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
        snapshot: () => Object.fromEntries(store),
    } as unknown as vscode.SecretStorage & { snapshot: () => Record<string, string> };
}

interface IContainerRuntime extends ContainerRuntimeHost, IContainerEngineOps {}

interface RuntimeOptions {
    readonly portFree?: boolean;
    readonly containers?: Array<{ id: string; labels?: Record<string, string> }>;
    readonly createAndRunContainer?: Mock;
    readonly listByLabel?: Mock;
    readonly volumeExists?: boolean;
    readonly overrides?: Partial<IContainerRuntime>;
}

function runtimeFor(options: RuntimeOptions = {}): IContainerRuntime {
    const runtime: IContainerRuntime = {
        resolveCli: vi.fn((request: Parameters<ContainerRuntimeHost['resolveCli']>[0]) => ({
            cli: request.kind === 'pinned' ? request.cli : request.preferred,
            executable: request.kind === 'pinned' ? request.cli : request.preferred,
            onPath: { docker: true, podman: true },
            preferred: request.kind === 'pinned' ? request.cli : request.preferred,
            fellBack: false,
        })),
        forCli: vi.fn(() => runtime),
        startAvailableDockerProvider: vi.fn().mockResolvedValue('notAvailable'),
        isDockerReady: vi.fn().mockResolvedValue({
            outcome: 'ready',
            environment: 'linux',
            endpointKind: 'unixSocket',
            canContinueAnyway: false,
            checkedAtMs: Date.now(),
            cliInstalled: true,
            daemonReachable: true,
        }),
        isPortFree: vi.fn().mockResolvedValue(options.portFree ?? true),
        listByLabel: options.listByLabel ?? vi.fn().mockResolvedValue(options.containers ?? []),
        pullImage: vi.fn().mockResolvedValue(undefined),
        // The image is on this machine, as it is after any earlier setup.
        inspectImage: vi.fn().mockResolvedValue({ id: 'sha256:local-image' }),
        createAndRunContainer: options.createAndRunContainer ?? vi.fn().mockResolvedValue('c1'),
        inspectContainer: vi.fn().mockResolvedValue({
            id: 'c1',
            status: 'running',
            ports: [{ containerPort: QUICK_START_PORT, hostPort: QUICK_START_PORT }],
        }),
        startContainer: vi.fn().mockResolvedValue(undefined),
        stopContainer: vi.fn().mockResolvedValue(undefined),
        removeContainer: vi.fn().mockResolvedValue(undefined),
        removeVolume: vi.fn().mockResolvedValue(undefined),
        volumeExists: vi.fn().mockResolvedValue(options.volumeExists ?? false),
        execShellInContainer: vi.fn().mockResolvedValue(undefined),
        followLogs: vi.fn().mockResolvedValue(undefined),
        readRecentLogs: vi.fn().mockResolvedValue(''),
        ...options.overrides,
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

/**
 * An ExtensionContext complete enough for {@link StorageService}, which the Quick Start store runs
 * on: it needs `extension.id` to namespace its keys and `subscriptions` for the SecretStorage
 * change listener. Installing a fresh backing store also drops the cached `StorageImpl` singletons,
 * whose short-lived `getItems` cache would otherwise leak a previous test's snapshot into this one.
 */
function fakeContext(globalState: vscode.Memento): vscode.ExtensionContext {
    StorageService._resetForTests();
    return {
        globalState,
        subscriptions: [],
        extension: { id: 'ms-azuretools.vscode-documentdb' },
    } as unknown as vscode.ExtensionContext;
}

describe('QuickStartService — WP-3 provisioning durability and port model', () => {
    let originalSecretStorage: vscode.SecretStorage;
    let originalContext: vscode.ExtensionContext;
    let secretStorage: ReturnType<typeof fakeSecretStorage>;
    let globalState: vscode.Memento;

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
        secretStorage = fakeSecretStorage();
        globalState = fakeMemento();
        ext.secretStorage = secretStorage;
        ext.context = fakeContext(globalState);
        onProbe = () => undefined;
        onHello = () => ({ ok: 1 });
        probeCommand.mockClear();
        connectProbe.mockClear();
        closeProbe.mockClear();
    });

    afterEach(() => {
        ext.secretStorage = originalSecretStorage;
        ext.context = originalContext;
        onProbe = () => undefined;
        onHello = () => ({ ok: 1 });
    });

    describe('instance engine ownership', () => {
        it.each(['docker', 'podman'] as const)(
            'releases the %s engine after another window deletes its record, container and volume',
            async (engineCli) => {
                const runtime = runtimeFor();
                const service = new QuickStartServiceImpl(runtime);
                await collect(service.provision(new AbortController().signal, { preferredEngine: engineCli }));
                expect((await service.getWizardContext()).instanceEngine).toBe(engineCli);
                await removeInstance(DEFAULT_ALIAS);
                vi.mocked(runtime.inspectContainer).mockResolvedValue(undefined);
                vi.mocked(runtime.volumeExists).mockResolvedValue(false);

                await service.refreshLiveState();

                expect(service.getStatus()).toMatchObject({ state: InstanceState.NotInstalled, dataRemoved: true });
                expect((await service.getWizardContext()).instanceEngine).toBeUndefined();
                expect(await service.getInstanceEngine()).toBeUndefined();
                const preferredEngine = engineCli === 'docker' ? 'podman' : 'docker';
                await service.checkInstanceDockerReadiness({}, preferredEngine);
                expect(runtime.isDockerReady).toHaveBeenLastCalledWith({
                    engine: { kind: 'preferred', preferred: preferredEngine },
                });
                const retry = service.provision(new AbortController().signal, { preferredEngine });
                try {
                    expect((await retry.next()).value).toMatchObject({ stage: 'checking', status: 'active' });
                    expect(runtime.resolveCli).toHaveBeenLastCalledWith({
                        kind: 'preferred',
                        preferred: preferredEngine,
                    });
                    vi.mocked(runtime.inspectContainer).mockResolvedValue({
                        id: 'c1',
                        name: DEFAULT_ALIAS,
                        imageId: 'image1',
                        image: {},
                        status: 'running',
                        environmentVariables: {},
                        networks: [],
                        ports: [{ containerPort: QUICK_START_PORT, hostPort: QUICK_START_PORT }],
                        mounts: [],
                        labels: { [QUICK_START_LABEL_KEY]: '1', [QUICK_START_ALIAS_LABEL_KEY]: DEFAULT_ALIAS },
                        entrypoint: [],
                        command: [],
                        createdAt: new Date(0),
                        raw: '{}',
                    });
                    await collect(retry);
                    expect(await getInstance(DEFAULT_ALIAS)).toMatchObject({
                        phase: 'ready',
                        engineCli: preferredEngine,
                    });
                } finally {
                    await retry.return(undefined);
                }
            },
        );

        it.each(['docker', 'podman'] as const)(
            'keeps the stored %s owner when only its container and volume were removed externally',
            async (engineCli) => {
                const runtime = runtimeFor();
                const service = new QuickStartServiceImpl(runtime);
                await collect(service.provision(new AbortController().signal, { preferredEngine: engineCli }));
                vi.mocked(runtime.inspectContainer).mockResolvedValue(undefined);
                vi.mocked(runtime.volumeExists).mockResolvedValue(false);

                await service.refreshLiveState();

                expect(service.getStatus()).toMatchObject({ state: InstanceState.NotInstalled, dataRemoved: true });
                expect((await service.getWizardContext()).instanceEngine).toBe(engineCli);
                await service.checkInstanceDockerReadiness({}, engineCli === 'docker' ? 'podman' : 'docker');
                expect(runtime.isDockerReady).toHaveBeenLastCalledWith({ engine: { kind: 'pinned', cli: engineCli } });
                expect(await getInstance(DEFAULT_ALIAS)).toMatchObject({ phase: 'ready', engineCli });
            },
        );

        it.each(['docker', 'podman'] as const)(
            'keeps the retained live %s instance owner when only its persisted record was removed',
            async (engineCli) => {
                const runtime = runtimeFor();
                const service = new QuickStartServiceImpl(runtime);
                await collect(service.provision(new AbortController().signal, { preferredEngine: engineCli }));
                await removeInstance(DEFAULT_ALIAS);

                expect((await service.getWizardContext()).instanceEngine).toBe(engineCli);
                await service.checkInstanceDockerReadiness({}, engineCli === 'docker' ? 'podman' : 'docker');
                expect(runtime.isDockerReady).toHaveBeenLastCalledWith({ engine: { kind: 'pinned', cli: engineCli } });
            },
        );

        it.each(['docker', 'podman'] as const)(
            'does not cache %s ownership when reconciliation finds only a fresh lease and no live container',
            async (engineCli) => {
                await upsertInstance({
                    alias: DEFAULT_ALIAS,
                    displayName: 'DocumentDB Local',
                    port: QUICK_START_PORT,
                    phase: 'provisioning',
                    engineCli,
                    operationId: 'other-window',
                    leaseAt: Date.now(),
                });
                const runtime = runtimeFor();
                const service = new QuickStartServiceImpl(runtime);

                await service.ensureHydrated();

                expect(service.getStatus().state).toBe(InstanceState.Provisioning);
                expect(await getInstance(DEFAULT_ALIAS)).toMatchObject({ phase: 'provisioning', engineCli });
                expect(await service.getInstanceEngine()).toBeUndefined();
                expect((await service.getWizardContext()).instanceEngine).toBeUndefined();
                await service.checkInstanceDockerReadiness({}, engineCli === 'docker' ? 'podman' : 'docker');
                expect(runtime.isDockerReady).toHaveBeenLastCalledWith({ engine: { kind: 'pinned', cli: engineCli } });
                expect(await service.getInstanceEngine()).toBeUndefined();
            },
        );

        it.each(['docker', 'podman'] as const)(
            'does not expose or cache a %s provisioning lease as the Configure engine',
            async (engineCli) => {
                await upsertInstance({
                    alias: DEFAULT_ALIAS,
                    displayName: 'DocumentDB Local',
                    port: QUICK_START_PORT,
                    phase: 'provisioning',
                    engineCli,
                    operationId: 'live-lease',
                    leaseAt: Date.now(),
                });
                const runtime = runtimeFor();
                const service = new QuickStartServiceImpl(runtime);

                expect((await service.getWizardContext()).instanceEngine).toBeUndefined();
                expect(await service.getInstanceEngine()).toBeUndefined();
                expect(runtime.resolveCli).not.toHaveBeenCalled();
                expect(runtime.isDockerReady).not.toHaveBeenCalled();
                await service.checkInstanceDockerReadiness({}, engineCli === 'docker' ? 'podman' : 'docker');
                expect(runtime.isDockerReady).toHaveBeenLastCalledWith({ engine: { kind: 'pinned', cli: engineCli } });
                expect(await service.getInstanceEngine()).toBeUndefined();
                expect((await service.getWizardContext()).instanceEngine).toBeUndefined();
            },
        );

        it.each(['failure', 'cancel'] as const)(
            'honors a new preference after a %s rolls back a checked lease',
            async (outcome) => {
                const runtime = runtimeFor();
                const service = new QuickStartServiceImpl(runtime);
                const controller = new AbortController();
                vi.mocked(runtime.pullImage).mockImplementationOnce(async () => {
                    expect(await getInstance(DEFAULT_ALIAS)).toMatchObject({
                        phase: 'provisioning',
                        engineCli: 'docker',
                    });
                    await service.checkInstanceDockerReadiness({}, 'podman');
                    expect(runtime.isDockerReady).toHaveBeenLastCalledWith({
                        engine: { kind: 'pinned', cli: 'docker' },
                    });
                    expect((await service.getWizardContext()).instanceEngine).toBeUndefined();
                    if (outcome === 'cancel') controller.abort();
                    throw new Error('pull interrupted');
                });

                await collect(service.provision(controller.signal, { preferredEngine: 'docker' }));

                expect(await getInstance(DEFAULT_ALIAS)).toBeUndefined();
                expect(await service.getInstanceEngine()).toBeUndefined();
                expect((await service.getWizardContext()).instanceEngine).toBeUndefined();
                const retry = service.provision(new AbortController().signal, { preferredEngine: 'podman' });
                expect((await retry.next()).value).toMatchObject({ stage: 'checking', status: 'active' });
                expect(runtime.resolveCli).toHaveBeenLastCalledWith({ kind: 'preferred', preferred: 'podman' });
                await collect(retry);
                expect(await getInstance(DEFAULT_ALIAS)).toMatchObject({ phase: 'ready', engineCli: 'podman' });
            },
        );

        it.each([
            ['docker', 'podman', 'ready'],
            ['podman', 'docker', 'ready'],
            ['docker', 'podman', 'diagnosed'],
            ['podman', 'docker', 'diagnosed'],
        ] as const)(
            'carries original %s to %s fallback on the %s checking event',
            async (preferredEngine, cli, outcome) => {
                const runtime = runtimeFor();
                const base = {
                    environment: 'linux',
                    endpointKind: 'unixSocket',
                    provider: 'podman',
                    providerEvidence: 'liveDaemon',
                    executionTarget: 'local',
                    checkedAtMs: 1,
                    canContinueAnyway: false,
                    cliInstalled: true,
                    cli,
                    preferredEngine: cli,
                    cliFallback: false,
                } as const;
                const pinned: DockerReadiness =
                    outcome === 'ready'
                        ? { ...base, outcome, daemonReachable: true }
                        : { ...base, outcome, daemonReachable: false, failureKind: 'daemonUnavailable' };
                vi.mocked(runtime.resolveCli).mockReturnValue({
                    cli,
                    executable: cli,
                    preferred: preferredEngine,
                    fellBack: true,
                    onPath: { docker: cli === 'docker', podman: cli === 'podman' },
                });
                vi.mocked(runtime.isDockerReady).mockResolvedValue(pinned);
                const service = new QuickStartServiceImpl(runtime);

                const events = await collect(service.provision(new AbortController().signal, { preferredEngine }));
                const checking = events.find((event) => event.stage === 'checking' && event.status !== 'active');

                expect(checking).toMatchObject({
                    status: outcome === 'ready' ? 'done' : 'error',
                    dockerReadiness: { cli, preferredEngine, cliFallback: true },
                });
                if (outcome === 'ready') await service.checkInstanceDockerReadiness({}, preferredEngine);
                expect(checking?.dockerReadiness).toMatchObject({ cli, preferredEngine, cliFallback: true });
                expect(pinned).toMatchObject({ preferredEngine: cli, cliFallback: false });
            },
        );

        const stored = 'mongodb://admin:stored-password@localhost:10260/?tls=true';

        it.each(['docker', 'podman'] as const)(
            'uses the fresh %s preference consistently without persisting it',
            async (preferredEngine) => {
                const runtime = runtimeFor();
                const service = new QuickStartServiceImpl(runtime);

                await service.checkInstanceDockerReadiness({}, preferredEngine);
                expect(runtime.isDockerReady).toHaveBeenLastCalledWith({
                    engine: { kind: 'preferred', preferred: preferredEngine },
                });
                await service.startDockerProvider(preferredEngine);
                expect(runtime.startAvailableDockerProvider).toHaveBeenLastCalledWith(
                    { kind: 'preferred', preferred: preferredEngine },
                    undefined,
                );
                expect(await getInstance(DEFAULT_ALIAS)).toBeUndefined();

                await collect(service.provision(new AbortController().signal, { preferredEngine }));

                expect(runtime.resolveCli).toHaveBeenCalledWith({ kind: 'preferred', preferred: preferredEngine });
                expect(runtime.isDockerReady).toHaveBeenLastCalledWith({
                    engine: { kind: 'pinned', cli: preferredEngine },
                });
                expect(runtime.forCli).toHaveBeenCalledWith(
                    expect.objectContaining({
                        cli: preferredEngine,
                        preferred: preferredEngine,
                        fellBack: false,
                    }),
                );
                expect(await getInstance(DEFAULT_ALIAS)).toMatchObject({ engineCli: preferredEngine, phase: 'ready' });
                expect(await getInstance(DEFAULT_ALIAS)).not.toHaveProperty('preferredEngine');
            },
        );

        it.each(['docker', 'podman'] as const)(
            'keeps the stored %s owner for readiness, launch and provision despite a conflicting preference',
            async (engineCli) => {
                const preferredEngine = engineCli === 'docker' ? 'podman' : 'docker';
                await upsertInstance({
                    alias: DEFAULT_ALIAS,
                    displayName: 'DocumentDB Local',
                    port: QUICK_START_PORT,
                    phase: 'ready',
                    engineCli,
                });
                const runtime = runtimeFor();
                const service = new QuickStartServiceImpl(runtime);

                await service.checkInstanceDockerReadiness({ forceRefresh: true }, preferredEngine);
                expect(runtime.isDockerReady).toHaveBeenLastCalledWith({
                    forceRefresh: true,
                    engine: { kind: 'pinned', cli: engineCli },
                });
                await service.startDockerProvider(preferredEngine);
                expect(runtime.startAvailableDockerProvider).toHaveBeenLastCalledWith(
                    { kind: 'pinned', cli: engineCli },
                    undefined,
                );
                await collect(service.provision(new AbortController().signal, { preferredEngine, startFresh: true }));
                expect(runtime.resolveCli).toHaveBeenCalledWith({ kind: 'pinned', cli: engineCli });
                expect(runtime.resolveCli).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'preferred' }));
                expect(await getInstance(DEFAULT_ALIAS)).toMatchObject({ engineCli, phase: 'ready' });
            },
        );

        it('passes the start action the button named to the click-time check', async () => {
            const runtime = runtimeFor();
            const service = new QuickStartServiceImpl(runtime);
            await service.startDockerProvider('docker', 'startPodmanMachine');
            expect(runtime.startAvailableDockerProvider).toHaveBeenLastCalledWith(
                { kind: 'preferred', preferred: 'docker' },
                'startPodmanMachine',
            );
        });

        it('ignores a new preference for a legacy record across readiness, launch and provision', async () => {
            await upsertInstance({
                alias: DEFAULT_ALIAS,
                displayName: 'DocumentDB Local',
                port: QUICK_START_PORT,
                phase: 'ready',
            });
            const runtime = runtimeFor();
            const service = new QuickStartServiceImpl(runtime);

            await service.checkInstanceDockerReadiness({}, 'podman');
            expect(runtime.isDockerReady).toHaveBeenLastCalledWith({
                engine: { kind: 'preferred', preferred: 'docker' },
            });
            await service.startDockerProvider('podman');
            expect(runtime.startAvailableDockerProvider).toHaveBeenLastCalledWith(
                { kind: 'preferred', preferred: 'docker' },
                undefined,
            );
            await collect(
                service.provision(new AbortController().signal, {
                    preferredEngine: 'podman',
                    startFresh: true,
                }),
            );
            expect(runtime.resolveCli).toHaveBeenCalledWith({ kind: 'preferred', preferred: 'docker' });
            expect(await getInstance(DEFAULT_ALIAS)).toMatchObject({ engineCli: 'docker', phase: 'ready' });
        });

        it('uses the execution-time fallback for provisioning operations and readiness', async () => {
            const runtime = runtimeFor();
            vi.mocked(runtime.resolveCli).mockReturnValue({
                cli: 'docker',
                executable: 'docker',
                preferred: 'podman',
                fellBack: true,
                onPath: { docker: true, podman: false },
            });
            const service = new QuickStartServiceImpl(runtime);
            await collect(service.provision(new AbortController().signal, { preferredEngine: 'podman' }));
            expect(runtime.forCli).toHaveBeenCalledWith(
                expect.objectContaining({
                    cli: 'docker',
                    preferred: 'podman',
                    fellBack: true,
                }),
            );
            expect(runtime.isDockerReady).toHaveBeenLastCalledWith({
                engine: { kind: 'pinned', cli: 'docker' },
            });
            expect(await getInstance(DEFAULT_ALIAS)).toMatchObject({ engineCli: 'docker', phase: 'ready' });
        });

        it.each(['docker', 'podman'] as const)(
            'establishes the missing %s preference and fallback only after the checking stage executes',
            async (preferredEngine) => {
                const cli = preferredEngine === 'docker' ? 'podman' : 'docker';
                const runtime = runtimeFor();
                vi.mocked(runtime.resolveCli).mockReturnValue({
                    cli,
                    executable: cli,
                    preferred: preferredEngine,
                    fellBack: true,
                    onPath: { docker: cli === 'docker', podman: cli === 'podman' },
                });
                vi.mocked(runtime.isDockerReady).mockResolvedValue({
                    outcome: 'ready',
                    environment: 'linux',
                    endpointKind: 'unixSocket',
                    provider: cli === 'docker' ? 'dockerEngine' : 'podman',
                    providerEvidence: 'liveDaemon',
                    executionTarget: 'local',
                    checkedAtMs: 1,
                    canContinueAnyway: false,
                    cliInstalled: true,
                    daemonReachable: true,
                    cli,
                    preferredEngine: cli,
                    cliFallback: false,
                });
                const service = new QuickStartServiceImpl(runtime);
                const generator = service.provision(new AbortController().signal, { preferredEngine });

                expect(service.getDockerReadinessSnapshot()).toBeUndefined();
                expect((await generator.next()).value).toMatchObject({ stage: 'checking', status: 'active' });
                expect(runtime.isDockerReady).not.toHaveBeenCalled();
                expect(service.getDockerReadinessSnapshot()).toBeUndefined();

                await collect(generator);

                expect(service.getDockerReadinessSnapshot()).toMatchObject({
                    cli,
                    preferredEngine,
                    cliFallback: true,
                });
            },
        );

        it.each([false, true])(
            'retains the original checking selection without mutating pinned runtime readiness (fallback=%s)',
            async (fellBack) => {
                const selection = {
                    cli: 'podman',
                    executable: 'podman',
                    preferred: fellBack ? 'docker' : 'podman',
                    fellBack,
                    onPath: { docker: false, podman: true },
                } as const;
                const pinned: DockerReadiness = {
                    outcome: 'ready',
                    environment: 'linux',
                    endpointKind: 'unixSocket',
                    provider: 'podman',
                    providerEvidence: 'liveDaemon',
                    executionTarget: 'local',
                    checkedAtMs: 1,
                    canContinueAnyway: false,
                    cliInstalled: true,
                    daemonReachable: true,
                    cli: 'podman',
                    preferredEngine: 'podman',
                    cliFallback: false,
                };
                const runtime = runtimeFor();
                vi.mocked(runtime.resolveCli).mockReturnValue(selection);
                vi.mocked(runtime.isDockerReady).mockResolvedValue(pinned);
                const service = new QuickStartServiceImpl(runtime);

                const events = await collect(service.provision(new AbortController().signal));

                expect(events).toContainEqual(expect.objectContaining({ stage: 'checking', status: 'done' }));
                expect(service.getStatus().state).toBe(InstanceState.Running);
                expect(runtime.isDockerReady).toHaveBeenCalledExactlyOnceWith({
                    engine: { kind: 'pinned', cli: 'podman' },
                });
                expect(service.getDockerReadinessSnapshot()).toMatchObject({
                    cli: 'podman',
                    preferredEngine: selection.preferred,
                    cliFallback: fellBack,
                });
                expect(service.getDockerReadinessSnapshot()).not.toBe(pinned);
                const directPinned = await runtime.isDockerReady({ engine: { kind: 'pinned', cli: 'podman' } });
                expect(directPinned).toBe(pinned);
                expect(directPinned).toMatchObject({ preferredEngine: 'podman', cliFallback: false });
            },
        );

        it.each(['pulling', 'creating'] as const)(
            'retains the original fallback in the forced terminal snapshot after %s fails',
            async (stage) => {
                // A fresh run: only a run that chose its CLI by preference can have fallen back.
                const selection = {
                    cli: 'podman',
                    executable: 'podman',
                    preferred: 'docker',
                    fellBack: true,
                    onPath: { docker: false, podman: true },
                } as const;
                const pinned: DockerReadiness = {
                    outcome: 'ready',
                    environment: 'linux',
                    endpointKind: 'unixSocket',
                    provider: 'podman',
                    providerEvidence: 'liveDaemon',
                    executionTarget: 'local',
                    checkedAtMs: 1,
                    canContinueAnyway: false,
                    cliInstalled: true,
                    daemonReachable: true,
                    cli: 'podman',
                    preferredEngine: 'podman',
                    cliFallback: false,
                };
                const unavailable: DockerReadiness = {
                    ...pinned,
                    outcome: 'diagnosed',
                    failureKind: 'daemonUnavailable',
                    daemonReachable: false,
                    checkedAtMs: 2,
                };
                const runtime = runtimeFor();
                vi.mocked(runtime.resolveCli).mockReturnValue(selection);
                vi.mocked(runtime.isDockerReady).mockResolvedValueOnce(pinned).mockResolvedValue(unavailable);
                vi.mocked(stage === 'pulling' ? runtime.pullImage : runtime.createAndRunContainer).mockRejectedValue(
                    new Error('engine became unavailable'),
                );
                const service = new QuickStartServiceImpl(runtime);

                const events = await collect(service.provision(new AbortController().signal, { startFresh: true }));

                expect(events.at(-1)).toMatchObject({
                    stage: 'error',
                    dockerReadiness: {
                        cli: 'podman',
                        preferredEngine: 'docker',
                        cliFallback: true,
                        failureKind: 'daemonUnavailable',
                    },
                });
                expect(runtime.isDockerReady).toHaveBeenLastCalledWith({
                    forceRefresh: true,
                    suppressCommandEcho: true,
                    engine: { kind: 'pinned', cli: 'podman' },
                });
                expect(await runtime.isDockerReady({ engine: { kind: 'pinned', cli: 'podman' } })).toBe(unavailable);
                expect(unavailable).toMatchObject({ preferredEngine: 'podman', cliFallback: false });
            },
        );

        it('does not overlay selection evidence onto readiness from a different CLI', async () => {
            const runtime = runtimeFor();
            const pinned = {
                ...(await runtime.isDockerReady()),
                cli: 'docker',
                preferredEngine: 'docker',
                cliFallback: false,
            } as const;
            vi.mocked(runtime.isDockerReady).mockResolvedValue(pinned);
            const service = new QuickStartServiceImpl(runtime);

            const result = await service.checkDockerReadiness(
                { engine: { kind: 'pinned', cli: 'docker' } },
                { cli: 'podman', preferred: 'docker', fellBack: true },
            );

            expect(result).toBe(pinned);
            expect(result).toMatchObject({ preferredEngine: 'docker', cliFallback: false });
        });

        it('persists the selected engine on the lease and record without switching during provision', async () => {
            const runtime = runtimeFor();
            const podman = runtimeFor();
            let preferred: 'docker' | 'podman' = 'podman';
            vi.mocked(runtime.resolveCli).mockImplementation((request) => {
                const cli = request.kind === 'pinned' ? request.cli : preferred;
                const requested = request.kind === 'pinned' ? request.cli : request.preferred;
                return {
                    cli,
                    executable: cli,
                    onPath: { docker: preferred === 'docker', podman: true },
                    preferred: requested,
                    fellBack: cli !== requested,
                };
            });
            vi.mocked(runtime.forCli).mockImplementation(({ cli }) => (cli === 'podman' ? podman : runtime));
            vi.mocked(runtime.isDockerReady).mockImplementation(async () => {
                // Docker appears before the existing-instance guard and lease write.
                preferred = 'docker';
                return {
                    outcome: 'ready',
                    environment: 'linux',
                    endpointKind: 'unixSocket',
                    canContinueAnyway: false,
                    checkedAtMs: Date.now(),
                    cliInstalled: true,
                    daemonReachable: true,
                    provider: 'podman',
                    providerEvidence: 'liveDaemon',
                    executionTarget: 'local',
                };
            });
            vi.mocked(podman.pullImage).mockImplementation(async () => {
                expect(await getInstance(DEFAULT_ALIAS)).toMatchObject({
                    phase: 'provisioning',
                    engineCli: 'podman',
                });
            });
            const service = new QuickStartServiceImpl(runtime);

            await collect(service.provision(new AbortController().signal));

            expect(await getInstance(DEFAULT_ALIAS)).toMatchObject({ phase: 'ready', engineCli: 'podman' });
            expect(service.getStatus().state).toBe(InstanceState.Running);
            expect(podman.pullImage).toHaveBeenCalledOnce();
            expect(podman.createAndRunContainer).toHaveBeenCalledOnce();
            expect(podman.followLogs).toHaveBeenCalledOnce();
            expect(podman.execShellInContainer).toHaveBeenCalledOnce();
            expect(runtime.pullImage).not.toHaveBeenCalled();
            expect(runtime.createAndRunContainer).not.toHaveBeenCalled();
            expect(runtime.listByLabel).not.toHaveBeenCalled();
            expect(runtime.forCli).toHaveBeenCalledWith(expect.objectContaining({ cli: 'podman' }));
        });

        it.each([false, true])(
            're-resolves an unowned alias after Podman is installed with initial listing failure=%s',
            async (listingFails) => {
                let podmanInstalled = false;
                const runtime = runtimeFor();
                const podman = runtimeFor();
                vi.mocked(runtime.resolveCli).mockImplementation((request) => {
                    const cli = request.kind === 'pinned' ? request.cli : podmanInstalled ? 'podman' : 'docker';
                    const preferred = request.kind === 'pinned' ? request.cli : request.preferred;
                    return {
                        cli,
                        executable: cli,
                        onPath: { docker: false, podman: podmanInstalled },
                        preferred,
                        fellBack: cli !== preferred,
                    };
                });
                vi.mocked(runtime.forCli).mockImplementation(({ cli }) => (cli === 'podman' ? podman : runtime));
                if (listingFails) {
                    vi.mocked(runtime.listByLabel).mockRejectedValue(new Error('Docker CLI missing'));
                }
                const ready = await runtime.isDockerReady();
                vi.mocked(runtime.isDockerReady).mockImplementation(async (request) => {
                    const cli = request?.engine?.kind === 'pinned' ? request.engine.cli : 'docker';
                    return podmanInstalled && cli === 'podman'
                        ? { ...ready, cli }
                        : {
                              ...ready,
                              cli,
                              outcome: 'diagnosed',
                              canContinueAnyway: false,
                              failureKind: 'cliMissing',
                              cliInstalled: false,
                              daemonReachable: false,
                          };
                });
                vi.mocked(podman.pullImage).mockImplementation(async () => {
                    expect(await getInstance(DEFAULT_ALIAS)).toMatchObject({
                        phase: 'provisioning',
                        engineCli: 'podman',
                    });
                });
                const service = new QuickStartServiceImpl(runtime);
                if (listingFails) {
                    await expect(service.ensureHydrated()).rejects.toThrow('Docker CLI missing');
                } else {
                    await service.ensureHydrated();
                }
                const first = await collect(service.provision(new AbortController().signal));
                expect(first.at(-1)).toMatchObject({ status: 'error', message: { key: 'dockerCliMissing' } });
                expect(await getInstance(DEFAULT_ALIAS)).toBeUndefined();

                podmanInstalled = true;
                await service.reconcile();
                const retried = await collect(service.provision(new AbortController().signal));

                expect(retried.at(-1)).toMatchObject({ stage: 'done' });
                expect(service.getStatus().state).toBe(InstanceState.Running);
                expect(await getInstance(DEFAULT_ALIAS)).toMatchObject({ phase: 'ready', engineCli: 'podman' });
                expect(podman.createAndRunContainer).toHaveBeenCalledOnce();
                expect(runtime.pullImage).not.toHaveBeenCalled();
                expect(runtime.createAndRunContainer).not.toHaveBeenCalled();
            },
        );

        it.each([false, true])(
            'keeps Podman for recreate with startFresh=%s when Docker is installed',
            async (startFresh) => {
                await upsertInstance({
                    alias: DEFAULT_ALIAS,
                    displayName: 'DocumentDB Local',
                    port: QUICK_START_PORT,
                    phase: 'ready',
                    engineCli: 'podman',
                });
                await writeConnectionString(DEFAULT_ALIAS, stored, {
                    displayName: 'DocumentDB Local',
                    port: QUICK_START_PORT,
                });
                const runtime = runtimeFor();
                const podman = runtimeFor({ volumeExists: true });
                vi.mocked(runtime.forCli).mockImplementation(({ cli }) => (cli === 'podman' ? podman : runtime));
                const service = new QuickStartServiceImpl(runtime);

                await collect(service.provision(new AbortController().signal, { startFresh }));

                expect(service.getStatus().state).toBe(InstanceState.Running);
                expect(await getInstance(DEFAULT_ALIAS)).toMatchObject({ engineCli: 'podman', phase: 'ready' });
                expect(runtime.resolveCli).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'preferred' }));
                expect(runtime.isDockerReady).toHaveBeenCalledWith({
                    engine: { kind: 'pinned', cli: 'podman' },
                });
                expect(podman.createAndRunContainer).toHaveBeenCalledOnce();
                expect(podman.removeVolume).toHaveBeenCalledTimes(startFresh ? 1 : 0);
                expect(runtime.createAndRunContainer).not.toHaveBeenCalled();
                expect(runtime.volumeExists).not.toHaveBeenCalled();
            },
        );

        it('uses the persisted owning engine ahead of previously cached ownership', async () => {
            const record = {
                alias: DEFAULT_ALIAS,
                displayName: 'DocumentDB Local',
                port: QUICK_START_PORT,
                phase: 'ready' as const,
                engineCli: 'docker' as const,
            };
            await upsertInstance(record);
            const runtime = runtimeFor();
            const podman = runtimeFor();
            vi.mocked(runtime.forCli).mockImplementation(({ cli }) => (cli === 'podman' ? podman : runtime));
            const service = new QuickStartServiceImpl(runtime);
            await service.reconcile();
            await upsertInstance({ ...record, engineCli: 'podman' });

            await collect(service.provision(new AbortController().signal, { startFresh: true }));

            expect(service.getStatus().state).toBe(InstanceState.Running);
            expect(podman.createAndRunContainer).toHaveBeenCalledOnce();
            expect(runtime.createAndRunContainer).not.toHaveBeenCalled();
            expect(await getInstance(DEFAULT_ALIAS)).toMatchObject({ phase: 'ready', engineCli: 'podman' });
        });

        it('resolves a legacy record to Podman at execution on a Podman-only host', async () => {
            await upsertInstance({
                alias: DEFAULT_ALIAS,
                displayName: 'DocumentDB Local',
                port: QUICK_START_PORT,
                phase: 'ready',
            });
            await writeConnectionString(DEFAULT_ALIAS, stored, {
                displayName: 'DocumentDB Local',
                port: QUICK_START_PORT,
            });
            const runtime = runtimeFor({ volumeExists: true });
            vi.mocked(runtime.resolveCli).mockImplementation((request) => {
                const cli = request.kind === 'pinned' ? request.cli : 'podman';
                const preferred = request.kind === 'pinned' ? request.cli : request.preferred;
                return {
                    cli,
                    executable: cli,
                    onPath: { docker: false, podman: true },
                    preferred,
                    fellBack: cli !== preferred,
                };
            });
            const service = new QuickStartServiceImpl(runtime);
            expect(runtime.resolveCli).not.toHaveBeenCalled();

            await collect(service.provision(new AbortController().signal));

            expect(runtime.resolveCli).toHaveBeenCalledWith({ kind: 'preferred', preferred: 'docker' });
            expect(runtime.forCli).toHaveBeenCalledWith(expect.objectContaining({ cli: 'podman' }));
            expect(await getInstance(DEFAULT_ALIAS)).toMatchObject({ engineCli: 'podman', phase: 'ready' });
            expect(service.getStatus().state).toBe(InstanceState.Running);
        });

        it.each([false, true])(
            'does not fall back when an existing instance has lost its Podman CLI (Docker installed=%s)',
            async (dockerInstalled) => {
                const record = {
                    alias: DEFAULT_ALIAS,
                    displayName: 'DocumentDB Local',
                    port: QUICK_START_PORT,
                    phase: 'ready' as const,
                    engineCli: 'podman' as const,
                };
                await upsertInstance(record);
                const runtime = runtimeFor();
                const podman = runtimeFor();
                vi.mocked(runtime.resolveCli).mockReturnValue({
                    cli: 'podman',
                    executable: 'podman',
                    preferred: 'podman',
                    fellBack: false,
                    onPath: { docker: dockerInstalled, podman: false },
                });
                vi.mocked(runtime.forCli).mockImplementation(({ cli }) => (cli === 'podman' ? podman : runtime));
                vi.mocked(runtime.isDockerReady).mockResolvedValue({
                    outcome: 'diagnosed',
                    cli: 'podman',
                    failureKind: 'cliMissing',
                    cliInstalled: false,
                    daemonReachable: false,
                    checkedAtMs: Date.now(),
                    environment: 'linux',
                    endpointKind: 'unknown',
                    canContinueAnyway: false,
                    provider: 'unknown',
                    providerEvidence: 'none',
                    executionTarget: 'local',
                });
                const service = new QuickStartServiceImpl(runtime);

                const events = await collect(service.provision(new AbortController().signal, { startFresh: true }));

                expect(events.at(-1)).toMatchObject({
                    status: 'error',
                    message: { key: 'dockerCliMissing', engineCli: 'podman' },
                });
                expect(await getInstance(DEFAULT_ALIAS)).toMatchObject(record);
                expect(runtime.isDockerReady).toHaveBeenCalledWith({ engine: { kind: 'pinned', cli: 'podman' } });
                expect(runtime.pullImage).not.toHaveBeenCalled();
                expect(podman.pullImage).not.toHaveBeenCalled();
                expect(runtime.forCli).not.toHaveBeenCalledWith(expect.objectContaining({ cli: 'docker' }));
            },
        );

        it('routes lifecycle, connection preflight, logs and delete to pinned Podman', async () => {
            await upsertInstance({
                alias: DEFAULT_ALIAS,
                displayName: 'DocumentDB Local',
                port: QUICK_START_PORT,
                phase: 'ready',
                engineCli: 'podman',
            });
            await writeConnectionString(DEFAULT_ALIAS, stored, {
                displayName: 'DocumentDB Local',
                port: QUICK_START_PORT,
            });
            const runtime = runtimeFor();
            const podman = runtimeFor({ containers: [{ id: 'p1', labels: { [QUICK_START_LABEL_KEY]: '1' } }] });
            let running = false;
            vi.mocked(podman.inspectContainer).mockImplementation(
                async () =>
                    ({
                        id: 'p1',
                        status: running ? 'running' : 'exited',
                        labels: { [QUICK_START_LABEL_KEY]: '1' },
                        ports: [{ containerPort: QUICK_START_PORT, hostPort: QUICK_START_PORT }],
                    }) as unknown as Awaited<ReturnType<IContainerEngineOps['inspectContainer']>>,
            );
            vi.mocked(podman.startContainer).mockImplementation(async () => {
                running = true;
            });
            vi.mocked(podman.stopContainer).mockImplementation(async () => {
                running = false;
            });
            vi.mocked(runtime.forCli).mockImplementation(({ cli }) => (cli === 'podman' ? podman : runtime));
            const service = new QuickStartServiceImpl(runtime);
            await service.reconcile();
            expect(podman.listByLabel).toHaveBeenCalledOnce();
            expect(runtime.listByLabel).not.toHaveBeenCalled();
            expect(await service.prepareForConnection()).toBe('stopped');

            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
            try {
                const starting = service.start();
                await vi.advanceTimersByTimeAsync(5_000);
                await starting;
                expect(service.getStatus().state).toBe(InstanceState.Running);
                expect(await service.prepareForConnection()).toBe('ready');
                const restarting = service.restart();
                await vi.advanceTimersByTimeAsync(5_000);
                await restarting;
                await service.stop();
                expect(service.getStatus().state).toBe(InstanceState.Stopped);
            } finally {
                vi.useRealTimers();
            }
            const cts = new vscode.CancellationTokenSource();
            await service.followLogs(DEFAULT_ALIAS, ['stored-password'], cts.token);
            expect(podman.followLogs).toHaveBeenCalledWith('p1', ['stored-password'], cts.token);
            cts.dispose();
            expect(await service.deleteContainer()).toBe('deleted');
            expect(podman.startContainer).toHaveBeenCalledTimes(2);
            expect(podman.stopContainer).toHaveBeenCalledTimes(2);
            expect(podman.removeContainer).toHaveBeenCalledWith('p1');
            expect(podman.removeVolume).toHaveBeenCalledOnce();
            expect(runtime.inspectContainer).not.toHaveBeenCalled();
            expect(runtime.startContainer).not.toHaveBeenCalled();
            expect(runtime.stopContainer).not.toHaveBeenCalled();
            expect(runtime.removeContainer).not.toHaveBeenCalled();
            expect(runtime.followLogs).not.toHaveBeenCalled();
        });

        it('restores credentials from the owning engine rather than Docker', async () => {
            await upsertInstance({
                alias: DEFAULT_ALIAS,
                displayName: 'DocumentDB Local',
                port: QUICK_START_PORT,
                phase: 'ready',
                engineCli: 'podman',
            });
            const runtime = runtimeFor();
            const podman = runtimeFor({ containers: [{ id: 'p1' }] });
            vi.mocked(podman.inspectContainer).mockResolvedValue({
                id: 'p1',
                status: 'running',
                ports: [],
                environmentVariables: { USERNAME: 'admin', PASSWORD: 'podman-password' },
            } as unknown as Awaited<ReturnType<IContainerEngineOps['inspectContainer']>>);
            vi.mocked(runtime.forCli).mockImplementation(({ cli }) => (cli === 'podman' ? podman : runtime));
            const service = new QuickStartServiceImpl(runtime);

            await service.reconcile();

            expect(await readConnectionString(DEFAULT_ALIAS)).toContain('admin:podman-password@');
            expect(service.getStatus().state).toBe(InstanceState.Running);
            expect(runtime.inspectContainer).not.toHaveBeenCalled();
        });
    });

    describe('pull progress', () => {
        const password = 'private-progress-password';
        let runtime: IContainerRuntime;
        let service: QuickStartServiceImpl;
        let controller: AbortController;
        let generator: AsyncGenerator<StageEvent>;
        let events: StageEvent[];
        let pullStarted: Promise<void>;
        let resolvePull: () => void;
        let rejectPull: (error: Error) => void;
        let emitProgress: (line: string) => void;
        let token: vscode.CancellationToken | undefined;

        beforeEach(() => {
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
            events = [];
            token = undefined;
            emitProgress = () => undefined;
            let started!: () => void;
            pullStarted = new Promise<void>((resolve) => {
                started = resolve;
            });
            const pull = new Promise<void>((resolve, reject) => {
                resolvePull = resolve;
                rejectPull = reject;
            });
            runtime = runtimeFor({
                overrides: {
                    inspectImage: vi.fn().mockResolvedValueOnce({ id: 'before' }).mockResolvedValue({ id: 'after' }),
                    pullImage: vi.fn((_imageRef, cancellationToken, onProgress): Promise<void> => {
                        token = cancellationToken;
                        emitProgress = onProgress ?? (() => undefined);
                        started();
                        return pull;
                    }),
                },
            });
            service = new QuickStartServiceImpl(runtime);
            controller = new AbortController();
            generator = service.provision(controller.signal, { username: 'testuser', password });
        });

        afterEach(async () => {
            controller.abort();
            resolvePull();
            await generator.return(undefined);
            vi.useRealTimers();
        });

        async function consume(): Promise<void> {
            for await (const event of generator) {
                events.push(event);
            }
        }

        function progressLines(): string[] {
            return events.flatMap((event) =>
                event.status === 'active' && event.facts?.kind === 'pulling' && event.facts.progress
                    ? [event.facts.progress]
                    : [],
            );
        }

        async function reachPull(): Promise<void> {
            let event = await generator.next();
            while (!event.done && event.value.stage !== 'pulling') {
                event = await generator.next();
            }
            expect(event.value).toMatchObject({ stage: 'pulling', status: 'active' });
        }

        it('emits actual lines during the pending pull and coalesces a flood to one latest line per 250 ms', async () => {
            const complete = consume();
            await pullStarted;
            emitProgress('Connecting to registry');
            await vi.advanceTimersByTimeAsync(0);

            expect(progressLines()).toEqual(['Connecting to registry']);
            expect(runtime.inspectImage).toHaveBeenCalledTimes(1);
            expect(runtime.createAndRunContainer).not.toHaveBeenCalled();
            expect(events.at(-1)).toMatchObject({
                stage: 'pulling',
                status: 'active',
                facts: {
                    kind: 'pulling',
                    imageRef: `${QUICK_START_IMAGE_REPOSITORY}:latest`,
                    imageOrigin: 'default',
                    imageId: 'before',
                    progress: 'Connecting to registry',
                },
            });

            for (let index = 0; index < 10_000; index++) {
                emitProgress(`Actual output ${index}`);
            }
            emitProgress('   ');
            await vi.advanceTimersByTimeAsync(249);
            expect(progressLines()).toEqual(['Connecting to registry']);
            expect(vi.getTimerCount()).toBe(1);
            await vi.advanceTimersByTimeAsync(1);
            expect(progressLines()).toEqual(['Connecting to registry', 'Actual output 9999']);
            expect(vi.getTimerCount()).toBe(0);

            emitProgress('Verifying digest');
            await vi.advanceTimersByTimeAsync(250);
            expect(progressLines()).toEqual(['Connecting to registry', 'Actual output 9999', 'Verifying digest']);
            resolvePull();
            await complete;

            const done = events.find((event) => event.stage === 'pulling' && event.status === 'done');
            expect(done?.facts).toMatchObject({ kind: 'pulling', result: 'updated', previousImageId: 'before' });
            expect(done?.facts).not.toHaveProperty('progress');
            expect(runtime.inspectImage).toHaveBeenCalledTimes(2);
            expect(runtime.pullImage).toHaveBeenCalledTimes(1);
            expect(vi.getTimerCount()).toBe(0);
        });

        it('strips controls and masks whole run secrets before taking the latest CR segment and 160 characters', async () => {
            const complete = consume();
            await pullStarted;
            emitProgress('\x1b[32m\r \u0000 \x1b[0m');
            await vi.advanceTimersByTimeAsync(0);
            expect(progressLines()).toEqual([]);
            expect(vi.getTimerCount()).toBe(0);

            emitProgress(
                'Obsolete output\r  \u0000' +
                    'x'.repeat(157) +
                    password.slice(0, 8) +
                    '\x1b[32m' +
                    password.slice(8) +
                    '\x1b[0m trailing text',
            );
            await vi.advanceTimersByTimeAsync(0);
            expect(progressLines()).toEqual(['x'.repeat(157) + '***']);
            expect(progressLines()[0]).toHaveLength(160);
            expect(JSON.stringify(events)).not.toContain(password);
            expect(JSON.stringify(events)).not.toContain(password.slice(0, 8));
            resolvePull();
            await complete;
        });

        it('does not poll a quiet pull and removes the existing abort listener on settlement', async () => {
            const added = vi.spyOn(controller.signal, 'addEventListener');
            const removed = vi.spyOn(controller.signal, 'removeEventListener');
            const complete = consume();
            await pullStarted;
            await vi.advanceTimersByTimeAsync(10_000);
            expect(vi.getTimerCount()).toBe(0);
            expect(progressLines()).toEqual([]);
            resolvePull();
            await complete;

            expect(events.filter((event) => event.stage === 'pulling' && event.status === 'active')).toHaveLength(1);
            expect(events.at(-1)?.stage).toBe('done');
            expect(removed).toHaveBeenCalledTimes(added.mock.calls.length);
            for (const [event, listener] of added.mock.calls) {
                expect(removed).toHaveBeenCalledWith(event, listener);
            }
            expect(vi.getTimerCount()).toBe(0);
        });

        it('drops throttled output on settlement without delaying completion or leaking it into the next run', async () => {
            const complete = consume();
            await pullStarted;
            emitProgress('First run output');
            await vi.advanceTimersByTimeAsync(0);
            emitProgress('Do not replay after completion');
            await vi.advanceTimersByTimeAsync(0);
            expect(vi.getTimerCount()).toBe(1);
            resolvePull();
            await complete;

            expect(progressLines()).toEqual(['First run output']);
            expect(
                events.find((event) => event.stage === 'pulling' && event.status === 'done')?.facts,
            ).not.toHaveProperty('progress');
            expect(vi.getTimerCount()).toBe(0);
            vi.mocked(runtime.pullImage).mockResolvedValue(undefined);
            const retry = await collect(service.provision(new AbortController().signal));
            expect(retry.at(-1)?.stage).toBe('done');
            expect(retry.every((event) => !event.facts || !('progress' in event.facts))).toBe(true);
            expect(vi.getTimerCount()).toBe(0);
        });

        it('observes rejection while paused at progress and preserves the existing failure flow without stale output', async () => {
            await reachPull();
            const next = generator.next();
            await pullStarted;
            emitProgress('Contacting registry');
            expect((await next).value).toMatchObject({ facts: { progress: 'Contacting registry' } });

            const failure = new DockerCommandError(125, 'Registry refused the pull');
            const unhandled = vi.fn();
            process.on('unhandledRejection', unhandled);
            try {
                rejectPull(failure);
                await vi.advanceTimersByTimeAsync(0);
                expect(unhandled).not.toHaveBeenCalled();
                expect(vi.getTimerCount()).toBe(0);
                const remaining = await collect(generator);
                expect(remaining.at(-1)).toMatchObject({
                    stage: 'error',
                    status: 'error',
                    message: { key: 'unexpectedFailure', detail: failure.message },
                    facts: { kind: 'pulling', imageId: 'before' },
                });
                expect(remaining.at(-1)?.facts).not.toHaveProperty('progress');
                expect(runtime.inspectImage).toHaveBeenCalledTimes(1);
                expect(runtime.createAndRunContainer).not.toHaveBeenCalled();
            } finally {
                process.removeListener('unhandledRejection', unhandled);
            }
        });

        it('cancels the owned pull immediately, clears a throttle timer and ignores late output on abort', async () => {
            const added = vi.spyOn(controller.signal, 'addEventListener');
            const removed = vi.spyOn(controller.signal, 'removeEventListener');
            const complete = consume();
            await pullStarted;
            emitProgress('Pulling');
            await vi.advanceTimersByTimeAsync(0);
            emitProgress('Throttled line');
            await vi.advanceTimersByTimeAsync(0);
            expect(vi.getTimerCount()).toBe(1);

            controller.abort();
            expect(token?.isCancellationRequested).toBe(true);
            expect(vi.getTimerCount()).toBe(0);
            emitProgress('Output after abort');
            rejectPull(new Error('aborted'));
            await complete;

            expect(progressLines()).toEqual(['Pulling']);
            expect(events.at(-1)).toMatchObject({ message: { key: 'setupCancelled' } });
            expect(events.at(-1)?.facts).not.toHaveProperty('progress');
            expect(runtime.inspectImage).toHaveBeenCalledTimes(1);
            expect(runtime.stopContainer).not.toHaveBeenCalled();
            expect(runtime.removeContainer).not.toHaveBeenCalled();
            expect(removed).toHaveBeenCalledExactlyOnceWith('abort', added.mock.calls[0][1]);
            expect(vi.getTimerCount()).toBe(0);
        });

        it('cancels and releases a pull when the consumer returns at a progress yield, then permits a clean retry', async () => {
            const added = vi.spyOn(controller.signal, 'addEventListener');
            const removed = vi.spyOn(controller.signal, 'removeEventListener');
            await reachPull();
            const next = generator.next();
            await pullStarted;
            emitProgress('Downloading');
            expect((await next).value).toMatchObject({ facts: { progress: 'Downloading' } });
            emitProgress('Pending latest line');

            expect((await generator.return(undefined)).done).toBe(true);
            expect(token?.isCancellationRequested).toBe(true);
            expect(removed).toHaveBeenCalledExactlyOnceWith('abort', added.mock.calls[0][1]);
            expect(service.getStatus().state).toBe(InstanceState.NotInstalled);
            expect(runtime.inspectImage).toHaveBeenCalledTimes(1);
            expect(vi.getTimerCount()).toBe(0);
            emitProgress('Output after unsubscribe');
            rejectPull(new Error('cancelled owned pull'));
            await vi.advanceTimersByTimeAsync(0);

            vi.mocked(runtime.pullImage).mockResolvedValue(undefined);
            const retry = await collect(service.provision(new AbortController().signal));
            expect(retry.at(-1)?.stage).toBe('done');
            expect(retry.every((event) => !event.facts || !('progress' in event.facts))).toBe(true);
            expect(vi.getTimerCount()).toBe(0);
        });
    });

    describe('setup stage facts', () => {
        it('emits allow-listed facts on every done stage without credentials or env', async () => {
            const password = 'private-password-123';
            const runtime = runtimeFor({
                overrides: {
                    inspectImage: vi
                        .fn()
                        .mockResolvedValueOnce('absent')
                        .mockResolvedValueOnce({
                            id: 'sha256:image',
                            digest: 'sha256:digest',
                            version: '0.116.0',
                            createdAtMs: Date.UTC(2026, 9, 28),
                            environmentVariables: { PASSWORD: password },
                            raw: 'private-inspect-raw',
                        }),
                    inspectContainer: vi.fn().mockResolvedValue({
                        id: 'c1',
                        status: 'running',
                        startedAt: new Date('2026-10-28T10:42:17Z'),
                        ports: [{ containerPort: QUICK_START_PORT, hostPort: 10273 }],
                        environmentVariables: { PASSWORD: password },
                        raw: 'private-container-raw',
                    }),
                },
            });
            const service = new QuickStartServiceImpl(runtime);
            const events = await collect(
                service.provision(new AbortController().signal, {
                    username: 'testuser',
                    password,
                    port: 10273,
                }),
            );
            const doneFacts = events
                .filter((event) => event.status === 'done' && event.facts)
                .map((event) => event.facts);
            expect(doneFacts).toEqual([
                { kind: 'checking', port: 10273, portFree: true, removedContainerId: undefined },
                {
                    kind: 'pulling',
                    imageRef: `${QUICK_START_IMAGE_REPOSITORY}:latest`,
                    imageOrigin: 'default',
                    result: 'downloaded',
                    imageId: 'sha256:image',
                    digest: 'sha256:digest',
                    imageVersion: '0.116.0',
                    createdAtMs: Date.UTC(2026, 9, 28),
                },
                {
                    kind: 'creating',
                    containerName: DEFAULT_ALIAS,
                    containerId: 'c1',
                    hostPort: 10273,
                    containerPort: QUICK_START_PORT,
                    volumeName: `${DEFAULT_ALIAS}-data`,
                    dataPath: '/data',
                    volume: 'new',
                    username: 'testuser',
                },
                {
                    kind: 'starting',
                    running: true,
                    startedAtMs: Date.parse('2026-10-28T10:42:17Z'),
                    boundPort: 10273,
                    boundPortReported: true,
                },
                {
                    kind: 'waiting',
                    port: 10273,
                    attempts: 1,
                    documentdbVersions: undefined,
                    maxWireVersion: undefined,
                    displayName: 'DocumentDB Local',
                    sampleData: 'loaded',
                },
            ]);
            expect(events.at(-1)?.stage).toBe('done');
            const serialized = JSON.stringify(events);
            for (const forbidden of [
                password,
                'environmentVariables',
                'PASSWORD',
                'private-inspect-raw',
                'private-container-raw',
                'durationMs',
            ]) {
                expect(serialized).not.toContain(forbidden);
            }
            expect(JSON.stringify(await listInstances())).not.toContain('sha256:image');
        });

        it.each([
            ['absent', { id: 'new' }, 'downloaded'],
            [{ id: 'same' }, { id: 'same' }, 'upToDate'],
            [{ id: 'old' }, { id: 'new' }, 'updated'],
            [undefined, { id: 'new' }, undefined],
            [{ id: 'old' }, undefined, undefined],
            ['absent', undefined, undefined],
            [{ id: 'old' }, 'absent', undefined],
        ])('compares only established before/after image IDs (%j → %j)', async (before, after, result) => {
            const runtime = runtimeFor({
                overrides: { inspectImage: vi.fn().mockResolvedValueOnce(before).mockResolvedValueOnce(after) },
            });
            const events = await collect(new QuickStartServiceImpl(runtime).provision(new AbortController().signal));
            const facts = events.find((event) => event.stage === 'pulling' && event.status === 'done')?.facts;
            expect(facts).toMatchObject({ kind: 'pulling', result });
            if (result === 'updated') {
                expect(facts).toHaveProperty('previousImageId', 'old');
            } else {
                expect(facts).not.toHaveProperty('previousImageId');
            }
            expect(runtime.inspectImage).toHaveBeenCalledTimes(2);
            expect(runtime.pullImage).toHaveBeenCalledTimes(1);
            expect(events.at(-1)?.stage).toBe('done');
        });

        it.each(['default', 'custom', 'reused'] as const)(
            'emits known %s image facts before either inspection or pulling starts',
            async (origin) => {
                const imageRef = `${QUICK_START_IMAGE_REPOSITORY}:${origin === 'default' ? 'latest' : '0.116.0'}`;
                if (origin === 'reused') {
                    await upsertInstance({
                        alias: DEFAULT_ALIAS,
                        displayName: 'DocumentDB Local',
                        port: QUICK_START_PORT,
                        phase: 'ready',
                        imageRef,
                    });
                    await writeConnectionString(
                        DEFAULT_ALIAS,
                        `mongodb://testuser:stored-password@localhost:${QUICK_START_PORT}/`,
                        { displayName: 'DocumentDB Local', port: QUICK_START_PORT },
                    );
                }
                const runtime = runtimeFor({ volumeExists: origin === 'reused' });
                const generator = new QuickStartServiceImpl(runtime).provision(new AbortController().signal, {
                    ...(origin === 'custom' ? { imageTag: '0.116.0' } : {}),
                });
                try {
                    let event = await generator.next();
                    while (!event.done && event.value.stage !== 'pulling') {
                        event = await generator.next();
                    }
                    expect(event.value).toMatchObject({
                        stage: 'pulling',
                        status: 'active',
                        facts: { kind: 'pulling', imageRef, imageOrigin: origin },
                    });
                    expect(runtime.inspectImage).not.toHaveBeenCalled();
                    expect(runtime.pullImage).not.toHaveBeenCalled();
                    const remaining = await collect(generator);
                    expect(remaining.at(-1)?.stage).toBe('done');
                    if (origin === 'reused') {
                        // Existing data keeps the local image; pulling its tag again could upgrade the data.
                        expect(runtime.inspectImage).toHaveBeenCalledOnce();
                        expect(runtime.pullImage).not.toHaveBeenCalled();
                    } else {
                        expect(runtime.inspectImage).toHaveBeenCalledTimes(2);
                        expect(runtime.pullImage).toHaveBeenCalledExactlyOnceWith(
                            imageRef,
                            expect.anything(),
                            expect.any(Function),
                        );
                    }
                } finally {
                    await generator.return(undefined);
                }
            },
        );

        it('masks the previous image ID when an updated image contains a run secret', async () => {
            const password = 'private-password-123';
            const runtime = runtimeFor({
                overrides: {
                    inspectImage: vi
                        .fn()
                        .mockResolvedValueOnce({ id: `old-${password}` })
                        .mockResolvedValueOnce({ id: 'new-image' }),
                },
            });
            const events = await collect(
                new QuickStartServiceImpl(runtime).provision(new AbortController().signal, {
                    username: 'testuser',
                    password,
                }),
            );
            expect(events.find((event) => event.stage === 'pulling' && event.status === 'done')?.facts).toMatchObject({
                result: 'updated',
                previousImageId: 'old-***',
            });
            expect(JSON.stringify(events)).not.toContain(password);
            expect(runtime.inspectImage).toHaveBeenCalledTimes(2);
        });

        it('captures failed port evidence and records previous removal only after it succeeded', async () => {
            const runtime = runtimeFor({
                containers: [{ id: 'old-container' }],
                portFree: false,
            });
            const events = await collect(
                new QuickStartServiceImpl(runtime).provision(new AbortController().signal, { startFresh: true }),
            );
            expect(events.at(-1)).toMatchObject({
                stage: 'checking',
                status: 'error',
                facts: {
                    kind: 'checking',
                    port: QUICK_START_PORT,
                    portFree: false,
                    removedContainerId: 'old-container',
                },
            });
        });

        it('never claims removal on failure or a port probe that did not run', async () => {
            const runtime = runtimeFor({
                containers: [{ id: 'old-container' }],
                portFree: false,
                overrides: { removeContainer: vi.fn().mockRejectedValue(new Error('remove failed')) },
            });
            const events = await collect(
                new QuickStartServiceImpl(runtime).provision(new AbortController().signal, { startFresh: true }),
            );
            expect(events.at(-1)?.facts).toMatchObject({ kind: 'checking', removedContainerId: undefined });
            const notReady = runtimeFor({
                overrides: {
                    isDockerReady: vi.fn().mockResolvedValue({ cliInstalled: false, daemonReachable: false }),
                },
            });
            const earlyEvents = await collect(
                new QuickStartServiceImpl(notReady).provision(new AbortController().signal),
            );
            expect(earlyEvents.at(-1)?.facts).toBeUndefined();
            expect(notReady.isPortFree).not.toHaveBeenCalled();
        });

        it.each(['pulling', 'creating', 'starting'] as const)(
            'retains known %s facts on a terminal error',
            async (stage) => {
                const fail = vi.fn().mockRejectedValue(new Error('operation failed'));
                const runtime = runtimeFor({
                    overrides: {
                        ...(stage === 'pulling' ? { pullImage: fail } : {}),
                        ...(stage === 'creating' ? { createAndRunContainer: fail } : {}),
                        ...(stage === 'starting' ? { inspectContainer: fail } : {}),
                    },
                });
                const events = await collect(
                    new QuickStartServiceImpl(runtime).provision(new AbortController().signal),
                );
                expect(events.at(-1)).toMatchObject({ stage: 'error', status: 'error', facts: { kind: stage } });
            },
        );

        it.each(['removal failure', 'cancellation'] as const)(
            'does not claim replacement when %s preserves the existing volume',
            async (failure) => {
                const controller = new AbortController();
                const runtime = runtimeFor({
                    overrides: {
                        volumeExists: vi.fn(async () => {
                            if (failure === 'cancellation') controller.abort();
                            return true;
                        }),
                        removeVolume: vi.fn().mockRejectedValue(new Error('volume is in use')),
                    },
                });
                const events = await collect(
                    new QuickStartServiceImpl(runtime).provision(controller.signal, { startFresh: true }),
                );
                expect(events.at(-1)).toMatchObject({
                    stage: 'error',
                    status: 'error',
                    message: { key: failure === 'cancellation' ? 'setupCancelled' : 'unexpectedFailure' },
                    facts: {
                        kind: 'creating',
                        volumeName: `${DEFAULT_ALIAS}-data`,
                        dataPath: '/data',
                    },
                });
                expect(events.at(-1)?.facts).toMatchObject({ volume: undefined });
                expect(runtime.removeVolume).toHaveBeenCalledTimes(failure === 'cancellation' ? 0 : 1);
                expect(runtime.createAndRunContainer).not.toHaveBeenCalled();
            },
        );

        it.each([false, true])('omits the volume outcome when creation fails (existing volume=%s)', async (exists) => {
            const runtime = runtimeFor({
                volumeExists: exists,
                createAndRunContainer: vi.fn().mockRejectedValue(new Error('create failed')),
            });
            const events = await collect(
                new QuickStartServiceImpl(runtime).provision(new AbortController().signal, { startFresh: exists }),
            );
            expect(events.at(-1)).toMatchObject({
                stage: 'error',
                status: 'error',
                facts: { kind: 'creating', volume: undefined },
            });
            expect(events.at(-1)?.facts).not.toHaveProperty('containerId');
            expect(runtime.createAndRunContainer).toHaveBeenCalledOnce();
            expect(runtime.removeVolume).toHaveBeenCalledTimes(exists ? 1 : 0);
            expect(events.some((event) => event.stage === 'creating' && event.status === 'done')).toBe(false);
        });

        it('retains confirmed existing-volume evidence when creation fails', async () => {
            await upsertInstance({
                alias: DEFAULT_ALIAS,
                displayName: 'DocumentDB Local',
                port: QUICK_START_PORT,
                phase: 'ready',
            });
            const previous = `mongodb://previous:password@localhost:${QUICK_START_PORT}/`;
            await writeConnectionString(DEFAULT_ALIAS, previous, {
                displayName: 'DocumentDB Local',
                port: QUICK_START_PORT,
            });
            const runtime = runtimeFor({
                volumeExists: true,
                createAndRunContainer: vi.fn().mockRejectedValue(new Error('create failed')),
            });
            const events = await collect(new QuickStartServiceImpl(runtime).provision(new AbortController().signal));
            expect(events.at(-1)).toMatchObject({
                stage: 'error',
                status: 'error',
                facts: { kind: 'creating', volume: 'reused' },
            });
            expect(runtime.removeVolume).not.toHaveBeenCalled();
            expect(await readConnectionString(DEFAULT_ALIAS)).toBe(previous);
            expect((await getInstance(DEFAULT_ALIAS))?.phase).toBe('ready');
        });

        it('omits a container-name fallback ID and inspected state and timestamp when inspect fails', async () => {
            const runtime = runtimeFor({
                createAndRunContainer: vi.fn().mockResolvedValue(undefined),
                overrides: { inspectContainer: vi.fn().mockResolvedValue(undefined) },
            });
            const events = await collect(new QuickStartServiceImpl(runtime).provision(new AbortController().signal));
            expect(events.find((event) => event.stage === 'creating' && event.status === 'done')?.facts).toMatchObject({
                kind: 'creating',
                containerId: undefined,
            });
            expect(events.find((event) => event.stage === 'starting' && event.status === 'done')?.facts).toEqual({
                kind: 'starting',
                running: undefined,
                startedAtMs: undefined,
                boundPort: QUICK_START_PORT,
                boundPortReported: false,
            });
        });

        it('masks textual facts with the run secrets without reading inspect environment', async () => {
            const password = 'private-password-123';
            const runtime = runtimeFor({
                createAndRunContainer: vi.fn().mockResolvedValue(`container-${password}`),
                overrides: {
                    inspectImage: vi
                        .fn()
                        .mockResolvedValue({ id: `image-${password}`, version: password, digest: password }),
                },
            });
            const events = await collect(
                new QuickStartServiceImpl(runtime).provision(new AbortController().signal, {
                    username: `user-${password}`,
                    password,
                }),
            );
            expect(events.at(-1)?.stage).toBe('done');
            const serialized = JSON.stringify(events.map((event) => event.facts));
            expect(serialized).not.toContain(password);
            expect(serialized).toContain('***');
        });

        it.each([
            ['new', false, false, false, 'default'],
            ['replaced', false, true, true, 'default'],
            ['reused', true, true, false, 'reused'],
        ] as const)(
            'reports a %s volume and the actual image origin',
            async (volume, reuse, exists, startFresh, origin) => {
                if (reuse) {
                    await upsertInstance({
                        alias: DEFAULT_ALIAS,
                        displayName: 'DocumentDB Local',
                        port: QUICK_START_PORT,
                        phase: 'ready',
                    });
                    await writeConnectionString(
                        DEFAULT_ALIAS,
                        `mongodb://admin:stored-pass@localhost:${QUICK_START_PORT}/`,
                        {
                            displayName: 'DocumentDB Local',
                            port: QUICK_START_PORT,
                        },
                    );
                }
                const runtime = runtimeFor({ volumeExists: exists });
                const events = await collect(
                    new QuickStartServiceImpl(runtime).provision(new AbortController().signal, {
                        startFresh,
                        ...(reuse ? { imageTag: 'ignored-tag' } : {}),
                    }),
                );
                expect(
                    events.find((event) => event.stage === 'creating' && event.status === 'done')?.facts,
                ).toMatchObject({ volume });
                expect(
                    events.find((event) => event.stage === 'pulling' && event.status === 'done')?.facts,
                ).toMatchObject({ imageOrigin: origin });
            },
        );

        it('identifies custom image tags without changing the configured reference', async () => {
            const events = await collect(
                new QuickStartServiceImpl(runtimeFor()).provision(new AbortController().signal, {
                    imageTag: '0.116.0',
                }),
            );
            expect(events.find((event) => event.stage === 'pulling' && event.status === 'done')?.facts).toMatchObject({
                imageRef: `${QUICK_START_IMAGE_REPOSITORY}:0.116.0`,
                imageOrigin: 'custom',
            });
        });
    });

    // H3: the credentials used to be written only AFTER readiness succeeded, so a window reload
    // inside that (up to 3-minute) window left a labelled container with no recoverable secret —
    // a dead end whose only exit was deleting the data volume.
    //
    it('persists the connection string BEFORE the readiness wait (H3)', async () => {
        let secretAtFirstProbe: string | undefined;
        onProbe = async () => {
            secretAtFirstProbe ??= await readConnectionString(DEFAULT_ALIAS);
        };
        const service = new QuickStartServiceImpl(runtimeFor());

        await collect(service.provision(new AbortController().signal));

        expect(secretAtFirstProbe).toBeDefined();
        expect(secretAtFirstProbe).toContain(`localhost:${QUICK_START_PORT}`);
        expect(service.getStatus().state).toBe(InstanceState.Running);
    });

    // ...but a DISCARDED attempt must not leave its secret behind, or the next run would decide
    // `reusing` from credentials that no volume was ever initialized with.
    it('restores the previous credential state when the attempt fails (H3)', async () => {
        const service = new QuickStartServiceImpl(
            runtimeFor({ createAndRunContainer: vi.fn().mockRejectedValue(new Error('create blew up')) }),
        );

        await collect(service.provision(new AbortController().signal));

        expect(await readConnectionString(DEFAULT_ALIAS)).toBeUndefined();
    });

    // The case above fails at `docker run`, i.e. BEFORE the early write — so it never exercised the
    // restore itself. Cancel during the readiness wait instead, once the credentials are on disk.
    it('clears the credentials it wrote early when the attempt is discarded after the write (H3)', async () => {
        const controller = new AbortController();
        onProbe = () => controller.abort();
        const service = new QuickStartServiceImpl(runtimeFor());

        await collect(service.provision(controller.signal));

        expect(await readConnectionString(DEFAULT_ALIAS)).toBeUndefined();
        expect(service.getStatus().state).not.toBe(InstanceState.Running);
    });

    it('restores the PREVIOUS credentials when a recreate is discarded after the write (H3)', async () => {
        const previous = `mongodb://old:old@localhost:${QUICK_START_PORT}/?tls=true&tlsAllowInvalidCertificates=true`;
        await upsertInstance({
            alias: DEFAULT_ALIAS,
            displayName: 'DocumentDB Local',
            port: QUICK_START_PORT,
            phase: 'ready',
        });
        await writeConnectionString(DEFAULT_ALIAS, previous, {
            displayName: 'DocumentDB Local',
            port: QUICK_START_PORT,
        });
        const controller = new AbortController();
        onProbe = () => controller.abort();
        const service = new QuickStartServiceImpl(runtimeFor());

        await collect(service.provision(controller.signal));

        // The existing volume is still openable with the credentials it was initialized with — a
        // discarded recreate must not leave the attempt's unusable ones in their place.
        expect(await readConnectionString(DEFAULT_ALIAS)).toBe(previous);
    });

    // H3/3d: the lease machinery existed but nothing in production ever wrote a 'provisioning'
    // record, so every reconcile branch that depends on it was unreachable.
    it('takes a provisioning lease before the pull and promotes it to ready (H3)', async () => {
        const phases: string[] = [];
        onProbe = async () => {
            const record = await getInstance(DEFAULT_ALIAS);
            phases.push(`${record?.phase}:${record?.operationId ? 'owned' : 'unowned'}`);
        };
        const service = new QuickStartServiceImpl(runtimeFor());

        await collect(service.provision(new AbortController().signal));

        // Mid-provision the record is an owned 'provisioning' reservation…
        expect(phases[0]).toBe('provisioning:owned');
        // …and once readiness succeeds it is promoted to the durable ready record.
        expect((await getInstance(DEFAULT_ALIAS))?.phase).toBe('ready');
    });

    it('releases its provisioning lease when the attempt fails (H3)', async () => {
        const service = new QuickStartServiceImpl(
            runtimeFor({ createAndRunContainer: vi.fn().mockRejectedValue(new Error('create blew up')) }),
        );

        await collect(service.provision(new AbortController().signal));

        expect(await listInstances()).toHaveLength(0);
    });

    // A failed RECREATE must not scavenge the ready record of an instance whose volume still exists.
    it('never downgrades an existing ready record to a provisioning lease (H3)', async () => {
        await upsertInstance({
            alias: DEFAULT_ALIAS,
            displayName: 'DocumentDB Local',
            port: QUICK_START_PORT,
            phase: 'ready',
        });
        await writeConnectionString(
            DEFAULT_ALIAS,
            `mongodb://u1:p1@localhost:${QUICK_START_PORT}/?tls=true&tlsAllowInvalidCertificates=true`,
            { displayName: 'DocumentDB Local', port: QUICK_START_PORT },
        );
        const service = new QuickStartServiceImpl(
            runtimeFor({ createAndRunContainer: vi.fn().mockRejectedValue(new Error('create blew up')) }),
        );

        await collect(service.provision(new AbortController().signal));

        expect((await getInstance(DEFAULT_ALIAS))?.phase).toBe('ready');
    });

    // H4: the loser of a two-window create race reaches the id-less cleanup branch, where an
    // unscoped by-label sweep would have removed the WINNER's container.
    it('scopes the orphan sweep to this run own operation label (H4)', async () => {
        const listByLabel = vi.fn().mockResolvedValue([]);
        const service = new QuickStartServiceImpl(
            runtimeFor({
                listByLabel,
                // A create that throws leaves no captured id, which is the branch that sweeps.
                createAndRunContainer: vi
                    .fn()
                    .mockRejectedValue(new Error('The container name "/vscode-documentdb-local" is already in use')),
            }),
        );

        await collect(service.provision(new AbortController().signal));

        const sweepCall = listByLabel.mock.calls.find(
            (call) => (call[0] as Record<string, string>)[QUICK_START_OPERATION_LABEL_KEY] !== undefined,
        );
        expect(sweepCall).toBeDefined();
        expect((sweepCall?.[0] as Record<string, string>)[QUICK_START_LABEL_KEY]).toBe('1');
        expect((sweepCall?.[0] as Record<string, string>)[QUICK_START_OPERATION_LABEL_KEY]).toMatch(/^[0-9a-f]{16}$/);
    });

    it('stamps the per-run operation label on the container it creates (H4)', async () => {
        const createAndRunContainer = vi.fn().mockResolvedValue('c1');
        const service = new QuickStartServiceImpl(runtimeFor({ createAndRunContainer }));

        await collect(service.provision(new AbortController().signal));

        const labels = (createAndRunContainer.mock.calls[0][0] as { labels: Record<string, string> }).labels;
        expect(labels[QUICK_START_LABEL_KEY]).toBe('1');
        expect(labels[QUICK_START_ALIAS_LABEL_KEY]).toBe(DEFAULT_ALIAS);
        expect(labels[QUICK_START_OPERATION_LABEL_KEY]).toMatch(/^[0-9a-f]{16}$/);
    });

    // L3: typing the default port used to be indistinguishable from "not set", which silently
    // turned the exact-port contract into the auto-relocating one.
    it('honours an explicit default port exactly instead of relocating (L3)', async () => {
        const service = new QuickStartServiceImpl(runtimeFor({ portFree: false }));

        const events = await collect(service.provision(new AbortController().signal, { port: QUICK_START_PORT }));

        expect(events.at(-1)).toMatchObject({ stage: 'checking', status: 'error' });
        expect(events.at(-1)?.message).toEqual({ key: 'portInUse', port: QUICK_START_PORT });
        expect(service.getStatus().state).toBe(InstanceState.Error);
    });

    it('binds the requested port rather than the canonical one', async () => {
        const createAndRunContainer = vi.fn().mockResolvedValue('c1');
        const service = new QuickStartServiceImpl(runtimeFor({ createAndRunContainer }));

        await collect(service.provision(new AbortController().signal, { port: 10333 }));

        expect((createAndRunContainer.mock.calls[0][0] as { hostPort: number }).hostPort).toBe(10333);
    });

    describe('sample data initialization', () => {
        it('detects environment-based passwords for 0.116 while preserving older image tags', async () => {
            const runtime = runtimeFor();
            const service = new QuickStartServiceImpl(runtime);

            const events = await collect(service.provision(new AbortController().signal, { port: 10333 }));

            expect(runtime.execShellInContainer).toHaveBeenCalledWith(
                'c1',
                'init_help="$(/home/documentdb/gateway/scripts/init_documentdb_data.sh --help)" || exit $?; ' +
                    'case "$init_help" in ' +
                    '*DOCUMENTDB_PASSWORD*) DOCUMENTDB_PASSWORD="$PASSWORD" /home/documentdb/gateway/scripts/init_documentdb_data.sh -H localhost -P 10260 -u "$USERNAME" -d /home/documentdb/gateway/sample-data ;; ' +
                    '*) /home/documentdb/gateway/scripts/init_documentdb_data.sh -H localhost -P 10260 -u "$USERNAME" -d /home/documentdb/gateway/sample-data -p "$PASSWORD" ;; ' +
                    'esac',
                expect.any(Array),
                expect.anything(),
            );
            expect(events.at(-1)).toMatchObject({ stage: 'done', status: 'done' });
        });

        it('finishes loading sample data before reporting the instance as running', async () => {
            const runtime = runtimeFor();
            const service = new QuickStartServiceImpl(runtime);
            let seeded = false;
            vi.spyOn(runtime, 'execShellInContainer').mockImplementation(async () => {
                await Promise.resolve();
                expect(service.getStatus().state).not.toBe(InstanceState.Running);
                seeded = true;
            });

            for await (const event of service.provision(new AbortController().signal)) {
                if (event.stage === 'done') {
                    expect(seeded).toBe(true);
                }
            }

            expect(seeded).toBe(true);
            expect(service.getStatus().state).toBe(InstanceState.Running);
            expect(runtime.createAndRunContainer).toHaveBeenCalledWith(
                expect.not.objectContaining({ command: expect.anything() }),
                expect.any(Array),
                expect.anything(),
            );
        });

        it('does not load sample data when the user disables it', async () => {
            const runtime = runtimeFor();
            const service = new QuickStartServiceImpl(runtime);

            const events = await collect(service.provision(new AbortController().signal, { loadSampleData: false }));

            expect(runtime.execShellInContainer).not.toHaveBeenCalled();
            expect(service.getStatus().state).toBe(InstanceState.Running);
            expect(events.find((event) => event.stage === 'waiting' && event.status === 'done')?.facts).toMatchObject({
                sampleData: 'notRequested',
            });
        });

        // #946 DATA-4: a reused volume already had its first setup; re-seeding would bring back
        // sample documents the user deleted.
        // Retained credentials alone (e.g. Start over after a timeout removed the volume) still seed.
        it.each([
            ['does not seed a reused data volume', true, 0],
            ['seeds when the stored credentials outlived their volume', false, 1],
        ])('%s', async (_label, volumeExists, seedCalls) => {
            await upsertInstance({
                alias: DEFAULT_ALIAS,
                displayName: 'DocumentDB Local',
                port: QUICK_START_PORT,
                phase: 'ready',
            });
            await writeConnectionString(
                DEFAULT_ALIAS,
                `mongodb://old:old@localhost:${QUICK_START_PORT}/?tls=true&tlsAllowInvalidCertificates=true`,
                { displayName: 'DocumentDB Local', port: QUICK_START_PORT },
            );
            const runtime = runtimeFor({ volumeExists });
            const service = new QuickStartServiceImpl(runtime);

            const events = await collect(service.provision(new AbortController().signal));

            expect(runtime.execShellInContainer).toHaveBeenCalledTimes(seedCalls);
            expect(service.getStatus().state).toBe(InstanceState.Running);
            expect(events.find((event) => event.stage === 'waiting' && event.status === 'done')?.facts).toMatchObject({
                sampleData: volumeExists ? 'keptExisting' : 'loaded',
            });
        });

        it('keeps the database usable without retrying a failed sample load', async () => {
            const runtime = runtimeFor();
            vi.spyOn(runtime, 'execShellInContainer').mockRejectedValue(new Error('initialization failed'));
            const service = new QuickStartServiceImpl(runtime);

            const events = await collect(service.provision(new AbortController().signal));

            expect(runtime.execShellInContainer).toHaveBeenCalledTimes(1);
            expect(events.at(-1)).toMatchObject({ stage: 'done', status: 'done' });
            expect(service.getStatus().state).toBe(InstanceState.Running);
            expect(events.find((event) => event.stage === 'waiting' && event.status === 'done')?.facts).toMatchObject({
                sampleData: 'failed',
            });
        });
    });

    describe('readiness evidence', () => {
        it('keeps the first two retry delays at 500ms and 750ms while counting every attempt', async () => {
            vi.useFakeTimers();
            try {
                let enteredProbe: () => void = () => undefined;
                const entered = new Promise<void>((resolve) => {
                    enteredProbe = resolve;
                });
                onProbe = () => {
                    enteredProbe();
                    if (connectProbe.mock.calls.length < 3) throw new Error('not ready');
                };
                const eventsPromise = collect(
                    new QuickStartServiceImpl(runtimeFor()).provision(new AbortController().signal),
                );
                await entered;
                await vi.advanceTimersByTimeAsync(0);
                expect(connectProbe).toHaveBeenCalledTimes(1);
                await vi.advanceTimersByTimeAsync(499);
                expect(connectProbe).toHaveBeenCalledTimes(1);
                await vi.advanceTimersByTimeAsync(1);
                expect(connectProbe).toHaveBeenCalledTimes(2);
                await vi.advanceTimersByTimeAsync(749);
                expect(connectProbe).toHaveBeenCalledTimes(2);
                await vi.advanceTimersByTimeAsync(1);
                const events = await eventsPromise;
                expect(connectProbe).toHaveBeenCalledTimes(3);
                expect(closeProbe).toHaveBeenCalledTimes(3);
                expect(
                    events.find((event) => event.stage === 'waiting' && event.status === 'done')?.facts,
                ).toMatchObject({ kind: 'waiting', attempts: 3 });
            } finally {
                vi.useRealTimers();
            }
        });

        it('counts the successful attempt and reads hello once on the same client', async () => {
            let attempts = 0;
            onProbe = () => {
                if (++attempts < 2) throw new Error('not ready');
            };
            onHello = () => ({
                internal: { documentdb_versions: ['0.116.0', '0.115.0'] },
                maxWireVersion: 21,
                password: 'must-not-copy',
                environmentVariables: { PASSWORD: 'must-not-copy' },
            });
            const runtime = runtimeFor();
            const events = await collect(new QuickStartServiceImpl(runtime).provision(new AbortController().signal));
            const facts = events.find((event) => event.stage === 'waiting' && event.status === 'done')?.facts;
            expect(facts).toEqual({
                kind: 'waiting',
                port: QUICK_START_PORT,
                attempts: 2,
                documentdbVersions: ['0.116.0', '0.115.0'],
                maxWireVersion: 21,
                displayName: 'DocumentDB Local',
                sampleData: 'loaded',
            });
            expect(connectProbe).toHaveBeenCalledTimes(2);
            expect(probeCommand.mock.calls).toEqual([[{ ping: 1 }], [{ hello: 1 }]]);
            expect(closeProbe).toHaveBeenCalledTimes(2);
            expect(JSON.stringify(facts)).not.toContain('must-not-copy');
        });

        it.each([
            [{ maxWireVersion: 21 }, undefined, 21],
            [
                { version: '7.0', internal: { documentdb_versions: ['0.116.0', 7] }, maxWireVersion: -1 },
                undefined,
                undefined,
            ],
            [
                { internal: { documentdb_versions: '0.116.0' }, maxWireVersion: Number.POSITIVE_INFINITY },
                undefined,
                undefined,
            ],
            [
                {
                    internal: { documentdb_versions: Array.from({ length: 10 }, (_, index) => String(index)) },
                    maxWireVersion: 1.5,
                },
                Array.from({ length: 8 }, (_, index) => String(index)),
                undefined,
            ],
        ])('omits unestablished server facts and bounds version evidence (%j)', async (hello, versions, wire) => {
            onHello = () => hello;
            const events = await collect(
                new QuickStartServiceImpl(runtimeFor()).provision(new AbortController().signal),
            );
            const facts = events.find((event) => event.stage === 'waiting' && event.status === 'done')?.facts;
            expect(facts).toMatchObject({ attempts: 1, documentdbVersions: versions, maxWireVersion: wire });
            expect(closeProbe).toHaveBeenCalledTimes(1);
        });

        it('does not retry a successful ping when hello rejects', async () => {
            onHello = () => Promise.reject(new Error('hello unavailable'));
            const events = await collect(
                new QuickStartServiceImpl(runtimeFor()).provision(new AbortController().signal),
            );
            expect(events.at(-1)?.stage).toBe('done');
            const facts = events.find((event) => event.stage === 'waiting' && event.status === 'done')?.facts;
            expect(facts).toMatchObject({ attempts: 1 });
            if (facts?.kind !== 'waiting') throw new Error('Missing waiting facts');
            expect(facts.documentdbVersions).toBeUndefined();
            expect(facts.maxWireVersion).toBeUndefined();
            expect(connectProbe).toHaveBeenCalledTimes(1);
            expect(probeCommand.mock.calls).toEqual([[{ ping: 1 }], [{ hello: 1 }]]);
            expect(closeProbe).toHaveBeenCalledTimes(1);
        });

        it.each([false, true])('cleans up a hung hello on timeout or cancellation (cancel=%s)', async (cancel) => {
            vi.useFakeTimers();
            try {
                let enteredHello: () => void = () => undefined;
                const entered = new Promise<void>((resolve) => {
                    enteredHello = resolve;
                });
                onHello = () => {
                    enteredHello();
                    return new Promise<never>(() => undefined);
                };
                const controller = new AbortController();
                const eventsPromise = collect(new QuickStartServiceImpl(runtimeFor()).provision(controller.signal));
                await entered;
                if (cancel) controller.abort();
                else await vi.advanceTimersByTimeAsync(2000);
                const events = await eventsPromise;
                expect(events.at(-1)?.stage).toBe(cancel ? 'error' : 'done');
                expect(connectProbe).toHaveBeenCalledTimes(1);
                expect(probeCommand.mock.calls).toEqual([[{ ping: 1 }], [{ hello: 1 }]]);
                expect(closeProbe).toHaveBeenCalledTimes(1);
                expect(vi.getTimerCount()).toBe(0);
            } finally {
                vi.useRealTimers();
            }
        });
    });

    // M5/3b: the port is pre-checked before the pull, which can take minutes — so a bind failure at
    // create time is a real (if rare) outcome and must not leak the raw daemon string.
    it('reports a Docker port-allocation failure in the same words as the pre-check (M5)', async () => {
        const service = new QuickStartServiceImpl(
            runtimeFor({
                createAndRunContainer: vi
                    .fn()
                    .mockRejectedValue(new Error('Bind for 127.0.0.1:10260 failed: port is already allocated')),
            }),
        );

        const events = await collect(service.provision(new AbortController().signal));

        expect(events.at(-1)?.message).toEqual({ key: 'portInUse', port: QUICK_START_PORT });
        // The daemon's own wording never rides along: a keyed message has nowhere to put it.
        expect(events.at(-1)?.message?.detail).toBeUndefined();
        // Read after the rollback: nothing was created, so Configure must not offer to keep data.
        expect(events.at(-1)?.canReuseExistingData).toBe(false);
    });

    // #948 ERR-1: Docker's stderr used to be dropped, so every failure read "Process exited with code N".
    describe('Docker command failures', () => {
        it('recognizes the port bind failure Docker actually prints', async () => {
            const service = new QuickStartServiceImpl(
                runtimeFor({
                    createAndRunContainer: vi
                        .fn()
                        .mockRejectedValue(
                            new DockerCommandError(
                                125,
                                "docker: Error response from daemon: ports are not available: exposing port TCP 127.0.0.1:10260 -> 127.0.0.1:0: listen tcp4 127.0.0.1:10260: bind: address already in use\n\nRun 'docker run --help' for more information\n",
                            ),
                        ),
                }),
            );

            const events = await collect(service.provision(new AbortController().signal));

            expect(events.at(-1)?.message).toEqual({ key: 'portInUse', port: QUICK_START_PORT });
        });

        it('passes on what Docker said for any other create failure', async () => {
            const service = new QuickStartServiceImpl(
                runtimeFor({
                    createAndRunContainer: vi
                        .fn()
                        .mockRejectedValue(
                            new DockerCommandError(
                                125,
                                'docker: Error response from daemon: Conflict. The container name "/vscode-documentdb-local" is already in use by container "7f3a".\n',
                            ),
                        ),
                }),
            );

            const events = await collect(service.provision(new AbortController().signal));

            expect(events.at(-1)?.message).toEqual({
                key: 'unexpectedFailure',
                detail: 'Conflict. The container name "/vscode-documentdb-local" is already in use by container "7f3a".',
            });
        });

        it('names the image when the registry has no such tag', async () => {
            const service = new QuickStartServiceImpl(
                runtimeFor({
                    overrides: {
                        pullImage: vi
                            .fn()
                            .mockRejectedValue(
                                new DockerCommandError(1, 'Error response from daemon: manifest unknown\n'),
                            ),
                    },
                }),
            );

            const events = await collect(
                service.provision(new AbortController().signal, { imageTag: '0.117.0-nope', port: QUICK_START_PORT }),
            );

            expect(events.at(-1)?.message).toEqual({
                key: 'imageNotFound',
                image: `${QUICK_START_IMAGE_REPOSITORY}:0.117.0-nope`,
            });
        });

        it('leaves the default image failure in Docker own words, since there is no tag to fix', async () => {
            const service = new QuickStartServiceImpl(
                runtimeFor({
                    overrides: {
                        pullImage: vi
                            .fn()
                            .mockRejectedValue(
                                new DockerCommandError(1, 'Error response from daemon: manifest unknown\n'),
                            ),
                    },
                }),
            );

            const events = await collect(service.provision(new AbortController().signal));

            expect(events.at(-1)?.message).toEqual({ key: 'unexpectedFailure', detail: 'manifest unknown' });
        });

        it('does not blame the tag for a pull failure that only mentions "not found"', async () => {
            const service = new QuickStartServiceImpl(
                runtimeFor({
                    overrides: {
                        pullImage: vi
                            .fn()
                            .mockRejectedValue(
                                new DockerCommandError(
                                    1,
                                    'error getting credentials - err: exec: "docker-credential-desktop.exe": executable file not found in $PATH, out: ``\n',
                                ),
                            ),
                    },
                }),
            );

            const events = await collect(service.provision(new AbortController().signal));

            expect(events.at(-1)?.message?.key).toBe('unexpectedFailure');
            expect(events.at(-1)?.message?.detail).toContain('docker-credential-desktop.exe');
        });

        // ERR-3: `docker run` can hang forever on Docker Desktop (e.g. port 65535).
        it('reports a create deadline and removes, within a bound, whatever the killed run left behind', async () => {
            const listByLabel = vi.fn().mockResolvedValue([]);
            const removeContainer = vi.fn().mockResolvedValue(undefined);
            const service = new QuickStartServiceImpl(
                runtimeFor({
                    createAndRunContainer: vi.fn().mockRejectedValue(new DockerCommandTimeoutError(90_000)),
                    listByLabel,
                    overrides: { removeContainer },
                }),
            );
            listByLabel.mockImplementation((labels: Record<string, string>) =>
                Promise.resolve(labels[QUICK_START_OPERATION_LABEL_KEY] ? [{ id: 'half-created' }] : []),
            );

            const events = await collect(service.provision(new AbortController().signal));

            expect(events.at(-1)).toMatchObject({ stage: 'error', message: { key: 'createTimedOut' } });
            expect(events.at(-1)?.timedOut).toBeUndefined();
            const cleanupBounds = { timeoutMs: SETUP_CLEANUP_TIMEOUT_MS };
            expect(listByLabel).toHaveBeenCalledWith(expect.anything(), cleanupBounds);
            expect(removeContainer).toHaveBeenCalledWith('half-created', undefined, cleanupBounds);
        });
    });

    // #948 ERR-2: these used to retry for the full three minutes, then offer "Wait longer".
    describe('readiness failures that waiting cannot fix', () => {
        function exitedContainerRuntime(logs: string): IContainerRuntime {
            let inspections = 0;
            return runtimeFor({
                overrides: {
                    // Running when setup confirms the start, exited by the first readiness probe.
                    inspectContainer: vi.fn(() => {
                        inspections += 1;
                        return Promise.resolve({
                            id: 'c1',
                            status: inspections === 1 ? 'running' : 'exited',
                            ports: [{ containerPort: QUICK_START_PORT, hostPort: QUICK_START_PORT }],
                            raw: JSON.stringify({ State: { Status: 'exited', ExitCode: 1 } }),
                        });
                    }) as unknown as IContainerRuntime['inspectContainer'],
                    readRecentLogs: vi.fn().mockResolvedValue(logs),
                },
            });
        }

        it('fails at once with the exit code and the log line that explains it', async () => {
            onProbe = () => {
                throw new Error('connect ECONNREFUSED 127.0.0.1:10260');
            };
            const runtime = exitedContainerRuntime(
                "Using username: documentdb\nError: username 'documentdb' uses reserved prefix 'documentdb'.\nChoose a username that does not begin with any of: documentdb, citus, pg, internal_role.\n",
            );
            const service = new QuickStartServiceImpl(runtime);

            const events = await collect(service.provision(new AbortController().signal));

            expect(events.at(-1)).toMatchObject({
                stage: 'error',
                message: {
                    key: 'containerExited',
                    exitCode: 1,
                    detail: "username 'documentdb' uses reserved prefix 'documentdb'.",
                },
            });
            expect(events.at(-1)?.timedOut).toBeUndefined();
            // A dead container is discarded like any failed attempt, not kept for "Wait longer".
            expect(runtime.removeContainer).toHaveBeenCalledWith('c1', undefined, undefined);
            expect(service.getStatus().canResumeReadiness).toBe(false);
            expect(events.at(-1)?.facts).toMatchObject({
                kind: 'waiting',
                port: QUICK_START_PORT,
                attempts: 1,
                lastProbeError: 'connect ECONNREFUSED 127.0.0.1:10260',
                exitCode: 1,
                lastLogLine: "username 'documentdb' uses reserved prefix 'documentdb'.",
            });
        });

        it('masks and bounds failed probe and exited-container evidence without copying URIs', async () => {
            const password = 'private-password-123';
            onProbe = () => {
                throw new Error(`probe failed mongodb://test:${password}@localhost:10260/ ${password}`);
            };
            const runtime = exitedContainerRuntime(
                `Error: ${password} mongodb://test:${password}@localhost:10260/ ${'x'.repeat(1500)}`,
            );
            const events = await collect(
                new QuickStartServiceImpl(runtime).provision(new AbortController().signal, {
                    username: 'test',
                    password,
                }),
            );
            const facts = events.at(-1)?.facts;
            expect(facts).toMatchObject({ kind: 'waiting', attempts: 1, exitCode: 1 });
            expect(JSON.stringify(facts)).not.toContain(password);
            expect(JSON.stringify(facts)).not.toContain('mongodb://');
            if (facts?.kind !== 'waiting') throw new Error('Missing waiting facts');
            expect(facts.lastProbeError).toContain('***');
            expect(facts.lastLogLine).toContain('***');
            expect(facts.lastLogLine).toHaveLength(1000);
            expect(facts.displayName).toBeUndefined();
            expect(facts.sampleData).toBeUndefined();
        });

        // A healthy gateway logs timestamped ERROR lines too; they must not pose as the exit reason.
        it('does not blame a routine gateway error line for a killed container', async () => {
            onProbe = () => {
                throw new Error('connect ECONNREFUSED 127.0.0.1:10260');
            };
            const service = new QuickStartServiceImpl(
                exitedContainerRuntime(
                    '2026-09-23T01:39:39.837928Z ERROR documentdb_gateway_core::runtime::v1: Failed to accept a TCP connection (IPv6)\n',
                ),
            );

            const events = await collect(service.provision(new AbortController().signal));

            expect(events.at(-1)?.message).toEqual({ key: 'containerExited', exitCode: 1, detail: undefined });
        });

        function rejectCredentials(): never {
            throw Object.assign(new Error('Invalid account: User details not found in the database'), {
                code: 18,
                codeName: 'AuthenticationFailed',
            });
        }

        it('treats credentials the server keeps rejecting as final, pointing at the ones the user typed', async () => {
            onProbe = rejectCredentials;
            const runtime = runtimeFor();
            const service = new QuickStartServiceImpl(runtime);

            const events = await collect(
                service.provision(new AbortController().signal, { username: 'x'.repeat(64), password: 'pw' }),
            );

            expect(events.at(-1)?.message).toEqual({
                key: 'credentialsRejected',
                detail: 'Invalid account: User details not found in the database',
            });
            expect(events.at(-1)?.facts).toMatchObject({ kind: 'waiting', attempts: 2 });
            expect(runtime.removeContainer).toHaveBeenCalledWith('c1', undefined, undefined);
        });

        // A recreate keeps the data and its saved credentials; Configure has nothing to edit there.
        it('words a rejection of saved credentials around the existing data', async () => {
            await upsertInstance({
                alias: DEFAULT_ALIAS,
                displayName: 'DocumentDB Local',
                port: QUICK_START_PORT,
                phase: 'ready',
            });
            await writeConnectionString(
                DEFAULT_ALIAS,
                `mongodb://saved:saved@localhost:${QUICK_START_PORT}/?tls=true&tlsAllowInvalidCertificates=true`,
                { displayName: 'DocumentDB Local', port: QUICK_START_PORT },
            );
            onProbe = rejectCredentials;
            const service = new QuickStartServiceImpl(runtimeFor());

            const events = await collect(service.provision(new AbortController().signal));

            expect(events.at(-1)?.message?.key).toBe('savedCredentialsRejected');
        });

        it('retries a single rejection, in case the gateway answered before the user existed', async () => {
            let probes = 0;
            onProbe = () => {
                probes += 1;
                if (probes === 1) {
                    rejectCredentials();
                }
            };
            const service = new QuickStartServiceImpl(runtimeFor());

            const events = await collect(service.provision(new AbortController().signal));

            expect(events.at(-1)).toMatchObject({ stage: 'done', status: 'done' });
        });

        it('treats a mixed-direction password SASLprep refuses as final', async () => {
            onProbe = () => {
                throw new Error(
                    'String must not contain RandALCat and LCat at the same time, see https://tools.ietf.org/html/rfc3454#section-6',
                );
            };
            const service = new QuickStartServiceImpl(runtimeFor());

            const events = await collect(service.provision(new AbortController().signal));

            expect(events.at(-1)?.message).toEqual({ key: 'passwordNotSupported' });
        });

        it('treats a password SASLprep refuses as final', async () => {
            onProbe = () => {
                throw new Error('Unassigned code point, see https://tools.ietf.org/html/rfc4013#section-2.5');
            };
            const service = new QuickStartServiceImpl(runtimeFor());

            const events = await collect(service.provision(new AbortController().signal));

            expect(events.at(-1)?.message).toEqual({ key: 'passwordNotSupported' });
        });

        // A timed-out attempt keeps its credentials and data, so Configure offers reuse and hides the fields.
        it('words a rejection after Wait longer around the saved data', async () => {
            const realNow = Date.now.bind(Date);
            let skipped = 0;
            const now = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + skipped);
            try {
                onProbe = () => {
                    skipped += 200_000;
                    throw new Error('connect ECONNREFUSED 127.0.0.1:10260');
                };
                const service = new QuickStartServiceImpl(runtimeFor());
                const first = await collect(service.provision(new AbortController().signal));
                expect(first.at(-1)?.timedOut).toBe(true);

                onProbe = rejectCredentials;
                const resumed = await collect(service.resumeReadiness(new AbortController().signal));

                expect(resumed.at(-1)?.message?.key).toBe('savedCredentialsRejected');
            } finally {
                now.mockRestore();
            }
        });

        it('words a saved password SASLprep refuses around the existing data', async () => {
            await upsertInstance({
                alias: DEFAULT_ALIAS,
                displayName: 'DocumentDB Local',
                port: QUICK_START_PORT,
                phase: 'ready',
            });
            await writeConnectionString(
                DEFAULT_ALIAS,
                `mongodb://saved:saved@localhost:${QUICK_START_PORT}/?tls=true&tlsAllowInvalidCertificates=true`,
                { displayName: 'DocumentDB Local', port: QUICK_START_PORT },
            );
            onProbe = () => {
                throw new Error('Unassigned code point, see https://tools.ietf.org/html/rfc4013#section-2.5');
            };
            const service = new QuickStartServiceImpl(runtimeFor());

            const events = await collect(service.provision(new AbortController().signal));

            expect(events.at(-1)?.message?.key).toBe('savedCredentialsRejected');
        });
    });

    // A host killed after `docker run` but before the old post-start write left a labelled container
    // nothing could open, "Provisioning…" for the lease TTL, and a setup that refused to run.
    it('stores the credentials before `docker run`, so a crash mid-create leaves an adoptable container', async () => {
        let secretAtCreate: string | undefined;
        const createAndRunContainer = vi.fn(async () => {
            secretAtCreate = await readConnectionString(DEFAULT_ALIAS);
            return 'c1';
        });
        const service = new QuickStartServiceImpl(runtimeFor({ createAndRunContainer }));

        await collect(service.provision(new AbortController().signal));

        expect(secretAtCreate).toContain(`localhost:${QUICK_START_PORT}`);
    });

    // With the write now ahead of `docker run`, the loser of a two-window create race reaches the
    // restore too; it must not erase the credentials the winner stored meanwhile.
    it('leaves another window credentials alone when its own create fails', async () => {
        const winner = `mongodb://winner:pw@localhost:${QUICK_START_PORT}/?tls=true&tlsAllowInvalidCertificates=true`;
        const service = new QuickStartServiceImpl(
            runtimeFor({
                createAndRunContainer: vi.fn(async () => {
                    // The winner renews the lease as its own, then stores its credentials.
                    await upsertInstance({
                        alias: DEFAULT_ALIAS,
                        displayName: 'DocumentDB Local',
                        port: QUICK_START_PORT,
                        phase: 'provisioning',
                        operationId: 'other-window',
                        leaseAt: Date.now(),
                    });
                    await writeConnectionString(DEFAULT_ALIAS, winner, {
                        displayName: 'DocumentDB Local',
                        port: QUICK_START_PORT,
                    });
                    throw new Error('The container name "/vscode-documentdb-local" is already in use');
                }),
            }),
        );

        await collect(service.provision(new AbortController().signal));

        expect(await readConnectionString(DEFAULT_ALIAS)).toBe(winner);
    });

    // Same race, but the winner stored its credentials on a record that still names this run's lease.
    it('keeps the lease record when another window stored its credentials on it', async () => {
        const winner = `mongodb://winner:pw@localhost:${QUICK_START_PORT}/?tls=true&tlsAllowInvalidCertificates=true`;
        const service = new QuickStartServiceImpl(
            runtimeFor({
                createAndRunContainer: vi.fn(async () => {
                    await writeConnectionString(DEFAULT_ALIAS, winner, {
                        displayName: 'DocumentDB Local',
                        port: QUICK_START_PORT,
                    });
                    throw new Error('The container name "/vscode-documentdb-local" is already in use');
                }),
            }),
        );

        await collect(service.provision(new AbortController().signal));

        expect(await readConnectionString(DEFAULT_ALIAS)).toBe(winner);
    });

    // Start fresh wipes the old volume before anything else can fail; restoring the old record and
    // credentials afterwards would describe data that no longer exists.
    it('leaves nothing of the replaced instance when Start fresh fails after the wipe', async () => {
        await upsertInstance({ alias: DEFAULT_ALIAS, displayName: 'DocumentDB Local', port: 10260, phase: 'ready' });
        await writeConnectionString(
            DEFAULT_ALIAS,
            `mongodb://old:old@localhost:${QUICK_START_PORT}/?tls=true&tlsAllowInvalidCertificates=true`,
            { displayName: 'DocumentDB Local', port: QUICK_START_PORT },
        );
        const service = new QuickStartServiceImpl(
            runtimeFor({
                volumeExists: true,
                createAndRunContainer: vi.fn().mockRejectedValue(new Error('create blew up')),
            }),
        );

        await collect(service.provision(new AbortController().signal, { startFresh: true }));

        expect(await listInstances()).toHaveLength(0);
        expect(await service.canReuseExistingData()).toBe(false);
    });

    it('replaces the old instance when Start fresh succeeds', async () => {
        const old = `mongodb://old:old@localhost:${QUICK_START_PORT}/?tls=true&tlsAllowInvalidCertificates=true`;
        await upsertInstance({ alias: DEFAULT_ALIAS, displayName: 'DocumentDB Local', port: 10260, phase: 'ready' });
        await writeConnectionString(DEFAULT_ALIAS, old, { displayName: 'DocumentDB Local', port: QUICK_START_PORT });
        const service = new QuickStartServiceImpl(runtimeFor({ volumeExists: true }));

        await collect(service.provision(new AbortController().signal, { startFresh: true }));

        expect(service.getStatus().state).toBe(InstanceState.Running);
        expect((await getInstance(DEFAULT_ALIAS))?.phase).toBe('ready');
        const stored = await readConnectionString(DEFAULT_ALIAS);
        expect(stored).toBeDefined();
        expect(stored).not.toBe(old);
    });

    it('does not adopt its own in-flight container when a reconcile runs mid-provision', async () => {
        const live: Array<{ id: string; labels: Record<string, string> }> = [];
        let phaseAfterReconcile: string | undefined;
        const service = new QuickStartServiceImpl(
            runtimeFor({
                listByLabel: vi.fn(() => Promise.resolve(live)),
                createAndRunContainer: vi.fn(() => {
                    live.push({ id: 'c1', labels: { [QUICK_START_ALIAS_LABEL_KEY]: DEFAULT_ALIAS } });
                    return Promise.resolve('c1');
                }),
            }),
        );
        onProbe = async () => {
            if (phaseAfterReconcile === undefined) {
                await service.reconcile();
                phaseAfterReconcile = (await getInstance(DEFAULT_ALIAS))?.phase;
            }
        };

        await collect(service.provision(new AbortController().signal));

        expect(phaseAfterReconcile).toBe('provisioning');
        expect(service.getStatus().state).toBe(InstanceState.Running);
    });

    describe('once the old container and its data are gone', () => {
        const stale = `mongodb://u1:p1@localhost:${QUICK_START_PORT}/?tls=true&tlsAllowInvalidCertificates=true`;

        async function seedRemovedInstance(runtime: IContainerRuntime): Promise<QuickStartServiceImpl> {
            await upsertInstance({
                alias: DEFAULT_ALIAS,
                displayName: 'DocumentDB Local',
                port: 10260,
                phase: 'ready',
            });
            await writeConnectionString(DEFAULT_ALIAS, stale, { displayName: 'DocumentDB Local', port: 10260 });
            const service = new QuickStartServiceImpl(runtime);
            await service.reconcile();
            expect(await service.canReuseExistingData()).toBe(false);
            return service;
        }

        // A Docker pointed back at the original engine must still open the original instance.
        it('sets up a new instance on the stored credentials', async () => {
            const service = await seedRemovedInstance(runtimeFor({ volumeExists: false }));

            await collect(service.provision(new AbortController().signal, { imageTag: '0.117.0' }));

            expect(await readConnectionString(DEFAULT_ALIAS)).toBe(stale);
            expect(service.getStatus().metadata?.imageRef).toContain(':0.117.0');
            expect(service.getStatus().state).toBe(InstanceState.Running);
        });

        it('keeps the stored credentials when that setup is cancelled', async () => {
            const controller = new AbortController();
            const runtime = runtimeFor({ volumeExists: false });
            (runtime.pullImage as Mock).mockImplementation(() => {
                controller.abort();
                return Promise.reject(new Error('aborted'));
            });
            const service = await seedRemovedInstance(runtime);

            await collect(service.provision(controller.signal));

            expect(await readConnectionString(DEFAULT_ALIAS)).toBe(stale);
        });

        it('keeps the stored credentials when a setup with custom ones is cancelled', async () => {
            const controller = new AbortController();
            const runtime = runtimeFor({ volumeExists: false });
            (runtime.pullImage as Mock).mockImplementation(() => {
                controller.abort();
                return Promise.reject(new Error('aborted'));
            });
            const service = await seedRemovedInstance(runtime);

            await collect(service.provision(controller.signal, { username: 'me', password: 'secret-pw' }));

            expect(await readConnectionString(DEFAULT_ALIAS)).toBe(stale);
        });

        it('uses custom credentials when the user sets them', async () => {
            const service = await seedRemovedInstance(runtimeFor({ volumeExists: false }));

            await collect(service.provision(new AbortController().signal, { username: 'me', password: 'secret-pw' }));

            expect(await readConnectionString(DEFAULT_ALIAS)).toContain('me:secret-pw@');
        });
    });

    // A newer image updates the DocumentDB extensions on the volume it starts on, and older images
    // can't run that volume afterwards, so a recreate must never follow a tag that has moved.
    describe('recreating a container onto its existing data', () => {
        const pinned = `${QUICK_START_IMAGE_REPOSITORY}@sha256:${'a'.repeat(64)}`;
        const latest = `${QUICK_START_IMAGE_REPOSITORY}:latest`;

        async function seedMissingInstance(imageRef: string | undefined, engineCli?: ContainerCli): Promise<void> {
            await upsertInstance({
                alias: DEFAULT_ALIAS,
                displayName: 'DocumentDB Local',
                port: QUICK_START_PORT,
                phase: 'ready',
                imageRef,
                engineCli,
            });
            await writeConnectionString(
                DEFAULT_ALIAS,
                `mongodb://u1:p1@localhost:${QUICK_START_PORT}/?tls=true&tlsAllowInvalidCertificates=true`,
                { displayName: 'DocumentDB Local', port: QUICK_START_PORT },
            );
        }

        function createdFrom(runtime: IContainerRuntime): unknown {
            return (runtime.createAndRunContainer as Mock).mock.calls[0]?.[0]?.imageRef;
        }

        // As the runtime answers: a missing tag is provably absent, a missing digest only unknown.
        function imagePruned(): Partial<IContainerRuntime> {
            return {
                inspectImage: vi.fn((ref: string) =>
                    Promise.resolve(ref.includes('@') ? undefined : ('absent' as const)),
                ),
            };
        }

        it('stores the digest of the image a new instance runs on', async () => {
            const inspectImage = vi.fn((ref: string, _token?: unknown, repository?: string) =>
                Promise.resolve(
                    ref === 'sha256:image-id' && repository === QUICK_START_IMAGE_REPOSITORY
                        ? { id: ref, digest: `sha256:${'a'.repeat(64)}` }
                        : { id: 'sha256:image-id' },
                ),
            );
            const runtime = runtimeFor({
                overrides: {
                    inspectContainer: vi.fn().mockResolvedValue({
                        id: 'c1',
                        status: 'running',
                        imageId: 'sha256:image-id',
                        ports: [{ containerPort: QUICK_START_PORT, hostPort: QUICK_START_PORT }],
                    }),
                    inspectImage,
                },
            });
            const service = new QuickStartServiceImpl(runtime);

            await collect(service.provision(new AbortController().signal));

            expect(runtime.pullImage).toHaveBeenCalledWith(latest, expect.anything(), expect.any(Function));
            expect((await getInstance(DEFAULT_ALIAS))?.imageRef).toBe(pinned);
            expect(service.getStatus().metadata?.imageRef).toBe(pinned);
        });

        it('runs the pinned image without pulling while it is still on this machine', async () => {
            await seedMissingInstance(pinned);
            const runtime = runtimeFor({
                volumeExists: true,
                overrides: { inspectImage: vi.fn().mockResolvedValue({ id: 'sha256:image-id' }) },
            });
            const service = new QuickStartServiceImpl(runtime);

            const events = await collect(service.provision(new AbortController().signal));

            expect(runtime.pullImage).not.toHaveBeenCalled();
            expect(createdFrom(runtime)).toBe(pinned);
            expect(service.getStatus().state).toBe(InstanceState.Running);
            // Nothing was checked against the registry, so the image is not reported as up to date.
            expect(events.find((event) => event.stage === 'pulling' && event.status === 'done')?.facts).toMatchObject({
                imageOrigin: 'reused',
                result: undefined,
            });
        });

        it('pulls the pinned digest, never the tag, once the image was pruned', async () => {
            await seedMissingInstance(pinned);
            const runtime = runtimeFor({ volumeExists: true, overrides: imagePruned() });
            const service = new QuickStartServiceImpl(runtime);

            await collect(service.provision(new AbortController().signal));

            expect(runtime.pullImage).toHaveBeenCalledWith(pinned, expect.anything(), expect.any(Function));
            expect(createdFrom(runtime)).toBe(pinned);
            expect((await getInstance(DEFAULT_ALIAS))?.imageRef).toBe(pinned);
        });

        it('runs a tag-only record from the local image without pulling', async () => {
            await seedMissingInstance(latest);
            const runtime = runtimeFor({
                volumeExists: true,
                overrides: { inspectImage: vi.fn().mockResolvedValue({ id: 'sha256:image-id' }) },
            });
            const service = new QuickStartServiceImpl(runtime);

            await collect(service.provision(new AbortController().signal));

            expect(runtime.pullImage).not.toHaveBeenCalled();
            expect(createdFrom(runtime)).toBe(latest);
            expect(service.getStatus().state).toBe(InstanceState.Running);
        });

        it.each([
            ['a tag-only record', latest, undefined, 'docker'],
            ['a record with no image', undefined, undefined, 'docker'],
            ['a tag-only Podman record', latest, 'podman', 'podman'],
        ] as const)(
            'stops before pulling for %s whose image is gone, keeping the data',
            async (_case, imageRef, engineCli, cli) => {
                await seedMissingInstance(imageRef, engineCli);
                const removeVolume = vi.fn().mockResolvedValue(undefined);
                const runtime = runtimeFor({ volumeExists: true, overrides: { ...imagePruned(), removeVolume } });
                const service = new QuickStartServiceImpl(runtime);

                const events = await collect(service.provision(new AbortController().signal));

                expect(runtime.pullImage).not.toHaveBeenCalled();
                expect(runtime.createAndRunContainer).not.toHaveBeenCalled();
                expect(removeVolume).not.toHaveBeenCalled();
                expect(events.at(-1)).toMatchObject({ stage: 'error', status: 'error', canReuseExistingData: true });
                expect(events.at(-1)?.message?.detail).toContain(`${cli} pull ${latest}`);
                expect(runtime.forCli).toHaveBeenCalledWith(expect.objectContaining({ cli }));
                expect(runtime.forCli).not.toHaveBeenCalledWith(
                    expect.objectContaining({ cli: cli === 'docker' ? 'podman' : 'docker' }),
                );
                expect(await getInstance(DEFAULT_ALIAS)).toMatchObject({ phase: 'ready', imageRef });
            },
        );

        it('pulls a tag-only record when its data volume is gone too, since there is nothing to upgrade', async () => {
            await seedMissingInstance(latest);
            const runtime = runtimeFor({ volumeExists: false, overrides: imagePruned() });
            const service = new QuickStartServiceImpl(runtime);

            await collect(service.provision(new AbortController().signal));

            expect(runtime.pullImage).toHaveBeenCalledWith(latest, expect.anything(), expect.any(Function));
            expect(service.getStatus().state).toBe(InstanceState.Running);
        });
    });

    describe('after a readiness timeout', () => {
        let nowSpy: MockInstance<(...args: []) => number>;

        beforeEach(() => {
            // Every probe fails and jumps the clock past the readiness deadline, so the wait times
            // out after one backoff instead of three minutes.
            const realNow = Date.now.bind(Date);
            let offset = 0;
            nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + offset);
            onProbe = () => {
                offset += 200_000;
                throw new Error('connect ECONNREFUSED');
            };
        });

        afterEach(() => {
            nowSpy.mockRestore();
        });

        async function provisionUntilTimeout(service: QuickStartServiceImpl, port?: number): Promise<void> {
            const events = await collect(
                service.provision(new AbortController().signal, port === undefined ? undefined : { port }),
            );
            expect(events.at(-1)).toMatchObject({ stage: 'waiting', status: 'error', timedOut: true });
            expect(service.getStatus().canResumeReadiness).toBe(true);
        }

        it.each([
            [false, true, false, 'loaded', 1],
            [false, false, false, 'notRequested', 0],
            [true, true, false, 'keptExisting', 0],
            [true, false, false, 'keptExisting', 0],
            [false, true, true, 'failed', 1],
        ] as const)(
            'reports fresh attempt counts and sample outcome on resume (reuse=%s, requested=%s, failed=%s)',
            async (reuse, requested, seedFails, outcome, seedCalls) => {
                if (reuse) {
                    await upsertInstance({
                        alias: DEFAULT_ALIAS,
                        displayName: 'DocumentDB Local',
                        port: QUICK_START_PORT,
                        phase: 'ready',
                    });
                    await writeConnectionString(
                        DEFAULT_ALIAS,
                        `mongodb://test:stored-password@localhost:${QUICK_START_PORT}/`,
                        {
                            displayName: 'DocumentDB Local',
                            port: QUICK_START_PORT,
                        },
                    );
                }
                const runtime = runtimeFor({ volumeExists: reuse });
                if (seedFails) vi.mocked(runtime.execShellInContainer).mockRejectedValue(new Error('seed failed'));
                const service = new QuickStartServiceImpl(runtime);
                const first = await collect(
                    service.provision(new AbortController().signal, { loadSampleData: requested }),
                );
                expect(first.at(-1)?.facts).toMatchObject({
                    kind: 'waiting',
                    port: QUICK_START_PORT,
                    attempts: 1,
                    lastProbeError: 'connect ECONNREFUSED',
                });
                expect(runtime.execShellInContainer).not.toHaveBeenCalled();
                const repeat = await collect(service.resumeReadiness(new AbortController().signal));
                expect(repeat.at(-1)?.facts).toMatchObject({ kind: 'waiting', attempts: 1 });
                expect(repeat.at(-1)?.timedOut).toBe(true);
                let attempts = 0;
                onProbe = () => {
                    if (++attempts < 2) throw new Error('not ready yet');
                };
                const resumed = await collect(service.resumeReadiness(new AbortController().signal));
                expect(resumed.at(-1)?.stage).toBe('done');
                expect(
                    resumed.find((event) => event.stage === 'waiting' && event.status === 'done')?.facts,
                ).toMatchObject({
                    kind: 'waiting',
                    port: QUICK_START_PORT,
                    attempts: 2,
                    sampleData: outcome,
                    displayName: 'DocumentDB Local',
                });
                expect(service.getStatus().state).toBe(InstanceState.Running);
                expect(runtime.execShellInContainer).toHaveBeenCalledTimes(seedCalls);
                expect(
                    (await collect(service.resumeReadiness(new AbortController().signal))).at(-1)?.message?.key,
                ).toBe('nothingToResume');
                expect(runtime.execShellInContainer).toHaveBeenCalledTimes(seedCalls);
            },
        );

        it('Start over drops a fresh attempt entirely: credentials, lease and data', async () => {
            const removeVolume = vi.fn().mockResolvedValue(undefined);
            const service = new QuickStartServiceImpl(runtimeFor({ overrides: { removeVolume } }));
            await provisionUntilTimeout(service);

            expect(await service.discardTimedOutInstance()).toBe(true);

            expect(removeVolume).toHaveBeenCalled();
            expect(await readConnectionString(DEFAULT_ALIAS)).toBeUndefined();
            expect(await listInstances()).toHaveLength(0);
            expect(await service.canReuseExistingData()).toBe(false);
            expect(service.getStatus()).toMatchObject({ state: InstanceState.NotInstalled, canResumeReadiness: false });
        });

        it('Start over warns when it cannot remove the fresh attempt data volume', async () => {
            const removeVolume = vi.fn().mockRejectedValue(new Error('volume is in use'));
            const service = new QuickStartServiceImpl(runtimeFor({ overrides: { removeVolume } }));
            await provisionUntilTimeout(service);
            const warning = vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined);

            expect(await service.discardTimedOutInstance()).toBe(true);

            expect(warning).toHaveBeenCalledWith(expect.stringContaining('could not remove its data volume'));
            expect(await readConnectionString(DEFAULT_ALIAS)).toBeUndefined();
            expect(await listInstances()).toHaveLength(0);
            warning.mockRestore();
        });

        it('Start over on a recreate keeps the data and its credentials, and settles as Missing', async () => {
            const previous = `mongodb://old:old@localhost:${QUICK_START_PORT}/?tls=true&tlsAllowInvalidCertificates=true`;
            await upsertInstance({
                alias: DEFAULT_ALIAS,
                displayName: 'DocumentDB Local',
                port: QUICK_START_PORT,
                phase: 'ready',
            });
            await writeConnectionString(DEFAULT_ALIAS, previous, {
                displayName: 'DocumentDB Local',
                port: QUICK_START_PORT,
            });
            const removeVolume = vi.fn().mockResolvedValue(undefined);
            const service = new QuickStartServiceImpl(runtimeFor({ volumeExists: true, overrides: { removeVolume } }));
            // A different port, so the attempt's own connection string differs from the stored one.
            await provisionUntilTimeout(service, 10333);

            expect(await service.discardTimedOutInstance()).toBe(true);

            expect(removeVolume).not.toHaveBeenCalled();
            expect(await readConnectionString(DEFAULT_ALIAS)).toBe(previous);
            expect((await getInstance(DEFAULT_ALIAS))?.phase).toBe('ready');
            expect(service.getStatus()).toMatchObject({ missing: true, canResumeReadiness: false });
            expect(await service.canReuseExistingData()).toBe(true);
        });

        it('Start over keeps everything when Docker cannot remove the container', async () => {
            const runtime = runtimeFor();
            const service = new QuickStartServiceImpl(runtime);
            await provisionUntilTimeout(service);
            const stored = await readConnectionString(DEFAULT_ALIAS);
            (runtime.removeContainer as Mock).mockRejectedValue(new Error('daemon unreachable'));
            // A failed lookup is no proof the container is gone, even if Docker answers again later.
            (runtime.listByLabel as Mock).mockRejectedValue(new Error('daemon unreachable'));

            const error = vi.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue(undefined);

            expect(await service.discardTimedOutInstance()).toBe(false);

            expect(await readConnectionString(DEFAULT_ALIAS)).toBe(stored);
            expect(service.getStatus().canResumeReadiness).toBe(true);
            // Started again, so Wait longer still has something to wait for, and the user is told.
            expect(runtime.startContainer).toHaveBeenCalled();
            expect(error).toHaveBeenCalled();
            error.mockRestore();
        });

        it('Start over still completes when the container was already removed outside VS Code', async () => {
            const runtime = runtimeFor();
            const service = new QuickStartServiceImpl(runtime);
            await provisionUntilTimeout(service);
            (runtime.removeContainer as Mock).mockRejectedValue(new Error('No such container'));

            expect(await service.discardTimedOutInstance()).toBe(true);

            expect(await readConnectionString(DEFAULT_ALIAS)).toBeUndefined();
        });

        it('Start over leaves an instance another window set up since alone', async () => {
            const other = `mongodb://other:pw@localhost:${QUICK_START_PORT}/?tls=true&tlsAllowInvalidCertificates=true`;
            const service = new QuickStartServiceImpl(runtimeFor());
            await provisionUntilTimeout(service);
            await upsertInstance({
                alias: DEFAULT_ALIAS,
                displayName: 'DocumentDB Local',
                port: QUICK_START_PORT,
                phase: 'ready',
            });
            await writeConnectionString(DEFAULT_ALIAS, other, {
                displayName: 'DocumentDB Local',
                port: QUICK_START_PORT,
            });

            expect(await service.discardTimedOutInstance()).toBe(true);

            expect(await readConnectionString(DEFAULT_ALIAS)).toBe(other);
        });

        it('Start over completes when another window replaced the kept container with its own', async () => {
            const other = `mongodb://other:pw@localhost:${QUICK_START_PORT}/?tls=true&tlsAllowInvalidCertificates=true`;
            const runtime = runtimeFor();
            const service = new QuickStartServiceImpl(runtime);
            await provisionUntilTimeout(service);
            (runtime.removeContainer as Mock).mockRejectedValue(new Error('No such container: c1'));
            (runtime.listByLabel as Mock).mockResolvedValue([
                { id: 'c2', name: DEFAULT_ALIAS, labels: { [QUICK_START_ALIAS_LABEL_KEY]: DEFAULT_ALIAS } },
            ]);
            await writeConnectionString(DEFAULT_ALIAS, other, {
                displayName: 'DocumentDB Local',
                port: QUICK_START_PORT,
            });

            expect(await service.discardTimedOutInstance()).toBe(true);

            expect(service.getStatus().canResumeReadiness).toBe(false);
            expect(await readConnectionString(DEFAULT_ALIAS)).toBe(other);
        });

        // Its recreate reuses the stored credentials, so the stored value alone cannot tell the attempts apart.
        it('Start over adopts a replacement another window set up on the same credentials', async () => {
            const labels = { [QUICK_START_LABEL_KEY]: '1', [QUICK_START_ALIAS_LABEL_KEY]: DEFAULT_ALIAS };
            let liveId: string | undefined;
            let hasVolume = false;
            let created = 0;
            const removeVolume = vi.fn(async () => {
                if (liveId) throw new Error('volume is in use');
                hasVolume = false;
            });
            const runtime = runtimeFor({
                overrides: {
                    listByLabel: vi
                        .fn()
                        .mockImplementation(async () => (liveId ? [{ id: liveId, name: DEFAULT_ALIAS, labels }] : [])),
                    volumeExists: vi.fn(async () => hasVolume),
                    createAndRunContainer: vi.fn(async () => {
                        liveId = `c${++created}`;
                        hasVolume = true;
                        return liveId;
                    }),
                    inspectContainer: vi.fn().mockImplementation(async (id: string) =>
                        liveId && (id === liveId || id === DEFAULT_ALIAS)
                            ? {
                                  id: liveId,
                                  status: 'running',
                                  ports: [{ containerPort: QUICK_START_PORT, hostPort: QUICK_START_PORT }],
                                  labels,
                              }
                            : undefined,
                    ),
                    removeContainer: vi.fn(async (id: string) => {
                        if (id !== liveId) throw new Error(`No such container: ${id}`);
                        liveId = undefined;
                    }),
                    removeVolume,
                },
            });
            const first = new QuickStartServiceImpl(runtime);
            const second = new QuickStartServiceImpl(runtime);
            await first.ensureHydrated();
            await second.ensureHydrated();
            await provisionUntilTimeout(first);
            const original = await readConnectionString(DEFAULT_ALIAS);
            onProbe = () => undefined;
            await collect(second.provision(new AbortController().signal));
            expect(liveId).toBe('c2');
            expect(await readConnectionString(DEFAULT_ALIAS)).toBe(original);

            expect(await first.discardTimedOutInstance()).toBe(true);

            expect(removeVolume).not.toHaveBeenCalled();
            expect(await readConnectionString(DEFAULT_ALIAS)).toBe(original);
            expect(first.getStatus().state).toBe(InstanceState.Running);
        });

        it('Start over with nothing left to discard just returns to setup', async () => {
            const service = new QuickStartServiceImpl(runtimeFor());
            await provisionUntilTimeout(service);
            await service.deleteContainer();

            expect(await service.discardTimedOutInstance()).toBe(true);
        });

        it('a timed-out recreate is not reported Running while Wait longer still owns it', async () => {
            await upsertInstance({
                alias: DEFAULT_ALIAS,
                displayName: 'DocumentDB Local',
                port: QUICK_START_PORT,
                phase: 'ready',
            });
            await writeConnectionString(
                DEFAULT_ALIAS,
                `mongodb://old:old@localhost:${QUICK_START_PORT}/?tls=true&tlsAllowInvalidCertificates=true`,
                { displayName: 'DocumentDB Local', port: QUICK_START_PORT },
            );
            const service = new QuickStartServiceImpl(runtimeFor({ volumeExists: true }));
            await service.reconcile();
            await provisionUntilTimeout(service);

            await service.refreshLiveState();

            expect(service.getStatus().state).toBe(InstanceState.Error);
        });

        it('Delete stops offering "Wait longer"', async () => {
            const service = new QuickStartServiceImpl(runtimeFor());
            await provisionUntilTimeout(service);

            expect(await service.deleteContainer()).toBe('deleted');

            expect(service.getStatus().canResumeReadiness).toBe(false);
        });
    });

    describe('suggestPort / checkPort (Configure-step validation, L3)', () => {
        it('suggests the canonical port when it is free', async () => {
            const service = new QuickStartServiceImpl(runtimeFor());

            await expect(service.suggestPort()).resolves.toBe(QUICK_START_PORT);
        });

        it('walks forward to the first free port', async () => {
            const runtime = runtimeFor();
            (runtime.isPortFree as unknown as Mock).mockImplementation((port: number) =>
                Promise.resolve(port >= QUICK_START_PORT + 3),
            );
            const service = new QuickStartServiceImpl(runtime);

            await expect(service.suggestPort()).resolves.toBe(QUICK_START_PORT + 3);
        });

        it('prefers the instance own recorded port so a recreate keeps its address', async () => {
            await upsertInstance({
                alias: DEFAULT_ALIAS,
                displayName: 'DocumentDB Local',
                port: 10333,
                phase: 'ready',
            });
            const service = new QuickStartServiceImpl(runtimeFor());

            await expect(service.suggestPort()).resolves.toBe(10333);
        });

        it('skips a port baked into a sibling instance', async () => {
            await upsertInstance({
                alias: 'documentdb-local-2',
                displayName: 'Second',
                port: QUICK_START_PORT,
                phase: 'ready',
            });
            const service = new QuickStartServiceImpl(runtimeFor());

            await expect(service.suggestPort()).resolves.toBe(QUICK_START_PORT + 1);
            await expect(service.checkPort(QUICK_START_PORT)).resolves.toBe('takenByAnotherInstance');
        });

        it('classifies a busy port as inUse', async () => {
            const service = new QuickStartServiceImpl(runtimeFor({ portFree: false }));

            await expect(service.checkPort(10333)).resolves.toBe('inUse');
        });
    });

    describe('credential exposure (#947)', () => {
        const PASSWORD = 'custom-password-947';

        it('removes the env-file once docker run settles, before the readiness wait', async () => {
            let envFile: string | undefined;
            let presentDuringRun = false;
            let presentAtProbe: boolean | undefined;
            const createAndRunContainer = vi.fn(async (options: { environmentFiles?: string[] }) => {
                envFile = options.environmentFiles?.[0];
                presentDuringRun = !!envFile && fs.existsSync(envFile);
                return 'c1';
            });
            onProbe = () => {
                presentAtProbe ??= !!envFile && fs.existsSync(envFile);
            };
            const service = new QuickStartServiceImpl(runtimeFor({ createAndRunContainer }));

            await collect(service.provision(new AbortController().signal));

            expect(presentDuringRun).toBe(true);
            expect(presentAtProbe).toBe(false);
        });

        it.each([
            [false, true],
            [true, false],
        ])(
            'with VS Code telemetry enabled=%s, opts the container out of usage telemetry: %s',
            async (telemetryEnabled, optedOut) => {
                const env = vscode.env as { isTelemetryEnabled: boolean };
                env.isTelemetryEnabled = telemetryEnabled;
                let contents = '';
                const createAndRunContainer = vi.fn(async (options: { environmentFiles?: string[] }) => {
                    contents = fs.readFileSync(options.environmentFiles![0], 'utf8');
                    return 'c1';
                });
                const service = new QuickStartServiceImpl(runtimeFor({ createAndRunContainer }));

                try {
                    await collect(service.provision(new AbortController().signal));
                } finally {
                    env.isTelemetryEnabled = false;
                }

                expect(contents.includes('DOCUMENTDB_USAGE_TELEMETRY=false\n')).toBe(optedOut);
            },
        );

        it('retries a failed env-file delete when provisioning ends', async () => {
            let envFile: string | undefined;
            const createAndRunContainer = vi.fn(async (options: { environmentFiles?: string[] }) => {
                envFile = options.environmentFiles?.[0];
                return 'c1';
            });
            const rm = vi.mocked(fsPromises.rm);
            rm.mockClear();
            rm.mockRejectedValueOnce(Object.assign(new Error('busy'), { code: 'EPERM' }));
            const service = new QuickStartServiceImpl(runtimeFor({ createAndRunContainer }));

            await collect(service.provision(new AbortController().signal));

            expect(rm.mock.calls.filter(([p]) => p === envFile)).toHaveLength(2);
            expect(fs.existsSync(envFile!)).toBe(false);
        });

        it('removes a partly written env file when the write fails', async () => {
            const actual = await vi.importActual<typeof fsPromises>('fs/promises');
            let envFile: string | undefined;
            vi.mocked(fsPromises.writeFile).mockImplementationOnce(async (file, _data, options) => {
                envFile = file as string;
                await actual.writeFile(envFile, 'USERNAME=admin\nPASSWORD=', options);
                throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
            });
            const createAndRunContainer = vi.fn();
            const service = new QuickStartServiceImpl(runtimeFor({ createAndRunContainer }));

            await collect(service.provision(new AbortController().signal));

            expect(envFile).toMatch(/documentdb-quickstart-\d+-[0-9a-f]{16}\.env$/);
            expect(fs.existsSync(envFile!)).toBe(false);
            expect(createAndRunContainer).not.toHaveBeenCalled();
        });

        it('masks the password in the readiness-timeout detail', async () => {
            const appendLine = vscode.window.createOutputChannel('test').appendLine as Mock;
            appendLine.mockClear();
            const expired = Date.now() + 10 * 60_000;
            const clock = vi.spyOn(Date, 'now');
            // The driver error can echo the connection string; expire the wait after one attempt.
            onProbe = () => {
                clock.mockReturnValue(expired);
                throw new Error(`Authentication failed for mongodb://admin:${PASSWORD}@localhost:10260/`);
            };
            const service = new QuickStartServiceImpl(runtimeFor());

            let events: StageEvent[] = [];
            try {
                events = await collect(
                    service.provision(new AbortController().signal, { username: 'admin', password: PASSWORD }),
                );
            } finally {
                clock.mockRestore();
            }

            const lines = appendLine.mock.calls.map(([line]) => String(line));
            expect(lines.some((line) => line.startsWith('[readiness-timeout]') && line.includes('***'))).toBe(true);
            expect(lines.join('\n')).not.toContain(PASSWORD);
            expect(events.at(-1)?.facts).toMatchObject({ kind: 'waiting', attempts: 1 });
            expect(JSON.stringify(events.at(-1)?.facts)).not.toContain(PASSWORD);
            expect(JSON.stringify(events.at(-1)?.facts)).not.toContain('mongodb://');
        });
    });
});
