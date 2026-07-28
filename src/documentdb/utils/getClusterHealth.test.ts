/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Document, type MongoClient } from 'mongodb';

import {
    getClusterPrivileges,
    getFailedCommandName,
    getStorageStats,
    killOperation,
    listCurrentOperations,
    sampleClusterHealth,
} from './getClusterHealth';

type CommandHandler = (command: Record<string, unknown>) => unknown;

interface FakeClientOptions {
    adminCommand?: CommandHandler;
    aggregate?: (pipeline: Document[]) => unknown[];
    listDatabases?: () => unknown;
    dbCommand?: (databaseName: string, command: Record<string, unknown>) => unknown;
}

function createFakeClient(options: FakeClientOptions): {
    client: MongoClient;
    adminCommands: Array<Record<string, unknown>>;
} {
    const adminCommands: Array<Record<string, unknown>> = [];

    const admin = {
        command: jest.fn((command: Record<string, unknown>): Promise<unknown> => {
            adminCommands.push(command);
            if (!options.adminCommand) {
                return Promise.reject(new Error('command not supported'));
            }
            try {
                return Promise.resolve(options.adminCommand(command));
            } catch (error) {
                return Promise.reject(error instanceof Error ? error : new Error(String(error)));
            }
        }),
        listDatabases: jest.fn((): Promise<unknown> => {
            if (!options.listDatabases) {
                return Promise.reject(new Error('listDatabases not supported'));
            }
            return Promise.resolve(options.listDatabases());
        }),
    };

    const client = {
        db: (databaseName?: string) => ({
            admin: () => admin,
            aggregate: (pipeline: Document[]) => ({
                toArray: (): Promise<unknown[]> => {
                    if (!options.aggregate) {
                        return Promise.reject(new Error('$currentOp not supported'));
                    }
                    try {
                        return Promise.resolve(options.aggregate(pipeline));
                    } catch (error) {
                        // Rejected rather than thrown synchronously, so a handler that
                        // refuses a pipeline behaves like a real driver failure.
                        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
                    }
                },
            }),
            command: (command: Record<string, unknown>): Promise<unknown> => {
                if (!options.dbCommand) {
                    return Promise.reject(new Error('command not supported'));
                }
                try {
                    return Promise.resolve(options.dbCommand(databaseName ?? '', command));
                } catch (error) {
                    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
                }
            },
        }),
    } as unknown as MongoClient;

    return { client, adminCommands };
}

