/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Reads timing metadata only; this does not validate the token. */
export function readJwtTimes(token: string): { iatSec?: number; expSec?: number } {
    const parts = token.split('.');
    if (parts.length !== 3 || !parts[1]) {
        return {};
    }
    try {
        const claims: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
        if (typeof claims !== 'object' || claims === null) {
            return {};
        }
        return {
            ...('iat' in claims && typeof claims.iat === 'number' && Number.isFinite(claims.iat)
                ? { iatSec: claims.iat }
                : {}),
            ...('exp' in claims && typeof claims.exp === 'number' && Number.isFinite(claims.exp)
                ? { expSec: claims.exp }
                : {}),
        };
    } catch {
        return {};
    }
}

/**
 * Seconds until an absolute expiry timestamp (milliseconds since the epoch), floored at zero.
 *
 * A small safety margin is subtracted so the driver refreshes slightly early rather than presenting
 * a token that expires in flight.
 */
export function expiresInSecondsFromTimestamp(expiresOnTimestamp: number, now: number = Date.now()): number {
    if (!Number.isFinite(expiresOnTimestamp)) {
        return 0;
    }

    const EXPIRY_SAFETY_MARGIN_SECONDS = 300;
    const remaining = Math.floor((expiresOnTimestamp - now) / 1000) - EXPIRY_SAFETY_MARGIN_SECONDS;
    return remaining > 0 ? remaining : 0;
}
