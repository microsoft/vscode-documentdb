/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Live health / storage / operations collectors for the Cluster Dashboard.
 *
 * Resilience model (copied from the sibling `getClusterMetadata.ts`): every server command
 * runs in its own try/catch. A command that fails leaves its fields `null` and records the
 * command name in `errors` — the collector never throws because of an unsupported command.
 * This matters because Azure DocumentDB (vCore) does not support `serverStatus` or `top`,
 * while a local emulator or a self-hosted server usually does.
 *
 * None of these functions cache; the caller decides the sampling cadence.
 */

import { type Document, type MongoClient } from 'mongodb';

/** Maximum number of `currentOp` entries returned to a caller. */
const CURRENT_OP_LIMIT = 100;

/** Maximum number of databases inspected by {@link getStorageStats}. */
const DATABASE_STATS_LIMIT = 20;

/** Maximum length of the serialized command preview attached to a {@link CurrentOpEntry}. */
const COMMAND_PREVIEW_MAX_LENGTH = 2000;

/** Databases excluded from the storage breakdown — they are server-internal. */
const SYSTEM_DATABASES = new Set(['admin', 'local', 'config']);

/**
 * A single point-in-time health sample of a cluster.
 * Every numeric field is `null` when the server did not answer the command that provides it.
 */
export interface ClusterHealthSample {
    /** `Date.now()` recorded when the sample started. */
    timestampMs: number;
    /** Round-trip time of `admin.ping`, in milliseconds. `null` when the ping failed. */
    pingLatencyMs: number | null;
    /** `serverStatus.uptime`, best effort (not available on vCore). */
    uptimeSeconds: number | null;
    /** `serverStatus.connections.current`, best effort. */
    connectionsCurrent: number | null;
    /** `serverStatus.opcounters`, best effort (not available on vCore). */
    opcounters: Record<string, number> | null;
    /** Number of operations reported by `currentOp`. */
    activeOperations: number | null;
    /** Names of the commands that failed while collecting this sample. */
    errors: string[];
}

/** Per-database storage figures used by the dashboard's Storage tab. */
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
}

/** Aggregated storage figures for a cluster. */
export interface ClusterStorageStats {
    databases: ClusterDatabaseStorage[];
    /** `listDatabases.totalSize`, or the sum of the per-database sizes when absent. */
    totalSizeBytes: number | null;
    /** Names of the commands that failed while collecting these statistics. */
    errors: string[];
}

/** A single in-flight server operation, reduced to the fields the dashboard renders. */
export interface CurrentOpEntry {
    /**
     * Operation identifier, always stringified: vCore reports string opids while
     * self-hosted servers report numbers.
     */
    opid: string;
    /** The `op` field: query/insert/update/remove/command/getmore/none. */
    type: string;
    /** `ns`, i.e. `database.collection`. */
    namespace: string;
    /** `secs_running`, when the server reports it. */
    secsRunning: number | null;
    /** `active` flag. */
    active: boolean;
    /** `client` / `appName`, when reported. */
    clientDescription: string | null;
    /** Truncated JSON of the operation's command, for the details column. */
    commandPreview: string;
}

/** Result of {@link listCurrentOperations}. */
export interface CurrentOperationsResult {
    operations: CurrentOpEntry[];
    /** Names of the commands that failed while listing operations. */
    errors: string[];
}

function toNumberOrNull(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toStringOrNull(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Extracts a flat `Record<string, number>` from an object of counters, dropping
 * anything that is not a finite number (e.g. the nested `deprecated` sub-document).
 */
function toCounterRecord(value: unknown): Record<string, number> | null {
    if (typeof value !== 'object' || value === null) {
        return null;
    }

    const counters: Record<string, number> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        if (typeof entry === 'number' && Number.isFinite(entry)) {
            counters[key] = entry;
        }
    }

    return Object.keys(counters).length > 0 ? counters : null;
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
        timestampMs: Date.now(),
        pingLatencyMs: null,
        uptimeSeconds: null,
        connectionsCurrent: null,
        opcounters: null,
        activeOperations: null,
        errors: [],
    };

    const adminDb = client.db().admin();

    try {
        const startedAt = performance.now();
        await adminDb.command({ ping: 1 });
        sample.pingLatencyMs = performance.now() - startedAt;
    } catch {
        sample.errors.push('ping');
    }

    try {
        const serverStatus = await adminDb.command({ serverStatus: 1 });
        sample.uptimeSeconds = toNumberOrNull(serverStatus.uptime);
        sample.connectionsCurrent = toNumberOrNull(
            (serverStatus.connections as Record<string, unknown> | undefined)?.current,
        );
        sample.opcounters = toCounterRecord(serverStatus.opcounters);
    } catch {
        // Expected on Azure DocumentDB (vCore): `serverStatus` is not supported there.
        sample.errors.push('serverStatus');
    }

    const currentOperations = await listCurrentOperations(client);
    if (currentOperations.errors.length > 0) {
        sample.errors.push(...currentOperations.errors);
    } else {
        sample.activeOperations = currentOperations.operations.length;
    }

    return sample;
}

