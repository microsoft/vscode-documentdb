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

import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { StorageService } from '../storageService';
import { disposeQuickStartOutputChannel, type IContainerRuntime, SETUP_CLEANUP_TIMEOUT_MS } from './ContainerRuntime';
import { DockerCommandError, DockerCommandTimeoutError } from './dockerCommand';
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
    QUICK_START_IMAGE_REPOSITORY,
    QUICK_START_LABEL_KEY,
    QUICK_START_OPERATION_LABEL_KEY,
    QUICK_START_PORT,
    type StageEvent,
} from './quickStartTypes';

/** Called on every readiness/sample-data probe, so a test can observe the world mid-provision. */
let onProbe: () => void | Promise<void> = () => undefined;

// Real fs, with `rm` and `writeFile` spyable so a test can fail one env-file write or delete.
jest.mock('fs/promises', () => {
    const actual = jest.requireActual<typeof fsPromises>('fs/promises');
    return { ...actual, rm: jest.fn(actual.rm), writeFile: jest.fn(actual.writeFile) };
});

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
    readonly volumeExists?: boolean;
    readonly overrides?: Partial<IContainerRuntime>;
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
        removeVolume: jest.fn().mockResolvedValue(undefined),
        volumeExists: jest.fn().mockResolvedValue(options.volumeExists ?? false),
        execShellInContainer: jest.fn().mockResolvedValue(undefined),
        followLogs: jest.fn().mockResolvedValue(undefined),
        readRecentLogs: jest.fn().mockResolvedValue(''),
        ...options.overrides,
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

            await collect(service.provision(new AbortController().signal));

            expect(runtime.execShellInContainer).toHaveBeenCalledTimes(seedCalls);
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

    // #948 ERR-1: Docker's stderr used to be dropped, so every failure read "Process exited with code N".
    describe('Docker command failures', () => {
        it('recognizes the port bind failure Docker actually prints', async () => {
            const service = new QuickStartServiceImpl(
                runtimeFor({
                    createAndRunContainer: jest
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
                    createAndRunContainer: jest
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
                        pullImage: jest
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
                        pullImage: jest
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
                        pullImage: jest
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
            const listByLabel = jest.fn().mockResolvedValue([]);
            const removeContainer = jest.fn().mockResolvedValue(undefined);
            const service = new QuickStartServiceImpl(
                runtimeFor({
                    createAndRunContainer: jest.fn().mockRejectedValue(new DockerCommandTimeoutError(90_000)),
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
                    inspectContainer: jest.fn(() => {
                        inspections += 1;
                        return Promise.resolve({
                            id: 'c1',
                            status: inspections === 1 ? 'running' : 'exited',
                            ports: [{ containerPort: QUICK_START_PORT, hostPort: QUICK_START_PORT }],
                            raw: JSON.stringify({ State: { Status: 'exited', ExitCode: 1 } }),
                        });
                    }) as unknown as IContainerRuntime['inspectContainer'],
                    readRecentLogs: jest.fn().mockResolvedValue(logs),
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
            const now = jest.spyOn(Date, 'now').mockImplementation(() => realNow() + skipped);
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

    describe('credential exposure (#947)', () => {
        const PASSWORD = 'custom-password-947';

        it('removes the env-file once docker run settles, before the readiness wait', async () => {
            let envFile: string | undefined;
            let presentDuringRun = false;
            let presentAtProbe: boolean | undefined;
            const createAndRunContainer = jest.fn(async (options: { environmentFiles?: string[] }) => {
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

        it('retries a failed env-file delete when provisioning ends', async () => {
            let envFile: string | undefined;
            const createAndRunContainer = jest.fn(async (options: { environmentFiles?: string[] }) => {
                envFile = options.environmentFiles?.[0];
                return 'c1';
            });
            const rm = jest.mocked(fsPromises.rm);
            rm.mockClear();
            rm.mockRejectedValueOnce(Object.assign(new Error('busy'), { code: 'EPERM' }));
            const service = new QuickStartServiceImpl(runtimeFor({ createAndRunContainer }));

            await collect(service.provision(new AbortController().signal));

            expect(rm.mock.calls.filter(([p]) => p === envFile)).toHaveLength(2);
            expect(fs.existsSync(envFile!)).toBe(false);
        });

        it('removes a partly written env file when the write fails', async () => {
            const actual = jest.requireActual<typeof fsPromises>('fs/promises');
            let envFile: string | undefined;
            jest.mocked(fsPromises.writeFile).mockImplementationOnce(async (file, _data, options) => {
                envFile = file as string;
                await actual.writeFile(envFile, 'USERNAME=admin\nPASSWORD=', options);
                throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
            });
            const createAndRunContainer = jest.fn();
            const service = new QuickStartServiceImpl(runtimeFor({ createAndRunContainer }));

            await collect(service.provision(new AbortController().signal));

            expect(envFile).toMatch(/documentdb-quickstart-\d+-[0-9a-f]{16}\.env$/);
            expect(fs.existsSync(envFile!)).toBe(false);
            expect(createAndRunContainer).not.toHaveBeenCalled();
        });

        it('masks the password in the readiness-timeout detail', async () => {
            const appendLine = vscode.window.createOutputChannel('test').appendLine as jest.Mock;
            appendLine.mockClear();
            const expired = Date.now() + 10 * 60_000;
            const clock = jest.spyOn(Date, 'now');
            // The driver error can echo the connection string; expire the wait after one attempt.
            onProbe = () => {
                clock.mockReturnValue(expired);
                throw new Error(`Authentication failed for mongodb://admin:${PASSWORD}@localhost:10260/`);
            };
            const service = new QuickStartServiceImpl(runtimeFor());

            try {
                await collect(
                    service.provision(new AbortController().signal, { username: 'admin', password: PASSWORD }),
                );
            } finally {
                clock.mockRestore();
            }

            const lines = appendLine.mock.calls.map(([line]) => String(line));
            expect(lines.some((line) => line.startsWith('[readiness-timeout]') && line.includes('***'))).toBe(true);
            expect(lines.join('\n')).not.toContain(PASSWORD);
        });
    });
});
