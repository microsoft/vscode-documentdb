/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { type AtlasSessionRefresher } from '../auth/AtlasCredentialSessionRegistry';
import { type AtlasSession } from '../auth/AtlasSession';
import { ATLAS_API_BASE_URL } from '../config';
import {
    type AtlasCluster,
    type AtlasOrganization,
    type AtlasProject,
    type AtlasUserInfo,
} from '../models/AtlasProjectModel';
import { computeDigestHeader, parseDigestChallenge } from './AtlasDigestAuth';

/** Atlas API response envelope for paginated results */
interface AtlasPaginatedResponse<T> {
    results: T[];
    totalCount: number;
    links?: { rel: string; href: string }[];
}

/**
 * Page size requested from the Atlas Admin API. Atlas caps `itemsPerPage` at 500; asking for the
 * maximum keeps the common single-page case to exactly one request.
 */
const ATLAS_PAGE_SIZE = 500;

/**
 * Defensive ceiling on the number of pages fetched for one list call. At 500 items per page this
 * covers 50,000 resources, far beyond any realistic Atlas organization, and guarantees that a
 * malformed `totalCount` can never spin an unbounded request loop.
 */
const ATLAS_MAX_PAGES = 100;

/**
 * Client for the MongoDB Atlas Admin API v2.
 * Supports Service Account (Bearer token) and API Key (HTTP Digest) authentication.
 */
export class AtlasApiClient {
    private digestNonceCount = 0;
    private session: AtlasSession;

    /**
     * @param session The active Atlas session used to authenticate requests.
     * @param sessionManager Optional session refresher. When provided, token-based sessions
     * (Service Account) are transparently refreshed and the request retried once if
     * the access token is rejected (401/403). The user is only signed out - and therefore
     * prompted to sign in again - when the credentials themselves are completely rejected.
     */
    constructor(
        session: AtlasSession,
        private readonly sessionManager?: AtlasSessionRefresher,
    ) {
        this.session = session;
    }

    /**
     * Lists all projects (groups) accessible by the authenticated user.
     */
    async listProjects(signal?: AbortSignal): Promise<AtlasProject[]> {
        return this.requestAllPages<AtlasProject>('/groups', signal);
    }

    /**
     * Lists all clusters in a given project.
     */
    async listClusters(projectId: string, signal?: AbortSignal): Promise<AtlasCluster[]> {
        return this.requestAllPages<AtlasCluster>(`/groups/${encodeURIComponent(projectId)}/clusters`, signal);
    }

    /**
     * Gets details for a specific cluster.
     */
    async getCluster(projectId: string, clusterName: string, signal?: AbortSignal): Promise<AtlasCluster> {
        return this.request<AtlasCluster>(
            `/groups/${encodeURIComponent(projectId)}/clusters/${encodeURIComponent(clusterName)}`,
            signal,
        );
    }

    /**
     * Lists all organizations accessible by the authenticated user.
     */
    async listOrganizations(signal?: AbortSignal): Promise<AtlasOrganization[]> {
        return this.requestAllPages<AtlasOrganization>('/orgs', signal);
    }

    /**
     * Gets the currently authenticated user's info.
     */
    async getCurrentUser(signal?: AbortSignal): Promise<AtlasUserInfo> {
        return this.request<AtlasUserInfo>('/users/me', signal);
    }

    /**
     * Walks every page of a paginated Atlas list endpoint and returns the concatenated results.
     *
     * Atlas paginates with `pageNum` (1-based) + `itemsPerPage` and reports `totalCount`. The loop
     * stops as soon as a short page arrives, the reported total is reached, or the defensive page
     * ceiling is hit, so a missing or wrong `totalCount` cannot cause an unbounded fetch.
     */
    private async requestAllPages<T>(path: string, signal?: AbortSignal): Promise<T[]> {
        const separator = path.includes('?') ? '&' : '?';
        const collected: T[] = [];

        for (let pageNum = 1; pageNum <= ATLAS_MAX_PAGES; pageNum++) {
            const pagePath = `${path}${separator}itemsPerPage=${String(ATLAS_PAGE_SIZE)}&pageNum=${String(pageNum)}`;
            const response = await this.request<AtlasPaginatedResponse<T>>(pagePath, signal);
            const results = Array.isArray(response.results) ? response.results : [];
            collected.push(...results);

            if (results.length < ATLAS_PAGE_SIZE) {
                break;
            }

            const totalCount = response.totalCount;
            if (typeof totalCount === 'number' && Number.isFinite(totalCount) && collected.length >= totalCount) {
                break;
            }
        }

        return collected;
    }

