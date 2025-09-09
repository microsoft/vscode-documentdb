/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type HttpError, type RetryConfig } from '../auth/types';

/**
 * Default retry configuration for HTTP requests.
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
    maxAttempts: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    jitterFactor: 0.1,
};

/**
 * HTTP utility functions for making requests with retry and backoff logic.
 */
export class HttpUtils {
    /**
     * Makes an HTTP request with automatic retry on transient failures.
     * 
     * @param url Request URL
     * @param options Fetch options
     * @param retryConfig Retry configuration
     * @returns Promise resolving to the response
     */
    static async fetchWithRetry(
        url: string,
        options: RequestInit = {},
        retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG,
    ): Promise<Response> {
        let lastError: HttpError | undefined;

        for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
            try {
                const response = await fetch(url, options);
                
                // Check if response indicates a retryable error
                if (HttpUtils.isRetryableStatus(response.status)) {
                    const error = await HttpUtils.createHttpError(response);
                    lastError = error;
                    
                    // Handle rate limiting with Retry-After header
                    if (response.status === 429) {
                        const retryAfter = HttpUtils.parseRetryAfter(response.headers.get('Retry-After'));
                        if (retryAfter) {
                            error.retryAfter = retryAfter;
                        }
                    }

                    if (attempt < retryConfig.maxAttempts) {
                        const delay = HttpUtils.calculateDelay(attempt, retryConfig, error.retryAfter);
                        await HttpUtils.sleep(delay);
                        continue;
                    }
                }

                return response;
            } catch (networkError) {
                lastError = {
                    name: 'NetworkError',
                    message: `Network request failed: ${(networkError as Error).message}`,
                    status: 0,
                    retryable: true,
                } as HttpError;

                if (attempt < retryConfig.maxAttempts) {
                    const delay = HttpUtils.calculateDelay(attempt, retryConfig);
                    await HttpUtils.sleep(delay);
                    continue;
                }
            }
        }

        throw lastError || new Error('Request failed after all retry attempts');
    }

    /**
     * Checks if an HTTP status code indicates a retryable error.
     * 
     * @param status HTTP status code
     * @returns True if the status is retryable
     */
    private static isRetryableStatus(status: number): boolean {
        // Retry on server errors (5xx) and rate limiting (429)
        return status >= 500 || status === 429;
    }

    /**
     * Creates an HttpError from a Response object.
     * 
     * @param response The HTTP response
     * @returns Promise resolving to an HttpError
     */
    private static async createHttpError(response: Response): Promise<HttpError> {
        let body: string;
        try {
            body = await response.text();
        } catch {
            body = 'Unable to read response body';
        }

        const headers: Record<string, string> = {};
        response.headers.forEach((value, key) => {
            headers[key] = value;
        });

        return {
            name: 'HttpError',
            message: `HTTP ${response.status}: ${response.statusText}`,
            status: response.status,
            headers,
            body,
            retryable: HttpUtils.isRetryableStatus(response.status),
        } as HttpError;
    }

    /**
     * Calculates the delay for the next retry attempt with exponential backoff and jitter.
     * 
     * @param attempt Current attempt number (1-indexed)
     * @param config Retry configuration
     * @param retryAfter Optional Retry-After value in seconds
     * @returns Delay in milliseconds
     */
    private static calculateDelay(attempt: number, config: RetryConfig, retryAfter?: number): number {
        // Use Retry-After header if provided
        if (retryAfter) {
            return Math.min(retryAfter * 1000, config.maxDelayMs);
        }

        // Exponential backoff: base * (2 ^ (attempt - 1))
        const exponentialDelay = config.baseDelayMs * Math.pow(2, attempt - 1);
        
        // Add jitter to prevent thundering herd
        const jitter = exponentialDelay * config.jitterFactor * Math.random();
        const delayWithJitter = exponentialDelay + jitter;
        
        // Cap at maximum delay
        return Math.min(delayWithJitter, config.maxDelayMs);
    }

    /**
     * Parses the Retry-After header value.
     * 
     * @param retryAfterHeader The Retry-After header value
     * @returns Retry delay in seconds, or undefined if not parseable
     */
    private static parseRetryAfter(retryAfterHeader: string | null): number | undefined {
        if (!retryAfterHeader) {
            return undefined;
        }

        // Try to parse as seconds (integer)
        const seconds = parseInt(retryAfterHeader, 10);
        if (!isNaN(seconds) && seconds > 0) {
            return seconds;
        }

        // Try to parse as HTTP date
        const date = new Date(retryAfterHeader);
        if (!isNaN(date.getTime())) {
            const secondsUntil = Math.max(0, Math.floor((date.getTime() - Date.now()) / 1000));
            return secondsUntil;
        }

        return undefined;
    }

    /**
     * Sleeps for the specified number of milliseconds.
     * 
     * @param ms Milliseconds to sleep
     * @returns Promise that resolves after the delay
     */
    private static sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Creates a user-friendly error message from an HTTP error.
     * 
     * @param error The HTTP error
     * @returns User-friendly error message
     */
    static createUserFriendlyErrorMessage(error: HttpError): string {
        switch (error.status) {
            case 401:
                return 'Authentication failed. Please check your credentials.';
            case 403:
                return 'Access denied. Please verify your permissions.';
            case 404:
                return 'Resource not found. Please check the URL or resource identifier.';
            case 429:
                return 'Too many requests. Please wait before trying again.';
            case 500:
            case 502:
            case 503:
            case 504:
                return 'Server error. Please try again later.';
            default:
                return `Request failed with status ${error.status}: ${error.message}`;
        }
    }
}