describe('sampleClusterHealth', () => {
    it('still returns a latency reading when serverStatus is unsupported', async () => {
        const { client } = createFakeClient({
            adminCommand: (command) => {
                if (command.ping === 1) {
                    return { ok: 1 };
                }
                throw new Error('CommandNotSupported: serverStatus');
            },
            aggregate: () => [{ opid: 7, op: 'query', ns: 'db.coll', active: true }],
        });

        const sample = await sampleClusterHealth(client);

        expect(sample.pingLatencyMs).not.toBeNull();
        expect(sample.errors.map(getFailedCommandName)).toContain('serverStatus');
        // The reason must survive: it is the only signal distinguishing an unsupported
        // command from Unauthorized or a TLS timeout once telemetry is suppressed.
        expect(sample.errors.join(' ')).toContain('CommandNotSupported');
        expect(sample.uptimeSeconds).toBeNull();
        expect(sample.opcounters).toBeNull();
        expect(sample.activeOperations).toBe(1);
    });

    it('records a null latency and the reason when the ping itself fails', async () => {
        const { client } = createFakeClient({
            adminCommand: () => {
                throw new Error('connection timed out');
            },
        });

        const sample = await sampleClusterHealth(client);

        // The whole connection-state machine keys on this being null.
        expect(sample.pingLatencyMs).toBeNull();
        expect(sample.errors.map(getFailedCommandName)).toContain('ping');
        expect(sample.errors.join(' ')).toContain('connection timed out');
    });

    it('reads uptime, connections and opcounters when serverStatus is available', async () => {
        const { client } = createFakeClient({
            adminCommand: (command) => {
                if (command.ping === 1) {
                    return { ok: 1 };
                }
                if (command.serverStatus === 1) {
                    return {
                        uptime: 1234,
                        connections: { current: 12 },
                        opcounters: { query: 5, insert: 2, deprecated: { total: 1 } },
                    };
                }
                throw new Error('unexpected command');
            },
            aggregate: () => [],
        });

        const sample = await sampleClusterHealth(client);

        expect(sample.errors).toEqual([]);
        expect(sample.uptimeSeconds).toBe(1234);
        expect(sample.connectionsCurrent).toBe(12);
        expect(sample.opcounters).toEqual({ query: 5, insert: 2 });
        expect(sample.activeOperations).toBe(0);
    });

    it('issues every command of a sample concurrently', async () => {
        // Run in sequence, an unreachable cluster pays the server-selection timeout once per
        // command, so the header badge stays on "Connecting…" for minutes. This guards the
        // failure case by observing the healthy one: all three must be in flight at once.
        const started: string[] = [];
        let release = (): void => {};
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });

        const { client } = createFakeClient({
            adminCommand: (command) => {
                started.push(command.ping === 1 ? 'ping' : 'serverStatus');
                return gate.then(() => ({ ok: 1, uptime: 1 }));
            },
            aggregate: () => {
                started.push('currentOp');
                return [];
            },
        });

        const pending = sampleClusterHealth(client);

        expect(started).toEqual(['ping', 'serverStatus', 'currentOp']);

        release();
        await pending;
    });

    it('keeps the error order stable regardless of which command fails first', async () => {
        const { client } = createFakeClient({
            adminCommand: (command) => {
                // serverStatus answers immediately while the ping is still resolving, so a
                // naive push-on-completion would report them out of order.
                if (command.ping === 1) {
                    return Promise.resolve().then(() => {
                        throw new Error('ping failed');
                    });
                }
                throw new Error('serverStatus failed');
            },
        });

        const sample = await sampleClusterHealth(client);

        expect(sample.errors.map(getFailedCommandName)).toEqual(['ping', 'serverStatus', '$currentOp', 'currentOp']);
    });
});

