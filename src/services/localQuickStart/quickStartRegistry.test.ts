/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { type IContainerRuntime } from './ContainerRuntime';
import {
    INITIAL_NEXT_SUFFIX,
    migrateLegacyQuickStartKeys,
    portFromConnectionString,
    readRegistry,
    removeInstanceRecord,
    updateRegistry,
    upsertInstanceRecord,
} from './quickStartRegistry';
import {
    containerName,
    DEFAULT_ALIAS,
    imageRefKey,
    LEGACY_IMAGE_REF_KEY,
    LEGACY_SECRET_KEY,
    QUICK_START_CONTAINER_NAME,
    QUICK_START_PORT,
    QUICK_START_VOLUME_NAME,
    secretKey,
    volumeName,
} from './quickStartTypes';

// --- Minimal in-memory fakes (cast to sidestep vscode's overloaded signatures) ---

function fakeMemento(): { memento: vscode.Memento; store: Map<string, unknown> } {
    const store = new Map<string, unknown>();
    const memento = {
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
    return { memento, store };
}

function fakeSecretStorage(): { secrets: vscode.SecretStorage; store: Map<string, string> } {
    const store = new Map<string, string>();
    const secrets = {
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
    } as unknown as vscode.SecretStorage;
    return { secrets, store };
}

/** A runtime whose `inspectContainer` reports the given bound host port (or none). */
function runtimeWithPort(hostPort: number | undefined): IContainerRuntime {
    const inspected =
        hostPort === undefined
            ? { status: 'running', ports: [] }
            : { status: 'running', ports: [{ containerPort: QUICK_START_PORT, hostPort }] };
    return {
        inspectContainer: jest.fn().mockResolvedValue(inspected),
    } as unknown as IContainerRuntime;
}

const CONN = (port?: number): string =>
    port === undefined
        ? 'mongodb://u1:p1@localhost/?tls=true&tlsAllowInvalidCertificates=true'
        : `mongodb://u1:p1@localhost:${port}/?tls=true&tlsAllowInvalidCertificates=true`;

describe('identity backward-compat invariants (no-rename on upgrade)', () => {
    // These MUST hold: they are the reason an existing single instance is adopted with no rename.
    // A future edit to any of the underlying literals would silently orphan the container/volume.
    it('containerName(DEFAULT_ALIAS) equals the legacy container name', () => {
        expect(containerName(DEFAULT_ALIAS)).toBe(QUICK_START_CONTAINER_NAME);
    });

    it('volumeName(DEFAULT_ALIAS) equals the legacy volume name', () => {
        expect(volumeName(DEFAULT_ALIAS)).toBe(QUICK_START_VOLUME_NAME);
    });
});

describe('quickStartRegistry.portFromConnectionString', () => {
    it('extracts an explicit port', () => {
        expect(portFromConnectionString(CONN(10273))).toBe(10273);
    });

    it('returns undefined when no port is present', () => {
        expect(portFromConnectionString(CONN(undefined))).toBeUndefined();
    });

    it('returns undefined for an unparseable string', () => {
        expect(portFromConnectionString('not-a-connection-string')).toBeUndefined();
    });
});

describe('quickStartRegistry.readRegistry / updateRegistry', () => {
    it('defaults a fresh registry', () => {
        const { memento } = fakeMemento();
        expect(readRegistry(memento)).toEqual({ nextSuffix: INITIAL_NEXT_SUFFIX, instances: [] });
    });

    it('persists mutations and returns the mutator result', async () => {
        const { memento } = fakeMemento();
        const alias = await updateRegistry(memento, (registry) => {
            registry.instances.push({ alias: 'x', displayName: 'X', port: 10261, phase: 'ready' });
            registry.nextSuffix = 3;
            return 'x';
        });
        expect(alias).toBe('x');
        const after = readRegistry(memento);
        expect(after.nextSuffix).toBe(3);
        expect(after.instances).toHaveLength(1);
        expect(after.instances[0]).toMatchObject({ alias: 'x', port: 10261, phase: 'ready' });
    });

    it('serializes concurrent mutations without clobbering', async () => {
        const { memento } = fakeMemento();
        await Promise.all(
            [10261, 10262, 10263].map((port, i) =>
                updateRegistry(memento, (registry) => {
                    registry.instances.push({ alias: `a${i}`, displayName: `A${i}`, port, phase: 'ready' });
                }),
            ),
        );
        expect(readRegistry(memento).instances).toHaveLength(3);
    });
});

describe('quickStartRegistry.upsertInstanceRecord / removeInstanceRecord', () => {
    it('inserts a new record', async () => {
        const { memento } = fakeMemento();
        await upsertInstanceRecord(memento, { alias: 'a', displayName: 'A', port: 10261, phase: 'ready' });
        expect(readRegistry(memento).instances).toEqual([
            { alias: 'a', displayName: 'A', port: 10261, phase: 'ready' },
        ]);
    });

    it('replaces an existing record matched by alias (clearing a stale provisioning lease)', async () => {
        const { memento } = fakeMemento();
        await upsertInstanceRecord(memento, {
            alias: 'a',
            displayName: 'A',
            port: 10261,
            phase: 'provisioning',
            operationId: 'op1',
            leaseAt: 1,
        });
        await upsertInstanceRecord(memento, { alias: 'a', displayName: 'A', port: 10275, phase: 'ready' });
        const instances = readRegistry(memento).instances;
        expect(instances).toHaveLength(1);
        expect(instances[0]).toEqual({ alias: 'a', displayName: 'A', port: 10275, phase: 'ready' });
    });

    it('removes a record by alias (no-op if absent)', async () => {
        const { memento } = fakeMemento();
        await upsertInstanceRecord(memento, { alias: 'a', displayName: 'A', port: 10261, phase: 'ready' });
        await upsertInstanceRecord(memento, { alias: 'b', displayName: 'B', port: 10262, phase: 'ready' });
        await removeInstanceRecord(memento, 'a');
        expect(readRegistry(memento).instances.map((record) => record.alias)).toEqual(['b']);
        await removeInstanceRecord(memento, 'nonexistent');
        expect(readRegistry(memento).instances.map((record) => record.alias)).toEqual(['b']);
    });
});

describe('quickStartRegistry.migrateLegacyQuickStartKeys', () => {
    it('migrates the legacy secret + imageRef to the alias-keyed values and registers the default instance', async () => {
        const { memento, store: state } = fakeMemento();
        const { secrets, store: secretStore } = fakeSecretStorage();
        secretStore.set(LEGACY_SECRET_KEY, CONN(10273));
        void memento.update(LEGACY_IMAGE_REF_KEY, 'ghcr.io/documentdb/documentdb-local:1.2.0');

        await migrateLegacyQuickStartKeys(secrets, memento, runtimeWithPort(undefined));

        // Copied to the alias-keyed values.
        expect(secretStore.get(secretKey(DEFAULT_ALIAS))).toBe(CONN(10273));
        expect(state.get(imageRefKey(DEFAULT_ALIAS))).toBe('ghcr.io/documentdb/documentdb-local:1.2.0');
        // Registry now has the default instance with the port parsed from the connection string.
        const registry = readRegistry(memento);
        expect(registry.instances).toHaveLength(1);
        expect(registry.instances[0]).toMatchObject({ alias: DEFAULT_ALIAS, port: 10273, phase: 'ready' });
        // Legacy keys deleted.
        expect(secretStore.has(LEGACY_SECRET_KEY)).toBe(false);
        expect(state.has(LEGACY_IMAGE_REF_KEY)).toBe(false);
    });

    it('is idempotent (a second run is a no-op)', async () => {
        const { memento } = fakeMemento();
        const { secrets, store: secretStore } = fakeSecretStorage();
        secretStore.set(LEGACY_SECRET_KEY, CONN(10273));

        await migrateLegacyQuickStartKeys(secrets, memento, runtimeWithPort(undefined));
        await migrateLegacyQuickStartKeys(secrets, memento, runtimeWithPort(undefined));

        expect(readRegistry(memento).instances).toHaveLength(1);
        expect(secretStore.get(secretKey(DEFAULT_ALIAS))).toBe(CONN(10273));
    });

    it('does nothing when there is no legacy secret (fresh install)', async () => {
        const { memento } = fakeMemento();
        const { secrets, store: secretStore } = fakeSecretStorage();

        await migrateLegacyQuickStartKeys(secrets, memento, runtimeWithPort(undefined));

        expect(readRegistry(memento).instances).toHaveLength(0);
        expect(secretStore.size).toBe(0);
    });

    it('resumes a partial migration: keeps the newer alias secret, completes the registry, deletes legacy', async () => {
        const { memento } = fakeMemento();
        const { secrets, store: secretStore } = fakeSecretStorage();
        secretStore.set(LEGACY_SECRET_KEY, CONN(10273));
        secretStore.set(secretKey(DEFAULT_ALIAS), CONN(10299)); // a prior run wrote the alias secret then crashed

        await migrateLegacyQuickStartKeys(secrets, memento, runtimeWithPort(undefined));

        // Never overwrites the newer alias secret; completes the registry from it; cleans up legacy.
        expect(secretStore.get(secretKey(DEFAULT_ALIAS))).toBe(CONN(10299));
        expect(secretStore.has(LEGACY_SECRET_KEY)).toBe(false);
        const registry = readRegistry(memento);
        expect(registry.instances).toHaveLength(1);
        expect(registry.instances[0]).toMatchObject({ alias: DEFAULT_ALIAS, port: 10299, phase: 'ready' });
    });

    it('resumes after a crash between the secret copy and the imageRef/registry/cleanup steps', async () => {
        const { memento, store: state } = fakeMemento();
        const { secrets, store: secretStore } = fakeSecretStorage();
        // Partial first run: legacy keys still present, alias secret already written, but the imageRef
        // copy, registry record, and legacy deletion never happened.
        secretStore.set(LEGACY_SECRET_KEY, CONN(10273));
        void memento.update(LEGACY_IMAGE_REF_KEY, 'ghcr.io/documentdb/documentdb-local:1.0.0');
        secretStore.set(secretKey(DEFAULT_ALIAS), CONN(10273));

        await migrateLegacyQuickStartKeys(secrets, memento, runtimeWithPort(undefined));

        // The second run completes every remaining step.
        expect(state.get(imageRefKey(DEFAULT_ALIAS))).toBe('ghcr.io/documentdb/documentdb-local:1.0.0');
        expect(readRegistry(memento).instances).toHaveLength(1);
        expect(secretStore.has(LEGACY_SECRET_KEY)).toBe(false);
        expect(state.has(LEGACY_IMAGE_REF_KEY)).toBe(false);
    });

    it('derives the port from the live container when the connection string has none', async () => {
        const { memento } = fakeMemento();
        const { secrets, store: secretStore } = fakeSecretStorage();
        secretStore.set(LEGACY_SECRET_KEY, CONN(undefined)); // no port in the string

        await migrateLegacyQuickStartKeys(secrets, memento, runtimeWithPort(10288));

        expect(readRegistry(memento).instances[0]).toMatchObject({ alias: DEFAULT_ALIAS, port: 10288 });
    });

    it('falls back to the default port when neither the string nor the container reveal one', async () => {
        const { memento } = fakeMemento();
        const { secrets, store: secretStore } = fakeSecretStorage();
        secretStore.set(LEGACY_SECRET_KEY, CONN(undefined));

        await migrateLegacyQuickStartKeys(secrets, memento, runtimeWithPort(undefined));

        expect(readRegistry(memento).instances[0]).toMatchObject({ alias: DEFAULT_ALIAS, port: QUICK_START_PORT });
    });
});
