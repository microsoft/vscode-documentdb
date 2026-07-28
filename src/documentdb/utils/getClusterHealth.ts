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
    'key',
    'speculativeauthenticate',
    'credentials',
    'salt',
    'saltedpassword',
    'clientkey',
    'serverkey',
    'storedkey',
    'passwordhash',
]);

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

/** The command name portion of a {@link describeCommandFailure} entry. */
export function getFailedCommandName(errorEntry: string): string {
    const separatorIndex = errorEntry.indexOf(':');

    return separatorIndex === -1 ? errorEntry : errorEntry.slice(0, separatorIndex);
}

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
    /**
     * Sum of `sizeOnDiskBytes` across the databases in {@link databases} — i.e. exactly
     * the rows the Storage tab renders, so the Total always reconciles with them.
     */
    totalSizeBytes: number | null;
    /** User databases beyond {@link DATABASE_STATS_LIMIT} that were not inspected. */
    omittedDatabaseCount: number;
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
    /**
     * `true` when the server reported `opid` as a number rather than a string.
     *
     * `killOp` requires the identifier in the *same* type the server used: self-hosted
     * servers report numeric opids and reject a string, Azure DocumentDB (vCore) reports
     * string opids and rejects a number. `opid` is stringified for display and React keys,
     * so this flag is what preserves the original type across the wire to
     * {@link killOperation}. Re-deriving it with `Number(opid)` would be wrong: it silently
     * accepts `'0x1A'`/`'1e3'` and loses precision above `Number.MAX_SAFE_INTEGER`, which
     * would kill a *different* operation.
     */
    opidIsNumeric: boolean;
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

/** What the signed-in user is allowed to do, as far as the server will say. */
export interface ClusterPrivileges {
    /**
     * Whether the user may terminate operations. `null` when the server did not report its
     * privileges at all — the dashboard then leaves the action enabled and lets the server
     * refuse, because disabling a button that would have worked is the worse error.
     */
    canKillOperations: boolean | null;
    /** Names of the commands that failed while reading privileges. */
    errors: string[];
}

/** The `killOp` privilege, as spelled in `connectionStatus.authInfo`. */
const KILL_OPERATION_ACTION = 'killop';

/**
 * Reads the signed-in user's privileges.
 *
 * Used only to explain why an action is unavailable — never to decide whether a command is
 * *supported*. The two are independent: an Azure DocumentDB (vCore) admin is granted the
 * `serverStatus` action while the server rejects the command outright, so predicting
 * capability from privileges would be wrong in both directions.
 *
 * @param client - A connected MongoClient.
 * @returns The privileges that could be determined; unknowns stay `null` rather than
 *          defaulting to "denied".
 */
export async function getClusterPrivileges(client: MongoClient): Promise<ClusterPrivileges> {
    try {
        const status = await client.db().admin().command({ connectionStatus: 1, showPrivileges: true });
        const authInfo = status.authInfo as { authenticatedUserPrivileges?: unknown } | undefined;
        const privileges = authInfo?.authenticatedUserPrivileges;

        if (!Array.isArray(privileges)) {
            // Reported nothing rather than reporting an empty set: not the same as "denied".
            return { canKillOperations: null, errors: [] };
        }

        // Any resource, not just `{cluster: true}`, even though that is where servers put it
        // today. Missing a grant filed elsewhere would disable a button that works, while an
        // over-broad match at worst leaves it enabled for the server to refuse.
        const canKillOperations = privileges.some((privilege) => {
            const actions = (privilege as { actions?: unknown } | null)?.actions;

            return (
                Array.isArray(actions) &&
                actions.some((action) => typeof action === 'string' && action.toLowerCase() === KILL_OPERATION_ACTION)
            );
        });

        return { canKillOperations, errors: [] };
    } catch (error) {
        return { canKillOperations: null, errors: [describeCommandFailure('connectionStatus', error)] };
    }
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

    // Issued concurrently rather than one after another. The commands are independent, and
    // run in sequence an unreachable cluster pays the server-selection timeout once per
    // command — several minutes before the header badge can leave "Connecting…", far longer
    // than the polling interval. Concurrency can inflate the measured ping slightly, since
    // the other commands compete for the same connection pool; a few milliseconds of noise
    // on a latency reading is worth bounding the failure case to a single timeout.
    const [pingError, serverStatusError, currentOperations] = await Promise.all([
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
                sample.connectionsCurrent = toNumberOrNull(
                    (serverStatus.connections as Record<string, unknown> | undefined)?.current,
                );
                sample.opcounters = toCounterRecord(serverStatus.opcounters);
                return null;
            } catch (error) {
                // Expected on Azure DocumentDB (vCore): `serverStatus` is not supported there.
                return describeCommandFailure('serverStatus', error);
            }
        })(),
        listCurrentOperations(client),
    ]);

    // Collected after the fact so `errors` keeps a stable ping/serverStatus/currentOp order
    // regardless of which command happened to finish first.
    if (pingError !== null) {
        sample.errors.push(pingError);
    }
    if (serverStatusError !== null) {
        sample.errors.push(serverStatusError);
    }
    if (currentOperations.errors.length > 0) {
        sample.errors.push(...currentOperations.errors);
    } else {
        sample.activeOperations = currentOperations.operations.length;
    }

    return sample;
}

