/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * WP-3 (review 798): provisioning durability + the always-explicit port model.
 *
 * Kept in its own file because it mocks `mongodb`, so the readiness probe resolves immediately and
 * a provision can be driven end to end — the other suites deliberately stop at pull/create.
 */

import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { StorageService } from '../storageService';
import { disposeQuickStartOutputChannel, type IContainerRuntime } from './ContainerRuntime';
import { QuickStartServiceImpl } from './QuickStartService';
import {
    getInstance,
    listInstances,
    readConnectionString,
    upsertInstance,
    writeConnectionString,
} from './quickStartStore';
import {
    DEFAULT_ALIAS,
    InstanceState,
    QUICK_START_ALIAS_LABEL_KEY,
    QUICK_START_LABEL_KEY,
    QUICK_START_OPERATION_LABEL_KEY,
    QUICK_START_PORT,
    type StageEvent,
} from './quickStartTypes';

/** Called on every readiness/sample-data probe, so a test can observe the world mid-provision. */
let onProbe: () => void | Promise<void> = () => undefined;

jest.mock('mongodb', () => ({
    MongoClient: class {
        public async connect(): Promise<unknown> {
            // Awaited so a hook can read the durable store, which is async since I3-1.
            await onProbe();
            return this;
        }
        public db(): unknown {
            return {
                command: () => Promise.resolve({ ok: 1 }),
            };
        }
        public close(): Promise<void> {
            return Promise.resolve();
        }
    },
}));

jest.mock('../../documentdb/ClustersClient', () => ({
    ClustersClient: { deleteClient: () => Promise.resolve() },
}));

