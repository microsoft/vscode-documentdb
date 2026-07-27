/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type MongoClient } from 'mongodb';

import { getStorageStats, killOperation, listCurrentOperations, sampleClusterHealth } from './getClusterHealth';

type CommandHandler = (command: Record<string, unknown>) => unknown;

interface FakeClientOptions {
    adminCommand?: CommandHandler;
    aggregate?: () => unknown[];
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
            aggregate: () => ({
                toArray: (): Promise<unknown[]> => {
                    if (!options.aggregate) {
                        return Promise.reject(new Error('$currentOp not supported'));
                    }
                    return Promise.resolve(options.aggregate());
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
        expect(sample.errors).toContain('serverStatus');
        expect(sample.uptimeSeconds).toBeNull();
        expect(sample.opcounters).toBeNull();
        expect(sample.activeOperations).toBe(1);
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
                { opid: 3, op: 'command', ns: 'admin.$cmd.aggregate', active: true, desc: 'conn4' },
            ],
        });

        const result = await listCurrentOperations(client);

        expect(result.operations).toHaveLength(1);
        expect(result.operations[0].opid).toBe('3');
        expect(result.operations[0].clientDescription).toBe('conn4');
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
    });

    it('reports both command names when neither form is supported', async () => {
        const { client } = createFakeClient({});

        const result = await listCurrentOperations(client);

        expect(result.operations).toEqual([]);
        expect(result.errors).toEqual(['$currentOp', 'currentOp']);
    });
});

describe('killOperation', () => {
    it('sends a numeric opid when the identifier is numeric', async () => {
        const { client, adminCommands } = createFakeClient({ adminCommand: () => ({ ok: 1 }) });

        await killOperation(client, '42');

        expect(adminCommands).toEqual([{ killOp: 1, op: 42 }]);
    });

    it('sends the opid as-is when it is not numeric', async () => {
        const { client, adminCommands } = createFakeClient({ adminCommand: () => ({ ok: 1 }) });

        await killOperation(client, 'shard0:1234');

        expect(adminCommands).toEqual([{ killOp: 1, op: 'shard0:1234' }]);
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
                return { dataSize: 90, indexSize: 10, collections: 3, objects: 500 };
            },
        });

        const stats = await getStorageStats(client);

        expect(stats.databases.map((database) => database.name)).toEqual(['sales', 'archive']);
        expect(stats.databases[0].dataSizeBytes).toBe(90);
        expect(stats.databases[1].dataSizeBytes).toBeNull();
        expect(stats.errors).toEqual(['dbStats:archive']);
        expect(stats.totalSizeBytes).toBe(303);
    });

    it('returns an error marker when listDatabases is unavailable', async () => {
        const { client } = createFakeClient({});

        const stats = await getStorageStats(client);

        expect(stats.databases).toEqual([]);
        expect(stats.totalSizeBytes).toBeNull();
        expect(stats.errors).toEqual(['listDatabases']);
    });
});
