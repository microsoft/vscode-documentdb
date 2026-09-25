/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Durable state for the managed Quick Start instances, on top of the shared {@link StorageService}.
 *
 * One {@link StorageItem} per alias holds everything about an instance: its record in `properties`
 * and its connection string in `secrets`. A state change is therefore a single `push()`, rather than
 * the two-phase commit that split secret/globalState stores would force (write the secret early,
 * remember the previous value, restore it in `finally`). It also follows the `service-kubernetes`
 * `sourceStore` and `service-atlas-mongodb` credential-store precedents, so the codebase has one
 * storage idiom rather than a per-feature one.
 *
 * **Cross-window note.** The backing `globalState` is a non-atomic JSON blob shared across VS Code
 * windows. Writes here take a per-process async lock (this window only); cross-window races are
 * handled in the service via Docker name/port uniqueness plus reconcile healing.
 */

import { type Storage, type StorageItem, StorageService } from '../storageService';

/** Storage name for the Quick Start subsystem (namespaces the keys under the extension id). */
export const QUICK_START_STORAGE_NAME = 'local-quickstart';

/** The single workspace ("directory") holding one item per managed instance. */
export const QUICK_START_INSTANCES_WORKSPACE = 'instances';

/** Schema version stamped on every item, so a future shape change can be detected rather than guessed. */
export const QUICK_START_ITEM_VERSION = '1';

/** Display name stamped on the default instance (stable data; the tree localizes at render). */
export const DEFAULT_INSTANCE_DISPLAY_NAME = 'DocumentDB Local';

/**
 * A provisioning lease older than this is treated as a crashed/abandoned pre-create and scavenged at
 * reconcile (design §4 / §12). It MUST exceed the worst-case first image pull (which precedes any
 * container), so a slow pull is never mistaken for a dead host; the lease is renewed per stage.
 */
export const PROVISIONING_LEASE_TTL_MS = 20 * 60_000;

/** One managed instance's durable record — the non-secret half of its storage item. */
export interface QuickStartInstanceRecord {
    readonly alias: string;
    displayName: string;
    /**
     * The host port. Authoritative for a **stopped** instance: `docker ps -a` omits the host-port
     * binding for stopped containers, so this record is the source of truth for their port.
     */
    port: number;
    /** `'provisioning'` while a create is in flight (see `leaseAt`); `'ready'` once a container exists. */
    phase: 'provisioning' | 'ready';
    /** Owner nonce of the in-flight provision; a destructive pre-clean only acts on its own container. */
    operationId?: string;
    /** Provisioning lease timestamp; a stale lease (crashed host) is scavenged at reconcile. */
    leaseAt?: number;
    /** Image the instance's data volume was created with, so a recreate reuses it. */
    imageRef?: string;
}

/** Properties persisted on the storage item. Structurally the record, minus the readonly marker. */
type QuickStartInstanceProperties = Record<string, unknown> & {
    alias: string;
    displayName: string;
    port: number;
    phase: 'provisioning' | 'ready';
    operationId?: string;
    leaseAt?: number;
    imageRef?: string;
};

/**
 * True when `record` is an in-flight `'provisioning'` lease that has NOT expired — i.e. a create is
 * genuinely still running (fresh), vs. a stale reservation left by a crashed host (to be scavenged).
 */
export function isProvisioningLeaseFresh(record: QuickStartInstanceRecord, now: number = Date.now()): boolean {
    return (
        record.phase === 'provisioning' &&
        record.leaseAt !== undefined &&
        now - record.leaseAt <= PROVISIONING_LEASE_TTL_MS
    );
}

function store(): Storage {
    return StorageService.get(QUICK_START_STORAGE_NAME);
}

function toRecord(item: StorageItem<QuickStartInstanceProperties>): QuickStartInstanceRecord | undefined {
    const properties = item.properties;
    if (!properties || typeof properties.port !== 'number') {
        return undefined;
    }
    return {
        alias: properties.alias ?? item.id,
        displayName: properties.displayName || item.name,
        port: properties.port,
        phase: properties.phase === 'provisioning' ? 'provisioning' : 'ready',
        operationId: properties.operationId,
        leaseAt: properties.leaseAt,
        imageRef: properties.imageRef,
    };
}

function toItem(
    record: QuickStartInstanceRecord,
    connectionString: string | undefined,
): StorageItem<QuickStartInstanceProperties> {
    return {
        id: record.alias,
        name: record.displayName,
        version: QUICK_START_ITEM_VERSION,
        properties: {
            alias: record.alias,
            displayName: record.displayName,
            port: record.port,
            phase: record.phase,
            operationId: record.operationId,
            leaseAt: record.leaseAt,
            imageRef: record.imageRef,
        },
        // `push` only writes the secret key when the array is non-empty, so an item that has no
        // credentials yet simply has no secret entry rather than an empty-string one.
        secrets: connectionString === undefined ? [] : [connectionString],
    };
}