jest.mock('../../documentdb/CredentialCache', () => ({
    CredentialCache: { setAuthCredentials: jest.fn(), deleteCredentials: jest.fn() },
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

interface RuntimeOptions {
    readonly portFree?: boolean;
    readonly containers?: Array<{ id: string; labels?: Record<string, string> }>;
    readonly createAndRunContainer?: jest.Mock;
    readonly listByLabel?: jest.Mock;
    readonly removeVolume?: jest.Mock;
    readonly volumeExists?: jest.Mock;
}

function runtimeFor(options: RuntimeOptions = {}): IContainerRuntime {
    return {
        isDockerReady: jest.fn().mockResolvedValue({
            outcome: 'ready',
            environment: 'linux',
            endpointKind: 'unixSocket',
            canContinueAnyway: false,
            checkedAtMs: Date.now(),
            cliInstalled: true,
            daemonReachable: true,
        }),
        isPortFree: jest.fn().mockResolvedValue(options.portFree ?? true),
        listByLabel: options.listByLabel ?? jest.fn().mockResolvedValue(options.containers ?? []),
        pullImage: jest.fn().mockResolvedValue(undefined),
        createAndRunContainer: options.createAndRunContainer ?? jest.fn().mockResolvedValue('c1'),
        inspectContainer: jest.fn().mockResolvedValue({
            id: 'c1',
            status: 'running',
            ports: [{ containerPort: QUICK_START_PORT, hostPort: QUICK_START_PORT }],
        }),
        startContainer: jest.fn().mockResolvedValue(undefined),
        stopContainer: jest.fn().mockResolvedValue(undefined),
        removeContainer: jest.fn().mockResolvedValue(undefined),
        removeVolume: options.removeVolume ?? jest.fn().mockResolvedValue(undefined),
        volumeExists: options.volumeExists ?? jest.fn().mockResolvedValue(false),
        listContainersUsingVolume: jest.fn().mockResolvedValue([]),
        execShellInContainer: jest.fn().mockResolvedValue(undefined),
        followLogs: jest.fn().mockResolvedValue(undefined),
    } as unknown as IContainerRuntime;
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

    beforeEach(() => {
        originalSecretStorage = ext.secretStorage;
        originalContext = ext.context;
        secretStorage = fakeSecretStorage();
        globalState = fakeMemento();
        ext.secretStorage = secretStorage;
        ext.context = fakeContext(globalState);
        onProbe = () => undefined;
    });

    afterEach(() => {
        ext.secretStorage = originalSecretStorage;
        ext.context = originalContext;
        onProbe = () => undefined;
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
            runtimeFor({ createAndRunContainer: jest.fn().mockRejectedValue(new Error('create blew up')) }),
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

    // #946: with the pre-clean gone, a fresh attempt's volume would otherwise block every retry.
    it('removes the volume its own failed fresh attempt created', async () => {
        const removeVolume = jest.fn().mockResolvedValue(undefined);
        const createAndRunContainer = jest.fn().mockResolvedValue('c1');
        const controller = new AbortController();
        onProbe = () => controller.abort();
        const service = new QuickStartServiceImpl(runtimeFor({ removeVolume, createAndRunContainer }));

        await collect(service.provision(controller.signal));

        expect(removeVolume).toHaveBeenCalledTimes(1);
        expect(removeVolume.mock.invocationCallOrder[0]).toBeGreaterThan(
            createAndRunContainer.mock.invocationCallOrder[0],
        );
    });

    it('keeps the volume when a failed attempt was reusing existing data', async () => {
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
        const removeVolume = jest.fn().mockResolvedValue(undefined);
        const controller = new AbortController();
        onProbe = () => controller.abort();
        const service = new QuickStartServiceImpl(
            runtimeFor({ volumeExists: jest.fn().mockResolvedValue(true), removeVolume }),
        );

        await collect(service.provision(controller.signal));

        expect(removeVolume).not.toHaveBeenCalled();
    });

    it('never removes the volume when its own create failed (the two-window race loser)', async () => {
        const removeVolume = jest.fn().mockResolvedValue(undefined);
        const service = new QuickStartServiceImpl(
            runtimeFor({
                removeVolume,
                createAndRunContainer: jest
                    .fn()
                    .mockRejectedValue(new Error('The container name "/vscode-documentdb-local" is already in use')),
            }),
        );

        await collect(service.provision(new AbortController().signal));

        expect(removeVolume).not.toHaveBeenCalled();
    });

    // Review F2: `docker run` can create the container and volume and still fail (a Cancel after it
    // returns, a port bind error). The id is never captured, so only the operation-scoped sweep
    // knows the volume is this run's.
    it.each([
        ['a start failure', false],
        ['a Cancel after docker run returned', true],
    ])('removes its own volume after %s left an orphaned container', async (_label, cancel) => {
        const controller = new AbortController();
        const removeContainer = jest.fn().mockResolvedValue(undefined);
        const removeVolume = jest.fn().mockResolvedValue(undefined);
        const runtime = runtimeFor({
            removeVolume,
            listByLabel: jest.fn((filter: Record<string, string>) =>
                Promise.resolve(filter[QUICK_START_OPERATION_LABEL_KEY] ? [{ id: 'orphan1', labels: filter }] : []),
            ),
            createAndRunContainer: cancel
                ? jest.fn(() => {
                      controller.abort();
                      return Promise.resolve('c1');
                  })
                : jest.fn().mockRejectedValue(new Error('Bind for 127.0.0.1:10260 failed: port is already allocated')),
        });
        (runtime as unknown as { removeContainer: jest.Mock }).removeContainer = removeContainer;
        const service = new QuickStartServiceImpl(runtime);

        await collect(service.provision(controller.signal));

        expect(removeContainer).toHaveBeenCalledWith('orphan1');
        expect(removeVolume).toHaveBeenCalledTimes(1);
        expect(removeVolume.mock.invocationCallOrder[0]).toBeGreaterThan(removeContainer.mock.invocationCallOrder[0]);
    });

    it('keeps the volume when a reusing attempt left an orphaned container', async () => {
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
        const removeVolume = jest.fn().mockResolvedValue(undefined);
        const service = new QuickStartServiceImpl(
            runtimeFor({
                volumeExists: jest.fn().mockResolvedValue(true),
                removeVolume,
                listByLabel: jest.fn((filter: Record<string, string>) =>
                    Promise.resolve(filter[QUICK_START_OPERATION_LABEL_KEY] ? [{ id: 'orphan1', labels: filter }] : []),
                ),
                createAndRunContainer: jest.fn().mockRejectedValue(new Error('port is already allocated')),
            }),
        );

        await collect(service.provision(new AbortController().signal));

        expect(removeVolume).not.toHaveBeenCalled();
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
            runtimeFor({ createAndRunContainer: jest.fn().mockRejectedValue(new Error('create blew up')) }),
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
            runtimeFor({ createAndRunContainer: jest.fn().mockRejectedValue(new Error('create blew up')) }),
        );

        await collect(service.provision(new AbortController().signal));

        expect((await getInstance(DEFAULT_ALIAS))?.phase).toBe('ready');
    });

    // H4: the loser of a two-window create race reaches the id-less cleanup branch, where an
    // unscoped by-label sweep would have removed the WINNER's container.
    it('scopes the orphan sweep to this run own operation label (H4)', async () => {
        const listByLabel = jest.fn().mockResolvedValue([]);
        const service = new QuickStartServiceImpl(
            runtimeFor({
                listByLabel,
                // A create that throws leaves no captured id, which is the branch that sweeps.
                createAndRunContainer: jest
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
        const createAndRunContainer = jest.fn().mockResolvedValue('c1');
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
        const createAndRunContainer = jest.fn().mockResolvedValue('c1');
        const service = new QuickStartServiceImpl(runtimeFor({ createAndRunContainer }));

        await collect(service.provision(new AbortController().signal, { port: 10333 }));

        expect((createAndRunContainer.mock.calls[0][0] as { hostPort: number }).hostPort).toBe(10333);
    });

    // Someone else created the volume while the image downloaded. Mounting it would use their data,
    // and a failure would then remove it.
    it('stops without touching a data volume that appeared during the pull', async () => {
        const removeVolume = jest.fn().mockResolvedValue(undefined);
        const runtime = runtimeFor({
            removeVolume,
            volumeExists: jest.fn().mockResolvedValueOnce(false).mockResolvedValue(true),
        });
        const service = new QuickStartServiceImpl(runtime);

        const events = await collect(service.provision(new AbortController().signal));

        expect(runtime.createAndRunContainer).not.toHaveBeenCalled();
        expect(removeVolume).not.toHaveBeenCalled();
        expect(events.at(-1)?.message).toEqual({ key: 'credentialsUnavailable' });
        expect(service.getStatus().state).toBe(InstanceState.CredentialsMissing);
    });

    it('refuses to recreate onto a data volume another container mounts', async () => {
        await writeConnectionString(
            DEFAULT_ALIAS,
            `mongodb://u1:p1@localhost:${QUICK_START_PORT}/?tls=true&tlsAllowInvalidCertificates=true`,
            { displayName: 'DocumentDB Local', port: QUICK_START_PORT },
        );
        const runtime = runtimeFor({ volumeExists: jest.fn().mockResolvedValue(true) });
        (runtime.listContainersUsingVolume as jest.Mock).mockResolvedValue([{ id: 'h1', name: 'holder' }]);
        const service = new QuickStartServiceImpl(runtime);

        const events = await collect(service.provision(new AbortController().signal));

        expect(runtime.createAndRunContainer).not.toHaveBeenCalled();
        expect(events.at(-1)?.message).toEqual({ key: 'dataVolumeInUse', detail: 'holder' });
    });

    describe('sample data initialization', () => {
        // Stored credentials outlive a discarded volume (Start over after a readiness timeout), so
        // the next run reuses them onto a brand-new, empty volume.
        it('seeds a new volume even when it reuses stored credentials', async () => {
            await writeConnectionString(
                DEFAULT_ALIAS,
                `mongodb://u1:p1@localhost:${QUICK_START_PORT}/?tls=true&tlsAllowInvalidCertificates=true`,
                { displayName: 'DocumentDB Local', port: QUICK_START_PORT },
            );
            const runtime = runtimeFor();
            const service = new QuickStartServiceImpl(runtime);

            await collect(service.provision(new AbortController().signal));

            expect(runtime.execShellInContainer).toHaveBeenCalledTimes(1);
        });

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
            jest.spyOn(runtime, 'execShellInContainer').mockImplementation(async () => {
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

            await collect(service.provision(new AbortController().signal, { loadSampleData: false }));

            expect(runtime.execShellInContainer).not.toHaveBeenCalled();
            expect(service.getStatus().state).toBe(InstanceState.Running);
        });

        // #946 DATA-4: a reused volume already had its first setup; seeding again would bring back
        // sample documents the user deleted.
        it('does not seed a reused data volume', async () => {
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
            const runtime = runtimeFor({ volumeExists: jest.fn().mockResolvedValue(true) });
            const service = new QuickStartServiceImpl(runtime);

            await collect(service.provision(new AbortController().signal));

            expect(runtime.execShellInContainer).not.toHaveBeenCalled();
            expect(service.getStatus().state).toBe(InstanceState.Running);
        });

        it('keeps the database usable without retrying a failed sample load', async () => {
            const runtime = runtimeFor();
            jest.spyOn(runtime, 'execShellInContainer').mockRejectedValue(new Error('initialization failed'));
            const service = new QuickStartServiceImpl(runtime);

            const events = await collect(service.provision(new AbortController().signal));

            expect(runtime.execShellInContainer).toHaveBeenCalledTimes(1);
            expect(events.at(-1)).toMatchObject({ stage: 'done', status: 'done' });
            expect(service.getStatus().state).toBe(InstanceState.Running);
        });
    });

    // M5/3b: the port is pre-checked before the pull, which can take minutes — so a bind failure at
    // create time is a real (if rare) outcome and must not leak the raw daemon string.
    it('reports a Docker port-allocation failure in the same words as the pre-check (M5)', async () => {
        const service = new QuickStartServiceImpl(
            runtimeFor({
                createAndRunContainer: jest
                    .fn()
                    .mockRejectedValue(new Error('Bind for 127.0.0.1:10260 failed: port is already allocated')),
            }),
        );

        const events = await collect(service.provision(new AbortController().signal));

        expect(events.at(-1)?.message).toEqual({ key: 'portInUse', port: QUICK_START_PORT });
        // The daemon's own wording never rides along: a keyed message has nowhere to put it.
        expect(events.at(-1)?.message?.detail).toBeUndefined();
    });

    describe('suggestPort / checkPort (Configure-step validation, L3)', () => {
        it('suggests the canonical port when it is free', async () => {
            const service = new QuickStartServiceImpl(runtimeFor());

            await expect(service.suggestPort()).resolves.toBe(QUICK_START_PORT);
        });

        it('walks forward to the first free port', async () => {
            const runtime = runtimeFor();
            (runtime.isPortFree as unknown as jest.Mock).mockImplementation((port: number) =>
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
});
