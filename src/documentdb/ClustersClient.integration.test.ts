/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DocumentDBShellRuntime } from '@documentdb-js/shell-runtime';
import { type IAzExtLogOutputChannel } from '@microsoft/vscode-azext-utils';
import { ext } from '../extensionVariables';
import { composeConnectionString } from '../services/localQuickStart/quickStartCredentials';
import { AuthMethodId } from './auth/AuthMethod';
import { ClustersClient } from './ClustersClient';
import { CredentialCache } from './CredentialCache';

// Telemetry needs a live extension host, so run its callbacks directly.
jest.mock('@microsoft/vscode-azext-utils', () => ({
    ...jest.requireActual('@microsoft/vscode-azext-utils'),
    callWithTelemetryAndErrorHandling: jest.fn(
        async (_callbackId: string, callback: (context: unknown) => Promise<unknown>) =>
            await callback({ telemetry: { properties: {}, measurements: {} }, errorHandling: {}, valuesToMask: [] }),
    ),
}));

// CI's db-integration job starts DocumentDB Local as a service container and sets these.
const username = process.env.DOCUMENTDB_INTEGRATION_USERNAME ?? '';
const password = process.env.DOCUMENTDB_INTEGRATION_PASSWORD ?? '';
const port = Number(process.env.DOCUMENTDB_INTEGRATION_PORT ?? 10260);
if (!username || !password) {
    throw new Error(
        'Set DOCUMENTDB_INTEGRATION_USERNAME and DOCUMENTDB_INTEGRATION_PASSWORD to a running DocumentDB Local instance.',
    );
}

const READY_TIMEOUT_MS = 120_000;
const clusterId = 'integration-documentdb-local';
const databaseName = `integration_${Date.now()}`;
const collectionName = 'items';

let client: ClustersClient;

beforeAll(async () => {
    ext.outputChannel = {
        trace: jest.fn(),
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        appendLine: jest.fn(),
        appendLog: jest.fn(),
    } as unknown as IAzExtLogOutputChannel;

    // The same connection string and credentials Quick Start sets up for its managed instance.
    CredentialCache.setAuthCredentials(
        clusterId,
        AuthMethodId.NativeAuth,
        composeConnectionString(username, password, port),
        { connectionUser: username, connectionPassword: password },
        { isEmulator: true, disableEmulatorSecurity: true },
    );
    client = await connectWhenReady();
}, READY_TIMEOUT_MS + 10_000);

afterAll(async () => {
    try {
        await client?.dropDatabase(databaseName);
    } finally {
        // An open client keeps Jest from exiting, which would hang the job instead of failing it.
        await ClustersClient.deleteClient(clusterId);
    }
});

describe('ClustersClient against DocumentDB Local', () => {
    it('creates an empty collection', async () => {
        await client.createCollection(databaseName, collectionName);

        expect((await client.listCollections(databaseName)).map((collection) => collection.name)).toContain(
            collectionName,
        );
        expect((await client.listDatabases()).map((database) => database.name)).toContain(databaseName);
    });

    it('queries the documents inserted into it', async () => {
        const inserted = await client.insertDocuments(databaseName, collectionName, [
            { _id: 'a', n: 1 },
            { _id: 'b', n: 2 },
            { _id: 'c', n: 3 },
        ]);
        expect(inserted.insertedCount).toBe(3);

        const found = await client.runFindQuery(databaseName, collectionName, {
            filter: '{ n: { $gte: 2 } }',
            sort: '{ n: -1 }',
        });
        expect(found.map((document) => document._id)).toEqual(['c', 'b']);
        expect(await client.countDocuments(databaseName, collectionName, '{ n: { $lt: 3 } }')).toBe(2);
    });

    it('updates and deletes a document by the serialized id the UI passes', async () => {
        const id = JSON.stringify('a');

        await client.upsertDocument(databaseName, collectionName, id, { n: 10 });
        expect(await client.pointRead(databaseName, collectionName, id)).toMatchObject({ _id: 'a', n: 10 });

        await client.deleteDocuments(databaseName, collectionName, [id]);
        expect(await client.pointRead(databaseName, collectionName, id)).toBeNull();
    });

    it('creates and drops an index', async () => {
        const indexNames = async () =>
            (await client.listIndexes(databaseName, collectionName)).map((index) => index.name);

        expect((await client.createIndex(databaseName, collectionName, { key: { n: 1 }, name: 'n_1' })).ok).toBe(1);
        expect(await indexNames()).toContain('n_1');

        expect((await client.dropIndex(databaseName, collectionName, 'n_1')).ok).toBe(1);
        expect(await indexNames()).not.toContain('n_1');
    });

    it('evaluates shell code over the same connection', async () => {
        const runtime = new DocumentDBShellRuntime(client.getMongoClient());
        try {
            const result = await runtime.evaluate(`db.${collectionName}.countDocuments({})`, databaseName);

            expect(Number(result.printable)).toBe(2);
        } finally {
            runtime.dispose();
        }
    });
});

// The container takes a while to accept commands after it starts, so retry until a real one succeeds.
async function connectWhenReady(): Promise<ClustersClient> {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    for (;;) {
        try {
            const connected = await ClustersClient.getClient(clusterId);
            await connected.listDatabases();
            return connected;
        } catch (error) {
            await ClustersClient.deleteClient(clusterId);
            if (Date.now() > deadline) {
                throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, 2_000));
        }
    }
}
