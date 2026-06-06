/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { type AtlasSession } from '../auth/AtlasSession';
import { ATLAS_API_BASE_URL } from '../config';
import { type AtlasCluster, type AtlasOrganization, type AtlasProject, type AtlasUserInfo } from '../models/AtlasProjectModel';
import { computeDigestHeader, parseDigestChallenge } from './AtlasDigestAuth';

/** Atlas API response envelope for paginated results */
interface AtlasPaginatedResponse<T> {
    results: T[];
    totalCount: number;
    links?: { rel: string; href: string }[];
}

/**
 * Client for the MongoDB Atlas Admin API v2.
 * Supports both OAuth Bearer tokens and API Key (HTTP Digest) authentication.
 */
export class AtlasApiClient {
    private digestNonceCount = 0;

    constructor(private readonly session: AtlasSession) {}

    /**
     * Lists all projects (groups) accessible by the authenticated user.
     */
    async listProjects(signal?: AbortSignal): Promise<AtlasProject[]> {
        const response = await this.request<AtlasPaginatedResponse<AtlasProject>>('/groups', signal);
        return response.results;
    }

    /**
     * Lists all clusters in a given project.
     */
    async listClusters(projectId: string, signal?: AbortSignal): Promise<AtlasCluster[]> {
        const response = await this.request<AtlasPaginatedResponse<AtlasCluster>>(
            `/groups/${encodeURIComponent(projectId)}/clusters`,
            signal,
        );
        return response.results;
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
        const response = await this.request<AtlasPaginatedResponse<AtlasOrganization>>('/orgs', signal);
        return response.results;
    }

    /**
     * Gets the currently authenticated user's info.
     */
    async getCurrentUser(signal?: AbortSignal): Promise<AtlasUserInfo> {
        return this.request<AtlasUserInfo>('/users/me', signal);
    }

    /**
     * Makes an authenticated request to the Atlas Admin API.
     * Handles OAuth Bearer and API Key Digest authentication transparently.
     */
    private async request<T>(path: string, signal?: AbortSignal): Promise<T> {
        const url = `${ATLAS_API_BASE_URL}${path}`;
        const headers: Record<string, string> = {
            Accept: 'application/vnd.atlas.2023-02-01+json',
        };

        if (this.session.type === 'oauth') {
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
                throw new AtlasApiError(vscode.l10n.t('Authentication failed. Please sign in again.'), response.status);
            case 403:
                throw new AtlasApiError(
                    vscode.l10n.t('Access denied. Verify your API key has the required permissions.'),
                    response.status,
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
    ) {
        super(message);
        this.name = 'AtlasApiError';
    }
}
