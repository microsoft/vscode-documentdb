/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The Quick Start durable state lives in the shared storage service: one item per alias holding the
 * instance's record in `properties` and its connection string in `secrets`.
 *
 * The credential half is the sensitive one. If a read ever answers "no credentials" for an instance
 * that has them, the next provision decides `reusing=false` and **wipes the user's data volume** —
 * so these tests pin the write/read/clear behaviour the provision paths rely on.
 */

import type * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { StorageService } from '../storageService';
import {
    getInstance,
    readConnectionString,
    removeInstanceIf,
    upsertInstance,
    writeConnectionString,
} from './quickStartStore';
import { DEFAULT_ALIAS } from './quickStartTypes';

const CONN = 'mongodb://u1:p1@localhost:10273/?tls=true&tlsAllowInvalidCertificates=true';
const IMAGE = 'ghcr.io/documentdb/documentdb-local:1.0.0';

function fakeMemento(): vscode.Memento {
    const store = new Map<string, unknown>();
    return {
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
}

function fakeSecretStorage(seed: Record<string, string> = {}): vscode.SecretStorage & {
    snapshot: () => Record<string, string>;
} {
    const store = new Map<string, string>(Object.entries(seed));
    return {
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
        snapshot: () => Object.fromEntries(store),
    } as unknown as vscode.SecretStorage & { snapshot: () => Record<string, string> };
}

describe('quickStartStore', () => {
    let originalSecretStorage: vscode.SecretStorage;
    let originalContext: vscode.ExtensionContext;
    let secretStorage: ReturnType<typeof fakeSecretStorage>;
    let globalState: vscode.Memento;

    beforeEach(() => {
        originalSecretStorage = ext.secretStorage;
        originalContext = ext.context;
        secretStorage = fakeSecretStorage();
        globalState = fakeMemento();
        ext.secretStorage = secretStorage;
        // A fresh backing store per test; resetting also drops the cached StorageImpl whose
        // short-lived getItems cache would otherwise leak the previous test's snapshot.
        StorageService._resetForTests();
        ext.context = {
            globalState,
            subscriptions: [],
            extension: { id: 'ms-azuretools.vscode-documentdb' },
        } as unknown as vscode.ExtensionContext;
    });

    afterEach(() => {
        ext.secretStorage = originalSecretStorage;
        ext.context = originalContext;
    });

    describe('records and credentials', () => {
        it('round-trips a record and its credentials as one item', async () => {
            await upsertInstance({
                alias: DEFAULT_ALIAS,
                displayName: 'DocumentDB Local',
                port: 10273,
                phase: 'ready',
                imageRef: IMAGE,
            });
            await writeConnectionString(DEFAULT_ALIAS, CONN, { displayName: 'DocumentDB Local', port: 10273 });

            const record = await getInstance(DEFAULT_ALIAS);
            expect(record).toMatchObject({ alias: DEFAULT_ALIAS, port: 10273, phase: 'ready', imageRef: IMAGE });
            expect(await readConnectionString(DEFAULT_ALIAS)).toBe(CONN);
        });

        it('keeps the credentials when only the record is rewritten', async () => {
            await writeConnectionString(DEFAULT_ALIAS, CONN, { displayName: 'DocumentDB Local', port: 10273 });
            await upsertInstance({
                alias: DEFAULT_ALIAS,
                displayName: 'DocumentDB Local',
                port: 10273,
                phase: 'ready',
            });

            expect(await readConnectionString(DEFAULT_ALIAS)).toBe(CONN);
        });

        it('creates a minimal record when credentials arrive before one exists', async () => {
            // provision() writes the secret early (H3); a secret with no record would be invisible
            // to reconcile and the tree.
            await writeConnectionString(DEFAULT_ALIAS, CONN, { displayName: 'DocumentDB Local', port: 10273 });

            expect(await getInstance(DEFAULT_ALIAS)).toMatchObject({ port: 10273, phase: 'provisioning' });
        });

        it('clears the credentials but keeps the record when passed null', async () => {
            await writeConnectionString(DEFAULT_ALIAS, CONN, { displayName: 'DocumentDB Local', port: 10273 });
            await writeConnectionString(DEFAULT_ALIAS, null, { displayName: 'DocumentDB Local', port: 10273 });

            expect(await readConnectionString(DEFAULT_ALIAS)).toBeUndefined();
            expect(await getInstance(DEFAULT_ALIAS)).toBeDefined();
        });

        it('removes an instance only while the predicate still holds', async () => {
            await upsertInstance({
                alias: DEFAULT_ALIAS,
                displayName: 'DocumentDB Local',
                port: 10273,
                phase: 'ready',
            });

            await removeInstanceIf(DEFAULT_ALIAS, (record) => record.phase === 'provisioning');
            expect(await getInstance(DEFAULT_ALIAS)).toBeDefined();

            await removeInstanceIf(DEFAULT_ALIAS, (record) => record.phase === 'ready');
            expect(await getInstance(DEFAULT_ALIAS)).toBeUndefined();
        });
    });
});
