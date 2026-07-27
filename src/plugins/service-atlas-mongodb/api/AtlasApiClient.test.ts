/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

jest.mock('vscode', () => ({
    ThemeIcon: class ThemeIcon {
        constructor(public readonly id: string) {}
    },
    l10n: {
        t: jest.fn((message: string, ...args: string[]) =>
            args.reduce<string>((m, value, index) => m.replace(`{${String(index)}}`, value), message),
        ),
    },
}));

jest.mock('../../../extensionVariables', () => ({
    ext: {
        outputChannel: { trace: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), appendLine: jest.fn() },
    },
}));

import { type AtlasProject } from '../models/AtlasProjectModel';
import { AtlasApiClient, AtlasApiError } from './AtlasApiClient';

const session = { type: 'serviceaccount', accessToken: 'token-1' } as const;

const fetchMock = jest.fn();

function jsonResponse(body: unknown, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (): string | null => null },
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
    } as unknown as Response;
}

function page(count: number, offset: number, totalCount: number): { results: AtlasProject[]; totalCount: number } {
    return {
        results: Array.from({ length: count }, (_unused, index) => ({
            id: `p${String(offset + index)}`,
            name: `Project ${String(offset + index)}`,
            orgId: 'org-1',
            clusterCount: 0,
            created: '2026-01-01T00:00:00Z',
        })),
        totalCount,
    };
}

function requestedUrls(): string[] {
    return fetchMock.mock.calls.map((call) => String(call[0]));
}

beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
});

describe('AtlasApiClient pagination', () => {
    it('issues a single request when the first page is short', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(page(3, 0, 3)));

        const projects = await new AtlasApiClient(session).listProjects();

        expect(projects).toHaveLength(3);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(requestedUrls()[0]).toContain('itemsPerPage=500&pageNum=1');
    });

    it('walks every page until a short page arrives', async () => {
        fetchMock
            .mockResolvedValueOnce(jsonResponse(page(500, 0, 1200)))
            .mockResolvedValueOnce(jsonResponse(page(500, 500, 1200)))
            .mockResolvedValueOnce(jsonResponse(page(200, 1000, 1200)));

        const projects = await new AtlasApiClient(session).listProjects();

        expect(projects).toHaveLength(1200);
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(requestedUrls().map((url) => url.split('pageNum=')[1])).toEqual(['1', '2', '3']);
    });

    it('stops as soon as the reported total is reached, even on a full last page', async () => {
        fetchMock
            .mockResolvedValueOnce(jsonResponse(page(500, 0, 1000)))
            .mockResolvedValueOnce(jsonResponse(page(500, 500, 1000)));

        const projects = await new AtlasApiClient(session).listProjects();

        expect(projects).toHaveLength(1000);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('paginates cluster lists with the project id encoded in the path', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({ results: [], totalCount: 0 }));

        await new AtlasApiClient(session).listClusters('group/1');

        expect(requestedUrls()[0]).toContain('/groups/group%2F1/clusters?itemsPerPage=500&pageNum=1');
    });

    it('does not paginate single-resource requests', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'u1', emailAddress: 'a@b.invalid' }));

        await new AtlasApiClient(session).getCurrentUser();

        expect(requestedUrls()[0]).not.toContain('pageNum');
    });

    it('surfaces API errors with their status code', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({ detail: 'IP not allowed' }, 403));

        await expect(new AtlasApiClient(session).listProjects()).rejects.toBeInstanceOf(AtlasApiError);
    });

    it('refreshes the session once and retries when the token is rejected', async () => {
        fetchMock
            .mockResolvedValueOnce(jsonResponse({ detail: 'token expired' }, 401))
            .mockResolvedValueOnce(jsonResponse(page(1, 0, 1)));

        const refresher = {
            tryRefreshIfPossible: jest
                .fn()
                .mockResolvedValue({ type: 'serviceaccount', accessToken: 'token-2' } as const),
        };

        const projects = await new AtlasApiClient(session, refresher).listProjects();

        expect(projects).toHaveLength(1);
        expect(refresher.tryRefreshIfPossible).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('does not mint a new token on 403, because a new token carries the same roles', async () => {
        // 403 means authenticated but not permitted: an enforced IP access list, or roles that are
        // too narrow. Re-minting cannot change the outcome, it only doubles the requests and makes
        // the failure take twice as long to surface.
        fetchMock.mockResolvedValueOnce(jsonResponse({ detail: 'IP address is not allowed' }, 403));

        const refresher = { tryRefreshIfPossible: jest.fn() };

        await expect(new AtlasApiClient(session, refresher).listProjects()).rejects.toBeInstanceOf(AtlasApiError);
        expect(refresher.tryRefreshIfPossible).not.toHaveBeenCalled();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