describe('listCurrentOperations', () => {
    it('maps aggregation results and stringifies the opid', async () => {
        const { client } = createFakeClient({
            aggregate: () => [
                {
                    opid: 42,
                    op: 'query',
                    ns: 'sales.orders',
                    secs_running: 9,
                    active: true,
                    client: '127.0.0.1:1234',
                    command: { find: 'orders' },
                },
            ],
        });

        const result = await listCurrentOperations(client);

        expect(result.errors).toEqual([]);
        expect(result.operations).toHaveLength(1);
        expect(result.operations[0]).toEqual({
            opid: '42',
            opidIsNumeric: true,
            type: 'query',
            namespace: 'sales.orders',
            secsRunning: 9,
            active: true,
            clientDescription: '127.0.0.1:1234',
            commandPreview: '{"find":"orders"}',
        });
    });

    it('drops the server background threads reported as op "none"', async () => {
        const { client } = createFakeClient({
            aggregate: () => [
                { opid: 1, op: 'none', ns: '', active: true, desc: 'Checkpointer' },
                { opid: 2, op: 'none', ns: '', active: true, desc: 'JournalFlusher' },
                { opid: 3, op: 'query', ns: 'sales.orders', active: true, desc: 'conn4' },
            ],
        });

        const result = await listCurrentOperations(client);

        expect(result.operations).toHaveLength(1);
        expect(result.operations[0].opid).toBe('3');
        expect(result.operations[0].clientDescription).toBe('conn4');
    });

    it('drops the $currentOp query that is collecting the list', async () => {
        // The server reports the inspecting aggregation itself. Keeping it would floor the
        // Active Operations tile at 1 on an idle cluster and put a permanent phantom row in
        // the table whose Kill button terminates the dashboard's own poll.
        const { client } = createFakeClient({
            aggregate: () => [
                {
                    opid: 10,
                    op: 'command',
                    ns: 'admin.$cmd.aggregate',
                    active: true,
                    command: { aggregate: 1, pipeline: [{ $currentOp: { allUsers: true } }, { $limit: 100 }] },
                },
                { opid: 11, op: 'query', ns: 'sales.orders', active: true },
            ],
        });

        const result = await listCurrentOperations(client);

        expect(result.operations.map((operation) => operation.opid)).toEqual(['11']);
    });

    it('drops the vCore self-inspection op, which reports no pipeline', async () => {
        // Observed on Azure DocumentDB (vCore): the inspecting aggregation is reported as
        // `{aggregate: ''}` with no namespace, so the pipeline check cannot see it and the
        // tab shows a permanent unkillable row on an idle cluster.
        const { client } = createFakeClient({
            aggregate: () => [
                { opid: '10000012901:1785186130769978', op: 'command', active: true, command: { aggregate: '' } },
                { opid: '10000012902:1785186130769979', op: 'command', ns: 'sales.orders', active: true },
            ],
        });

        const result = await listCurrentOperations(client);

        expect(result.operations.map((operation) => operation.opid)).toEqual(['10000012902:1785186130769979']);
    });

    it('drops the vCore parallel workers of a single user aggregation', async () => {
        // vCore fans one aggregation out internally and reports every worker as its own op
        // with an empty opid, so a single slow query rendered as three rows — two of them
        // unkillable duplicates — and tripled the Active Operations tile.
        const { client } = createFakeClient({
            aggregate: () => [
                { opid: '10000053116:1785197164497492', op: 'command', ns: 'analytics.events', active: true },
                {
                    opid: '',
                    op: 'command',
                    ns: 'analytics.events',
                    active: true,
                    parallelWorker: true,
                    leaderOpPatter: 53116,
                },
                {
                    opid: '',
                    op: 'command',
                    ns: 'analytics.events',
                    active: true,
                    parallelWorker: true,
                    leaderOpPatter: 53116,
                },
            ],
        });

        const result = await listCurrentOperations(client);

        expect(result.operations.map((operation) => operation.opid)).toEqual(['10000053116:1785197164497492']);
    });

    it('excludes parallel workers in the pipeline, before the result limit', async () => {
        const stages: Document[] = [];
        const { client } = createFakeClient({
            aggregate: (pipeline) => {
                stages.push(...pipeline);
                return [];
            },
        });

        await listCurrentOperations(client);

        // Serialized so the workers cannot consume the `$limit` budget on a busy cluster.
        expect(JSON.stringify(stages)).toContain('parallelWorker');
    });

    it('drops the legacy currentOp command that is collecting the list', async () => {
        const { client } = createFakeClient({
            adminCommand: (command) => {
                if (command.currentOp === 1) {
                    return {
                        inprog: [
                            { opid: 20, op: 'command', ns: 'admin.$cmd', active: true, command: { currentOp: 1 } },
                            { opid: 21, op: 'update', ns: 'sales.orders', active: true },
                        ],
                    };
                }
                throw new Error('unexpected command');
            },
        });

        const result = await listCurrentOperations(client);

        expect(result.operations.map((operation) => operation.opid)).toEqual(['21']);
    });

    it('excludes background threads before the result limit is applied', async () => {
        // Regression guard: filtering after `$limit` lets background threads consume the
        // whole budget so real user operations vanish on a busy server.
        const stages: Document[] = [];
        const { client } = createFakeClient({
            aggregate: (pipeline) => {
                stages.push(...pipeline);
                return [];
            },
        });

        await listCurrentOperations(client);

        const matchIndex = stages.findIndex((stage) => '$match' in stage);
        const limitIndex = stages.findIndex((stage) => '$limit' in stage);

        expect(matchIndex).toBeGreaterThanOrEqual(0);
        expect(limitIndex).toBeGreaterThan(matchIndex);
    });

    it('falls back to the legacy currentOp command when the aggregation fails', async () => {
        const { client } = createFakeClient({
            adminCommand: (command) => {
                if (command.currentOp === 1) {
                    return { inprog: [{ opid: 'op-1', op: 'command', ns: 'admin.$cmd', active: false }] };
                }
                throw new Error('unexpected command');
            },
        });

        const result = await listCurrentOperations(client);

        expect(result.errors).toEqual([]);
        expect(result.operations).toHaveLength(1);
        expect(result.operations[0].opid).toBe('op-1');
        expect(result.operations[0].opidIsNumeric).toBe(false);
    });

    it('reports both command names when neither form is supported', async () => {
        const { client } = createFakeClient({});

        const result = await listCurrentOperations(client);

        expect(result.operations).toEqual([]);
        expect(result.errors.map(getFailedCommandName)).toEqual(['$currentOp', 'currentOp']);
    });

    it('reports the cluster-wide scope when the privileged form succeeds', async () => {
        const { client } = createFakeClient({ aggregate: () => [] });

        const result = await listCurrentOperations(client);

        expect(result.scope).toBe('all');
    });

    it('falls back to own operations when the cluster-wide forms are refused', async () => {
        // A connection without the `inprog` privilege: both cluster-wide forms are refused,
        // but the account may always see its own operations. Without the fallback the
        // Operations tab is permanently empty on a least-privileged account.
        const { client } = createFakeClient({
            aggregate: (pipeline) => {
                const stage = pipeline[0] as { $currentOp?: { allUsers?: boolean } };
                if (stage.$currentOp?.allUsers === true) {
                    throw new Error('not authorized on admin to execute command');
                }
                return [{ opid: 5, op: 'query', ns: 'sales.orders', active: true }];
            },
            adminCommand: () => {
                throw new Error('not authorized on admin to execute command');
            },
        });

        const result = await listCurrentOperations(client);

        expect(result.scope).toBe('own');
        expect(result.operations.map((operation) => operation.opid)).toEqual(['5']);
        // A successful fallback is not an error — surfacing one would put a permanent
        // warning on the tab of every cluster that only supports the narrower form.
        expect(result.errors).toEqual([]);
    });

    it('uses $ownOps as the last resort when only the legacy command exists', async () => {
        const { client, adminCommands } = createFakeClient({
            adminCommand: (command) => {
                if (command.currentOp === 1 && command.$ownOps === true) {
                    return { inprog: [{ opid: 'op-9', op: 'update', ns: 'sales.orders', active: true }] };
                }
                throw new Error('not authorized on admin to execute command');
            },
        });

        const result = await listCurrentOperations(client);

        expect(result.scope).toBe('own');
        expect(result.operations.map((operation) => operation.opid)).toEqual(['op-9']);
        expect(adminCommands).toContainEqual({ currentOp: 1, $ownOps: true });
    });

    it('stops after the first attempt when the cluster is unreachable', async () => {
        // Every attempt would pay the full server-selection timeout, so a dead connection
        // must cost one timeout rather than four — the sample interval depends on it.
        let attempts = 0;
        const { client } = createFakeClient({
            aggregate: () => {
                attempts += 1;
                const error = new Error('Server selection timed out after 30000 ms');
                error.name = 'MongoServerSelectionError';
                throw error;
            },
            adminCommand: () => {
                attempts += 1;
                throw new Error('unexpected command');
            },
        });

        const result = await listCurrentOperations(client);

        expect(attempts).toBe(1);
        expect(result.operations).toEqual([]);
        expect(result.errors.map(getFailedCommandName)).toEqual(['$currentOp']);
    });

    it('redacts credential-bearing commands caught in flight', async () => {
        // `currentOp` reports commands verbatim, and `commandPreview` is rendered in a
        // webview tooltip. An authentication handshake or a user-management command caught
        // mid-flight must never carry its secret across that boundary.
        const { client } = createFakeClient({
            aggregate: () => [
                {
                    opid: 1,
                    op: 'command',
                    ns: 'admin.$cmd',
                    active: true,
                    command: { saslStart: 1, payload: 'biwsbj1h' },
                },
                {
                    opid: 2,
                    op: 'command',
                    ns: 'admin.$cmd',
                    active: true,
                    command: { createUser: 'alice', pwd: 'hunter2', roles: ['readWrite'] },
                },
                {
                    opid: 3,
                    op: 'command',
                    ns: 'sales.$cmd',
                    active: true,
                    command: { find: 'orders', filter: { key: 'AKIAsecret' } },
                },
            ],
        });

        const result = await listCurrentOperations(client);
        const previews = result.operations.map((operation) => operation.commandPreview);

        expect(previews[0]).toBe('{"saslStart":"[redacted]"}');
        expect(previews[1]).toBe('{"createUser":"[redacted]"}');
        // A nested credential field is redacted without discarding the rest of the command,
        // which is what makes the preview useful at all.
        expect(previews[2]).toBe('{"find":"orders","filter":{"key":"[redacted]"}}');
        expect(previews.join(' ')).not.toContain('hunter2');
        expect(previews.join(' ')).not.toContain('biwsbj1h');
    });
});

