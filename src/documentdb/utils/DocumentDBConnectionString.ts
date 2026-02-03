/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import ConnectionString, { type ConnectionStringParsingOptions } from 'mongodb-connection-string-url';

/**
 * Extends the ConnectionString class to properly handle password encoding/decoding
 * and special characters in query parameters.
 *
 * The base ConnectionString class has two main issues:
 * 1. Improper handling of special characters in passwords
 * 2. Incorrect parsing when '@' characters appear in query parameters (e.g., appName=@user@)
 *    because the regex-based parser looks for '@' to separate credentials from the host
 */
export class DocumentDBConnectionString extends ConnectionString {
    /**
     * Constructor that pre-processes the connection string to handle special characters
     * in query parameters before passing to the base class.
     *
     * @param uri - The MongoDB connection string
     * @param options - Optional parsing options
     *
     * @example
     * // This would fail in the base class due to '@' in appName parameter:
     * // mongodb://host:10255/?appName=@user@
     * const connStr = new DocumentDBConnectionString(
     *   'mongodb://myaccount.a-host.local:10255/?ssl=true&appName=@myaccount@'
     * );
     */
    constructor(uri: string, options?: ConnectionStringParsingOptions) {
        const sanitizedUri = DocumentDBConnectionString.sanitizeConnectionString(uri);
        super(sanitizedUri, options);
    }

    /**
     * Pre-processes a connection string to encode special characters in query parameters
     * that would otherwise confuse the base ConnectionString parser.
     *
     * The base parser uses regex to find '@' characters to separate credentials from the host.
     * However, '@' characters in query parameters (e.g., appName=@tnaumowicz-ru400@) cause
     * incorrect parsing, making the parser think there are credentials when there aren't.
     *
     * This method:
     * 1. Separates the connection string into protocol, authority, and query sections
     * 2. Uses URLSearchParams to parse the query string (handles edge cases better)
     * 3. Re-encodes all parameter values (not keys) using encodeURIComponent
     * 4. Reconstructs the connection string with properly encoded values
     *
     * @param uri - The original connection string
     * @returns A sanitized connection string safe for the base parser
     */
    private static sanitizeConnectionString(uri: string): string {
        // Find the query string section (everything after the first '?')
        const queryStartIndex = uri.indexOf('?');

        // If there's no query string, return as-is
        if (queryStartIndex === -1) {
            return uri;
        }

        // Split into base URL and query string
        const baseUrl = uri.substring(0, queryStartIndex);
        const queryString = uri.substring(queryStartIndex + 1);

        // Use URLSearchParams to parse the query string
        // This handles edge cases like empty values, multiple values, etc.
        const searchParams = new URLSearchParams(queryString);
        const encodedParams: string[] = [];

        // Get all unique keys (without duplicates)
        const uniqueKeys = [...new Set([...searchParams.keys()])];

        // Process each key, preserving all values for duplicate keys
        for (const key of uniqueKeys) {
            // Get all values for this key (supports duplicate parameters)
            const values = searchParams.getAll(key);

            // Encode each value and add to the result
            for (const value of values) {
                const encodedValue = encodeURIComponent(value);
                encodedParams.push(`${key}=${encodedValue}`);
            }
        }

        return `${baseUrl}?${encodedParams.join('&')}`;
    }

    /**
     * Override the password setter to properly encode the password before setting it.
     * This prevents encoding issues in the underlying ConnectionString implementation.
     * Review: https://github.com/jsdom/whatwg-url/issues/301 to review whether this is still needed.
     */
    public set password(value: string) {
        const properlyEncodedPassword = encodeURIComponent(value);
        super.password = properlyEncodedPassword;
    }

    /**
     * Override the password getter to properly decode the password when retrieving it.
     * This ensures that code accessing the password property gets the original unencoded value.
     */
    public get password(): string {
        const encodedPassword = super.password;
        try {
            return encodedPassword ? decodeURIComponent(encodedPassword) : '';
        } catch (err) {
            console.warn('Failed to decode connection string password', err);
            return encodedPassword;
        }
    }

    /**
     * Override the username getter to properly decode the username when retrieving it.
     * This ensures consistency with password handling.
     */
    public get username(): string {
        const encodedUsername = super.username;
        try {
            return encodedUsername ? decodeURIComponent(encodedUsername) : '';
        } catch (err) {
            console.warn('Failed to decode connection string username', err);
            return encodedUsername;
        }
    }

    /**
     * Override the username setter to properly encode the username before setting it.
     * This ensures consistency with password handling.
     */
    public set username(value: string) {
        const properlyEncodedUsername = encodeURIComponent(value);
        super.username = properlyEncodedUsername;
    }