function mapCurrentOp(op: Document): CurrentOpEntry {
    let commandPreview = '';
    try {
        commandPreview = JSON.stringify(op.command ?? {}).slice(0, COMMAND_PREVIEW_MAX_LENGTH);
    } catch {
        commandPreview = '';
    }

    return {
        opid: String(op.opid ?? ''),
        type: toStringOrNull(op.op) ?? 'unknown',
        namespace: toStringOrNull(op.ns) ?? '',
        secsRunning: toNumberOrNull(op.secs_running),
        active: op.active === true,
        clientDescription: toStringOrNull(op.client) ?? toStringOrNull(op.appName),
        commandPreview,
    };
}

/**
 * Lists the operations currently running on the cluster.
 *
 * Prefers the `$currentOp` aggregation stage (the modern form, and the one Azure
 * DocumentDB documents as supported) and falls back to the legacy `currentOp` command.
 * The raw server documents are never returned — they are mapped to {@link CurrentOpEntry}
 * so the payload stays small.
 *
 * @param client - A connected MongoClient.
 * @returns The mapped operations, or an empty list plus the failed command names in `errors`.
 */
export async function listCurrentOperations(client: MongoClient): Promise<CurrentOperationsResult> {
    const errors: string[] = [];

    try {
        const documents = await client
            .db('admin')
            .aggregate([{ $currentOp: { allUsers: true, idleConnections: false } }, { $limit: CURRENT_OP_LIMIT }])
            .toArray();

        return { operations: documents.map(mapCurrentOp), errors };
    } catch {
        errors.push('$currentOp');
    }

    try {
        const result = await client.db().admin().command({ currentOp: 1 });
        const inprog = Array.isArray(result.inprog) ? (result.inprog as Document[]) : [];

        return { operations: inprog.slice(0, CURRENT_OP_LIMIT).map(mapCurrentOp), errors: [] };
    } catch {
        errors.push('currentOp');
    }

    return { operations: [], errors };
}

/**
 * Terminates a running operation.
 *
 * `killOp` expects the same opid type the server reported: a number on self-hosted
 * servers, a string on Azure DocumentDB (vCore).
 *
 * @param client - A connected MongoClient.
 * @param opid - The operation identifier as reported by {@link listCurrentOperations}.
 */
export async function killOperation(client: MongoClient, opid: string): Promise<void> {
    const numericOpid = Number(opid);
    const op: number | string = Number.isNaN(numericOpid) || opid.trim() === '' ? opid : numericOpid;

    await client.db().admin().command({ killOp: 1, op });
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
export async function getStorageStats(client: MongoClient): Promise<ClusterStorageStats> {
    const errors: string[] = [];
    const adminDb = client.db().admin();

    let listed: Document;
    try {
        listed = await adminDb.listDatabases();
    } catch {
        return { databases: [], totalSizeBytes: null, errors: ['listDatabases'] };
    }

    const entries = (Array.isArray(listed.databases) ? (listed.databases as Document[]) : [])
        .filter((entry) => typeof entry.name === 'string' && !SYSTEM_DATABASES.has(entry.name as string))
        .slice(0, DATABASE_STATS_LIMIT);

    const databases = await Promise.all(
        entries.map(async (entry): Promise<ClusterDatabaseStorage> => {
            const name = entry.name as string;
            const database: ClusterDatabaseStorage = {
                name,
                sizeOnDiskBytes: toNumberOrNull(entry.sizeOnDisk),
                dataSizeBytes: null,
                indexSizeBytes: null,
                collections: null,
                objects: null,
            };

            try {
                const stats = await client.db(name).command({ dbStats: 1 });
                database.dataSizeBytes = toNumberOrNull(stats.dataSize);
                database.indexSizeBytes = toNumberOrNull(stats.indexSize);
                database.collections = toNumberOrNull(stats.collections);
                database.objects = toNumberOrNull(stats.objects);
                database.sizeOnDiskBytes = database.sizeOnDiskBytes ?? toNumberOrNull(stats.storageSize);
            } catch {
                errors.push(`dbStats:${name}`);
            }

            return database;
        }),
    );

    const totalSizeBytes =
        toNumberOrNull(listed.totalSize) ??
        (databases.length > 0
            ? databases.reduce((total, database) => total + (database.sizeOnDiskBytes ?? 0), 0)
            : null);

    return { databases, totalSizeBytes, errors };
}