describe('killOperation', () => {
    it('sends a numeric opid when the server reported a number', async () => {
        const { client, adminCommands } = createFakeClient({ adminCommand: () => ({ ok: 1 }) });

        await killOperation(client, '42', true);

        expect(adminCommands).toEqual([{ killOp: 1, op: 42 }]);
    });

    it('sends a string opid unchanged when the server reported a string', async () => {
        const { client, adminCommands } = createFakeClient({ adminCommand: () => ({ ok: 1 }) });

        await killOperation(client, 'shard0:1234', false);

        expect(adminCommands).toEqual([{ killOp: 1, op: 'shard0:1234' }]);
    });

    it('preserves a numeric-looking string opid rather than coercing it', async () => {
        // Azure DocumentDB (vCore) reports string opids. `Number('12345')` would send a
        // number the server does not match, and an int64 beyond MAX_SAFE_INTEGER would be
        // rounded onto a *different* operation.
        const { client, adminCommands } = createFakeClient({ adminCommand: () => ({ ok: 1 }) });

        await killOperation(client, '9007199254740993', false);

        expect(adminCommands).toEqual([{ killOp: 1, op: '9007199254740993' }]);
    });

    it('reports whether the server acknowledged the request', async () => {
        const { client } = createFakeClient({ adminCommand: () => ({ ok: 0 }) });

        await expect(killOperation(client, '42', true)).resolves.toBe(false);
    });
});

