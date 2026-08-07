/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { StorageService } from '../storageService';
import { disposeQuickStartOutputChannel, type IContainerRuntime } from './ContainerRuntime';

import { getReadinessTimeoutMessage, QuickStartServiceImpl } from './QuickStartService';
import { listInstances, PROVISIONING_LEASE_TTL_MS, upsertInstance, writeConnectionString } from './quickStartStore';
import {
    DEFAULT_ALIAS,
    type DockerReadiness,
    InstanceState,
    QUICK_START_ALIAS_LABEL_KEY,
    QUICK_START_LABEL_KEY,
    QUICK_START_PORT,
    type StageEvent,
} from './quickStartTypes';

// Volume-safety around stored credentials: whenever an instance's credentials are readable, the
// service must (a) adopt an existing labelled container rather than remove it, and (b) decide
// `reusing=true` so the data volume is never wiped. The injectable runtime (WI-0) makes this testable.

const STORED_CONN = 'mongodb://u1:p1@localhost:10273/?tls=true&tlsAllowInvalidCertificates=true';

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

function fakeSecretStorage(seed: Record<string, string>): vscode.SecretStorage {
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
    } as unknown as vscode.SecretStorage;
}

function mockRuntime(overrides: Partial<IContainerRuntime>): IContainerRuntime {
    return {
        listByLabel: jest.fn().mockResolvedValue([]),
        inspectContainer: jest.fn().mockResolvedValue(undefined),
        removeContainer: jest.fn().mockResolvedValue(undefined),
        removeVolume: jest.fn().mockResolvedValue(undefined),
        isPortFree: jest.fn().mockResolvedValue(true),
        ...overrides,
    } as unknown as IContainerRuntime;
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

/**
 * Seed an already-provisioned instance: a `ready` record plus its credentials, which is what the
 * store holds for any instance the user has set up. Must run after {@link fakeContext} installs the
 * backing state.
 */
async function seedInstance(alias: string, connectionString: string): Promise<void> {
    const port = Number(connectionString.split('@')[1]?.split('/')[0]?.split(':')[1]) || QUICK_START_PORT;
    await upsertInstance({ alias, displayName: alias, port, phase: 'ready' });
    await writeConnectionString(alias, connectionString, { displayName: alias, port });
}

describe('QuickStartService — stored-credential volume safety', () => {
    // jest-mock-vscode's createOutputChannel returns a channel without `appendLine`; stub it so the
    // reconcile branches that log (credential-unavailable surface, duplicate-winner) don't throw.
    beforeAll(() => {
        jest.spyOn(vscode.window, 'createOutputChannel').mockReturnValue({
            name: 'test',
            append: jest.fn(),
            appendLine: jest.fn(),
            replace: jest.fn(),
            clear: jest.fn(),
            show: jest.fn(),
            hide: jest.fn(),
            dispose: jest.fn(),
        } as unknown as vscode.LogOutputChannel);
        disposeQuickStartOutputChannel();
    });

    afterAll(() => {
        disposeQuickStartOutputChannel();
        jest.restoreAllMocks();
    });

    let originalSecretStorage: vscode.SecretStorage;
    let originalContext: vscode.ExtensionContext;

    beforeEach(() => {
        originalSecretStorage = ext.secretStorage;
        originalContext = ext.context;
    });

    afterEach(() => {
        ext.secretStorage = originalSecretStorage;
        ext.context = originalContext;
    });

    it('reconcile() adopts a labelled container whose credentials we hold, never removing it or its volume', async () => {
        ext.secretStorage = fakeSecretStorage({});
        ext.context = fakeContext(fakeMemento());
        await seedInstance(DEFAULT_ALIAS, STORED_CONN);

        const removeContainer = jest.fn().mockResolvedValue(undefined);
        const removeVolume = jest.fn().mockResolvedValue(undefined);
        const runtime = mockRuntime({
            listByLabel: jest.fn().mockResolvedValue([{ id: 'c1' }]),
            // Exited container ⇒ adopted as Stopped (skips the running-only credential-cache path).
            inspectContainer: jest.fn().mockResolvedValue({
                id: 'c1',
                status: 'exited',
                ports: [{ containerPort: 10260, hostPort: 10273 }],
                image: { originalName: 'ghcr.io/documentdb/documentdb-local:1.0.0' },
            }),
            removeContainer,
            removeVolume,
        });
        const service = new QuickStartServiceImpl(runtime);

        await service.reconcile();

        // The stored-secret read succeeded, so the no-secret orphan-removal branch was skipped: the
        // container is adopted, not removed, and the volume is never touched.
        expect(removeContainer).not.toHaveBeenCalled();
        expect(removeVolume).not.toHaveBeenCalled();
        expect(service.getStatus().state).toBe(InstanceState.Stopped);
    });

    it('canReuseExistingData() is true when credentials are stored (protects the volume-wipe gate)', async () => {
        ext.secretStorage = fakeSecretStorage({});
        ext.context = fakeContext(fakeMemento());
        await seedInstance(DEFAULT_ALIAS, STORED_CONN);

        const service = new QuickStartServiceImpl(mockRuntime({}));

        expect(await service.canReuseExistingData()).toBe(true);
    });

    it('reconcile() with NO stored secret surfaces the orphan as credential-unavailable (never removes it or its volume)', async () => {
        ext.secretStorage = fakeSecretStorage({});
        ext.context = fakeContext(fakeMemento());

        const removeContainer = jest.fn().mockResolvedValue(undefined);
        const removeVolume = jest.fn().mockResolvedValue(undefined);
        const runtime = mockRuntime({
            listByLabel: jest.fn().mockResolvedValue([{ id: 'c1' }]),
            removeContainer,
            removeVolume,
        });
        const service = new QuickStartServiceImpl(runtime);

        await service.reconcile();

        // No recoverable credentials anywhere ⇒ the labelled container is SURFACED as
        // credential-unavailable (CredentialsMissing), NOT removed, and the volume is NEVER touched. A
        // lost secret does not prove the volume is disposable, so the user decides (Delete, or restore
        // the secret).
        expect(removeContainer).not.toHaveBeenCalled();
        expect(removeVolume).not.toHaveBeenCalled();
        expect(service.getStatus().state).toBe(InstanceState.CredentialsMissing);
    });

    it('deleteContainer() drops the record AND the credentials (a full clean slate)', async () => {
        ext.secretStorage = fakeSecretStorage({});
        ext.context = fakeContext(fakeMemento());
        await seedInstance(DEFAULT_ALIAS, STORED_CONN);

        const service = new QuickStartServiceImpl(mockRuntime({}));

        const outcome = await service.deleteContainer();
        // No container to reconcile against ⇒ records/secrets are cleaned and the outcome is 'deleted'.
        expect(outcome).toBe('deleted');

        // Nothing survives that a later provision could silently reuse (locks the opus47-N1 fix), and
        // the instance won't linger as a ghost tree row.
        expect(await service.readStoredConnectionString()).toBeUndefined();
        expect(await listInstances()).toHaveLength(0);
    });
});

// WI-2d: reconcile is registry-driven and multi-instance. It enumerates the union of the durable
// registry and the live labelled containers (grouped by the alias label), rebuilding each alias's
// state — adopting containers whose credentials we hold, surfacing (never removing) credential-less
// ones, keeping a fresh provisioning lease as Provisioning, scavenging a stale one, and marking a
// ready record whose container vanished as Missing.
describe('QuickStartService — WI-2d registry-driven reconcile (multi-instance)', () => {
    const ALIAS_2 = `${DEFAULT_ALIAS}-2`;
    const CONN_1 = 'mongodb://u1:p1@localhost:10260/?tls=true&tlsAllowInvalidCertificates=true';
    const CONN_2 = 'mongodb://u2:p2@localhost:10261/?tls=true&tlsAllowInvalidCertificates=true';

    beforeAll(() => {
        jest.spyOn(vscode.window, 'createOutputChannel').mockReturnValue({
            name: 'test',
            append: jest.fn(),
            appendLine: jest.fn(),
            replace: jest.fn(),
            clear: jest.fn(),
            show: jest.fn(),
            hide: jest.fn(),
            dispose: jest.fn(),
        } as unknown as vscode.LogOutputChannel);
        disposeQuickStartOutputChannel();
    });

    afterAll(() => {
        disposeQuickStartOutputChannel();
        jest.restoreAllMocks();
    });

    let originalSecretStorage: vscode.SecretStorage;
    let originalContext: vscode.ExtensionContext;
    let originalOutputChannel: typeof ext.outputChannel;
    let trace: jest.Mock;

    beforeEach(() => {
        originalSecretStorage = ext.secretStorage;
        originalContext = ext.context;
        originalOutputChannel = ext.outputChannel;
        trace = jest.fn();
        ext.outputChannel = { trace } as unknown as typeof ext.outputChannel;
    });

    afterEach(() => {
        ext.secretStorage = originalSecretStorage;
        ext.context = originalContext;
        ext.outputChannel = originalOutputChannel;
    });

    function inspectItem(id: string, opts: { running: boolean; port?: number; image?: string }): unknown {
        return {
            id,
            status: opts.running ? 'running' : 'exited',
            ports: opts.port ? [{ containerPort: QUICK_START_PORT, hostPort: opts.port }] : [],
            image: opts.image ? { originalName: opts.image } : undefined,
        };
    }

    function reconcileRuntime(opts: {
        containers: Array<{ id: string; alias?: string; createdAt?: Date }>;
        inspect?: Record<string, unknown>;
        isDockerReady?: jest.Mock;
        removeContainer?: jest.Mock;
        removeVolume?: jest.Mock;
    }): IContainerRuntime {
        const inspect = opts.inspect ?? {};
        return mockRuntime({
            listByLabel: jest.fn().mockResolvedValue(
                opts.containers.map((container) => ({
                    id: container.id,
                    createdAt: container.createdAt,
                    labels: container.alias === undefined ? {} : { [QUICK_START_ALIAS_LABEL_KEY]: container.alias },
                })),
            ),
            inspectContainer: jest.fn((id: string) =>
                Promise.resolve(inspect[id]),
            ) as unknown as IContainerRuntime['inspectContainer'],
            isDockerReady: opts.isDockerReady,
            removeContainer: opts.removeContainer ?? jest.fn().mockResolvedValue(undefined),
            removeVolume: opts.removeVolume ?? jest.fn().mockResolvedValue(undefined),
        });
    }

    it('adopts two labelled containers into isolated per-alias states (running + stopped)', async () => {
        ext.secretStorage = fakeSecretStorage({});
        ext.context = fakeContext(fakeMemento());
        await seedInstance(DEFAULT_ALIAS, CONN_1);
        await seedInstance(ALIAS_2, CONN_2);
        const service = new QuickStartServiceImpl(
            reconcileRuntime({
                containers: [
                    { id: 'c1', alias: DEFAULT_ALIAS },
                    { id: 'c2', alias: ALIAS_2 },
                ],
                inspect: {
                    c1: inspectItem('c1', { running: true, port: 10260, image: 'img:1' }),
                    c2: inspectItem('c2', { running: false, port: 10261, image: 'img:1' }),
                },
            }),
        );

        await service.reconcile();

        expect(service.getStatus(DEFAULT_ALIAS).state).toBe(InstanceState.Running);
        expect(service.getStatus(ALIAS_2).state).toBe(InstanceState.Stopped);
        // listStatuses is ordered DEFAULT-first; both instances are durable + ready.
        expect(service.listStatuses().map((status) => status.alias)).toEqual([DEFAULT_ALIAS, ALIAS_2]);
        expect((await listInstances()).map((record) => record.alias).sort()).toEqual([ALIAS_2, DEFAULT_ALIAS].sort());
    });

    it('retains Docker host facts collected during reconciliation', async () => {
        ext.secretStorage = fakeSecretStorage({});
        ext.context = fakeContext(fakeMemento());
        const readiness: DockerReadiness = {
            outcome: 'ready',
            environment: 'wsl',
            endpointKind: 'unixSocket',
            provider: 'dockerEngine',
            providerEvidence: 'liveDaemon',
            executionTarget: 'wsl',
            canContinueAnyway: false,
            checkedAtMs: 1,
            cliInstalled: true,
            cliVersion: 'Docker version 28.1.1',
            daemonReachable: true,
            osType: 'linux',
            daemonArchitecture: 'amd64',
        };
        const isDockerReady = jest.fn().mockResolvedValue(readiness);
        const service = new QuickStartServiceImpl(reconcileRuntime({ containers: [], isDockerReady }));

        await service.reconcile();

        expect(isDockerReady).toHaveBeenCalledWith({ suppressCommandEcho: true });
        expect(service.getDockerReadinessSnapshot()).toBe(readiness);
    });

    it('surfaces a credential-unavailable instance as CredentialsMissing without removing it or its volume (R2)', async () => {
        ext.secretStorage = fakeSecretStorage({}); // no secret for ALIAS_2
        ext.context = fakeContext(fakeMemento());
        const removeContainer = jest.fn().mockResolvedValue(undefined);
        const removeVolume = jest.fn().mockResolvedValue(undefined);
        const service = new QuickStartServiceImpl(
            reconcileRuntime({
                containers: [{ id: 'c2', alias: ALIAS_2 }],
                inspect: { c2: inspectItem('c2', { running: true, port: 10261 }) },
                removeContainer,
                removeVolume,
            }),
        );

        await service.reconcile();

        expect(service.getStatus(ALIAS_2).state).toBe(InstanceState.CredentialsMissing);
        expect(removeContainer).not.toHaveBeenCalled();
        expect(removeVolume).not.toHaveBeenCalled();
    });

    it('marks a ready record whose container vanished as Missing, keeping the record (recoverable)', async () => {
        ext.secretStorage = fakeSecretStorage({});
        const globalState = fakeMemento();
        ext.context = fakeContext(globalState);
        await seedInstance(ALIAS_2, CONN_2);
        await upsertInstance({ alias: ALIAS_2, displayName: 'Second', port: 10261, phase: 'ready' });
        const service = new QuickStartServiceImpl(reconcileRuntime({ containers: [] }));

        await service.reconcile();

        expect(service.listStatuses().find((status) => status.alias === ALIAS_2)?.missing).toBe(true);
        expect((await listInstances()).some((record) => record.alias === ALIAS_2)).toBe(true);
    });

    it('start() after an external container delete surfaces Missing instead of a silent no-op (#2)', async () => {
        ext.secretStorage = fakeSecretStorage({});
        ext.context = fakeContext(fakeMemento());
        await seedInstance(DEFAULT_ALIAS, CONN_1);

        const startContainer = jest.fn().mockResolvedValue(undefined);
        // Mutable inspect map: present during reconcile (adopted as Stopped), then removed to
        // simulate `docker rm` outside VS Code before the user clicks Start.
        const inspect: Record<string, unknown> = {
            c1: inspectItem('c1', { running: false, port: 10260, image: 'img:1' }),
        };
        const service = new QuickStartServiceImpl(
            mockRuntime({
                listByLabel: jest
                    .fn()
                    .mockResolvedValue([{ id: 'c1', labels: { [QUICK_START_ALIAS_LABEL_KEY]: DEFAULT_ALIAS } }]),
                inspectContainer: jest.fn((id: string) =>
                    Promise.resolve(inspect[id]),
                ) as unknown as IContainerRuntime['inspectContainer'],
                startContainer,
            }),
        );

        await service.reconcile();
        expect(service.getStatus().state).toBe(InstanceState.Stopped);

        // The container vanishes (external `docker rm`): every subsequent inspect returns undefined.
        delete inspect.c1;
        const info = jest.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined);

        await service.start();

        // The regression: previously isManaged() returned false for a gone container and the `||`
        // chain short-circuited before the missing-detection, so start() early-returned silently.
        expect(startContainer).not.toHaveBeenCalled(); // never tried to start a container that is gone
        expect(info).toHaveBeenCalled(); // the user is told, not left with a stale "Stopped" row
        expect(service.getStatus().missing).toBe(true); // routed to the recoverable Missing badge (O4)
        info.mockRestore();
    });

    it('refreshLiveState() fires the status change only on the TRANSITION into Missing (H1)', async () => {
        ext.secretStorage = fakeSecretStorage({});
        ext.context = fakeContext(fakeMemento());
        await seedInstance(DEFAULT_ALIAS, CONN_1);

        const inspect: Record<string, unknown> = {
            c1: inspectItem('c1', { running: true, port: 10260, image: 'img:1' }),
        };
        const service = new QuickStartServiceImpl(
            mockRuntime({
                listByLabel: jest
                    .fn()
                    .mockResolvedValue([{ id: 'c1', labels: { [QUICK_START_ALIAS_LABEL_KEY]: DEFAULT_ALIAS } }]),
                inspectContainer: jest.fn((id: string) =>
                    Promise.resolve(inspect[id]),
                ) as unknown as IContainerRuntime['inspectContainer'],
            }),
        );

        await service.reconcile();

        // The container is removed outside VS Code; the tree then re-renders repeatedly.
        delete inspect.c1;
        let fired = 0;
        service.onDidChangeStatus(() => fired++);

        await service.refreshLiveState();
        await service.refreshLiveState();
        await service.refreshLiveState();

        // Pre-fix this fired once per call, and each fire re-entered getChildren() → refreshLiveState()
        // → a self-sustaining `docker inspect` loop for as long as the view was visible.
        expect(fired).toBe(1);
        expect(service.getStatus().missing).toBe(true);
    });

    it('ensureHydrated() lazily reconciles once and shares concurrent work', async () => {
        ext.secretStorage = fakeSecretStorage({});
        ext.context = fakeContext(fakeMemento());

        let finishListing: ((containers: []) => void) | undefined;
        const listByLabel = jest.fn(
            () =>
                new Promise<[]>((resolve) => {
                    finishListing = resolve;
                }),
        );
        const service = new QuickStartServiceImpl(mockRuntime({ listByLabel }));

        expect(listByLabel).not.toHaveBeenCalled();
        const first = service.ensureHydrated();
        const second = service.ensureHydrated();
        expect(listByLabel).toHaveBeenCalledTimes(1);

        finishListing?.([]);
        await Promise.all([first, second]);
        await service.ensureHydrated();

        expect(listByLabel).toHaveBeenCalledTimes(1);
        expect(trace).toHaveBeenCalledWith(expect.stringContaining('Lazy hydration requested'));
        expect(trace).toHaveBeenCalledWith(
            expect.stringContaining('Discovery returned 0 managed container(s) and 0 durable record(s)'),
        );
        expect(trace).toHaveBeenCalledWith(expect.stringContaining('Lazy hydration completed'));
    });

    it('ensureHydrated() remains retryable when Docker discovery fails', async () => {
        ext.secretStorage = fakeSecretStorage({});
        ext.context = fakeContext(fakeMemento());

        const listByLabel = jest.fn().mockRejectedValueOnce(new Error('Docker unavailable')).mockResolvedValue([]);
        const service = new QuickStartServiceImpl(mockRuntime({ listByLabel }));

        await expect(service.ensureHydrated()).rejects.toThrow('Docker unavailable');
        expect(service.isHydrated).toBe(false);
        expect(trace).toHaveBeenCalledWith(expect.stringContaining('Docker state remains unknown'));
        expect(trace).toHaveBeenCalledWith(expect.stringContaining('the next Quick Start entry will retry'));

        await service.ensureHydrated();
        expect(service.isHydrated).toBe(true);
        expect(listByLabel).toHaveBeenCalledTimes(2);
    });

    it('shares deep reconciliation between hydration and explicit refresh', async () => {
        ext.secretStorage = fakeSecretStorage({});
        ext.context = fakeContext(fakeMemento());

        let finishListing: ((containers: []) => void) | undefined;
        const listByLabel = jest.fn(
            () =>
                new Promise<[]>((resolve) => {
                    finishListing = resolve;
                }),
        );
        const service = new QuickStartServiceImpl(mockRuntime({ listByLabel }));

        const hydration = service.ensureHydrated();
        const refresh = service.refreshHydratedState();
        expect(listByLabel).toHaveBeenCalledTimes(1);

        finishListing?.([]);
        await Promise.all([hydration, refresh]);

        expect(service.isHydrated).toBe(true);
        expect(listByLabel).toHaveBeenCalledTimes(1);
    });

    it('does not start a background live-state probe immediately after explicit refresh', async () => {
        ext.secretStorage = fakeSecretStorage({});
        ext.context = fakeContext(fakeMemento());

        const service = new QuickStartServiceImpl(mockRuntime({}));

        await service.refreshHydratedState();
        service.refreshLiveStateInBackground();

        expect(service.isRefreshingLiveState).toBe(false);
    });

    it('refreshLiveStateInBackground() de-duplicates and rate-limits the docker probe (M6)', async () => {
        ext.secretStorage = fakeSecretStorage({});
        ext.context = fakeContext(fakeMemento());
        await seedInstance(DEFAULT_ALIAS, CONN_1);

        const inspect: Record<string, unknown> = {
            c1: inspectItem('c1', { running: true, port: 10260, image: 'img:1' }),
        };
        const inspectContainer = jest.fn((id: string) => Promise.resolve(inspect[id]));
        const service = new QuickStartServiceImpl(
            mockRuntime({
                listByLabel: jest
                    .fn()
                    .mockResolvedValue([{ id: 'c1', labels: { [QUICK_START_ALIAS_LABEL_KEY]: DEFAULT_ALIAS } }]),
                inspectContainer: inspectContainer as unknown as IContainerRuntime['inspectContainer'],
            }),
        );

        await service.reconcile();
        inspectContainer.mockClear();

        // The Connections view re-renders many times in a burst (connection add/remove, folder ops,
        // discovery refresh); getChildren() calls this on every one of them.
        service.refreshLiveStateInBackground();
        service.refreshLiveStateInBackground();
        service.refreshLiveStateInBackground();
        expect(service.isRefreshingLiveState).toBe(true);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        // One probe for the burst, and the cooldown blocks the re-render the completion event causes.
        service.refreshLiveStateInBackground();
        expect(inspectContainer).toHaveBeenCalledTimes(1);
    });

    it('deleteContainer() refuses to remove a container that is not ours, even when surfaced as Missing (#9)', async () => {
        ext.secretStorage = fakeSecretStorage({});
        ext.context = fakeContext(fakeMemento());
        await seedInstance(DEFAULT_ALIAS, CONN_1);

        const removeContainer = jest.fn().mockResolvedValue(undefined);
        const removeVolume = jest.fn().mockResolvedValue(undefined);
        // Three phases for the SAME id/name: (1) ours (adopt), (2) gone (Start marks it Missing),
        // (3) a FOREIGN container now holds the name. This reproduces the exact old bypass:
        // entry.missing === true, so the pre-fix `entry.missing || isManaged(...)` would have removed
        // a container the extension never created (metadata.containerId can be a NAME, not an id).
        let phase: 'ours' | 'gone' | 'foreign' = 'ours';
        const service = new QuickStartServiceImpl(
            mockRuntime({
                listByLabel: jest
                    .fn()
                    .mockResolvedValue([{ id: 'c1', labels: { [QUICK_START_ALIAS_LABEL_KEY]: DEFAULT_ALIAS } }]),
                inspectContainer: jest.fn((id: string) =>
                    Promise.resolve(
                        phase === 'gone'
                            ? undefined
                            : phase === 'foreign'
                              ? { id, status: 'running', labels: {} } // not ours: no quickstart label
                              : {
                                    id,
                                    status: 'running',
                                    ports: [{ containerPort: QUICK_START_PORT, hostPort: 10260 }],
                                    image: { originalName: 'img:1' },
                                    labels: {
                                        [QUICK_START_LABEL_KEY]: '1',
                                        [QUICK_START_ALIAS_LABEL_KEY]: DEFAULT_ALIAS,
                                    },
                                },
                    ),
                ) as unknown as IContainerRuntime['inspectContainer'],
                startContainer: jest.fn().mockResolvedValue(undefined),
                removeContainer,
                removeVolume,
            }),
        );

        await service.reconcile(); // adopts as Running (metadata.containerId = 'c1')
        const info = jest.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined);
        phase = 'gone';
        await service.start(); // container gone ⇒ ensureActionable sets entry.missing = true
        expect(service.getStatus().missing).toBe(true);

        phase = 'foreign'; // the id/name now resolves to a container the extension did not create
        const warn = jest.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined);
        const outcome = await service.deleteContainer();

        // #9: even with entry.missing === true (the old bypass), never remove a container — or its
        // possibly-shared volume — that the extension did not create.
        expect(removeContainer).not.toHaveBeenCalled();
        expect(removeVolume).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalled();
        // ...and the outcome is 'refused' so the command suppresses its "container deleted" toast
        // (GPT-5.6 review): the instance is untouched, so a success message would be contradictory.
        expect(outcome).toBe('refused');
        info.mockRestore();
        warn.mockRestore();
    });

    it('start() on a container that drifted to running in another window refreshes without starting', async () => {
        ext.secretStorage = fakeSecretStorage({});
        ext.context = fakeContext(fakeMemento());
        await seedInstance(DEFAULT_ALIAS, CONN_1);

        const startContainer = jest.fn().mockResolvedValue(undefined);
        // Adopt as Stopped, then the container is actually running (another window started it).
        // The inspect result carries our labels (as real Docker does) so ensureActionable recognizes
        // it as ours and hits the drift branch rather than the foreign one.
        let running = false;
        const service = new QuickStartServiceImpl(
            mockRuntime({
                listByLabel: jest
                    .fn()
                    .mockResolvedValue([{ id: 'c1', labels: { [QUICK_START_ALIAS_LABEL_KEY]: DEFAULT_ALIAS } }]),
                inspectContainer: jest.fn((id: string) =>
                    Promise.resolve({
                        id,
                        status: running ? 'running' : 'exited',
                        ports: [{ containerPort: QUICK_START_PORT, hostPort: 10260 }],
                        image: { originalName: 'img:1' },
                        labels: { [QUICK_START_LABEL_KEY]: '1', [QUICK_START_ALIAS_LABEL_KEY]: DEFAULT_ALIAS },
                    }),
                ) as unknown as IContainerRuntime['inspectContainer'],
                startContainer,
            }),
        );

        await service.reconcile();
        expect(service.getStatus().state).toBe(InstanceState.Stopped);

        running = true; // drift: it's already running
        const info = jest.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined);
        await service.start();

        expect(startContainer).not.toHaveBeenCalled(); // start on an already-running container is a no-op
        expect(info).toHaveBeenCalled(); // the user is told the state changed
        expect(service.getStatus().state).toBe(InstanceState.Running); // corrected to the live state
        expect(service.getStatus().missing).toBe(false);
        info.mockRestore();
    });

    it('scavenges a STALE provisioning reservation that never produced a container', async () => {
        ext.secretStorage = fakeSecretStorage({});
        const globalState = fakeMemento();
        ext.context = fakeContext(globalState);
        await upsertInstance({
            alias: ALIAS_2,
            displayName: 'Second',
            port: 10261,
            phase: 'provisioning',
            leaseAt: Date.now() - PROVISIONING_LEASE_TTL_MS - 1_000,
        });
        const service = new QuickStartServiceImpl(reconcileRuntime({ containers: [] }));

        await service.reconcile();

        expect((await listInstances()).some((record) => record.alias === ALIAS_2)).toBe(false);
        expect(service.getStatus(ALIAS_2).state).toBe(InstanceState.NotInstalled);
    });

    it('keeps a FRESH provisioning reservation as Provisioning (not scavenged)', async () => {
        ext.secretStorage = fakeSecretStorage({});
        const globalState = fakeMemento();
        ext.context = fakeContext(globalState);
        await upsertInstance({
            alias: ALIAS_2,
            displayName: 'Second',
            port: 10261,
            phase: 'provisioning',
            leaseAt: Date.now(),
        });
        const service = new QuickStartServiceImpl(reconcileRuntime({ containers: [] }));

        await service.reconcile();

        expect((await listInstances()).some((record) => record.alias === ALIAS_2)).toBe(true);
        expect(service.getStatus(ALIAS_2).state).toBe(InstanceState.Provisioning);
    });

    it('adopts (never scavenges) a container present under a stale provisioning lease, promoting it to ready (Q4)', async () => {
        ext.secretStorage = fakeSecretStorage({});
        const globalState = fakeMemento();
        ext.context = fakeContext(globalState);
        await seedInstance(ALIAS_2, CONN_2);
        await upsertInstance({
            alias: ALIAS_2,
            displayName: 'Second',
            port: 10261,
            phase: 'provisioning',
            leaseAt: Date.now() - PROVISIONING_LEASE_TTL_MS - 1_000,
        });
        const service = new QuickStartServiceImpl(
            reconcileRuntime({
                containers: [{ id: 'c2', alias: ALIAS_2 }],
                inspect: { c2: inspectItem('c2', { running: true, port: 10261 }) },
            }),
        );

        await service.reconcile();

        expect(service.getStatus(ALIAS_2).state).toBe(InstanceState.Running);
        expect((await listInstances()).find((record) => record.alias === ALIAS_2)?.phase).toBe('ready');
    });

    it('deleteContainer() removes a surfaced (no-metadata) instance via a live lookup', async () => {
        ext.secretStorage = fakeSecretStorage({});
        ext.context = fakeContext(fakeMemento());
        const removeContainer = jest.fn().mockResolvedValue(undefined);
        const removeVolume = jest.fn().mockResolvedValue(undefined);
        const service = new QuickStartServiceImpl(
            reconcileRuntime({
                containers: [{ id: 'c2', alias: ALIAS_2 }],
                inspect: {
                    c2: {
                        id: 'c2',
                        status: 'running',
                        labels: { [QUICK_START_LABEL_KEY]: '1', [QUICK_START_ALIAS_LABEL_KEY]: ALIAS_2 },
                    },
                },
                removeContainer,
                removeVolume,
            }),
        );

        await service.reconcile(); // surfaces ALIAS_2 as credential-unavailable (no in-memory metadata)
        const outcome = await service.deleteContainer(ALIAS_2);

        // The container is found via findManagedContainer despite no in-memory metadata, and an
        // explicit Delete is a full clean slate (its own volume is wiped).
        expect(removeContainer).toHaveBeenCalledTimes(1);
        expect(removeVolume).toHaveBeenCalledTimes(1);
        // An owned container was actually removed ⇒ 'deleted' so the command shows its success toast.
        expect(outcome).toBe('deleted');
    });

    it('deleteContainer() reports an error (not a false "deleted") when removing OUR container fails', async () => {
        // GPT-5.6 review follow-up: if Docker refuses to remove our OWNED container, deleteContainer
        // must NOT swallow the failure and claim success. It surfaces the error, returns 'error', and
        // leaves the volume + records intact so the instance can be retried rather than becoming a
        // credential-missing ghost.
        ext.secretStorage = fakeSecretStorage({});
        ext.context = fakeContext(fakeMemento());
        const removeContainer = jest.fn().mockRejectedValue(new Error('docker daemon unavailable'));
        const removeVolume = jest.fn().mockResolvedValue(undefined);
        const service = new QuickStartServiceImpl(
            reconcileRuntime({
                containers: [{ id: 'c2', alias: ALIAS_2 }],
                inspect: {
                    c2: {
                        id: 'c2',
                        status: 'running',
                        labels: { [QUICK_START_LABEL_KEY]: '1', [QUICK_START_ALIAS_LABEL_KEY]: ALIAS_2 },
                    },
                },
                removeContainer,
                removeVolume,
            }),
        );
        const errorMessage = jest.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue(undefined);

        await service.reconcile();
        const outcome = await service.deleteContainer(ALIAS_2);

        expect(removeContainer).toHaveBeenCalledTimes(1);
        expect(outcome).toBe('error');
        // We bailed before the clean-slate cleanup: the volume is NOT wiped (the container may still
        // hold that data) and an error was surfaced to the user.
        expect(removeVolume).not.toHaveBeenCalled();
        expect(errorMessage).toHaveBeenCalled();
        errorMessage.mockRestore();
    });

    it('deleteContainer() reports an error (not a false "deleted") when the live container lookup fails', async () => {
        // GPT-5.6 review follow-up: on the no-metadata path (surfaced Missing / credential-unavailable),
        // a Docker lookup FAILURE must not be mistaken for "already gone". We cannot verify the
        // container, so surface an error and leave records/secrets intact rather than reporting a clean
        // delete and turning a still-running container into a credential-missing ghost.
        ext.secretStorage = fakeSecretStorage({});
        const globalState = fakeMemento();
        ext.context = fakeContext(globalState);
        await seedInstance(DEFAULT_ALIAS, CONN_1);
        await upsertInstance({
            alias: DEFAULT_ALIAS,
            displayName: 'DocumentDB Local',
            port: 10273,
            phase: 'ready',
        });
        const removeContainer = jest.fn().mockResolvedValue(undefined);
        const removeVolume = jest.fn().mockResolvedValue(undefined);
        const service = new QuickStartServiceImpl(
            mockRuntime({
                listByLabel: jest.fn().mockRejectedValue(new Error('docker daemon unavailable')),
                removeContainer,
                removeVolume,
            }),
        );
        const errorMessage = jest.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue(undefined);

        const outcome = await service.deleteContainer();

        expect(outcome).toBe('error');
        expect(removeContainer).not.toHaveBeenCalled();
        expect(removeVolume).not.toHaveBeenCalled();
        expect(errorMessage).toHaveBeenCalled();
        // Records + secrets preserved so the instance stays in the tree and Delete can be retried.
        expect(await service.readStoredConnectionString()).toBe(CONN_1);
        expect(await listInstances()).toHaveLength(1);
        errorMessage.mockRestore();
    });

    it('deleteContainer() removes the LIVE labelled container when the stored metadata id is stale', async () => {
        // GPT-5.6 review follow-up: inspectContainer swallows Docker errors and returns undefined, so a
        // stale metadata id that no longer resolves must NOT be trusted as "already gone". If the
        // original container was externally replaced by a NEW labelled same-alias container, Delete must
        // remove the LIVE container (found authoritatively by label), not wipe records and leave a
        // running ghost that resurfaces as CredentialsMissing.
        ext.secretStorage = fakeSecretStorage({});
        ext.context = fakeContext(fakeMemento());
        await seedInstance(DEFAULT_ALIAS, CONN_1);
        const removeContainer = jest.fn().mockResolvedValue(undefined);
        const removeVolume = jest.fn().mockResolvedValue(undefined);
        let phase: 'adopt' | 'delete' = 'adopt';
        const service = new QuickStartServiceImpl(
            mockRuntime({
                listByLabel: jest.fn(() =>
                    Promise.resolve(
                        phase === 'adopt'
                            ? [{ id: 'c1', labels: { [QUICK_START_ALIAS_LABEL_KEY]: DEFAULT_ALIAS } }]
                            : // the stored id 'c1' is gone; a NEW labelled same-alias container 'c2' is live
                              [
                                  {
                                      id: 'c2',
                                      labels: {
                                          [QUICK_START_LABEL_KEY]: '1',
                                          [QUICK_START_ALIAS_LABEL_KEY]: DEFAULT_ALIAS,
                                      },
                                  },
                              ],
                    ),
                ) as unknown as IContainerRuntime['listByLabel'],
                inspectContainer: jest.fn((id: string) =>
                    Promise.resolve(
                        phase === 'adopt'
                            ? {
                                  id,
                                  status: 'running',
                                  ports: [{ containerPort: QUICK_START_PORT, hostPort: 10260 }],
                                  image: { originalName: 'img:1' },
                                  labels: {
                                      [QUICK_START_LABEL_KEY]: '1',
                                      [QUICK_START_ALIAS_LABEL_KEY]: DEFAULT_ALIAS,
                                  },
                              }
                            : undefined, // delete phase: the stale id 'c1' inspects as gone
                    ),
                ) as unknown as IContainerRuntime['inspectContainer'],
                removeContainer,
                removeVolume,
            }),
        );
        await service.reconcile(); // adopts c1 (metadata.containerId = 'c1')
        phase = 'delete';

        const outcome = await service.deleteContainer();

        // The stale id 'c1' inspects to undefined, but the authoritative label lookup finds the LIVE
        // replacement 'c2' — so we remove c2 (not wipe records) and report a truthful 'deleted'.
        expect(removeContainer).toHaveBeenCalledTimes(1);
        expect(removeContainer).toHaveBeenCalledWith('c2');
        expect(outcome).toBe('deleted');
    });

    it('deleteContainer() reports an error when the stored id inspects as gone but the label lookup fails', async () => {
        // GPT-5.6 review follow-up: inspectContainer returning undefined for a stored metadata id is
        // inconclusive (it swallows Docker errors). Before wiping records we confirm absence with the
        // non-swallowing label lookup; if THAT fails (Docker unreachable) the outcome is 'error', not a
        // false 'deleted' — the still-live container must not be abandoned as a credential-missing ghost.
        ext.secretStorage = fakeSecretStorage({});
        ext.context = fakeContext(fakeMemento());
        await seedInstance(DEFAULT_ALIAS, CONN_1);
        const removeContainer = jest.fn().mockResolvedValue(undefined);
        const removeVolume = jest.fn().mockResolvedValue(undefined);
        let phase: 'adopt' | 'delete' = 'adopt';
        const service = new QuickStartServiceImpl(
            mockRuntime({
                listByLabel: jest.fn(() =>
                    phase === 'adopt'
                        ? Promise.resolve([{ id: 'c1', labels: { [QUICK_START_ALIAS_LABEL_KEY]: DEFAULT_ALIAS } }])
                        : Promise.reject(new Error('docker daemon unavailable')),
                ) as unknown as IContainerRuntime['listByLabel'],
                inspectContainer: jest.fn((id: string) =>
                    Promise.resolve(
                        phase === 'adopt'
                            ? {
                                  id,
                                  status: 'running',
                                  ports: [{ containerPort: QUICK_START_PORT, hostPort: 10260 }],
                                  image: { originalName: 'img:1' },
                                  labels: {
                                      [QUICK_START_LABEL_KEY]: '1',
                                      [QUICK_START_ALIAS_LABEL_KEY]: DEFAULT_ALIAS,
                                  },
                              }
                            : undefined, // delete phase: the stored id inspects as gone (swallowed error)
                    ),
                ) as unknown as IContainerRuntime['inspectContainer'],
                removeContainer,
                removeVolume,
            }),
        );
        await service.reconcile(); // adopts c1 (metadata.containerId = 'c1')
        phase = 'delete';
        const errorMessage = jest.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue(undefined);

        const outcome = await service.deleteContainer();

        expect(outcome).toBe('error');
        expect(removeContainer).not.toHaveBeenCalled();
        expect(removeVolume).not.toHaveBeenCalled();
        expect(errorMessage).toHaveBeenCalled();
        // Records preserved so the still-live container isn't abandoned; Delete can be retried.
        expect(await service.readStoredConnectionString()).toBe(CONN_1);
        errorMessage.mockRestore();
    });

    it('deleteContainer() removes EVERY same-alias managed container (no ghost survivor)', async () => {
        // GPT-5.6 review follow-up: a cross-window double-create can leave more than one managed
        // container for the alias (reconcile adopts the newest and LEAVES the rest — pickManagedContainer).
        // Delete is a full clean slate, so it must remove ALL label-matched containers; removing only the
        // first would strand a survivor that resurfaces as a credential-missing ghost.
        ext.secretStorage = fakeSecretStorage({});
        ext.context = fakeContext(fakeMemento());
        const removeContainer = jest.fn().mockResolvedValue(undefined);
        const removeVolume = jest.fn().mockResolvedValue(undefined);
        const service = new QuickStartServiceImpl(
            mockRuntime({
                listByLabel: jest.fn().mockResolvedValue([
                    {
                        id: 'dup1',
                        labels: { [QUICK_START_LABEL_KEY]: '1', [QUICK_START_ALIAS_LABEL_KEY]: DEFAULT_ALIAS },
                    },
                    {
                        id: 'dup2',
                        labels: { [QUICK_START_LABEL_KEY]: '1', [QUICK_START_ALIAS_LABEL_KEY]: DEFAULT_ALIAS },
                    },
                ]),
                removeContainer,
                removeVolume,
            }),
        );

        const outcome = await service.deleteContainer();

        expect(removeContainer).toHaveBeenCalledTimes(2);
        expect(removeContainer).toHaveBeenCalledWith('dup1');
        expect(removeContainer).toHaveBeenCalledWith('dup2');
        expect(outcome).toBe('deleted');
    });

    it('is idempotent across repeated reconciles', async () => {
        ext.secretStorage = fakeSecretStorage({});
        ext.context = fakeContext(fakeMemento());
        await seedInstance(DEFAULT_ALIAS, CONN_1);
        const service = new QuickStartServiceImpl(
            reconcileRuntime({
                containers: [{ id: 'c1', alias: DEFAULT_ALIAS }],
                inspect: { c1: inspectItem('c1', { running: true, port: 10260, image: 'img:1' }) },
            }),
        );

        await service.reconcile();
        await service.reconcile();

        expect(service.getStatus(DEFAULT_ALIAS).state).toBe(InstanceState.Running);
        expect((await listInstances()).filter((record) => record.alias === DEFAULT_ALIAS)).toHaveLength(1);
    });
});

