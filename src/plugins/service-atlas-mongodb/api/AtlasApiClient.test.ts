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

jest.mock('./AtlasDigestAuth', () => ({
    parseDigestChallenge: jest.fn(() => ({ realm: 'realm', nonce: 'nonce', qop: 'auth' })),
    computeDigestHeader: jest.fn(() => 'Digest computed-value'),
}));

import { ext } from '../../../extensionVariables';
import { type AtlasProject } from '../models/AtlasProjectModel';
import { AtlasApiClient, AtlasApiError } from './AtlasApiClient';
import { computeDigestHeader } from './AtlasDigestAuth';

const session = { type: 'serviceaccount', accessToken: 'token-1' } as const;

const fetchMock = jest.fn();

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (name: string): string | null => headers[name.toLowerCase()] ?? null },
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
    (ext.outputChannel.warn as jest.Mock).mockClear();
    (ext.outputChannel.trace as jest.Mock).mockClear();
    global.fetch = fetchMock as unknown as typeof fetch;
});

describe('AtlasApiClient error reporting', () => {
    it('keeps the whole Atlas error envelope instead of reducing it to detail', async () => {
        // errorCode is the only stable, machine-readable part, and it is what separates an IP
        // access list rejection from any other 403.
        fetchMock.mockResolvedValueOnce(
            jsonResponse(
                {
                    error: 403,
                    errorCode: 'IP_ADDRESS_NOT_ON_ACCESS_LIST',
                    reason: 'Forbidden',
                    detail: 'IP address 203.0.113.9 is not allowed to access this resource.',
                    parameters: ['203.0.113.9'],
                },
                403,
            ),
        );

        const error = await new AtlasApiClient(session).listProjects().catch((e: unknown) => e);

        expect(error).toBeInstanceOf(AtlasApiError);
        expect((error as AtlasApiError).errorCode).toBe('IP_ADDRESS_NOT_ON_ACCESS_LIST');
        expect((error as AtlasApiError).detail).toContain('203.0.113.9');
        expect((error as AtlasApiError).parameters).toEqual(['203.0.113.9']);

        const warning = String((ext.outputChannel.warn as jest.Mock).mock.calls[0][0]);
        expect(warning).toContain('errorCode=IP_ADDRESS_NOT_ON_ACCESS_LIST');
        expect(warning).toContain('reason=Forbidden');
        expect(warning).toContain('detail=IP address 203.0.113.9');
        expect(warning).toContain('parameters=["203.0.113.9"]');
    });

    it('traces the rate-limit headers, which are the only way to spot throttling', async () => {
        fetchMock.mockResolvedValueOnce(
            jsonResponse({ errorCode: 'RATE_LIMITED', detail: 'Too many requests.' }, 429, {
                'retry-after': '30',
                'x-ratelimit-remaining': '0',
                'x-request-id': 'req-abc',
            }),
        );

        await expect(new AtlasApiClient(session).listProjects()).rejects.toBeInstanceOf(AtlasApiError);

        const traced = (ext.outputChannel.trace as jest.Mock).mock.calls.map((call) => String(call[0])).join('\n');
        expect(traced).toContain('retry-after=30');
        expect(traced).toContain('x-ratelimit-remaining=0');
        expect(traced).toContain('x-request-id=req-abc');
    });

    it('keeps a bounded slice of a non-JSON error body rather than dropping it', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: false,
            status: 502,
            headers: { get: (): string | null => null },
            json: () => Promise.reject(new Error('not json')),
            text: () => Promise.resolve('<html>Bad Gateway</html>'),
        } as unknown as Response);

        await expect(new AtlasApiClient(session).listProjects()).rejects.toBeInstanceOf(AtlasApiError);

        expect(String((ext.outputChannel.warn as jest.Mock).mock.calls[0][0])).toContain('body=<html>Bad Gateway');
    });
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

    it('traces secret-free diagnostics for every discovered cluster', async () => {
        fetchMock.mockResolvedValueOnce(
            jsonResponse({
                results: [
                    {
                        id: 'c1',
                        name: 'PausedCluster',
                        groupId: 'g1',
                        mongoDBVersion: '8.0.0',
                        paused: true,
                        stateName: 'IDLE',
                        clusterType: 'REPLICASET',
                        providerSettings: {
                            providerName: 'AWS',
                            regionName: 'US_EAST_1',
                            instanceSizeName: 'M10',
                        },
                        connectionStrings: { standardSrv: 'mongodb+srv://must-not-appear.example.invalid' },
                    },
                ],
                totalCount: 1,
            }),
        );

        const clusters = await new AtlasApiClient(session).listClusters('g1');

        expect(clusters[0].paused).toBe(true);
        const traced = (ext.outputChannel.trace as jest.Mock).mock.calls.map((call) => String(call[0])).join('\n');
        expect(traced).toContain(
            'cluster "PausedCluster": state=IDLE, paused=true, type=REPLICASET, provider=AWS, region=US_EAST_1, tier=M10, connectionString=available',
        );
        expect(traced).not.toContain('must-not-appear.example.invalid');
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

    it('uses a credential-neutral message for a 403 with no detail body', async () => {
        // The shared client serves both API Keys and Service Accounts, so a fallback that names an
        // "API key" would be wrong for one of them.
        fetchMock.mockResolvedValueOnce(jsonResponse({}, 403));

        const error = await new AtlasApiClient(session).listProjects().catch((e: unknown) => e);

        expect(error).toBeInstanceOf(AtlasApiError);
        expect((error as AtlasApiError).message).toBe('Access denied. Verify you have the required permissions.');
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

describe('AtlasApiClient API Key Digest authentication', () => {
    const apiKeySession = { type: 'apikey', publicKey: 'pub', privateKey: 'priv' } as const;

    function challengeResponse(): Response {
        return {
            ok: false,
            status: 401,
            headers: {
                get: (name: string): string | null =>
                    name.toLowerCase() === 'www-authenticate' ? 'Digest realm="atlas", nonce="abc", qop="auth"' : null,
            },
            json: () => Promise.resolve({}),
            text: () => Promise.resolve(''),
        } as unknown as Response;
    }

    beforeEach(() => {
        (computeDigestHeader as jest.Mock).mockClear();
    });

    it('signs the full request-target including the query string, not just the path', async () => {
        // RFC 7616 section 3.4.6: the Digest `uri` must match the request target that fetch() sends.
        // The paginated list URL always carries `?itemsPerPage=...&pageNum=...`, so the signed
        // request-target must include that query string.
        fetchMock.mockResolvedValueOnce(challengeResponse()).mockResolvedValueOnce(jsonResponse(page(1, 0, 1)));

        await new AtlasApiClient(apiKeySession).listProjects();

        const digestUri = (computeDigestHeader as jest.Mock).mock.calls[0][1] as string;
        expect(digestUri).toBe('/api/atlas/v2/groups?itemsPerPage=500&pageNum=1');
    });

    it('reuses the cached challenge pre-emptively on later requests with an incrementing nonce-count', async () => {
        // First call answers a challenge (2 fetches); the second call sends the Digest header
        // straight away using the cached challenge (1 fetch), and `nc` advances 1 -> 2.
        const client = new AtlasApiClient(apiKeySession);
        fetchMock
            .mockResolvedValueOnce(challengeResponse())
            .mockResolvedValueOnce(jsonResponse(page(1, 0, 1)))
            .mockResolvedValueOnce(jsonResponse(page(1, 0, 1)));

        await client.listProjects();
        await client.listProjects();

        expect(fetchMock).toHaveBeenCalledTimes(3);
        const nonceCounts = (computeDigestHeader as jest.Mock).mock.calls.map((call) => call[5] as number);
        expect(nonceCounts).toEqual([1, 2]);
    });

    it('re-challenges once and resets the nonce-count when the cached nonce is rejected', async () => {
        const client = new AtlasApiClient(apiKeySession);
        fetchMock
            // First call: establish the cached challenge.
            .mockResolvedValueOnce(challengeResponse())
            .mockResolvedValueOnce(jsonResponse(page(1, 0, 1)))
            // Second call: the pre-emptive request is rejected (stale nonce), triggering a re-challenge.
            .mockResolvedValueOnce(challengeResponse())
            .mockResolvedValueOnce(jsonResponse(page(1, 0, 1)));

        await client.listProjects();
        await client.listProjects();

        const nonceCounts = (computeDigestHeader as jest.Mock).mock.calls.map((call) => call[5] as number);
        // 1 = first challenge answered; 2 = pre-emptive attempt on the second call; 1 = counter reset
        // after the re-challenge adopts the fresh nonce.
        expect(nonceCounts).toEqual([1, 2, 1]);
    });
});