    /**
     * Validates that a password can be properly encoded and decoded.
     * Returns true if the password will be handled correctly, false otherwise.
     */
    public static validatePassword(password: string): boolean {
        try {
            const encoded = encodeURIComponent(password);
            const decoded = decodeURIComponent(encoded);
            return decoded === password;
        } catch {
            return false;
        }
    }

    /**
     * Validates that a username can be properly encoded and decoded.
     * Returns true if the username will be handled correctly, false otherwise.
     */
    public static validateUsername(username: string): boolean {
        try {
            const encoded = encodeURIComponent(username);
            const decoded = decodeURIComponent(encoded);
            return decoded === username;
        } catch {
            return false;
        }
    }

    /**
     * Parameters that can legitimately appear multiple times in a MongoDB connection string.
     * According to the MongoDB Connection String Specification, only these parameters
     * are designed to accept multiple values as an ordered list.
     *
     * See connection-string-parameters.md for detailed documentation and sources.
     */
    private static readonly MULTI_VALUE_PARAMETERS = new Set(['readpreferencetags']);

    /**
     * Removes duplicate query parameters from the connection string according to MongoDB specifications.
     *
     * Behavior:
     * - For parameters in MULTI_VALUE_PARAMETERS (e.g., readPreferenceTags): Preserves all unique values in order
     * - For all other parameters: Removes exact duplicate key=value pairs, keeps only the last value per key
     *   (following "last value wins" behavior per MongoDB spec)
     *
     * This is useful for cleaning up connection strings that may have been corrupted by bugs in previous versions.
     *
     * @returns A new connection string with deduplicated parameters
     *
     * @example
     * // Input:  mongodb://host/?ssl=true&ssl=true&appName=app
     * // Output: mongodb://host/?ssl=true&appName=app
     *
     * @example
     * // readPreferenceTags preserves multiple unique values:
     * // Input:  mongodb://host/?readPreferenceTags=dc:ny&readPreferenceTags=dc:ny&readPreferenceTags=
     * // Output: mongodb://host/?readPreferenceTags=dc:ny&readPreferenceTags=
     */
    public deduplicateQueryParameters(): string {
        // Get all unique keys
        const uniqueKeys = [...new Set([...this.searchParams.keys()])];

        // For each key, get unique values (preserving order of first occurrence)
        const deduplicatedParams: string[] = [];
        for (const key of uniqueKeys) {
            const allValues = this.searchParams.getAll(key);
            const normalizedKey = key.toLowerCase();

            // Check if this parameter can have multiple values
            if (DocumentDBConnectionString.MULTI_VALUE_PARAMETERS.has(normalizedKey)) {
                // For multi-value parameters, keep all unique values in order
                const uniqueValues = [...new Set(allValues)];
                for (const value of uniqueValues) {
                    deduplicatedParams.push(`${key}=${encodeURIComponent(value)}`);
                }
            } else {
                // For single-value parameters, keep only the last value (per MongoDB spec)
                const lastValue = allValues[allValues.length - 1];
                deduplicatedParams.push(`${key}=${encodeURIComponent(lastValue)}`);
            }
        }

        // Reconstruct the connection string
        const baseUrl = this.toString().split('?')[0];
        if (deduplicatedParams.length === 0) {
            return baseUrl;
        }
        return `${baseUrl}?${deduplicatedParams.join('&')}`;
    }

    /**
     * Checks if the connection string has any duplicate query parameters.
     *
     * @returns true if there are duplicate parameters (same key with same value appearing multiple times)
     */
    public hasDuplicateParameters(): boolean {
        const uniqueKeys = [...new Set([...this.searchParams.keys()])];

        for (const key of uniqueKeys) {
            const allValues = this.searchParams.getAll(key);
            const uniqueValues = new Set(allValues);
            if (allValues.length !== uniqueValues.size) {
                return true;
            }
        }
        return false;
    }

    /**
     * Normalizes a connection string by:
     * 1. Removing duplicate query parameters (same key=value pairs)
     * 2. Ensuring consistent encoding
     *
     * This is a static factory method that creates a normalized connection string
     * from an input string, useful for cleaning up potentially corrupted data.
     *
     * @param connectionString - The connection string to normalize
     * @returns A normalized connection string, or the original if parsing fails
     */
    public static normalize(connectionString: string): string {
        if (!connectionString) {
            return connectionString;
        }

        try {
            const parsed = new DocumentDBConnectionString(connectionString);
            return parsed.deduplicateQueryParameters();
        } catch {
            // If parsing fails, return the original string
            return connectionString;
        }
    }
}
