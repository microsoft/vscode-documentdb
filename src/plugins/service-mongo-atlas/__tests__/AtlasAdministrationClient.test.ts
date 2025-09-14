/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AtlasApiResponse } from '../types/AtlasAdminApiTypes';
import { AtlasAdministrationClient } from '../utils/AtlasAdministrationClient';
import { AtlasHttpClient } from '../utils/AtlasHttpClient';

function mockJson<T>(data: T): Response {
    return { ok: true, status: 200, json: async () => data } as any as Response;
}

function mockFail(status: number, text: string): Response {
    return { ok: false, status, text: async () => text } as any as Response;
}

describe('AtlasAdministrationClient (Jest)', () => {
    const orgId = 'org';
    const projectId = 'proj';

    let originalGet: typeof AtlasHttpClient.get;
    let originalPost: typeof AtlasHttpClient.post;
    let originalDelete: typeof AtlasHttpClient.delete;

    beforeEach(() => {
        originalGet = AtlasHttpClient.get.bind(AtlasHttpClient);
        originalPost = AtlasHttpClient.post.bind(AtlasHttpClient);
        originalDelete = AtlasHttpClient.delete.bind(AtlasHttpClient);
    });

    afterEach(() => {
        AtlasHttpClient.get = originalGet;
        AtlasHttpClient.post = originalPost;
        AtlasHttpClient.delete = originalDelete;
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
        expect(resp.totalCount).toBe(1);
        expect(/pageNum=1/.test(calledEndpoint)).toBe(true);
    });

    test('listProjects failure throws', async () => {
        AtlasHttpClient.get = (async () => mockFail(500, 'err')) as any;
        await expect(AtlasAdministrationClient.listProjects(orgId)).rejects.toThrow(/Failed to list Atlas projects/);
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
        expect(resp.results.length).toBe(1);
    });

    test('getCluster failure throws', async () => {
        AtlasHttpClient.get = (async () => mockFail(404, 'missing')) as any;
        await expect(AtlasAdministrationClient.getCluster(orgId, projectId, 'cl')).rejects.toThrow(
            /Failed to get cluster/,
        );
    });

    test('listDatabaseUsers failure throws', async () => {
        AtlasHttpClient.get = (async () => mockFail(400, 'bad')) as any;
        await expect(AtlasAdministrationClient.listDatabaseUsers(orgId, projectId)).rejects.toThrow(
            /Failed to list database users/,
        );
    });

    test('getAccessList failure throws', async () => {
        AtlasHttpClient.get = (async () => mockFail(401, 'unauth')) as any;
        await expect(AtlasAdministrationClient.getAccessList(orgId, projectId)).rejects.toThrow(
            /Failed to get access list/,
        );
    });

    test('createAccessListEntries failure throws', async () => {
        AtlasHttpClient.post = (async () => mockFail(500, 'boom')) as any;
        await expect(AtlasAdministrationClient.createAccessListEntries(orgId, projectId, [])).rejects.toThrow(
            /Failed to create access list entries/,
        );
    });

    test('deleteAccessListEntry failure throws', async () => {
        AtlasHttpClient.delete = (async () => mockFail(403, 'deny')) as any;
        await expect(AtlasAdministrationClient.deleteAccessListEntry(orgId, projectId, '1.1.1.1')).rejects.toThrow(
            /Failed to delete access list entry/,
        );
    });
});
