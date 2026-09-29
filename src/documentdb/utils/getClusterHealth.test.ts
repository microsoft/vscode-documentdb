/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type MongoClient } from 'mongodb';

import {
    getDatabaseCollections,
    getStorageStats,
    sampleClusterHealth,
    type RawCommandDiagnostic,
} from './getClusterHealth';

function getFailedCommandName(errorEntry: string): string {
    const separatorIndex = errorEntry.indexOf(':');

    return separatorIndex === -1 ? errorEntry : errorEntry.slice(0, separatorIndex);
}

type CommandHandler = (command: Record<string, unknown>) => unknown;

interface FakeClientOptions {
    adminCommand?: CommandHandler;
    listDatabases?: () => unknown;
    dbCommand?: (databaseName: string, command: Record<string, unknown>) => unknown;
    listCollections?: (databaseName: string) => unknown[];
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
            listCollections: () => ({
                toArray: (): Promise<unknown[]> => {
                    if (!options.listCollections) {
                        return Promise.reject(new Error('listCollections not supported'));
                    }
                    try {
                        return Promise.resolve(options.listCollections(databaseName ?? ''));
                    } catch (error) {
                        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
                    }
                },
            }),
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
        });

        const sample = await sampleClusterHealth(client);

        expect(sample.pingLatencyMs).not.toBeNull();
        expect(sample.errors.map(getFailedCommandName)).toContain('serverStatus');
        // The reason must survive: it is the only signal distinguishing an unsupported
        // command from Unauthorized or a TLS timeout once telemetry is suppressed.
        expect(sample.errors.join(' ')).toContain('CommandNotSupported');
        expect(sample.uptimeSeconds).toBeNull();
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

    it('reads uptime when serverStatus is available', async () => {
        const { client } = createFakeClient({
            adminCommand: (command) => {
                if (command.ping === 1) {
                    return { ok: 1 };
                }
                if (command.serverStatus === 1) {
                    return {
                        uptime: 1234,
                    };
                }
                throw new Error('unexpected command');
            },
        });

        const sample = await sampleClusterHealth(client);

        expect(sample.errors).toEqual([]);
        expect(sample.uptimeSeconds).toBe(1234);
    });

    it('issues both commands of a sample concurrently', async () => {
        // Run in sequence, an unreachable cluster pays the server-selection timeout once per
        // command, so the header badge stays on "Connecting…" for minutes. This guards the
        // failure case by observing the healthy one: both must be in flight at once.
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
        });

        const pending = sampleClusterHealth(client);

        expect(started).toEqual(['ping', 'serverStatus']);

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

        expect(sample.errors.map(getFailedCommandName)).toEqual(['ping', 'serverStatus']);
    });
});

