/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Health, storage and running-operation collectors for the Cluster Dashboard.
 *
 * Resilience model (copied from the sibling `getClusterMetadata.ts`): every server command
 * runs in its own try/catch. A command that fails leaves its fields `null` and records the
 * command name in `errors` — the collector never throws because of an unsupported command.
 * This matters because Azure DocumentDB (vCore) does not support `serverStatus`, while a
 * local emulator or a self-hosted server usually does.
 *
 * None of these functions cache; the caller decides the sampling cadence.
 */

import { type Document, type MongoClient } from 'mongodb';

/** Maximum number of `currentOp` entries returned to a caller. */
const CURRENT_OP_LIMIT = 100;

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

/** Maximum length of the serialized command preview attached to a {@link CurrentOpEntry}. */
const COMMAND_PREVIEW_MAX_LENGTH = 2000;

/** Databases excluded from the storage breakdown — they are server-internal. */
const SYSTEM_DATABASES = new Set(['admin', 'local', 'config']);

/**
 * Commands whose *entire* body is credential material, so only the command name survives
 * into a preview. `saslStart`/`saslContinue` carry the SCRAM exchange in `payload`, and the
 * user-management commands carry the cleartext password in `pwd`.
 */
const CREDENTIAL_COMMANDS = new Set([
    'createuser',
    'updateuser',
    'saslstart',
    'saslcontinue',
    'authenticate',
    'copydbsaslstart',
    'copydbgetnonce',
    'getnonce',
]);

/** Field names redacted wherever they appear in a command document, at any depth. */
const CREDENTIAL_FIELDS = new Set([
    'pwd',
    'payload',
    'speculativeauthenticate',
    'credentials',
    'salt',
    'saltedpassword',
    'clientkey',
    'serverkey',
    'storedkey',
    'passwordhash',
]);

/**
 * Substrings that make a field name secret-shaped, matched anywhere in the name.
 *
 * The exact-name set above covers the fields the wire protocol itself defines. It cannot cover
 * application data: a `find` whose filter is `{password: "hunter2"}` or `{accessToken: "…"}` is
 * an ordinary command carrying a secret in a field this code has never heard of. Those names are
 * not wire-protocol fields, so no exact list will ever contain them, but they are conventional
 * enough to catch by shape.
 *
 * This is defence in depth, not a guarantee. A denylist cannot establish that a command document
 * is safe — an application is free to call its secret `q7`. See the note on `exportDiagnostics`
 * for what that means for anything a user is invited to share.
 */
const CREDENTIAL_FIELD_FRAGMENTS = [
    'password',
    'passwd',
    'secret',
    'token',
    'apikey',
    'api_key',
    'accesskey',
    'access_key',
    'privatekey',
    'private_key',
    'authorization',
    'credential',
];

/** Whether a command-document field name should have its value withheld. */
function isCredentialFieldName(fieldName: string): boolean {
    const normalized = fieldName.toLowerCase();

    return (
        CREDENTIAL_FIELDS.has(normalized) ||
        CREDENTIAL_FIELD_FRAGMENTS.some((fragment) => normalized.includes(fragment))
    );
}

/** Marker substituted for redacted values. Data inside a JSON blob, so not localized. */
const REDACTED_VALUE = '[redacted]';

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

/**
 * Breadth of a {@link listCurrentOperations} result.
 *
 * `'all'` — every user's operations. `'own'` — only the operations of the signed-in user,
 * which is all a connection without the `inprog` privilege is allowed to see.
 */
export type CurrentOpScope = 'all' | 'own';

