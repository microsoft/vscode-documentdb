/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Health and storage collectors for the Cluster Dashboard.
 *
 * Resilience model (copied from the sibling `getClusterMetadata.ts`): every server command
 * runs in its own try/catch. A command that fails leaves its fields `null` and records the
 * command name in `errors` — the collector never throws because of an unsupported command.
 * This matters because Azure DocumentDB (vCore) does not support `serverStatus`, while a
 * local emulator or a self-hosted server usually does.
 *
 * Nothing here reads a command anyone is running: no `currentOp`, and so no command
 * document, query filter or client address ever enters this module. That is what keeps
 * application data out of the diagnostics export.
 *
 * None of these functions cache; the caller decides the sampling cadence.
 */

import { type Document, type MongoClient } from 'mongodb';

/** Maximum number of databases inspected by {@link getStorageStats}. */
const DATABASE_STATS_LIMIT = 20;

/**
 * Maximum number of collections inspected by {@link getDatabaseCollections}.
 *
 * Higher than the database cap because this runs only for the one database the user
 * expanded, but still bounded: `collStats` is one round trip per collection.
 */
const COLLECTION_STATS_LIMIT = 100;

/**
 * How many per-namespace stat commands may be in flight at once.
 *
 * The caps above bound the *amount* of work; this bounds its *burst*. Firing one command per
 * collection through a single `Promise.all` put up to a hundred simultaneous `collStats` on
 * the wire the moment a user opened a database, which the driver services by opening
 * connections until it hits its pool limit — a visible load spike on the cluster caused by a
 * disclosure gesture. Eight keeps the wall-clock benefit of overlapping round trips without
 * the dashboard behaving like a load generator.
 */
const STATS_CONCURRENCY = 8;

/**
 * A ceiling on concurrent work, shared by everyone who holds the same instance.
 *
 * A limit applied per call is not a limit on the cluster: the dashboard can have a storage
 * pass and a collection pass in flight at once, and a per-call ceiling of eight would apply
 * to each of them separately. Holding the budget outside the call makes the number mean what
 * it says.
 */
class ConcurrencyBudget {
    private inFlight = 0;
    private readonly waiting: Array<() => void> = [];

    public constructor(private readonly limit: number) {}

    public async run<R>(task: () => Promise<R>): Promise<R> {
        if (this.inFlight >= this.limit) {
            await new Promise<void>((resolve) => this.waiting.push(resolve));
        }

        this.inFlight += 1;
        try {
            return await task();
        } finally {
            this.inFlight -= 1;
            this.waiting.shift()?.();
        }
    }
}

/**
 * One statistics budget per connection, shared by every collector using it.
 *
 * Keyed on the client rather than the cluster id so it cannot outlive the connection, and so
 * a reconnect starts with a clean budget rather than inheriting a stalled one.
 */
const statsBudgets = new WeakMap<MongoClient, ConcurrencyBudget>();

function statsBudgetFor(client: MongoClient): ConcurrencyBudget {
    let budget = statsBudgets.get(client);

    if (budget === undefined) {
        budget = new ConcurrencyBudget(STATS_CONCURRENCY);
        statsBudgets.set(client, budget);
    }

    return budget;
}

/**
 * `Promise.all`-shaped map that draws from a shared budget and stops doing work once the
 * caller has gone away.
 *
 * Results keep the input order (workers write by index), and a rejection propagates exactly
 * as `Promise.all` would — both call sites catch per item, so a single failure never takes
 * the batch down.
 *
 * `map` is told whether the work was abandoned rather than being skipped, so each collector
 * returns its own "nothing to report" shape instead of leaving a hole in the results. An
 * abandoned item never takes a slot in the budget.
 */
async function mapWithConcurrency<T, R>(
    items: readonly T[],
    budget: ConcurrencyBudget,
    map: (item: T, abandoned: boolean) => Promise<R>,
    signal?: AbortSignal,
): Promise<R[]> {
    // The budget is claimed per item, not per worker: a worker that held its slot for the whole
    // pass would let one invocation take the entire budget and starve every other collector
    // until it finished, which is the problem this exists to prevent rather than a fix for it.
    return Promise.all(
        items.map(async (item) => {
            if (signal?.aborted === true) {
                return map(item, true);
            }

            return budget.run(() => map(item, signal?.aborted === true));
        }),
    );
}