// WI-2e-1 (from the 3-agent data-safety review): provision must NEVER silently wipe a
// credential-unavailable instance's data volume (RR4 / plan §5.2). Only a truly-fresh alias — no
// managed container AND no durable `ready` record — may reach the clean-slate wipe.
describe('QuickStartService — WI-2e-1 provision RR4 volume-wipe gate', () => {
    beforeAll(() => {
        jest.spyOn(vscode.window, 'createOutputChannel').mockReturnValue({
            name: 'test',
            append: jest.fn(),
            appendLine: jest.fn(),
            replace: jest.fn(),
            clear: jest.fn(),
            show: jest.fn(),
            hide: jest.fn(),
            dispose: jest.fn(),
        } as unknown as vscode.LogOutputChannel);
        disposeQuickStartOutputChannel();
    });

    afterAll(() => {
        disposeQuickStartOutputChannel();
        jest.restoreAllMocks();
    });

    let originalSecretStorage: vscode.SecretStorage;
    let originalContext: vscode.ExtensionContext;

    beforeEach(() => {
        originalSecretStorage = ext.secretStorage;
        originalContext = ext.context;
    });

    afterEach(() => {
        ext.secretStorage = originalSecretStorage;
        ext.context = originalContext;
    });

    function provisionRuntime(opts: {
        containers?: Array<{ id: string; alias?: string }>;
        portFree?: boolean;
        removeContainer?: jest.Mock;
        removeVolume?: jest.Mock;
        readiness?: DockerReadiness;
    }): IContainerRuntime {
        return mockRuntime({
            isDockerReady: jest.fn().mockResolvedValue(
                opts.readiness ?? {
                    outcome: 'ready',
                    environment: 'linux',
                    endpointKind: 'unknown',
                    canContinueAnyway: false,
                    checkedAtMs: Date.now(),
                    cliInstalled: true,
                    daemonReachable: true,
                },
            ),
            listByLabel: jest.fn().mockResolvedValue(
                (opts.containers ?? []).map((container) => ({
                    id: container.id,
                    labels: container.alias === undefined ? {} : { [QUICK_START_ALIAS_LABEL_KEY]: container.alias },
                })),
            ),
            isPortFree: jest.fn().mockResolvedValue(opts.portFree ?? true),
            removeContainer: opts.removeContainer ?? jest.fn().mockResolvedValue(undefined),
            removeVolume: opts.removeVolume ?? jest.fn().mockResolvedValue(undefined),
        } as unknown as Partial<IContainerRuntime>);
    }

    async function drain(gen: AsyncGenerator<unknown>): Promise<void> {
        for await (const event of gen) {
            void event; // consume the stage events
        }
    }

    it.each(['pulling', 'creating'] as const)(
        'routes a Docker daemon failure during %s through typed readiness recovery',
        async (failingStage) => {
            ext.secretStorage = fakeSecretStorage({});
            ext.context = fakeContext(fakeMemento());
            const ready: DockerReadiness = {
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
            const unavailable: DockerReadiness = {
                outcome: 'diagnosed',
                environment: 'linux',
                endpointKind: 'unixSocket',
                provider: 'dockerDesktop',
                providerEvidence: 'rememberedProvider',
                providerRecordedAtMs: 1,
                executionTarget: 'local',
                failureKind: 'daemonUnavailable',
                startAction: 'startDockerDesktopLinux',
                canContinueAnyway: false,
                checkedAtMs: 2,
                cliInstalled: true,
                daemonReachable: false,
            };
            const isDockerReady = jest.fn().mockResolvedValueOnce(ready).mockResolvedValueOnce(unavailable);
            const runtime = mockRuntime({
                isDockerReady,
                listByLabel: jest.fn().mockResolvedValue([]),
                removeVolume: jest.fn().mockResolvedValue(undefined),
                isPortFree: jest.fn().mockResolvedValue(true),
                pullImage:
                    failingStage === 'pulling'
                        ? jest.fn().mockRejectedValue(new Error('daemon disappeared during pull'))
                        : jest.fn().mockResolvedValue(undefined),
                createAndRunContainer: jest.fn().mockRejectedValue(new Error('daemon disappeared during run')),
            });
            const service = new QuickStartServiceImpl(runtime);
            const events: StageEvent[] = [];

            for await (const event of service.provision(new AbortController().signal)) {
                events.push(event);
            }

            expect(events.at(-1)).toMatchObject({
                stage: 'error',
                status: 'error',
                message: `Docker became unavailable during setup: daemon disappeared during ${
                    failingStage === 'pulling' ? 'pull' : 'run'
                }`,
                dockerReadiness: unavailable,
            });
            expect(isDockerReady).toHaveBeenLastCalledWith({ forceRefresh: true });
        },
    );

    // The webview acts on the terminal event the moment it arrives (Retry becomes clickable), so
    // the in-progress guard has to be clear by then. It was not for the Docker-readiness failure,
    // which made every other Retry click bounce off "Setup is already in progress.".
    it('clears the in-progress guard before reporting a Docker readiness failure', async () => {
        ext.secretStorage = fakeSecretStorage({});
        ext.context = fakeContext(fakeMemento());
        const unavailable: DockerReadiness = {
            outcome: 'diagnosed',
            environment: 'linux',
            endpointKind: 'unixSocket',
            provider: 'dockerEngine',
            providerEvidence: 'liveDaemon',
            executionTarget: 'local',
            failureKind: 'daemonUnavailable',
            canContinueAnyway: false,
            checkedAtMs: 1,
            cliInstalled: true,
            daemonReachable: false,
        };
        const service = new QuickStartServiceImpl(provisionRuntime({ readiness: unavailable }));
        const retryEvents: StageEvent[] = [];

        for await (const event of service.provision(new AbortController().signal)) {
            if (event.status !== 'error') {
                continue;
            }
            expect(event).toMatchObject({ stage: 'checking', status: 'error' });
            for await (const retryEvent of service.provision(new AbortController().signal)) {
                retryEvents.push(retryEvent);
            }
        }

        expect(retryEvents[0]).toMatchObject({ stage: 'checking', status: 'active' });
        expect(retryEvents.map((event) => event.message)).not.toContain('Setup is already in progress.');
    });

    it('keeps an image failure on the provisioning path when Docker remains ready', async () => {
        ext.secretStorage = fakeSecretStorage({});
        ext.context = fakeContext(fakeMemento());
        const ready: DockerReadiness = {
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
        const runtime = mockRuntime({
            isDockerReady: jest.fn().mockResolvedValue(ready),
            listByLabel: jest.fn().mockResolvedValue([]),
            removeVolume: jest.fn().mockResolvedValue(undefined),
            isPortFree: jest.fn().mockResolvedValue(true),
            pullImage: jest.fn().mockRejectedValue(new Error('manifest unknown')),
        });
        const service = new QuickStartServiceImpl(runtime);
        const events: StageEvent[] = [];

        for await (const event of service.provision(new AbortController().signal)) {
            events.push(event);
        }

        expect(events.at(-1)).toMatchObject({ stage: 'error', error: 'manifest unknown' });
        expect(events.at(-1)?.dockerReadiness).toBeUndefined();
    });

    it('keeps the original provisioning error when the follow-up Docker result is indeterminate', async () => {
        ext.secretStorage = fakeSecretStorage({});
        ext.context = fakeContext(fakeMemento());
        const ready: DockerReadiness = {
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
        const indeterminate: DockerReadiness = {
            outcome: 'indeterminate',
            environment: 'linux',
            endpointKind: 'unknown',
            provider: 'unknown',
            providerEvidence: 'none',
            executionTarget: 'local',
            failureKind: 'probeTimedOut',
            canContinueAnyway: true,
            checkedAtMs: 2,
            cliInstalled: true,
            daemonReachable: false,
        };
        const runtime = mockRuntime({
            isDockerReady: jest.fn().mockResolvedValueOnce(ready).mockResolvedValueOnce(indeterminate),
            listByLabel: jest.fn().mockResolvedValue([]),
            removeVolume: jest.fn().mockResolvedValue(undefined),
            isPortFree: jest.fn().mockResolvedValue(true),
            pullImage: jest.fn().mockRejectedValue(new Error('manifest unknown')),
        });
        const service = new QuickStartServiceImpl(runtime);
        const events: StageEvent[] = [];

        for await (const event of service.provision(new AbortController().signal)) {
            events.push(event);
        }

        expect(events.at(-1)).toMatchObject({ stage: 'error', error: 'manifest unknown' });
        expect(events.at(-1)?.dockerReadiness).toBeUndefined();
    });

    it('adds the published-port explanation only for dev-container readiness timeouts', () => {
        expect(getReadinessTimeoutMessage('devContainer')).toContain(
            'published localhost port might not be reachable from inside the dev container',
        );
        expect(getReadinessTimeoutMessage('linux')).toBe(
            'DocumentDB did not accept connections in time. It may still be initializing.',
        );
    });

    it('aborts (never removes/wipes) when a managed container exists but no secret is recoverable', async () => {
        ext.secretStorage = fakeSecretStorage({});
        ext.context = fakeContext(fakeMemento());
        const removeContainer = jest.fn().mockResolvedValue(undefined);
        const removeVolume = jest.fn().mockResolvedValue(undefined);
        const service = new QuickStartServiceImpl(
            provisionRuntime({ containers: [{ id: 'c1', alias: DEFAULT_ALIAS }], removeContainer, removeVolume }),
        );

        await drain(service.provision(new AbortController().signal));

        expect(removeVolume).not.toHaveBeenCalled();
        expect(removeContainer).not.toHaveBeenCalled();
        expect(service.getStatus().state).toBe(InstanceState.CredentialsMissing);
    });

    it('aborts (never wipes) when a durable ready record exists but no secret (container already gone)', async () => {
        ext.secretStorage = fakeSecretStorage({});
        const globalState = fakeMemento();
        ext.context = fakeContext(globalState);
        await upsertInstance({
            alias: DEFAULT_ALIAS,
            displayName: 'DocumentDB Local',
            port: 10260,
            phase: 'ready',
        });
        const removeVolume = jest.fn().mockResolvedValue(undefined);
        const service = new QuickStartServiceImpl(provisionRuntime({ containers: [], removeVolume }));

        await drain(service.provision(new AbortController().signal));

        expect(removeVolume).not.toHaveBeenCalled();
        expect(service.getStatus().state).toBe(InstanceState.CredentialsMissing);
    });

    it('proceeds to the clean-slate wipe for a truly-fresh alias (no container, no ready record)', async () => {
        ext.secretStorage = fakeSecretStorage({});
        ext.context = fakeContext(fakeMemento());
        const removeVolume = jest.fn().mockResolvedValue(undefined);
        // The port is busy, so provision performs the (safe) wipe then aborts at the port pre-check.
        const service = new QuickStartServiceImpl(provisionRuntime({ containers: [], portFree: false, removeVolume }));

        await drain(service.provision(new AbortController().signal));

        expect(removeVolume).toHaveBeenCalledTimes(1);
    });

    // Review M4 / I2-2: the recreate-vs-fresh decision is the user's explicit Configure-step choice,
    // not something inferred from whether credentials happen to be readable.
    it('keeps the data volume when stored credentials exist and "Start fresh" was NOT chosen', async () => {
        ext.secretStorage = fakeSecretStorage({});
        ext.context = fakeContext(fakeMemento());
        await seedInstance(DEFAULT_ALIAS, STORED_CONN);
        const removeVolume = jest.fn().mockResolvedValue(undefined);
        const service = new QuickStartServiceImpl(
            provisionRuntime({ containers: [{ id: 'c1', alias: DEFAULT_ALIAS }], portFree: false, removeVolume }),
        );

        await drain(service.provision(new AbortController().signal));

        expect(removeVolume).not.toHaveBeenCalled();
    });

    it('wipes the data volume when "Start fresh" was chosen, even though credentials are readable', async () => {
        ext.secretStorage = fakeSecretStorage({});
        ext.context = fakeContext(fakeMemento());
        await seedInstance(DEFAULT_ALIAS, STORED_CONN);
        const removeVolume = jest.fn().mockResolvedValue(undefined);
        const service = new QuickStartServiceImpl(
            provisionRuntime({ containers: [{ id: 'c1', alias: DEFAULT_ALIAS }], portFree: false, removeVolume }),
        );

        await drain(service.provision(new AbortController().signal, { startFresh: true }));

        expect(removeVolume).toHaveBeenCalledTimes(1);
    });

    it('lets an explicit "Start fresh" recover a credential-unavailable instance instead of refusing', async () => {
        ext.secretStorage = fakeSecretStorage({});
        ext.context = fakeContext(fakeMemento());
        const removeVolume = jest.fn().mockResolvedValue(undefined);
        const service = new QuickStartServiceImpl(
            provisionRuntime({ containers: [{ id: 'c1', alias: DEFAULT_ALIAS }], portFree: false, removeVolume }),
        );

        await drain(service.provision(new AbortController().signal, { startFresh: true }));

        // Previously this was a hard refusal (CredentialsMissing) that sent the user hunting for a
        // separate Delete Container command; the warned Start-fresh path now lives in the wizard.
        expect(removeVolume).toHaveBeenCalledTimes(1);
        expect(service.getStatus().state).not.toBe(InstanceState.CredentialsMissing);
    });

    it('continues past an indeterminate readiness result only when explicitly requested', async () => {
        ext.secretStorage = fakeSecretStorage({});
        ext.context = fakeContext(fakeMemento());
        const removeVolume = jest.fn().mockResolvedValue(undefined);
        const service = new QuickStartServiceImpl(
            provisionRuntime({
                containers: [],
                portFree: false,
                removeVolume,
                readiness: {
                    outcome: 'indeterminate',
                    environment: 'linux',
                    endpointKind: 'unixSocket',
                    provider: 'unknown',
                    providerEvidence: 'none',
                    executionTarget: 'local',
                    failureKind: 'unknown',
                    canContinueAnyway: true,
                    checkedAtMs: Date.now(),
                    cliInstalled: true,
                    daemonReachable: false,
                },
            }),
        );

        await drain(service.provision(new AbortController().signal, { continueAnyway: true }));

        expect(removeVolume).toHaveBeenCalledTimes(1);
    });

    it('does not bypass a diagnosed readiness failure', async () => {
        ext.secretStorage = fakeSecretStorage({});
        ext.context = fakeContext(fakeMemento());
        const removeVolume = jest.fn().mockResolvedValue(undefined);
        const service = new QuickStartServiceImpl(
            provisionRuntime({
                containers: [],
                portFree: false,
                removeVolume,
                readiness: {
                    outcome: 'diagnosed',
                    environment: 'linux',
                    endpointKind: 'unixSocket',
                    provider: 'unknown',
                    providerEvidence: 'none',
                    executionTarget: 'local',
                    failureKind: 'permissionDenied',
                    canContinueAnyway: false,
                    checkedAtMs: Date.now(),
                    cliInstalled: true,
                    daemonReachable: false,
                },
            }),
        );

        await drain(service.provision(new AbortController().signal, { continueAnyway: true }));

        expect(removeVolume).not.toHaveBeenCalled();
        expect(service.getStatus().state).toBe(InstanceState.Error);
    });
});
