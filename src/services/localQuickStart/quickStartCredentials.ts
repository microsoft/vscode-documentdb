/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure credential + connection-string helpers for Quick Start (decision D6).
 * No `vscode` dependency, so it is unit-testable in isolation.
 */

import * as crypto from 'crypto';
import { DocumentDBConnectionString } from '../../documentdb/utils/DocumentDBConnectionString';
import { QUICK_START_PORT } from './quickStartTypes';

/** URL-safe alphabet: never emits a character with meaning in a URI (design §8.1). */
const SAFE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Generate a random token of `length` characters from the URL-safe alphabet. */
export function generateToken(length: number): string {
    if (length <= 0) {
        return '';
    }
    const alphabetLength = SAFE_ALPHABET.length;
    // Reject the biased tail of each random byte: only values in [0, limit) — where
    // `limit` is the largest multiple of the alphabet length that fits in a byte —
    // map uniformly onto the alphabet. Using a plain `byte % alphabetLength` would
    // over-represent the first `256 % alphabetLength` characters
    // (CodeQL js/biased-cryptographic-random). Rejection sampling removes that bias.
    const limit = 256 - (256 % alphabetLength);
    let out = '';
    while (out.length < length) {
        const bytes = crypto.randomBytes(length - out.length);
        for (let i = 0; i < bytes.length && out.length < length; i++) {
            const value = bytes[i];
            if (value < limit) {
                out += SAFE_ALPHABET.charAt(value % alphabetLength);
            }
        }
    }
    return out;
}

export interface GeneratedCredentials {
    readonly username: string;
    readonly password: string;
}

/** Auto-generate a username + strong password from the URL-safe alphabet. */
export function generateCredentials(): GeneratedCredentials {
    // Lead the username with a letter so it is never all-digits.
    return { username: 'u' + generateToken(11), password: generateToken(24) };
}

/**
 * Compose the local DocumentDB connection string. Credentials are percent-encoded
 * by {@link DocumentDBConnectionString} (belt-and-suspenders alongside the safe
 * alphabet, design §8.1). TLS-allow-invalid matches the official image.
 */
export function composeConnectionString(username: string, password: string, port: number = QUICK_START_PORT): string {
    const cs = new DocumentDBConnectionString(`mongodb://localhost:${port}/?tls=true&tlsAllowInvalidCertificates=true`);
    cs.username = username;
    cs.password = password;
    return cs.toString();
}