/** Databases excluded from the storage breakdown — they are server-internal. */
const SYSTEM_DATABASES = new Set(['admin', 'local', 'config']);

/**
 * Formats a failed command as `name: reason` for the sample's `errors` array.
 *
 * The sibling `getClusterMetadata.ts` records the message of every failed command
 * (`serverStatus_error` etc.) and this module claims to copy its resilience model — but a
 * bare `catch {}` would discard it. Since the dashboard's stated top risk is vCore
 * behaviour, and telemetry is suppressed on the polled procedures, this string is the only
 * way to tell `Unauthorized` from `CommandNotSupported` from a TLS timeout.
 */
function describeCommandFailure(commandName: string, error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);

    return message ? `${commandName}: ${message}` : commandName;
}

/**
 * A single point-in-time health sample of a cluster.
 * Every numeric field is `null` when the server did not answer the command that provides it.
 */
export interface ClusterHealthSample {
    /** Round-trip time of `admin.ping`, in milliseconds. `null` when the ping failed. */
    pingLatencyMs: number | null;
    /** `serverStatus.uptime`, best effort (not available on vCore). */
    uptimeSeconds: number | null;
    /** Names of the commands that failed while collecting this sample. */
    errors: string[];
}

/** Per-database storage figures used by the dashboard's inventory list. */
export interface ClusterDatabaseStorage {
    name: string;
    /** `listDatabases.databases[].sizeOnDisk`. */
    sizeOnDiskBytes: number | null;
    /** `dbStats.dataSize`. */
    dataSizeBytes: number | null;
    /** `dbStats.indexSize`. */
    indexSizeBytes: number | null;
    /** `dbStats.collections`. */
    collections: number | null;
    /** `dbStats.objects`. */
    objects: number | null;
    /** `dbStats.indexes` — number of indexes across the database's collections. */
    indexes: number | null;
}

/** Aggregated storage figures for a cluster. */
export interface ClusterStorageStats {
    databases: ClusterDatabaseStorage[];
    /**
     * Sum of `sizeOnDiskBytes` across the databases in {@link databases} — i.e. exactly
     * the rows the inventory list renders, so the Total always reconciles with them.
     */
    totalSizeBytes: number | null;
    /** User databases beyond {@link DATABASE_STATS_LIMIT} that were not inspected. */
    omittedDatabaseCount: number;
    /** Names of the commands that failed while collecting these statistics. */
    errors: string[];
}

/** A database command and its unmodified outcome, captured for diagnostic export. */
export interface RawCommandDiagnostic {
    database: string;
    command: Document;
    result: { ok: true; response: Document } | { ok: false; error: string };
}

/** Per-collection figures shown when the inventory steps into a database. */
export interface ClusterCollectionStorage {
    name: string;
    /** `listCollections.type`: `collection`, `view`, or `timeseries`. */
    type: string;
    /** `collStats.count`. */
    documents: number | null;
    /** `collStats.size` — the uncompressed size of the documents. */
    dataSizeBytes: number | null;
    /** `collStats.storageSize`. */
    storageSizeBytes: number | null;
    /** `collStats.totalIndexSize`. */
    indexSizeBytes: number | null;
    /** `collStats.nindexes`. */
    indexes: number | null;
}

/** Result of {@link getDatabaseCollections}. */
export interface DatabaseCollectionsResult {
    databaseName: string;
    collections: ClusterCollectionStorage[];
    /** Collections beyond {@link COLLECTION_STATS_LIMIT} that were not inspected. */
    omittedCollectionCount: number;
    /** Names of the commands that failed while collecting these statistics. */
    errors: string[];
}

