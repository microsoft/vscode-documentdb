/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    AtlasAdministrationClient,
    type AtlasApiResponse,
} from '../../src/plugins/service-mongo-atlas/utils/AtlasAdministrationClient';
import { AtlasHttpClient } from '../../src/plugins/service-mongo-atlas/utils/AtlasHttpClient';

// Prevent ESM parsing issue from transitively importing digest-fetch by mocking it early.
jest.mock('digest-fetch', () => ({ default: jest.fn() }));
jest.mock('../../src/plugins/service-mongo-atlas/utils/AtlasHttpClient');

const mockedHttp = AtlasHttpClient as jest.Mocked<typeof AtlasHttpClient>;

function mockJson<T>(data: T) {
    return { ok: true, status: 200, json: async () => data } as any as Response;
}

function mockFail(status: number, text: string) {
    return { ok: false, status, text: async () => text } as any as Response;
}

describe('AtlasAdministrationClient', () => {
    const orgId = 'org';
    const projectId = 'proj';

    beforeEach(() => {
        jest.resetAllMocks();
    });

    test('listProjects success builds query params', async () => {
        const data: AtlasApiResponse<any> = {
            results: [{ name: 'p', orgId: orgId, created: '', clusterCount: 0 }],
            totalCount: 1,
        };
        mockedHttp.get.mockResolvedValue(mockJson(data));
        const resp = await AtlasAdministrationClient.listProjects(orgId, {
            pageNum: 1,
            itemsPerPage: 5,
            includeCount: true,
        });
        expect(resp.totalCount).toBe(1);
        expect(mockedHttp.get.mock.calls[0][1]).toMatch(/pageNum=1/);
    });

    test('listProjects failure throws', async () => {
        mockedHttp.get.mockResolvedValue(mockFail(500, 'err'));
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
        mockedHttp.get.mockResolvedValue(mockJson(data));
        const resp = await AtlasAdministrationClient.listClusters(orgId, projectId);
        expect(resp.results.length).toBe(1);
    });

    test('getCluster failure throws', async () => {
        mockedHttp.get.mockResolvedValue(mockFail(404, 'missing'));
        await expect(AtlasAdministrationClient.getCluster(orgId, projectId, 'cl')).rejects.toThrow(
            /Failed to get cluster/,
        );
    });

    test('listDatabaseUsers failure throws', async () => {
        mockedHttp.get.mockResolvedValue(mockFail(400, 'bad'));
        await expect(AtlasAdministrationClient.listDatabaseUsers(orgId, projectId)).rejects.toThrow(
            /Failed to list database users/,
        );
    });

    test('getAccessList failure throws', async () => {
        mockedHttp.get.mockResolvedValue(mockFail(401, 'unauth'));
        await expect(AtlasAdministrationClient.getAccessList(orgId, projectId)).rejects.toThrow(
            /Failed to get access list/,
        );
    });

    test('createAccessListEntries failure throws', async () => {
        mockedHttp.post.mockResolvedValue(mockFail(500, 'boom'));
        await expect(AtlasAdministrationClient.createAccessListEntries(orgId, projectId, [])).rejects.toThrow(
            /Failed to create access list entries/,
        );
    });

    test('deleteAccessListEntry failure throws', async () => {
        mockedHttp.delete.mockResolvedValue(mockFail(403, 'deny'));
        await expect(AtlasAdministrationClient.deleteAccessListEntry(orgId, projectId, '1.1.1.1')).rejects.toThrow(
            /Failed to delete access list entry/,
        );
    });
});
