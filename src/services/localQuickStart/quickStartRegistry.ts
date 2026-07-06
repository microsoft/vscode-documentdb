/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Persisted registry of managed Quick Start instances + the one-time legacy-key migration (WI-1).
 *
 * The registry is the durable list the tree and reconcile enumerate (so a Missing instance — one
 * whose container was removed externally — still renders). The migration moves the pre-multi-instance
 * flat storage keys to the `DEFAULT_ALIAS`-keyed values BEFORE reconcile so an upgrading user's single
 * instance is adopted with no rename and no data loss.
 *
 * Cross-window note: `globalState` is a non-atomic JSON blob shared across VS Code windows. Mutations
 * here take a per-process async lock (serializes this window only); cross-window races are handled in
 * the service (WI-2) via Docker name/port uniqueness + reconcile healing (see the plan §4.2).
 */

import type * as vscode from 'vscode';
import { DocumentDBConnectionString } from '../../documentdb/utils/DocumentDBConnectionString';
import { getBoundHostPort, type IContainerRuntime } from './ContainerRuntime';
import {
    containerName,
    DEFAULT_ALIAS,
    imageRefKey,
    LEGACY_IMAGE_REF_KEY,
    LEGACY_SECRET_KEY,
    QUICK_START_PORT,
    secretKey,
} from './quickStartTypes';

/** globalState key holding the whole registry blob. */
export const REGISTRY_STATE_KEY = 'documentdb.quickstart.registry';

/** Display name stamped on the migrated default instance (stable data; the tree localizes at render). */
export const DEFAULT_INSTANCE_DISPLAY_NAME = 'DocumentDB Local';

/** One managed instance's durable record. */
export interface QuickStartInstanceRecord {
    readonly alias: string;
    displayName: string;
    /**
     * The host port. Authoritative for a **stopped** instance: `docker ps -a` omits the host-port
     * binding for stopped containers, so the registry is the source of truth for their port.
     */
    port: number;
    /** `'provisioning'` while a create is in flight (see `leaseAt`); `'ready'` once a container exists. */
    phase: 'provisioning' | 'ready';
    /** Owner nonce of the in-flight provision; a destructive pre-clean only acts on its own container. */
    operationId?: string;
    /** Provisioning lease timestamp; a stale lease (crashed host) is scavenged at reconcile. */
    leaseAt?: number;
}

/** The persisted registry blob. */
export interface QuickStartRegistry {
    /** Monotonic suffix for new aliases; healed in reconcile from `max(existing)`. Fresh install = 2. */
    nextSuffix: number;
    instances: QuickStartInstanceRecord[];
}

/** The initial `nextSuffix` on a fresh registry (the default instance has no suffix, so the next is 2). */
export const INITIAL_NEXT_SUFFIX = 2;

/** Read the registry, defaulting a fresh one. Returns a deep-ish copy so callers can mutate freely. */
export function readRegistry(globalState: vscode.Memento): QuickStartRegistry {
    const stored = globalState.get<QuickStartRegistry>(REGISTRY_STATE_KEY);
    if (!stored || typeof stored.nextSuffix !== 'number' || !Array.isArray(stored.instances)) {
        return { nextSuffix: INITIAL_NEXT_SUFFIX, instances: [] };
    }
    return { nextSuffix: stored.nextSuffix, instances: stored.instances.map((record) => ({ ...record })) };
}

/**
 * Per-process serialization of registry writes: mutations chain so two concurrent `updateRegistry`
 * calls in THIS window can't read-modify-write over each other. (Cross-window is out of scope here —
 * see the module header.)
 */
let mutationChain: Promise<unknown> = Promise.resolve();

/**
 * Mutate the registry under the per-process lock: read → mutate → write. The mutator may return a
 * value, which is resolved to the caller (e.g. a freshly allocated alias). Errors are isolated so one
 * failed mutation doesn't wedge the chain.
 */
export function updateRegistry<T>(
    globalState: vscode.Memento,
    mutator: (registry: QuickStartRegistry) => T,
): Promise<T> {
    const run = async (): Promise<T> => {
        const registry = readRegistry(globalState);
        const result = mutator(registry);
        await globalState.update(REGISTRY_STATE_KEY, registry);
        return result;
    };
    const next = mutationChain.then(run, run);
    mutationChain = next.then(
        () => undefined,
        () => undefined,
    );
    return next;
}

