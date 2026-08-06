/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { CredentialCache } from '../../../documentdb/CredentialCache';
import { QuickStartService } from '../../../services/localQuickStart/QuickStartService';
import {
    InstanceState,
    type InstanceMetadata,
    type QuickStartStatus,
} from '../../../services/localQuickStart/quickStartTypes';
import { type ClusterItemBase } from '../../documentdb/ClusterItemBase';
import { LocalQuickStartItem } from './LocalQuickStartItem';

jest.mock('../../../utils/icons', () => ({ getResourcesPath: () => '/resources' }));

jest.mock('@microsoft/vscode-azext-utils', () => ({
    UserCancelledError: class UserCancelledError extends Error {},
    callWithTelemetryAndErrorHandling: jest.fn(async (_eventName: string, callback: (ctx: unknown) => unknown) =>
        callback({ telemetry: { properties: {}, measurements: {} }, errorHandling: {}, valuesToMask: [] }),
    ),
    createContextValue: (values: string[]) => values.join(';'),
    createGenericElement: (opts: Record<string, unknown>) => ({ ...opts }),
}));

jest.mock('../../../extensionVariables', () => ({
    ext: { outputChannel: { appendLine: jest.fn(), debug: jest.fn() } },
}));

const mockGetClient = jest.fn();
jest.mock('../../../documentdb/ClustersClient', () => ({
    ClustersClient: { getClient: (...args: unknown[]) => mockGetClient(...args) },
}));

jest.mock('../../documentdb/DatabaseItem', () => ({
    DatabaseItem: class {
        public constructor(
            _cluster: unknown,
            private readonly database: { name: string },
        ) {}
        public get id(): string {
            return this.database.name;
        }
        public loadCollectionCount(): void {
            /* no-op */
        }
    },
}));

const ALIAS = 'vscode-documentdb-local';
const CLUSTER_ID = `quickstart-${ALIAS}`;
const CONNECTION_STRING = `mongodb://qs_user:s3cr3t@localhost:10260/?tls=true&tlsAllowInvalidCertificates=true`;

function runningStatus(): QuickStartStatus {
    return {
        state: InstanceState.Running,
        missing: false,
        canResumeReadiness: false,
        metadata: {
            containerId: 'c1',
            alias: ALIAS,
            boundPort: 10260,
            clusterId: CLUSTER_ID,
            connectionString: CONNECTION_STRING,
            username: 'qs_user',
        } as InstanceMetadata,
    } as QuickStartStatus;
}

/** The Running row is always a single cluster item; unwrap it with the base type. */
async function getClusterItem(): Promise<ClusterItemBase> {
    const children = await new LocalQuickStartItem('connectionsView/root').getChildren();
    expect(children).toHaveLength(1);
    return children[0] as unknown as ClusterItemBase;
}

/**
 * H5 contract (review §3 H5, fixed in Iteration 1): the managed instance is NOT a stored connection,
 * so it must resolve its credentials from {@link QuickStartService} rather than from
 * `ConnectionStorageService` (which holds no record for it) or from a pre-primed `CredentialCache`.
 *
 * Before the fix, a window reload — or any other path that emptied the cache — left the node
 * unbrowsable: the inherited `DocumentDBClusterItem.authenticateAndConnect()` looked the instance up
 * in storage, missed, and returned `null`. These tests pin the new source of truth so a refactor
 * cannot quietly reintroduce the storage dependency behind a green suite.
 */
describe('QuickStartClusterItem — credential source of truth (H5)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        CredentialCache.deleteCredentials(CLUSTER_ID);
        jest.spyOn(QuickStartService, 'refreshLiveStateInBackground').mockReturnValue(undefined);
        jest.spyOn(QuickStartService, 'getStatus').mockReturnValue(runningStatus());
    });

    afterEach(() => {
        jest.restoreAllMocks();
        CredentialCache.deleteCredentials(CLUSTER_ID);
    });

    it('lists databases after the credential cache was emptied (e.g. a window reload)', async () => {
        const readStored = jest
            .spyOn(QuickStartService, 'readStoredConnectionString')
            .mockResolvedValue(CONNECTION_STRING);
        const listDatabases = jest.fn().mockResolvedValue([{ name: 'sampledb' }]);
        mockGetClient.mockResolvedValue({ listDatabases });
        jest.spyOn(vscode.window, 'withProgress').mockImplementation(
            (_options: unknown, task: (progress: unknown, token: unknown) => Thenable<unknown>) =>
                task({ report: jest.fn() }, { onCancellationRequested: jest.fn() }) as Thenable<never>,
        );

        // The cache is empty — exactly the post-reload state that made H5 reproducible.
        expect(CredentialCache.hasCredentials(CLUSTER_ID)).toBe(false);

        const databases = await (await getClusterItem()).getChildren();

        expect(readStored).toHaveBeenCalledWith(ALIAS);
        expect(mockGetClient).toHaveBeenCalledWith(CLUSTER_ID, expect.anything());
        expect(databases).toHaveLength(1);
        // The cache is a cache: it is filled by the connect, not depended on by it.
        expect(CredentialCache.hasCredentials(CLUSTER_ID)).toBe(true);
    });

    it('exposes the stored credentials via getCredentials()', async () => {
        jest.spyOn(QuickStartService, 'readStoredConnectionString').mockResolvedValue(CONNECTION_STRING);

        const credentials = await (await getClusterItem()).getCredentials();

        expect(credentials?.connectionString).toBe(CONNECTION_STRING);
        expect(credentials?.nativeAuthConfig).toEqual({ connectionUser: 'qs_user', connectionPassword: 's3cr3t' });
    });

    it('returns no credentials and no client when the secret is gone', async () => {
        jest.spyOn(QuickStartService, 'readStoredConnectionString').mockResolvedValue(undefined);

        const item = await getClusterItem();

        // getChildren() must degrade to error-recovery children rather than throw out of the tree.
        await expect(item.getCredentials()).resolves.toBeUndefined();
        const children = await item.getChildren();
        expect(children.some((child) => child.id?.endsWith('/retry'))).toBe(true);
        expect(mockGetClient).not.toHaveBeenCalled();
    });
});