/** Result of {@link listCurrentOperations}. */
export interface CurrentOperationsResult {
    operations: CurrentOpEntry[];
    /**
     * Whether the returned list covers the whole cluster or only the caller's own
     * operations. The dashboard says so explicitly rather than presenting a partial list
     * as complete.
     */
    scope: CurrentOpScope;
    /** Names of the commands that failed while listing operations. */
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
 * Serializes an in-flight command for diagnostics, with credential material stripped first.
 *
 * `currentOp` reports commands verbatim, so an authentication handshake or a `createUser`
 * caught mid-flight carries the SCRAM payload or a cleartext password. Serialized as-is it
 * would enter the diagnostics document — the repository forbids surfacing passwords or tokens,
 * and a preview is never worth a credential.
 *
 * Two passes, and neither makes the result *safe*: commands that exist only to carry
 * credentials lose their body entirely, and secret-shaped field names lose their values at any
 * depth. What survives is the rest of the command — including **query filter values and document
 * fields written by the application**. That is ordinary customer data, and no denylist can
 * recognize it. Treat the result as sensitive wherever it is surfaced, and see
 * `exportDiagnostics` for the consequence.
 */
function buildCommandPreview(command: unknown): string {
    if (typeof command !== 'object' || command === null) {
        return '';
    }

    // The command name is the first key of the document, by wire-protocol convention.
    const commandName = Object.keys(command)[0];
    if (commandName !== undefined && CREDENTIAL_COMMANDS.has(commandName.toLowerCase())) {
        return JSON.stringify({ [commandName]: REDACTED_VALUE });
    }

    return (
        JSON.stringify(command, (key, value: unknown) => (isCredentialFieldName(key) ? REDACTED_VALUE : value)) ?? ''
    );
}

function mapCurrentOp(op: Document): CurrentOpEntry {
    let commandPreview = '';
    try {
        commandPreview = buildCommandPreview(op.command).slice(0, COMMAND_PREVIEW_MAX_LENGTH);
    } catch {
        commandPreview = '';
    }

    return {
        opid: String(op.opid ?? ''),
        type: toStringOrNull(op.op) ?? 'unknown',
        namespace: toStringOrNull(op.ns) ?? '',
        secsRunning: toNumberOrNull(op.secs_running),
        active: op.active === true,
        clientDescription: toStringOrNull(op.client) ?? toStringOrNull(op.appName) ?? toStringOrNull(op.desc),
        commandPreview,
    };
}

/**
 * `$match` stage dropping the entries that are not user operations:
 *
 * - the server's own background threads (`Checkpointer`, `JournalFlusher`, …), reported as
 *   `op: 'none'` against no namespace;
 * - Azure DocumentDB (vCore) parallel workers, the internal shards of one user aggregation.
 *
 * Neither describes a distinct user operation. This runs **before** `$limit` so background
 * work cannot consume the result budget and hide user operations in diagnostics.
 */
const EXCLUDE_BACKGROUND_THREADS = {
    $match: {
        $and: [{ $or: [{ op: { $ne: 'none' } }, { ns: { $nin: ['', null] } }] }, { parallelWorker: { $ne: true } }],
    },
};

/** Client-side equivalent of {@link EXCLUDE_BACKGROUND_THREADS} for the legacy path. */
function isUserOperation(op: Document): boolean {
    // vCore fans an aggregation out internally and reports every worker as its own op, each
    // with an empty `opid`. `leaderOpPatter` [sic] points back at the operation the user
    // actually started, which is the entry worth retaining.
    if (op.parallelWorker === true) {
        return false;
    }

    const operationType = toStringOrNull(op.op);
    const namespace = toStringOrNull(op.ns);

    return !(operationType === null || operationType === 'none') || namespace !== null;
}

/**
 * `true` for the very query that is collecting this list.
 *
 * `$currentOp` reports the aggregation issuing it, and the legacy `currentOp` command
 * reports itself the same way. No `$currentOp` option suppresses it, so it is filtered from
 * the diagnostics snapshot here.
 */
function isSelfInspectionQuery(op: Document): boolean {
    const command = op.command as Record<string, unknown> | undefined;
    if (!command) {
        return false;
    }

    // Legacy form: `{ currentOp: 1 }`.
    if (command.currentOp !== undefined) {
        return true;
    }

    // Aggregation form: a pipeline whose first stage is `$currentOp`.
    const pipeline = command.pipeline;
    if (
        Array.isArray(pipeline) &&
        pipeline.some((stage) => typeof stage === 'object' && stage !== null && '$currentOp' in stage)
    ) {
        return true;
    }

    // Azure DocumentDB (vCore) does not report the pipeline at all — the inspecting
    // aggregation arrives as `{ aggregate: '' }` with no namespace, so neither check above
    // can see it. A database-level aggregation against no collection is the only shape this
    // matches, and this inspection query is by far its most likely source.
    return command.aggregate === '' && toStringOrNull(op.ns) === null;
}

/**
 * Names of the driver's connectivity error classes, matched structurally rather than with
 * `instanceof` so these checks also work with driver errors from a different module instance.
 */
const CONNECTIVITY_ERROR_NAMES = new Set([
    'MongoNetworkError',
    'MongoNetworkTimeoutError',
    'MongoServerSelectionError',
    'MongoTopologyClosedError',
    'MongoNotConnectedError',
]);

/**
 * `true` when the cluster could not be reached at all, as opposed to reaching it and being
 * refused. Only the former means retrying a different command form is pointless.
 */
function isConnectivityFailure(error: unknown): boolean {
    const name = (error as { name?: unknown } | null)?.name;

    return typeof name === 'string' && CONNECTIVITY_ERROR_NAMES.has(name);
}

/** One way of asking a server for its in-flight operations. */
interface CurrentOpAttempt {
    /**
     * Command form, used verbatim as the `errors` label. Deliberately *not* the scope: two
     * attempts that differ only in breadth fail for the same reason and produce the same
     * string, which is then deduplicated into a single entry.
     */
    commandName: '$currentOp' | 'currentOp';
    scope: CurrentOpScope;
    run: (client: MongoClient) => Promise<Document[]>;
}

/**
 * Ordered fallback chain for listing operations.
 *
 * Both cluster-wide forms require the `inprog` privilege, which a least-privileged account
 * does not have. The own-operations forms need no privilege at all, so diagnostics degrades
 * to a narrower list instead of returning nothing.
 *
 * Ordered by breadth first and command form second: a complete list from the legacy command
 * is more useful than a self-only list from the modern one.
 */
const CURRENT_OP_ATTEMPTS: CurrentOpAttempt[] = [
    {
        commandName: '$currentOp',
        scope: 'all',
        run: (client) =>
            client
                .db('admin')
                .aggregate([
                    // `idleSessions` (not `idleConnections`, which already defaults to
                    // false) is what keeps parked sessions out of the result.
                    { $currentOp: { allUsers: true, idleConnections: false, idleSessions: false } },
                    EXCLUDE_BACKGROUND_THREADS,
                    { $limit: CURRENT_OP_LIMIT },
                ])
                .toArray(),
    },
    {
        commandName: 'currentOp',
        scope: 'all',
        run: async (client) => {
            const result = await client.db().admin().command({ currentOp: 1 });

            return Array.isArray(result.inprog) ? (result.inprog as Document[]) : [];
        },
    },
    {
        commandName: '$currentOp',
        scope: 'own',
        run: (client) =>
            client
                .db('admin')
                .aggregate([
                    { $currentOp: { allUsers: false, idleConnections: false, idleSessions: false } },
                    EXCLUDE_BACKGROUND_THREADS,
                    { $limit: CURRENT_OP_LIMIT },
                ])
                .toArray(),
    },
    {
        commandName: 'currentOp',
        scope: 'own',
        run: async (client) => {
            const result = await client.db().admin().command({ currentOp: 1, $ownOps: true });

            return Array.isArray(result.inprog) ? (result.inprog as Document[]) : [];
        },
    },
];

/**
 * Lists the operations running on a cluster.
 *
 * Walks {@link CURRENT_OP_ATTEMPTS} until one succeeds, so an unsupported command form or a
 * missing `inprog` privilege narrows the result rather than emptying it. The raw server
 * documents are never returned — they are mapped to {@link CurrentOpEntry} so the credential
 * redaction in {@link buildCommandPreview} is applied on the way out.
 *
 * @param client - A connected MongoClient.
 * @returns The mapped operations and the breadth they cover, or an empty list plus the
 *          failed command names in `errors`.
 */
export async function listCurrentOperations(client: MongoClient): Promise<CurrentOperationsResult> {
    const errors: string[] = [];

    for (const attempt of CURRENT_OP_ATTEMPTS) {
        try {
            const documents = await attempt.run(client);

            return {
                // Filtered client-side as well as in the pipeline: the `$match` stage is the
                // load-bearing fix (it runs before `$limit`), but repeating it here keeps
                // behaviour identical if a server ignores or rejects the stage, and makes
                // every attempt in the chain produce the same shape.
                operations: documents
                    .filter((op) => isUserOperation(op) && !isSelfInspectionQuery(op))
                    .slice(0, CURRENT_OP_LIMIT)
                    .map(mapCurrentOp),
                scope: attempt.scope,
                // A successful fallback is not an error: earlier attempts failing is the
                // chain working as designed, and surfacing them would report a permanent
                // problem on every cluster that only supports one form.
                errors: [],
            };
        } catch (error) {
            const description = describeCommandFailure(attempt.commandName, error);
            if (!errors.includes(description)) {
                errors.push(description);
            }

            // An unreachable cluster fails every attempt identically, each paying the full
            // server-selection timeout. Stop at the first one so a dead connection costs a
            // single timeout rather than four.
            if (isConnectivityFailure(error)) {
                break;
            }
        }
    }

    return { operations: [], scope: 'all', errors };
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