/**
 * Serializes an in-flight command for the Operations tab tooltip, with credential material
 * stripped first.
 *
 * `currentOp` reports commands verbatim, so an authentication handshake or a `createUser`
 * caught mid-flight carries the SCRAM payload or a cleartext password. Serialized as-is it
 * would cross the webview bridge and render in a tooltip — the repository forbids surfacing
 * passwords or tokens, and a preview is never worth a credential.
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
        JSON.stringify(command, (key, value: unknown) =>
            CREDENTIAL_FIELDS.has(key.toLowerCase()) ? REDACTED_VALUE : value,
        ) ?? ''
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
        opidIsNumeric: typeof op.opid === 'number',
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
 * Neither can be killed, and both inflate the "Active Operations" tile — background threads
 * make an idle cluster read non-zero, and vCore reports one slow aggregation as a leader
 * plus two or more workers, so the tile reads roughly triple. This runs **before** `$limit`
 * so they cannot consume the result budget and hide real user operations on a busy server —
 * the case where the Operations tab matters most.
 */
const EXCLUDE_BACKGROUND_THREADS = {
    $match: {
        $and: [{ $or: [{ op: { $ne: 'none' } }, { ns: { $nin: ['', null] } }] }, { parallelWorker: { $ne: true } }],
    },
};

/** Client-side equivalent of {@link EXCLUDE_BACKGROUND_THREADS} for the legacy path. */
function isUserOperation(op: Document): boolean {
    // vCore fans an aggregation out internally and reports every worker as its own op, each
    // with an empty `opid` — so they arrive as unkillable duplicate rows sharing the
    // leader's namespace. `leaderOpPatter` [sic] points back at the operation the user
    // actually started, which is the row worth showing.
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
 * reports itself the same way. Without this the dashboard watches itself: the Active
 * Operations tile floors at 1 on an idle cluster, the sparkline is a flat line at 1, and
 * the Operations tab shows a permanent phantom row whose Kill button terminates the
 * dashboard's own poll. No `$currentOp` option suppresses it, so it is filtered here.
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
    // can see it and the dashboard ends up permanently watching itself. A database-level
    // aggregation against no collection is the only shape this matches, and the poll is by
    // far its most likely source.
    return command.aggregate === '' && toStringOrNull(op.ns) === null;
}

/**
 * Names of the driver's connectivity error classes.
 *
 * Matched structurally rather than with `instanceof`, because importing them would be a
 * *runtime* import of `mongodb`: the webview imports {@link getFailedCommandName} from this
 * module as a value, and the extension bundles every webview into a single chunk, so a
 * value import here drags the whole driver into the browser bundle.
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
 * does not have — on such a connection the first two attempts fail and the Operations tab
 * would otherwise be permanently empty. The own-operations forms need no privilege at all,
 * so the tab degrades to a narrower list instead of nothing.
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
 * Lists the operations currently running on the cluster.
 *
 * Walks {@link CURRENT_OP_ATTEMPTS} until one succeeds, so an unsupported command form or a
 * missing `inprog` privilege narrows the result rather than emptying it. The raw server
 * documents are never returned — they are mapped to {@link CurrentOpEntry} so the payload
 * stays small.
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
                // chain working as designed, and surfacing them would put a permanent
                // warning on the tab of every cluster that only supports one form.
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
 * Terminates a running operation.
 *
 * @param client - A connected MongoClient.
 * @param opid - The operation identifier exactly as reported by {@link listCurrentOperations}.
 * @param opidIsNumeric - Whether the server reported the identifier as a number.
 *                        See {@link CurrentOpEntry.opidIsNumeric} for why this is carried
 *                        rather than re-derived.
 * @returns `true` when the server acknowledged the request.
 */
export async function killOperation(client: MongoClient, opid: string, opidIsNumeric: boolean): Promise<boolean> {
    const op: number | string = opidIsNumeric ? Number(opid) : opid;

    const result = await client.db().admin().command({ killOp: 1, op });

    return result.ok === 1;
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
    } catch (error) {
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
                // `??` rather than `||`: a genuine 0 is a real answer and must not be
                // replaced, but `null` (field absent) should fall back to storageSize.
                database.sizeOnDiskBytes ??= toNumberOrNull(stats.storageSize);
            } catch (error) {
                errors.push(describeCommandFailure(`dbStats:${name}`, error));
            }

            return database;
        }),
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