/**
 * Per-process serialization of instance writes: mutations chain so two concurrent read-modify-write
 * calls in THIS window can't clobber each other. (Cross-window is out of scope — see the module
 * header.) Errors are isolated so one failed mutation doesn't wedge the chain.
 */
let mutationChain: Promise<unknown> = Promise.resolve();

function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = mutationChain.then(operation, operation);
    mutationChain = next.then(
        () => undefined,
        () => undefined,
    );
    return next;
}

/** Every known instance's durable record, in no particular order. */
export async function listInstances(): Promise<QuickStartInstanceRecord[]> {
    const items = await store().getItems<QuickStartInstanceProperties>(QUICK_START_INSTANCES_WORKSPACE);
    return items
        .map((item) => toRecord(item))
        .filter((record): record is QuickStartInstanceRecord => record !== undefined);
}

/** One instance's durable record, or `undefined` when the alias is unknown. */
export async function getInstance(alias: string): Promise<QuickStartInstanceRecord | undefined> {
    const item = await store().getItem<QuickStartInstanceProperties>(QUICK_START_INSTANCES_WORKSPACE, alias);
    return item && toRecord(item);
}

/** The instance's stored connection string — the credential source of truth. */
export async function readConnectionString(alias: string): Promise<string | undefined> {
    const item = await store().getItem<QuickStartInstanceProperties>(QUICK_START_INSTANCES_WORKSPACE, alias);
    return item?.secrets?.[0] || undefined;
}

/**
 * Read-modify-write one instance under the lock. The mutator receives the current record (or
 * `undefined`) and returns the record to persist; returning `undefined` leaves the instance
 * untouched, which lets a caller decide inside the lock that it should not write at all.
 *
 * The connection string is preserved unless `connectionString` is passed: `null` clears it,
 * a string replaces it.
 */
export function updateInstance(
    alias: string,
    mutate: (current: QuickStartInstanceRecord | undefined) => QuickStartInstanceRecord | undefined,
    connectionString?: string | null,
): Promise<void> {
    return serialize(async () => {
        const item = await store().getItem<QuickStartInstanceProperties>(QUICK_START_INSTANCES_WORKSPACE, alias);
        const current = item && toRecord(item);
        const next = mutate(current);
        if (!next) {
            return;
        }
        const secret = connectionString === undefined ? item?.secrets?.[0] : (connectionString ?? undefined);
        // `push` writes the secret key only when there is something to write — it never clears one.
        // Deleting the item first is what actually removes a stale secret, which the H3 restore path
        // depends on: a discarded attempt must not leave its credentials behind for the next run's
        // `reusing` decision. Safe inside the lock, and a crash between the two leaves no record,
        // which is the harmless direction.
        if (secret === undefined && item?.secrets?.length) {
            await store().delete(QUICK_START_INSTANCES_WORKSPACE, alias);
        }
        await store().push(QUICK_START_INSTANCES_WORKSPACE, toItem(next, secret));
    });
}

/** Insert or replace an instance's record, preserving its stored connection string. */
export function upsertInstance(record: QuickStartInstanceRecord): Promise<void> {
    return updateInstance(record.alias, () => record);
}

/**
 * Store (or clear, with `null`) an instance's connection string, creating a minimal record when the
 * alias is not known yet — a secret with no record would be invisible to reconcile and the tree.
 */
export function writeConnectionString(
    alias: string,
    connectionString: string | null,
    fallback: { displayName: string; port: number },
): Promise<void> {
    return updateInstance(
        alias,
        (current) =>
            current ?? {
                alias,
                displayName: fallback.displayName,
                port: fallback.port,
                phase: 'provisioning',
            },
        connectionString,
    );
}

/** Remove an instance entirely — record and credentials — for an explicit Delete. */
export function removeInstance(alias: string): Promise<void> {
    return serialize(() => store().delete(QUICK_START_INSTANCES_WORKSPACE, alias));
}

/**
 * Remove an instance only when `predicate` still holds. The predicate is evaluated INSIDE the lock,
 * which is the whole point: a record that a concurrent finalize/adopt just promoted to `ready` (or
 * refreshed the lease on) must not be dropped by a check made before the write landed.
 */
export function removeInstanceIf(
    alias: string,
    predicate: (record: QuickStartInstanceRecord) => boolean,
): Promise<void> {
    return serialize(async () => {
        const item = await store().getItem<QuickStartInstanceProperties>(QUICK_START_INSTANCES_WORKSPACE, alias);
        const record = item && toRecord(item);
        if (record && predicate(record)) {
            await store().delete(QUICK_START_INSTANCES_WORKSPACE, alias);
        }
    });
}

/** Drop stale pre-create reservations, re-validating staleness inside the lock. */
export async function scavengeStaleLeases(aliases: Iterable<string>): Promise<void> {
    for (const alias of aliases) {
        await removeInstanceIf(alias, (record) => record.phase === 'provisioning' && !isProvisioningLeaseFresh(record));
    }
}
