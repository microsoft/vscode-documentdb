/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { disposeQuickStartOutputChannel, type IContainerRuntime } from './ContainerRuntime';
import { PROVISIONING_LEASE_TTL_MS, readRegistry, upsertInstanceRecord } from './quickStartRegistry';
import { getReadinessTimeoutMessage, QuickStartServiceImpl } from './QuickStartService';
import {
    DEFAULT_ALIAS,
    type DockerReadiness,
    imageRefKey,
    InstanceState,
    LEGACY_IMAGE_REF_KEY,
    LEGACY_SECRET_KEY,
    QUICK_START_ALIAS_LABEL_KEY,
    QUICK_START_LABEL_KEY,
    QUICK_START_PORT,
    secretKey,
    type StageEvent,
} from './quickStartTypes';

// The R1 belt-and-suspenders safety path (WI-1): before the activation migration copies the legacy
// flat secret to the alias-keyed one, the service must still (a) adopt an existing labelled container
// rather than remove it, and (b) decide `reusing=true` so the data volume is never wiped — both via
// `readStoredConnectionString`'s legacy fallback. The injectable runtime (WI-0) makes this testable.

const LEGACY_CONN = 'mongodb://u1:p1@localhost:10273/?tls=true&tlsAllowInvalidCertificates=true';

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
        ...overrides,
    } as unknown as IContainerRuntime;
}