describe('getClusterPrivileges', () => {
    it('finds the killOp privilege in the cluster resource grant', async () => {
        // Shape taken from a live Azure DocumentDB (vCore) cluster.
        const { client, adminCommands } = createFakeClient({
            adminCommand: () => ({
                authInfo: {
                    authenticatedUserRoles: [{ role: 'root', db: 'admin' }],
                    authenticatedUserPrivileges: [
                        { resource: { db: '', collection: '' }, actions: ['find', 'insert'] },
                        { resource: { cluster: true }, actions: ['getLog', 'killop', 'listDatabases'] },
                    ],
                },
            }),
        });

        const privileges = await getClusterPrivileges(client);

        expect(privileges.canKillOperations).toBe(true);
        expect(privileges.errors).toEqual([]);
        expect(adminCommands).toEqual([{ connectionStatus: 1, showPrivileges: true }]);
    });

    it('reports the privilege as absent when no grant carries it', async () => {
        const { client } = createFakeClient({
            adminCommand: () => ({
                authInfo: {
                    authenticatedUserPrivileges: [{ resource: { cluster: true }, actions: ['listDatabases'] }],
                },
            }),
        });

        await expect(getClusterPrivileges(client)).resolves.toMatchObject({ canKillOperations: false });
    });

    it('stays unknown rather than denied when the server reports no privileges', async () => {
        // "Did not say" is not "said no": disabling Kill here would block an action that
        // works, so the button stays enabled and the server gets to refuse.
        const { client } = createFakeClient({
            adminCommand: () => ({ authInfo: { authenticatedUserRoles: [{ role: 'root', db: 'admin' }] } }),
        });

        await expect(getClusterPrivileges(client)).resolves.toEqual({ canKillOperations: null, errors: [] });
    });

    it('stays unknown when the command itself fails', async () => {
        const { client } = createFakeClient({});

        const privileges = await getClusterPrivileges(client);

        expect(privileges.canKillOperations).toBeNull();
        expect(privileges.errors.map(getFailedCommandName)).toEqual(['connectionStatus']);
    });
});