/** Parse the host port out of a stored connection string, if present and valid. */
export function portFromConnectionString(connectionString: string): number | undefined {
    try {
        const host = new DocumentDBConnectionString(connectionString).hosts[0];
        const port = Number(host?.split(':')[1]);
        return Number.isInteger(port) && port > 0 ? port : undefined;
    } catch {
        return undefined;
    }
}

/**
 * One-time migration of the pre-multi-instance flat keys to the `DEFAULT_ALIAS`-keyed values.
 *
 * **Ordering is data-safety:** MUST be awaited at activation BEFORE `reconcile()` / any `provision()`.
 * Otherwise reconcile reads a missing alias-keyed secret and a subsequent re-provision decides
 * `reusing=false` and wipes the default volume. Idempotent + guarded; copies (never destructive-moves)
 * then deletes the flat keys only after the alias-keyed copy is confirmed written.
 */
export async function migrateLegacyQuickStartKeys(
    secretStorage: vscode.SecretStorage,
    globalState: vscode.Memento,
    runtime: IContainerRuntime,
): Promise<void> {
    const legacyConnectionString = await secretStorage.get(LEGACY_SECRET_KEY);
    const legacyImageRef = globalState.get<string>(LEGACY_IMAGE_REF_KEY);

    // Nothing to migrate once the legacy keys are gone (fresh install, or a prior run finished cleanup).
    if (legacyConnectionString === undefined && legacyImageRef === undefined) {
        return;
    }

    // The effective connection string: the alias-keyed one if a prior PARTIAL run (or a re-provision)
    // already wrote it — never overwrite a newer alias secret — otherwise the legacy one.
    const aliasConnectionString = await secretStorage.get(secretKey(DEFAULT_ALIAS));
    const connectionString = aliasConnectionString ?? legacyConnectionString;

    // A stray legacy imageRef with no connection string anywhere → just clean it up (no instance).
    if (connectionString === undefined) {
        await globalState.update(LEGACY_IMAGE_REF_KEY, undefined);
        return;
    }

    // Each step is individually idempotent ("ensure if missing") so a crash between any two steps
    // self-heals on the next activation: the guard above keys off the LEGACY key still existing, so a
    // partially-migrated instance is COMPLETED (not skipped). The legacy keys are deleted only LAST.

    // 1) alias secret
    if (aliasConnectionString === undefined) {
        await secretStorage.store(secretKey(DEFAULT_ALIAS), connectionString);
    }

    // 2) alias imageRef
    if (legacyImageRef !== undefined && globalState.get<string>(imageRefKey(DEFAULT_ALIAS)) === undefined) {
        await globalState.update(imageRefKey(DEFAULT_ALIAS), legacyImageRef);
    }

    // 3) default registry record (create-if-missing). Port: connection string → live container
    //    binding → default (never a blind 10260).
    if (!readRegistry(globalState).instances.some((record) => record.alias === DEFAULT_ALIAS)) {
        let port = portFromConnectionString(connectionString);
        if (port === undefined) {
            const inspected = await runtime.inspectContainer(containerName(DEFAULT_ALIAS));
            port = (inspected && getBoundHostPort(inspected)) || QUICK_START_PORT;
        }
        await updateRegistry(globalState, (registry) => {
            if (!registry.instances.some((record) => record.alias === DEFAULT_ALIAS)) {
                registry.instances.push({
                    alias: DEFAULT_ALIAS,
                    displayName: DEFAULT_INSTANCE_DISPLAY_NAME,
                    port: port as number,
                    phase: 'ready',
                });
            }
        });
    }

    // 4) Delete the flat keys only AFTER all alias-keyed state + the registry record are present.
    await secretStorage.delete(LEGACY_SECRET_KEY);
    await globalState.update(LEGACY_IMAGE_REF_KEY, undefined);
}

/** Insert or replace an instance record (matched by alias). Used when an instance becomes ready. */
export function upsertInstanceRecord(globalState: vscode.Memento, record: QuickStartInstanceRecord): Promise<void> {
    return updateRegistry(globalState, (registry) => {
        const index = registry.instances.findIndex((existing) => existing.alias === record.alias);
        if (index >= 0) {
            registry.instances[index] = { ...record };
        } else {
            registry.instances.push({ ...record });
        }
    });
}

/** Remove an instance record by alias (no-op if absent). Used on an explicit Delete. */
export function removeInstanceRecord(globalState: vscode.Memento, alias: string): Promise<void> {
    return updateRegistry(globalState, (registry) => {
        registry.instances = registry.instances.filter((existing) => existing.alias !== alias);
    });
}