describe('getStorageStats', () => {
    it('skips system databases and survives a failing dbStats', async () => {
        const diagnostics: RawCommandDiagnostic[] = [];
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

        const stats = await getStorageStats(client, undefined, diagnostics);

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
        expect(diagnostics).toEqual(
            expect.arrayContaining([
                {
                    database: 'admin',
                    command: { listDatabases: 1 },
                    result: expect.objectContaining({ ok: true }),
                },
                {
                    database: 'sales',
                    command: { dbStats: 1 },
                    result: {
                        ok: true,
                        response: { dataSize: 90, indexSize: 10, collections: 3, objects: 500, indexes: 7 },
                    },
                },
                {
                    database: 'archive',
                    command: { dbStats: 1 },
                    result: { ok: false, error: 'dbStats failed' },
                },
            ]),
        );
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

    it('keeps a zero the server confirms is empty', async () => {
        const { client } = createFakeClient({
            listDatabases: () => ({ databases: [{ name: 'empty', sizeOnDisk: 0, empty: true }] }),
            dbCommand: () => ({ dataSize: 0, indexSize: 0, collections: 0, objects: 0, storageSize: 4096 }),
        });

        const stats = await getStorageStats(client);

        // Overwriting this with `storageSize` would report preallocated overhead as data.
        expect(stats.databases[0].sizeOnDiskBytes).toBe(0);
    });

    it('falls back to storageSize when a non-empty database reports a size of zero', async () => {
        // Observed on a live Azure DocumentDB (vCore) cluster: every `listDatabases` entry
        // comes back `{sizeOnDisk: 0, empty: false}` however much data it holds, which
        // rendered the whole Storage tab as "0 B".
        const { client } = createFakeClient({
            listDatabases: () => ({
                databases: [
                    { name: 'sales', sizeOnDisk: 0, empty: false },
                    { name: 'iot', sizeOnDisk: 0, empty: false },
                ],
            }),
            dbCommand: (databaseName) => ({
                dataSize: 100,
                indexSize: 10,
                collections: 2,
                objects: 50,
                indexes: 3,
                storageSize: databaseName === 'sales' ? 12984320 : 20357120,
            }),
        });

        const stats = await getStorageStats(client);

        expect(stats.databases.map((database) => database.sizeOnDiskBytes)).toEqual([12984320, 20357120]);
        // The Total must reconcile with the rendered rows, which it could not while every
        // row read zero.
        expect(stats.totalSizeBytes).toBe(33341440);
    });

    it('returns an error marker when listDatabases is unavailable', async () => {
        const { client } = createFakeClient({});

        const stats = await getStorageStats(client);

        expect(stats.databases).toEqual([]);
        expect(stats.totalSizeBytes).toBeNull();
        expect(stats.errors.map(getFailedCommandName)).toEqual(['listDatabases']);
    });
});

describe('getDatabaseCollections', () => {
    it('reports per-collection figures and never asks a view for storage', async () => {
        const collStatsCalls: string[] = [];
        const { client } = createFakeClient({
            listCollections: () => [
                { name: 'orders', type: 'collection' },
                { name: 'recentOrders', type: 'view' },
            ],
            dbCommand: (_databaseName, command) => {
                if (typeof command.collStats === 'string') {
                    collStatsCalls.push(command.collStats);
                    return { count: 42, size: 1024, storageSize: 2048, totalIndexSize: 512, nindexes: 3 };
                }
                throw new Error('unexpected command');
            },
        });

        const result = await getDatabaseCollections(client, 'shop');

        expect(result.databaseName).toBe('shop');
        expect(result.errors).toEqual([]);
        expect(result.collections[0]).toEqual({
            name: 'orders',
            type: 'collection',
            documents: 42,
            dataSizeBytes: 1024,
            storageSizeBytes: 2048,
            indexSizeBytes: 512,
            indexes: 3,
        });
        // `collStats` on a view reports the *source* collection's bytes, which would credit
        // another collection's storage to the view.
        expect(collStatsCalls).toEqual(['orders']);
        expect(result.collections[1].storageSizeBytes).toBeNull();
    });

    it('keeps the other collections when one collStats fails', async () => {
        const { client } = createFakeClient({
            listCollections: () => [{ name: 'ok' }, { name: 'denied' }],
            dbCommand: (_databaseName, command) => {
                if (command.collStats === 'denied') {
                    throw new Error('Unauthorized');
                }
                return { count: 1, size: 8, storageSize: 16, totalIndexSize: 4, nindexes: 1 };
            },
        });

        const result = await getDatabaseCollections(client, 'shop');

        expect(result.collections).toHaveLength(2);
        expect(result.collections[0].documents).toBe(1);
        expect(result.collections[1].documents).toBeNull();
        expect(result.errors.map(getFailedCommandName)).toEqual(['collStats']);
    });

    it('caps how many collStats are in flight at once, and keeps the reported order', async () => {
        const names = Array.from({ length: 40 }, (_, index) => `collection-${index}`);
        let inFlight = 0;
        let peakInFlight = 0;

        const { client } = createFakeClient({
            listCollections: () => names.map((name) => ({ name })),
            dbCommand: (_databaseName, command) => {
                inFlight++;
                peakInFlight = Math.max(peakInFlight, inFlight);
                // Resolving on a later turn is what lets the pool actually fill: a promise
                // that settles synchronously would never overlap with its siblings.
                return new Promise((resolve) => {
                    setTimeout(() => {
                        inFlight--;
                        resolve({
                            count: Number((command.collStats as string).split('-')[1]),
                            size: 8,
                            storageSize: 16,
                            totalIndexSize: 4,
                            nindexes: 1,
                        });
                    }, 0);
                });
            },
        });

        const result = await getDatabaseCollections(client, 'shop');

        // A `Promise.all` over every entry would put all 40 on the wire at once, which is a
        // load spike triggered by a user expanding one row.
        expect(peakInFlight).toBeLessThanOrEqual(8);
        expect(peakInFlight).toBeGreaterThan(1);
        expect(result.collections).toHaveLength(40);
        // Bounded concurrency must not reorder the list against `listCollections`.
        expect(result.collections.map((collection) => collection.name)).toEqual(names);
        expect(result.collections.map((collection) => collection.documents)).toEqual(
            names.map((_name, index) => index),
        );
    });

    it('returns an error marker when the database will not list its collections', async () => {
        const { client } = createFakeClient({});

        const result = await getDatabaseCollections(client, 'shop');

        expect(result.collections).toEqual([]);
        expect(result.errors.map(getFailedCommandName)).toEqual(['listCollections']);
    });
});

describe('statistics concurrency budget', () => {
    it('caps concurrent collStats across simultaneous invocations, not just within one', async () => {
        let inFlight = 0;
        let peak = 0;
        const release: Array<() => void> = [];

        const { client } = createFakeClient({
            listCollections: () =>
                Array.from({ length: 12 }, (_unused, index) => ({ name: `c${index}`, type: 'collection' })),
            dbCommand: () => {
                inFlight += 1;
                peak = Math.max(peak, inFlight);

                return new Promise<unknown>((resolve) => {
                    release.push(() => {
                        inFlight -= 1;
                        resolve({});
                    });
                });
            },
        });

        // Two expanded database panels on the same connection. A limit applied per call would
        // let each take its own eight; the dashboard allows twenty panels at once, which is how
        // eight became a hundred and sixty.
        const passes = Promise.all([getDatabaseCollections(client, 'alpha'), getDatabaseCollections(client, 'beta')]);

        // Let every queued item reach the budget before measuring: only the ones it admits
        // ever call the driver, so the peak is the budget's answer, not a race.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        const peakWhileSaturated = peak;

        let settled = false;
        void passes.then(() => {
            settled = true;
        });

        while (!settled) {
            while (release.length > 0) {
                release.shift()?.();
            }
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }

        await passes;

        expect(peakWhileSaturated).toBeGreaterThan(0);
        expect(peakWhileSaturated).toBeLessThanOrEqual(8);
    });
});
