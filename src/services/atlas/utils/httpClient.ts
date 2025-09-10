/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { type AtlasAuthConfig, DEFAULT_ATLAS_AUTH_CONFIG } from '../types/AtlasAuthConfig';
import { type AtlasAuthHeader } from '../types/AtlasAuthResult';

/**
 * HTTP client utilities for making authenticated requests to MongoDB Atlas API
 */
export class AtlasHttpClient {
    private readonly config: Required<AtlasAuthConfig>;

    constructor(config: AtlasAuthConfig = {}) {
        this.config = { ...DEFAULT_ATLAS_AUTH_CONFIG, ...config };
    }

    /**
     * Makes an authenticated HTTP request using the provided auth header
     * @param url The URL to request
     * @param options Fetch options
     * @param authHeader Authentication header to include
     * @returns Response from the Atlas API
     */
    async makeAuthenticatedRequest(
        url: string,
        options: RequestInit = {},
        authHeader: AtlasAuthHeader
    ): Promise<Response> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

        try {
            const response = await fetch(url, {
                ...options,
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    ...authHeader,
                    ...options.headers,
                },
                signal: controller.signal,
            });

            return response;
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                throw new Error(l10n.t('Request timed out after {0}ms', this.config.timeoutMs));
            }
            throw error;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    /**
     * Makes an authenticated HTTP request using a custom fetch function (for Digest auth)
     * @param url The URL to request
     * @param options Fetch options
     * @param authenticatedFetch Custom fetch function with authentication
     * @returns Response from the Atlas API
     */
    async makeAuthenticatedRequestWithFetch(
        url: string,
        options: RequestInit = {},
        authenticatedFetch: typeof fetch
    ): Promise<Response> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

        try {
            const response = await authenticatedFetch(url, {
                ...options,
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    ...options.headers,
                },
                signal: controller.signal,
            });

            return response;
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                throw new Error(l10n.t('Request timed out after {0}ms', this.config.timeoutMs));
            }
            throw error;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    /**
     * Builds a full Atlas API URL from a relative path
     * @param path The API path (e.g., '/groups')
     * @returns Full Atlas API URL
     */
    buildApiUrl(path: string): string {
        const trimmedPath = path.startsWith('/') ? path.slice(1) : path;
        return `${this.config.apiBaseUrl}/${trimmedPath}`;
    }

    /**
     * Handles common Atlas API response patterns and errors
     * @param response The response from Atlas API
     * @returns Parsed JSON response
     */
    async handleApiResponse<T = unknown>(response: Response): Promise<T> {
        if (!response.ok) {
            await this.handleApiError(response);
        }

        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            return (await response.json()) as T;
        }

        throw new Error(
            l10n.t('Unexpected response content type: {0}', contentType || 'unknown')
        );
    }

    /**
     * Handles Atlas API error responses
     */
    private async handleApiError(response: Response): Promise<never> {
        let errorMessage: string;

        try {
            const errorData = (await response.json()) as unknown;
            if (typeof errorData === 'object' && errorData !== null) {
                const errorObj = errorData as Record<string, unknown>;
                if (typeof errorObj.error === 'string') {
                    errorMessage = errorObj.error;
                } else if (typeof errorObj.message === 'string') {
                    errorMessage = errorObj.message;
                } else {
                    errorMessage = l10n.t('Unknown API error');
                }
            } else {
                errorMessage = l10n.t('Unknown API error');
            }
        } catch {
            // If we can't parse the error response, use status text
            errorMessage = response.statusText || l10n.t('Unknown API error');
        }

        switch (response.status) {
            case 401:
                throw new Error(l10n.t('Authentication failed: {0}', errorMessage));
            case 403:
                throw new Error(l10n.t('Access forbidden: {0}', errorMessage));
            case 404:
                throw new Error(l10n.t('Resource not found: {0}', errorMessage));
            case 429:
                throw new Error(l10n.t('Rate limit exceeded: {0}', errorMessage));
            case 500:
                throw new Error(l10n.t('Atlas API server error: {0}', errorMessage));
            default:
                throw new Error(
                    l10n.t('Atlas API error ({0}): {1}', response.status, errorMessage)
                );
        }
    }
}