describe('getStorageStats', () => {
    it('skips system databases and survives a failing dbStats', async () => {
        const { client } = createFakeClient({
            listDatabases: () => ({
                databases: [
                    { name: 'admin', sizeOnDisk: 1 },
                    { name: 'local', sizeOnDisk: 2 },
                    { name: 'sales', sizeOnDisk: 100 },
                    { name: 'archive', sizeOnDisk: 200 },
                ],
                totalSize: 303,
            }),
            dbCommand: (databaseName) => {
                if (databaseName === 'archive') {
                    throw new Error('dbStats failed');
                }
                return { dataSize: 90, indexSize: 10, collections: 3, objects: 500, indexes: 7 };
            },
        });

        const stats = await getStorageStats(client);

        expect(stats.databases.map((database) => database.name)).toEqual(['sales', 'archive']);
        expect(stats.databases[0].dataSizeBytes).toBe(90);
        expect(stats.databases[0].indexes).toBe(7);
        expect(stats.databases[1].dataSizeBytes).toBeNull();
        expect(stats.databases[1].indexes).toBeNull();
        expect(stats.errors).toHaveLength(1);
        expect(stats.errors[0]).toContain('dbStats:archive');
        // The total must reconcile with the rendered rows (100 + 200), NOT with
        // listDatabases.totalSize (303), which also counts admin/local/config.
        expect(stats.totalSizeBytes).toBe(300);
        expect(stats.omittedDatabaseCount).toBe(0);
    });

    it('reports how many databases were omitted by the inspection cap', async () => {
        const databases = Array.from({ length: 25 }, (_, index) => ({
            name: `db${index}`,
            sizeOnDisk: 10,
        }));

        const { client } = createFakeClient({
            listDatabases: () => ({ databases }),
            dbCommand: () => ({ dataSize: 5, indexSize: 1, collections: 1, objects: 1 }),
        });

        const stats = await getStorageStats(client);

        expect(stats.databases).toHaveLength(20);
        expect(stats.omittedDatabaseCount).toBe(5);
    });

    it('keeps a reported size of zero instead of falling back to storageSize', async () => {
        const { client } = createFakeClient({
            listDatabases: () => ({ databases: [{ name: 'empty', sizeOnDisk: 0 }] }),
            dbCommand: () => ({ dataSize: 0, indexSize: 0, collections: 0, objects: 0, storageSize: 4096 }),
        });

        const stats = await getStorageStats(client);

        expect(stats.databases[0].sizeOnDiskBytes).toBe(0);
    });

    it('returns an error marker when listDatabases is unavailable', async () => {
        const { client } = createFakeClient({});

        const stats = await getStorageStats(client);

        expect(stats.databases).toEqual([]);
        expect(stats.totalSizeBytes).toBeNull();
        expect(stats.errors.map(getFailedCommandName)).toEqual(['listDatabases']);
    });
});
