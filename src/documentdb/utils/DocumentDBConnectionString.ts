/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import ConnectionString from 'mongodb-connection-string-url';

/**
 * Extends the ConnectionString class to properly handle password encoding/decoding.
 * The base ConnectionString class has issues with certain special characters in passwords.
 */
export class DocumentDBConnectionString extends ConnectionString {
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
}
