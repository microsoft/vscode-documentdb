/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { type AtlasApiResponse } from '../../src/plugins/service-mongo-atlas/utils/AtlasAdminApiTypes';
import { AtlasAdministrationClient } from '../../src/plugins/service-mongo-atlas/utils/AtlasAdministrationClient';
import { AtlasHttpClient } from '../../src/plugins/service-mongo-atlas/utils/AtlasHttpClient';

function mockJson<T>(data: T): Response {
    return { ok: true, status: 200, json: async () => data } as any as Response;
}

function mockFail(status: number, text: string): Response {
    return { ok: false, status, text: async () => text } as any as Response;
}

suite('AtlasAdministrationClient', () => {
    const orgId = 'org';
    const projectId = 'proj';

    let originalGet: typeof AtlasHttpClient.get;
    let originalPost: typeof AtlasHttpClient.post;
    let originalDelete: typeof AtlasHttpClient.delete;

    function resetStubs() {
        AtlasHttpClient.get = originalGet;
        AtlasHttpClient.post = originalPost;
        AtlasHttpClient.delete = originalDelete;
    }

    setup(() => {
        originalGet = AtlasHttpClient.get.bind(AtlasHttpClient);
        originalPost = AtlasHttpClient.post.bind(AtlasHttpClient);
        originalDelete = AtlasHttpClient.delete.bind(AtlasHttpClient);
    });

    teardown(() => {
        resetStubs();
    });

    test('listProjects success builds query params', async () => {
        const data: AtlasApiResponse<any> = {
            results: [{ name: 'p', orgId: orgId, created: '', clusterCount: 0 }],
            totalCount: 1,
        };
        let calledEndpoint = '';
        AtlasHttpClient.get = (async (_org, endpoint) => {
            calledEndpoint = endpoint;
            return mockJson(data);
        }) as any;
        const resp = await AtlasAdministrationClient.listProjects(orgId, {
            pageNum: 1,
            itemsPerPage: 5,
            includeCount: true,
        });
        assert.strictEqual(resp.totalCount, 1);
        assert.ok(/pageNum=1/.test(calledEndpoint), 'Expected pageNum query param');
    });

    test('listProjects failure throws', async () => {
        AtlasHttpClient.get = (async () => mockFail(500, 'err')) as any;
        await assert.rejects(() => AtlasAdministrationClient.listProjects(orgId), /Failed to list Atlas projects/);
    });

    test('listClusters success', async () => {
        const data: AtlasApiResponse<any> = {
            results: [
                {
                    clusterType: 'REPLICASET',
                    providerSettings: { providerName: 'AWS', regionName: 'us', instanceSizeName: 'M10' },
                    stateName: 'IDLE',
                },
            ],
            totalCount: 1,
        };
        AtlasHttpClient.get = (async () => mockJson(data)) as any;
        const resp = await AtlasAdministrationClient.listClusters(orgId, projectId);
        assert.strictEqual(resp.results.length, 1);
    });

    test('getCluster failure throws', async () => {
        AtlasHttpClient.get = (async () => mockFail(404, 'missing')) as any;
        await assert.rejects(
            () => AtlasAdministrationClient.getCluster(orgId, projectId, 'cl'),
            /Failed to get cluster/,
        );
    });

    test('listDatabaseUsers failure throws', async () => {
        AtlasHttpClient.get = (async () => mockFail(400, 'bad')) as any;
        await assert.rejects(
            () => AtlasAdministrationClient.listDatabaseUsers(orgId, projectId),
            /Failed to list database users/,
        );
    });

    test('getAccessList failure throws', async () => {
        AtlasHttpClient.get = (async () => mockFail(401, 'unauth')) as any;
        await assert.rejects(
            () => AtlasAdministrationClient.getAccessList(orgId, projectId),
            /Failed to get access list/,
        );
    });

    test('createAccessListEntries failure throws', async () => {
        AtlasHttpClient.post = (async () => mockFail(500, 'boom')) as any;
        await assert.rejects(
            () => AtlasAdministrationClient.createAccessListEntries(orgId, projectId, []),
            /Failed to create access list entries/,
        );
    });

    test('deleteAccessListEntry failure throws', async () => {
        AtlasHttpClient.delete = (async () => mockFail(403, 'deny')) as any;
        await assert.rejects(
            () => AtlasAdministrationClient.deleteAccessListEntry(orgId, projectId, '1.1.1.1'),
            /Failed to delete access list entry/,
        );
    });
});