    /**
     * Makes an authenticated request to the Atlas Admin API.
     *
     * For token-based sessions (Service Account) backed by a session manager, a single
     * silent token refresh is attempted when the access token is rejected (401/403), and the
     * request is retried with the freshly minted token. If the credentials are completely
     * rejected, {@link AtlasSessionManager} signs out and the original error propagates so the
     * caller can prompt the user to sign in again.
     */
    private async request<T>(path: string, signal?: AbortSignal): Promise<T> {
        try {
            return await this.requestOnce<T>(path, signal);
        } catch (error) {
            const isAuthFailure =
                error instanceof AtlasApiError && (error.statusCode === 401 || error.statusCode === 403);
            const canRefresh = this.sessionManager !== undefined && this.session.type === 'serviceaccount';

            if (isAuthFailure && canRefresh) {
                const refreshedSession = await this.sessionManager!.tryRefreshIfPossible();
                if (refreshedSession) {
                    this.session = refreshedSession;
                    return await this.requestOnce<T>(path, signal);
                }
            }

            throw error;
        }
    }

    /**
     * Performs a single authenticated request to the Atlas Admin API.
     * Handles Service Account Bearer and API Key Digest authentication transparently.
     */
    private async requestOnce<T>(path: string, signal?: AbortSignal): Promise<T> {
        const url = `${ATLAS_API_BASE_URL}${path}`;
        const headers: Record<string, string> = {
            Accept: 'application/vnd.atlas.2023-02-01+json',
        };

        if (this.session.type === 'serviceaccount') {
            headers['Authorization'] = `Bearer ${this.session.accessToken}`;

            const response = await fetch(url, { method: 'GET', headers, signal });

            if (!response.ok) {
                await this.handleErrorResponse(response);
            }

            return (await response.json()) as T;
        }

        // API Key: HTTP Digest Authentication
        // First request without auth to get the challenge
        const initialResponse = await fetch(url, { method: 'GET', headers, signal });

        if (initialResponse.status === 401) {
            const wwwAuth = initialResponse.headers.get('www-authenticate');
            if (!wwwAuth || !wwwAuth.toLowerCase().startsWith('digest')) {
                throw new Error(vscode.l10n.t('Atlas API did not return a valid Digest challenge'));
            }

            const challenge = parseDigestChallenge(wwwAuth);
            this.digestNonceCount++;

            const uri = new URL(url).pathname;
            const authHeader = computeDigestHeader(
                'GET',
                uri,
                this.session.publicKey,
                this.session.privateKey,
                challenge,
                this.digestNonceCount,
            );

            headers['Authorization'] = authHeader;

            const authedResponse = await fetch(url, { method: 'GET', headers, signal });

            if (!authedResponse.ok) {
                await this.handleErrorResponse(authedResponse);
            }

            return (await authedResponse.json()) as T;
        }

        if (!initialResponse.ok) {
            await this.handleErrorResponse(initialResponse);
        }

        return (await initialResponse.json()) as T;
    }

    /**
     * Handles API error responses with user-friendly messages.
     */
    private async handleErrorResponse(response: Response): Promise<never> {
        let detail: string;

        try {
            const errorBody = (await response.json()) as { detail?: string; error?: string; reason?: string };
            detail = errorBody.detail ?? errorBody.error ?? errorBody.reason ?? '';
        } catch {
            detail = await response.text();
        }

        switch (response.status) {
            case 401:
                throw new AtlasApiError(
                    detail
                        ? vscode.l10n.t('Authentication failed: {0}', detail)
                        : vscode.l10n.t('Authentication failed. Please sign in again.'),
                    response.status,
                    detail,
                );
            case 403:
                throw new AtlasApiError(
                    detail
                        ? vscode.l10n.t('Access denied: {0}', detail)
                        : vscode.l10n.t('Access denied. Verify your API key has the required permissions.'),
                    response.status,
                    detail,
                );
            case 404:
                throw new AtlasApiError(vscode.l10n.t('Resource not found.'), response.status);
            case 429:
                throw new AtlasApiError(
                    vscode.l10n.t('Rate limited by Atlas API. Please try again shortly.'),
                    response.status,
                );
            default:
                throw new AtlasApiError(
                    vscode.l10n.t('Atlas API error ({0}): {1}', String(response.status), detail),
                    response.status,
                    detail,
                );
        }
    }
}

/**
 * Custom error class for Atlas API errors.
 */
export class AtlasApiError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number,
        public readonly detail?: string,
    ) {
        super(message);
        this.name = 'AtlasApiError';
    }
}
