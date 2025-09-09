/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AtlasApiClient } from '../client/AtlasApiClient';
import {
    type OAuthCredentials,
    type DigestCredentials,
    type AtlasApiResponse,
    type AtlasProject,
    type AtlasCluster,
    AtlasApiError,
    AtlasRateLimitError,
    AtlasAuthenticationError,
} from '../client/types';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock AbortSignal.timeout
Object.defineProperty(AbortSignal, 'timeout', {
    value: jest.fn(() => new AbortController().signal),
    writable: true,
});

describe('AtlasApiClient', () => {
    const oauthCredentials: OAuthCredentials = {
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        scopes: ['openid'],
    };

    const digestCredentials: DigestCredentials = {
        publicKey: 'test-public-key',
        privateKey: 'test-private-key',
    };

    beforeEach(() => {
        jest.clearAllMocks();
        // Reset any timers
        jest.useRealTimers();
    });

    describe('OAuth Authentication', () => {
        test('should authenticate with OAuth and make successful API calls', async () => {
            const client = new AtlasApiClient(oauthCredentials);

            // Mock OAuth token response
            mockFetch
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({
                        access_token: 'mock-access-token',
                        token_type: 'Bearer',
                        expires_in: 3600,
                    }),
                })
                // Mock API response
                .mockResolvedValueOnce({
                    ok: true,
                    headers: new Map([['content-type', 'application/json']]),
                    json: async () => ({
                        results: [
                            {
                                id: 'project-1',
                                name: 'Test Project',
                                orgId: 'org-1',
                                created: '2023-01-01T00:00:00Z',
                                clusterCount: 2,
                            },
                        ],
                        totalCount: 1,
                    }),
                });

            const result = await client.listProjects();

            expect(mockFetch).toHaveBeenCalledTimes(2);
            
            // Check OAuth token request
            expect(mockFetch).toHaveBeenCalledWith(
                'https://cloud.mongodb.com/api/oauth/token',
                expect.objectContaining({
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Accept': 'application/json',
                    },
                }),
            );

            // Check API request with Bearer token
            expect(mockFetch).toHaveBeenCalledWith(
                'https://cloud.mongodb.com/api/atlas/v2/groups',
                expect.objectContaining({
                    method: 'GET',
                    headers: expect.objectContaining({
                        'Authorization': 'Bearer mock-access-token',
                    }),
                }),
            );

            expect(result.results).toHaveLength(1);
            expect(result.results[0].name).toBe('Test Project');
        });

        test('should handle OAuth authentication failures', async () => {
            const client = new AtlasApiClient(oauthCredentials);

            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 401,
                statusText: 'Unauthorized',
                json: async () => ({ error: 'invalid_client' }),
            });

            await expect(client.listProjects()).rejects.toThrow(AtlasAuthenticationError);
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });
    });

    describe('Digest Authentication', () => {
        test('should handle digest auth challenge flow', async () => {
            const client = new AtlasApiClient(digestCredentials);

            // Mock initial 401 response with digest challenge
            mockFetch
                .mockResolvedValueOnce({
                    ok: false,
                    status: 401,
                    headers: new Map([
                        ['WWW-Authenticate', 'Digest realm="atlas", nonce="abc123", qop="auth"'],
                    ]),
                })
                // Mock successful response after digest auth
                .mockResolvedValueOnce({
                    ok: true,
                    headers: new Map([['content-type', 'application/json']]),
                    json: async () => ({
                        results: [],
                        totalCount: 0,
                    }),
                });

            const result = await client.listProjects();

            expect(mockFetch).toHaveBeenCalledTimes(2);
            expect(result.results).toEqual([]);
        });
    });

    describe('Error Handling and Retries', () => {
        test('should handle rate limiting with retry', async () => {
            jest.useFakeTimers();
            const client = new AtlasApiClient(oauthCredentials, { maxRetries: 2, retryDelayMs: 1000 });

            // Mock OAuth token response
            mockFetch
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({
                        access_token: 'mock-access-token',
                        token_type: 'Bearer',
                        expires_in: 3600,
                    }),
                })
                // Mock rate limit response
                .mockResolvedValueOnce({
                    ok: false,
                    status: 429,
                    headers: new Map([['Retry-After', '2']]),
                })
                // Mock successful retry
                .mockResolvedValueOnce({
                    ok: true,
                    headers: new Map([['content-type', 'application/json']]),
                    json: async () => ({
                        results: [],
                        totalCount: 0,
                    }),
                });

            const resultPromise = client.listProjects();
            
            // Fast-forward timers to trigger retry
            await jest.advanceTimersByTimeAsync(2000);

            const result = await resultPromise;

            expect(mockFetch).toHaveBeenCalledTimes(3);
            expect(result.results).toEqual([]);
            
            jest.useRealTimers();
        }, 10000); // Increase timeout

        test('should throw AtlasRateLimitError when max retries exceeded', async () => {
            const client = new AtlasApiClient(oauthCredentials, { maxRetries: 1 });

            // Mock OAuth token response first
            mockFetch
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({
                        access_token: 'mock-access-token',
                        token_type: 'Bearer',
                        expires_in: 3600,
                    }),
                })
                // Mock rate limit responses for the API calls
                .mockResolvedValue({
                    ok: false,
                    status: 429,
                    headers: new Map([['Retry-After', '1']]),
                });

            await expect(client.listProjects()).rejects.toThrow(AtlasRateLimitError);
        });

        test('should handle API errors properly', async () => {
            const client = new AtlasApiClient(oauthCredentials);

            // Mock OAuth token response
            mockFetch
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({
                        access_token: 'mock-access-token',
                        token_type: 'Bearer',
                        expires_in: 3600,
                    }),
                })
                // Mock API error
                .mockResolvedValueOnce({
                    ok: false,
                    status: 404,
                    statusText: 'Not Found',
                    headers: new Map([['content-type', 'application/json']]),
                    json: async () => ({ error: 'Project not found' }),
                });

            await expect(client.listProjects()).rejects.toThrow(AtlasApiError);
        });
    });

    describe('API Operations', () => {
        beforeEach(() => {
            // Mock OAuth token response for all API tests
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    access_token: 'mock-access-token',
                    token_type: 'Bearer',
                    expires_in: 3600,
                }),
            });
        });

        test('should list clusters for a project', async () => {
            const client = new AtlasApiClient(oauthCredentials);
            const projectId = 'test-project-id';

            const mockClusters: AtlasApiResponse<AtlasCluster> = {
                results: [
                    {
                        name: 'test-cluster',
                        clusterType: 'REPLICASET',
                        mongoDBVersion: '7.0',
                        connectionStrings: {
                            standard: 'mongodb://test-cluster.mongodb.net:27017',
                        },
                        providerSettings: {
                            providerName: 'AWS',
                            instanceSizeName: 'M10',
                            regionName: 'US_EAST_1',
                        },
                        stateName: 'IDLE',
                    },
                ],
                totalCount: 1,
            };

            mockFetch.mockResolvedValueOnce({
                ok: true,
                headers: new Map([['content-type', 'application/json']]),
                json: async () => mockClusters,
            });

            const result = await client.listClusters(projectId);

            expect(mockFetch).toHaveBeenLastCalledWith(
                `https://cloud.mongodb.com/api/atlas/v2/groups/${projectId}/clusters`,
                expect.objectContaining({ method: 'GET' }),
            );

            expect(result.results).toHaveLength(1);
            expect(result.results[0].name).toBe('test-cluster');
        });

        test('should get cluster details with connection strings', async () => {
            const client = new AtlasApiClient(oauthCredentials);
            const projectId = 'test-project-id';
            const clusterName = 'test-cluster';

            const mockCluster: AtlasCluster = {
                name: 'test-cluster',
                clusterType: 'REPLICASET',
                mongoDBVersion: '7.0',
                connectionStrings: {
                    standard: 'mongodb://test-cluster.mongodb.net:27017',
                    standardSrv: 'mongodb+srv://test-cluster.mongodb.net',
                },
                providerSettings: {
                    providerName: 'AWS',
                    instanceSizeName: 'M10',
                    regionName: 'US_EAST_1',
                },
                stateName: 'IDLE',
            };

            mockFetch.mockResolvedValueOnce({
                ok: true,
                headers: new Map([['content-type', 'application/json']]),
                json: async () => mockCluster,
            });

            const result = await client.getCluster(projectId, clusterName);

            expect(mockFetch).toHaveBeenLastCalledWith(
                `https://cloud.mongodb.com/api/atlas/v2/groups/${projectId}/clusters/${clusterName}`,
                expect.objectContaining({ method: 'GET' }),
            );

            expect(result.name).toBe('test-cluster');
            expect(result.connectionStrings?.standardSrv).toBe('mongodb+srv://test-cluster.mongodb.net');
        });

        test('should handle IP access list operations', async () => {
            const client = new AtlasApiClient(oauthCredentials);
            const projectId = 'test-project-id';

            // Test adding access list entry
            const newEntry = {
                ipAddress: '192.168.1.1',
                comment: 'Test IP',
            };

            mockFetch.mockResolvedValueOnce({
                ok: true,
                headers: new Map([['content-type', 'application/json']]),
                json: async () => ({
                    results: [{ ...newEntry }],
                    totalCount: 1,
                }),
            });

            const addResult = await client.addAccessListEntry(projectId, newEntry);

            expect(mockFetch).toHaveBeenLastCalledWith(
                `https://cloud.mongodb.com/api/atlas/v2/groups/${projectId}/accessList`,
                expect.objectContaining({
                    method: 'POST',
                    body: JSON.stringify([newEntry]),
                }),
            );

            expect(addResult.results).toHaveLength(1);
        });
    });

    describe('Pagination', () => {
        beforeEach(() => {
            // Mock OAuth token response for pagination tests
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    access_token: 'mock-access-token',
                    token_type: 'Bearer',
                    expires_in: 3600,
                }),
            });
        });

        test('should handle paginated responses', async () => {
            const client = new AtlasApiClient(oauthCredentials);

            // Mock first page
            mockFetch
                .mockResolvedValueOnce({
                    ok: true,
                    headers: new Map([['content-type', 'application/json']]),
                    json: async () => ({
                        results: [{ id: 'project-1', name: 'Project 1' }],
                        links: [
                            { rel: 'next', href: 'https://cloud.mongodb.com/api/atlas/v2/groups?pageNum=2' },
                        ],
                        totalCount: 2,
                    }),
                })
                // Mock second page
                .mockResolvedValueOnce({
                    ok: true,
                    headers: new Map([['content-type', 'application/json']]),
                    json: async () => ({
                        results: [{ id: 'project-2', name: 'Project 2' }],
                        links: [],
                        totalCount: 2,
                    }),
                });

            const results = await client.requestWithPagination<AtlasProject>(
                { method: 'GET', url: '/groups' },
                1, // Small page size to test pagination
            );

            expect(mockFetch).toHaveBeenCalledTimes(3); // OAuth + 2 pages
            expect(results).toHaveLength(2);
            expect(results[0].name).toBe('Project 1');
            expect(results[1].name).toBe('Project 2');
        });
    });
});