function toNumberOrNull(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Reads `listDatabases.databases[].sizeOnDisk`, rejecting a zero the server has already
 * contradicted.
 *
 * Azure DocumentDB (vCore) answers `listDatabases` with `sizeOnDisk: 0` for *every*
 * database while setting `empty: false` on the same entry — so taking the figure literally
 * renders the whole inventory as `0 B` on a cluster holding hundreds of megabytes. A zero
 * next to `empty: false` is the server declining to answer, and is reported as `null` so the
 * caller falls back to `dbStats.storageSize`.
 *
 * A zero the server has *not* contradicted is kept: a genuinely empty database is 0 bytes,
 * and overwriting that with `storageSize` would report preallocated overhead as data.
 */
function toReportedDatabaseSize(entry: Document): number | null {
    const sizeOnDisk = toNumberOrNull(entry.sizeOnDisk);

    if (sizeOnDisk === 0 && entry.empty === false) {
        return null;
    }

    return sizeOnDisk;
}

function toStringOrNull(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Collects one health sample from a cluster.
 *
 * @param client - A connected MongoClient.
 * @returns A sample where unsupported/failed commands are reported through `errors`
 *          rather than by throwing.
 */
export async function sampleClusterHealth(client: MongoClient): Promise<ClusterHealthSample> {
    const sample: ClusterHealthSample = {
        pingLatencyMs: null,
        uptimeSeconds: null,
        errors: [],
    };

    const adminDb = client.db().admin();

    // Issued concurrently rather than one after another. The commands are independent, and
    // run in sequence an unreachable cluster pays the server-selection timeout once per
    // command — several minutes before the header badge can leave "Connecting…", far longer
    // than the polling interval. Concurrency can inflate the measured ping slightly, since
    // the other commands compete for the same connection pool; a few milliseconds of noise
    // on a latency reading is worth bounding the failure case to a single timeout.
    const [pingError, serverStatusError] = await Promise.all([
        (async (): Promise<string | null> => {
            try {
                const startedAt = performance.now();
                await adminDb.command({ ping: 1 });
                sample.pingLatencyMs = performance.now() - startedAt;
                return null;
            } catch (error) {
                return describeCommandFailure('ping', error);
            }
        })(),
        (async (): Promise<string | null> => {
            try {
                const serverStatus = await adminDb.command({ serverStatus: 1 });
                sample.uptimeSeconds = toNumberOrNull(serverStatus.uptime);
                return null;
            } catch (error) {
                // Expected on Azure DocumentDB (vCore): `serverStatus` is not supported there.
                return describeCommandFailure('serverStatus', error);
            }
        })(),
    ]);

    // Collected after the fact so `errors` keeps a stable ping/serverStatus order
    // regardless of which command happened to finish first.
    if (pingError !== null) {
        sample.errors.push(pingError);
    }
    if (serverStatusError !== null) {
        sample.errors.push(serverStatusError);
    }
    return sample;
}

/**
 * Collects the per-database storage breakdown of a cluster.
 *
 * System databases are skipped and the number of inspected databases is capped
 * ({@link DATABASE_STATS_LIMIT}); `dbStats` runs in parallel so a slow database
 * does not serialize the whole collection pass.
 *
 * @param client - A connected MongoClient.
 * @returns The per-database figures; databases whose `dbStats` failed keep `null` fields.
 */
export async function getStorageStats(
    client: MongoClient,
    signal?: AbortSignal,
    diagnostics?: RawCommandDiagnostic[],
): Promise<ClusterStorageStats> {
    const errors: string[] = [];
    const adminDb = client.db().admin();
    const listDatabasesCommand = { listDatabases: 1 };

    let listed: Document;
    try {
        listed = await adminDb.listDatabases();
        diagnostics?.push({
            database: 'admin',
            command: listDatabasesCommand,
            result: { ok: true, response: listed },
        });
    } catch (error) {
        diagnostics?.push({
            database: 'admin',
            command: listDatabasesCommand,
            result: { ok: false, error: error instanceof Error ? error.message : String(error) },
        });
        return {
            databases: [],
            totalSizeBytes: null,
            omittedDatabaseCount: 0,
            errors: [describeCommandFailure('listDatabases', error)],
        };
    }

    const allUserDatabases = (Array.isArray(listed.databases) ? (listed.databases as Document[]) : []).filter(
        (entry) => typeof entry.name === 'string' && !SYSTEM_DATABASES.has(entry.name as string),
    );

    const entries = allUserDatabases.slice(0, DATABASE_STATS_LIMIT);
    const omittedDatabaseCount = allUserDatabases.length - entries.length;

    const databases = await mapWithConcurrency(
        entries,
        statsBudgetFor(client),
        async (entry, abandoned): Promise<ClusterDatabaseStorage> => {
            const name = entry.name as string;
            const database: ClusterDatabaseStorage = {
                name,
                sizeOnDiskBytes: toReportedDatabaseSize(entry),
                dataSizeBytes: null,
                indexSizeBytes: null,
                collections: null,
                objects: null,
                indexes: null,
            };

            // The caller has gone: return the same "did not report" shape a refused command
            // produces, so the result is complete in shape and simply carries nothing.
            if (abandoned) {
                return database;
            }

            const dbStatsCommand = { dbStats: 1 };
            try {
                const stats = await client.db(name).command(dbStatsCommand);
                diagnostics?.push({
                    database: name,
                    command: dbStatsCommand,
                    result: { ok: true, response: stats },
                });
                database.dataSizeBytes = toNumberOrNull(stats.dataSize);
                database.indexSizeBytes = toNumberOrNull(stats.indexSize);
                database.collections = toNumberOrNull(stats.collections);
                database.objects = toNumberOrNull(stats.objects);
                database.indexes = toNumberOrNull(stats.indexes);
                // `??` rather than `||`: a genuine 0 is a real answer and must not be
                // replaced, but `null` (field absent) should fall back to storageSize.
                database.sizeOnDiskBytes ??= toNumberOrNull(stats.storageSize);
            } catch (error) {
                diagnostics?.push({
                    database: name,
                    command: dbStatsCommand,
                    result: { ok: false, error: error instanceof Error ? error.message : String(error) },
                });
                errors.push(describeCommandFailure(`dbStats:${name}`, error));
            }

            return database;
        },
        signal,
    );

    // Deliberately NOT `listed.totalSize`: that counts admin/local/config and any database
    // past the cap, so it would not equal the sum of the rows actually rendered. A 5 GB
    // oplog would put the Total several GB above a single visible row.
    const sizedDatabases = databases.filter((database) => database.sizeOnDiskBytes !== null);
    const totalSizeBytes =
        sizedDatabases.length > 0
            ? sizedDatabases.reduce((total, database) => total + (database.sizeOnDiskBytes ?? 0), 0)
            : null;

    return { databases, totalSizeBytes, omittedDatabaseCount, errors };
}

/**
 * Collects the per-collection breakdown of one database.
 *
 * Loaded on demand — when the user expands a database row — rather than as part of
 * {@link getStorageStats}: `collStats` is one round trip per collection, so collecting it
 * for every database up front would multiply the dashboard's cold-start cost by the number
 * of collections in the cluster.
 *
 * @param client - A connected MongoClient.
 * @param databaseName - The database to inspect.
 * @returns The per-collection figures; collections whose `collStats` failed keep `null` fields.
 */
export async function getDatabaseCollections(
    client: MongoClient,
    databaseName: string,
    signal?: AbortSignal,
): Promise<DatabaseCollectionsResult> {
    const errors: string[] = [];
    const db = client.db(databaseName);

    let listed: Document[];
    try {
        listed = await db.listCollections().toArray();
    } catch (error) {
        return {
            databaseName,
            collections: [],
            omittedCollectionCount: 0,
            errors: [describeCommandFailure('listCollections', error)],
        };
    }

    const named = listed.filter((entry): entry is Document => typeof entry.name === 'string');
    const entries = named.slice(0, COLLECTION_STATS_LIMIT);
    const omittedCollectionCount = named.length - entries.length;

    const collections = await mapWithConcurrency(
        entries,
        statsBudgetFor(client),
        async (entry, abandoned): Promise<ClusterCollectionStorage> => {
            const name = entry.name as string;
            const collection: ClusterCollectionStorage = {
                name,
                type: toStringOrNull(entry.type) ?? 'collection',
                documents: null,
                dataSizeBytes: null,
                storageSizeBytes: null,
                indexSizeBytes: null,
                indexes: null,
            };

            // A view has no storage of its own and `collStats` reports on the underlying
            // pipeline source, which would attribute another collection's bytes to it.
            if (collection.type === 'view' || abandoned) {
                return collection;
            }

            try {
                const stats = await db.command({ collStats: name });
                collection.documents = toNumberOrNull(stats.count);
                collection.dataSizeBytes = toNumberOrNull(stats.size);
                collection.storageSizeBytes = toNumberOrNull(stats.storageSize);
                collection.indexSizeBytes = toNumberOrNull(stats.totalIndexSize);
                collection.indexes = toNumberOrNull(stats.nindexes);
            } catch (error) {
                errors.push(describeCommandFailure(`collStats:${name}`, error));
            }

            return collection;
        },
        signal,
    );

    return { databaseName, collections, omittedCollectionCount, errors };
}
