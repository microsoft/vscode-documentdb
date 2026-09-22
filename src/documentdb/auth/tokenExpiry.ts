/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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
