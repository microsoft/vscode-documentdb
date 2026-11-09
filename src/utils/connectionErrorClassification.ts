/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const NETWORK_ERROR_CODES: ReadonlySet<string> = new Set([
    'ENOTFOUND',
    'EAI_AGAIN',
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'REQUEST_SEND_ERROR',
    'UND_ERR_CONNECT_TIMEOUT',
]);

function field(value: unknown, key: string): unknown {
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

/** An HTTP status from Azure SDK (`statusCode`), Kubernetes client (`code`) or fetch-style (`status`) errors. */
export function httpStatus(error: unknown): number | undefined {
    for (const candidate of [error, field(error, 'response')]) {
        for (const key of ['statusCode', 'status', 'code']) {
            const value = field(candidate, key);
            if (typeof value === 'number' && Number.isInteger(value) && value >= 100 && value < 600) {
                return value;
            }
        }
    }
    return undefined;
}

export function networkCode(error: unknown): boolean {
    for (
        let current = error, depth = 0;
        current !== undefined && depth < 3;
        current = field(current, 'cause'), depth++
    ) {
        const code = field(current, 'code');
        if (typeof code === 'string' && NETWORK_ERROR_CODES.has(code)) {
            return true;
        }
    }
    return false;
}