describe('QuickStartService — R1 legacy-fallback safety (WI-1)', () => {
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

    it('reconcile() adopts a labelled container via the legacy secret and never removes it or its volume', async () => {
        ext.secretStorage = fakeSecretStorage({ [LEGACY_SECRET_KEY]: LEGACY_CONN });
        ext.context = { globalState: fakeMemento() } as unknown as vscode.ExtensionContext;

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

        // The legacy fallback made the stored-secret read succeed, so the no-secret orphan-removal
        // branch was skipped: the container is adopted, not removed, and the volume is never touched.
        expect(removeContainer).not.toHaveBeenCalled();
        expect(removeVolume).not.toHaveBeenCalled();
        expect(service.getStatus().state).toBe(InstanceState.Stopped);
    });

    it('willReuseExistingInstance() is true when only the legacy secret exists (protects the volume-wipe gate)', async () => {
        ext.secretStorage = fakeSecretStorage({ [LEGACY_SECRET_KEY]: LEGACY_CONN });
        ext.context = { globalState: fakeMemento() } as unknown as vscode.ExtensionContext;

        const service = new QuickStartServiceImpl(mockRuntime({}));

        expect(await service.willReuseExistingInstance()).toBe(true);
    });

    it('reconcile() with NO stored secret surfaces the orphan as credential-unavailable (never removes it or its volume)', async () => {
        ext.secretStorage = fakeSecretStorage({});
        ext.context = { globalState: fakeMemento() } as unknown as vscode.ExtensionContext;

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

    it('deleteContainer() purges BOTH the alias-keyed and legacy keys (a full clean slate)', async () => {
        ext.secretStorage = fakeSecretStorage({
            [secretKey(DEFAULT_ALIAS)]: LEGACY_CONN,
            [LEGACY_SECRET_KEY]: LEGACY_CONN,
        });
        const globalState = fakeMemento();
        await globalState.update(imageRefKey(DEFAULT_ALIAS), 'ghcr.io/documentdb/documentdb-local:1.0.0');
        await globalState.update(LEGACY_IMAGE_REF_KEY, 'ghcr.io/documentdb/documentdb-local:1.0.0');
        await upsertInstanceRecord(globalState, {
            alias: DEFAULT_ALIAS,
            displayName: 'DocumentDB Local',
            port: 10273,
            phase: 'ready',
        });
        ext.context = { globalState } as unknown as vscode.ExtensionContext;

        const service = new QuickStartServiceImpl(mockRuntime({}));

        const outcome = await service.deleteContainer();
        // No container to reconcile against ⇒ records/secrets are cleaned and the outcome is 'deleted'.
        expect(outcome).toBe('deleted');

        // Explicit Delete leaves no stale credentials/image behind — neither alias-keyed nor legacy —
        // so the next provision can never silently reuse them (locks the opus47-N1 fix).
        expect(await ext.secretStorage.get(secretKey(DEFAULT_ALIAS))).toBeUndefined();
        expect(await ext.secretStorage.get(LEGACY_SECRET_KEY)).toBeUndefined();
        expect(globalState.get(imageRefKey(DEFAULT_ALIAS))).toBeUndefined();
        expect(globalState.get(LEGACY_IMAGE_REF_KEY)).toBeUndefined();
        // ...and the registry record is gone, so the instance won't linger as a ghost tree row (WI-2).
        expect(readRegistry(globalState).instances).toHaveLength(0);
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

    beforeEach(() => {
        originalSecretStorage = ext.secretStorage;
        originalContext = ext.context;
    });

    afterEach(() => {
        ext.secretStorage = originalSecretStorage;
        ext.context = originalContext;
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
            removeContainer: opts.removeContainer ?? jest.fn().mockResolvedValue(undefined),
            removeVolume: opts.removeVolume ?? jest.fn().mockResolvedValue(undefined),
        });
    }

    it('adopts two labelled containers into isolated per-alias states (running + stopped)', async () => {
        ext.secretStorage = fakeSecretStorage({
            [secretKey(DEFAULT_ALIAS)]: CONN_1,
            [secretKey(ALIAS_2)]: CONN_2,
        });
        ext.context = { globalState: fakeMemento() } as unknown as vscode.ExtensionContext;
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
        expect(
            readRegistry(ext.context.globalState)
                .instances.map((record) => record.alias)
                .sort(),
        ).toEqual([ALIAS_2, DEFAULT_ALIAS].sort());
    });

    it('surfaces a credential-unavailable instance as CredentialsMissing without removing it or its volume (R2)', async () => {
        ext.secretStorage = fakeSecretStorage({}); // no secret for ALIAS_2
        ext.context = { globalState: fakeMemento() } as unknown as vscode.ExtensionContext;
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
        ext.secretStorage = fakeSecretStorage({ [secretKey(ALIAS_2)]: CONN_2 });
        const globalState = fakeMemento();
        await upsertInstanceRecord(globalState, { alias: ALIAS_2, displayName: 'Second', port: 10261, phase: 'ready' });
        ext.context = { globalState } as unknown as vscode.ExtensionContext;
        const service = new QuickStartServiceImpl(reconcileRuntime({ containers: [] }));

        await service.reconcile();

        expect(service.listStatuses().find((status) => status.alias === ALIAS_2)?.missing).toBe(true);
        expect(readRegistry(globalState).instances.some((record) => record.alias === ALIAS_2)).toBe(true);
    });

    it('start() after an external container delete surfaces Missing instead of a silent no-op (#2)', async () => {
        ext.secretStorage = fakeSecretStorage({ [secretKey(DEFAULT_ALIAS)]: CONN_1 });
        ext.context = { globalState: fakeMemento() } as unknown as vscode.ExtensionContext;

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

    it('deleteContainer() refuses to remove a container that is not ours, even when surfaced as Missing (#9)', async () => {
        ext.secretStorage = fakeSecretStorage({ [secretKey(DEFAULT_ALIAS)]: CONN_1 });
        ext.context = { globalState: fakeMemento() } as unknown as vscode.ExtensionContext;

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
        ext.secretStorage = fakeSecretStorage({ [secretKey(DEFAULT_ALIAS)]: CONN_1 });
        ext.context = { globalState: fakeMemento() } as unknown as vscode.ExtensionContext;

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
        await upsertInstanceRecord(globalState, {
            alias: ALIAS_2,
            displayName: 'Second',
            port: 10261,
            phase: 'provisioning',
            leaseAt: Date.now() - PROVISIONING_LEASE_TTL_MS - 1_000,
        });
        ext.context = { globalState } as unknown as vscode.ExtensionContext;
        const service = new QuickStartServiceImpl(reconcileRuntime({ containers: [] }));

        await service.reconcile();

        expect(readRegistry(globalState).instances.some((record) => record.alias === ALIAS_2)).toBe(false);
        expect(service.getStatus(ALIAS_2).state).toBe(InstanceState.NotInstalled);
    });

    it('keeps a FRESH provisioning reservation as Provisioning (not scavenged)', async () => {
        ext.secretStorage = fakeSecretStorage({});
        const globalState = fakeMemento();
        await upsertInstanceRecord(globalState, {
            alias: ALIAS_2,
            displayName: 'Second',
            port: 10261,
            phase: 'provisioning',
            leaseAt: Date.now(),
        });
        ext.context = { globalState } as unknown as vscode.ExtensionContext;
        const service = new QuickStartServiceImpl(reconcileRuntime({ containers: [] }));

        await service.reconcile();

        expect(readRegistry(globalState).instances.some((record) => record.alias === ALIAS_2)).toBe(true);
        expect(service.getStatus(ALIAS_2).state).toBe(InstanceState.Provisioning);
    });

    it('adopts (never scavenges) a container present under a stale provisioning lease, promoting it to ready (Q4)', async () => {
        ext.secretStorage = fakeSecretStorage({ [secretKey(ALIAS_2)]: CONN_2 });
        const globalState = fakeMemento();
        await upsertInstanceRecord(globalState, {
            alias: ALIAS_2,
            displayName: 'Second',
            port: 10261,
            phase: 'provisioning',
            leaseAt: Date.now() - PROVISIONING_LEASE_TTL_MS - 1_000,
        });
        ext.context = { globalState } as unknown as vscode.ExtensionContext;
        const service = new QuickStartServiceImpl(
            reconcileRuntime({
                containers: [{ id: 'c2', alias: ALIAS_2 }],
                inspect: { c2: inspectItem('c2', { running: true, port: 10261 }) },
            }),
        );

        await service.reconcile();

        expect(service.getStatus(ALIAS_2).state).toBe(InstanceState.Running);
        expect(readRegistry(globalState).instances.find((record) => record.alias === ALIAS_2)?.phase).toBe('ready');
    });

    it('deleteContainer() removes a surfaced (no-metadata) instance via a live lookup', async () => {
        ext.secretStorage = fakeSecretStorage({});
        ext.context = { globalState: fakeMemento() } as unknown as vscode.ExtensionContext;
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
        ext.context = { globalState: fakeMemento() } as unknown as vscode.ExtensionContext;
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
        ext.secretStorage = fakeSecretStorage({ [secretKey(DEFAULT_ALIAS)]: CONN_1 });
        const globalState = fakeMemento();
        await upsertInstanceRecord(globalState, {
            alias: DEFAULT_ALIAS,
            displayName: 'DocumentDB Local',
            port: 10273,
            phase: 'ready',
        });
        ext.context = { globalState } as unknown as vscode.ExtensionContext;
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
        expect(await ext.secretStorage.get(secretKey(DEFAULT_ALIAS))).toBe(CONN_1);
        expect(readRegistry(globalState).instances).toHaveLength(1);
        errorMessage.mockRestore();
    });

    it('deleteContainer() removes the LIVE labelled container when the stored metadata id is stale', async () => {
        // GPT-5.6 review follow-up: inspectContainer swallows Docker errors and returns undefined, so a
        // stale metadata id that no longer resolves must NOT be trusted as "already gone". If the
        // original container was externally replaced by a NEW labelled same-alias container, Delete must
        // remove the LIVE container (found authoritatively by label), not wipe records and leave a
        // running ghost that resurfaces as CredentialsMissing.
        ext.secretStorage = fakeSecretStorage({ [secretKey(DEFAULT_ALIAS)]: CONN_1 });
        ext.context = { globalState: fakeMemento() } as unknown as vscode.ExtensionContext;
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
        ext.secretStorage = fakeSecretStorage({ [secretKey(DEFAULT_ALIAS)]: CONN_1 });
        ext.context = { globalState: fakeMemento() } as unknown as vscode.ExtensionContext;
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
        expect(await ext.secretStorage.get(secretKey(DEFAULT_ALIAS))).toBe(CONN_1);
        errorMessage.mockRestore();
    });

    it('deleteContainer() removes EVERY same-alias managed container (no ghost survivor)', async () => {
        // GPT-5.6 review follow-up: a cross-window double-create can leave more than one managed
        // container for the alias (reconcile adopts the newest and LEAVES the rest — pickManagedContainer).
        // Delete is a full clean slate, so it must remove ALL label-matched containers; removing only the
        // first would strand a survivor that resurfaces as a credential-missing ghost.
        ext.secretStorage = fakeSecretStorage({});
        ext.context = { globalState: fakeMemento() } as unknown as vscode.ExtensionContext;
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
        ext.secretStorage = fakeSecretStorage({ [secretKey(DEFAULT_ALIAS)]: CONN_1 });
        ext.context = { globalState: fakeMemento() } as unknown as vscode.ExtensionContext;
        const service = new QuickStartServiceImpl(
            reconcileRuntime({
                containers: [{ id: 'c1', alias: DEFAULT_ALIAS }],
                inspect: { c1: inspectItem('c1', { running: true, port: 10260, image: 'img:1' }) },
            }),
        );

        await service.reconcile();
        await service.reconcile();

        expect(service.getStatus(DEFAULT_ALIAS).state).toBe(InstanceState.Running);
        expect(
            readRegistry(ext.context.globalState).instances.filter((record) => record.alias === DEFAULT_ALIAS),
        ).toHaveLength(1);
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
        findAvailablePort?: number;
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
            findAvailablePort: jest.fn().mockResolvedValue(opts.findAvailablePort),
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
            ext.context = { globalState: fakeMemento() } as unknown as vscode.ExtensionContext;
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
                findAvailablePort: jest.fn().mockResolvedValue(QUICK_START_PORT),
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
                message: 'Docker became unavailable during setup.',
                dockerReadiness: unavailable,
            });
            expect(isDockerReady).toHaveBeenLastCalledWith({ forceRefresh: true });
        },
    );

    it('keeps an image failure on the provisioning path when Docker remains ready', async () => {
        ext.secretStorage = fakeSecretStorage({});
        ext.context = { globalState: fakeMemento() } as unknown as vscode.ExtensionContext;
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
            findAvailablePort: jest.fn().mockResolvedValue(QUICK_START_PORT),
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
        const message = 'Timed out waiting for DocumentDB.';

        expect(getReadinessTimeoutMessage(message, 'devContainer')).toContain(
            'published localhost port might not be reachable from inside the dev container',
        );
        expect(getReadinessTimeoutMessage(message, 'linux')).toBe(message);
    });

    it('aborts (never removes/wipes) when a managed container exists but no secret is recoverable', async () => {
        ext.secretStorage = fakeSecretStorage({});
        ext.context = { globalState: fakeMemento() } as unknown as vscode.ExtensionContext;
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
        await upsertInstanceRecord(globalState, {
            alias: DEFAULT_ALIAS,
            displayName: 'DocumentDB Local',
            port: 10260,
            phase: 'ready',
        });
        ext.context = { globalState } as unknown as vscode.ExtensionContext;
        const removeVolume = jest.fn().mockResolvedValue(undefined);
        const service = new QuickStartServiceImpl(provisionRuntime({ containers: [], removeVolume }));

        await drain(service.provision(new AbortController().signal));

        expect(removeVolume).not.toHaveBeenCalled();
        expect(service.getStatus().state).toBe(InstanceState.CredentialsMissing);
    });

    it('proceeds to the clean-slate wipe for a truly-fresh alias (no container, no ready record)', async () => {
        ext.secretStorage = fakeSecretStorage({});
        ext.context = { globalState: fakeMemento() } as unknown as vscode.ExtensionContext;
        const removeVolume = jest.fn().mockResolvedValue(undefined);
        // findAvailablePort → undefined so provision performs the (safe) wipe then aborts at port pick.
        const service = new QuickStartServiceImpl(
            provisionRuntime({ containers: [], findAvailablePort: undefined, removeVolume }),
        );

        await drain(service.provision(new AbortController().signal));

        expect(removeVolume).toHaveBeenCalledTimes(1);
    });

    it('continues past an indeterminate readiness result only when explicitly requested', async () => {
        ext.secretStorage = fakeSecretStorage({});
        ext.context = { globalState: fakeMemento() } as unknown as vscode.ExtensionContext;
        const removeVolume = jest.fn().mockResolvedValue(undefined);
        const service = new QuickStartServiceImpl(
            provisionRuntime({
                containers: [],
                findAvailablePort: undefined,
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
        ext.context = { globalState: fakeMemento() } as unknown as vscode.ExtensionContext;
        const removeVolume = jest.fn().mockResolvedValue(undefined);
        const service = new QuickStartServiceImpl(
            provisionRuntime({
                containers: [],
                findAvailablePort: undefined,
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
