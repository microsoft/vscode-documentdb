/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseError } from '@microsoft/vscode-azext-utils';

const IDENTIFIER_TYPE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const NUMERIC_CODE_TYPE = /^[0-9]{1,6}$/;
const MAX_CAUSE_DEPTH = 5;

/**
 * Keeps an error type (class name, Node.js error code or server code) only when it has the
 * shape of an identifier or a short numeric code, so a message or an ID can never pass as a type.
 *
 * Telemetry properties carrying the result must not be named like `error` or `exception`:
 * whole-error masking would redact them, and aggressive masking turns 4+ digit codes into `redacted:id`.
 */
export function allowListedErrorType(type: string | undefined): string {
    return type !== undefined && (IDENTIFIER_TYPE.test(type) || NUMERIC_CODE_TYPE.test(type)) ? type : 'other';
}

/** The allow-listed `parseError` type of an error. */
export function telemetryErrorTypeOf(error: unknown): string {
    return allowListedErrorType(parseError(error).errorType);
}

function causeOf(value: unknown): unknown {
    return typeof value === 'object' && value !== null ? (value as { cause?: unknown }).cause : undefined;
}

/**
 * The allow-listed type of the innermost cause of `error` that is more specific than a plain
 * `Error`, or of the innermost cause when every cause is a plain `Error`. `undefined` without a cause.
 */
export function innermostCauseTypeOf(error: unknown): string | undefined {
    let innermostType: string | undefined;
    let specificType: string | undefined;
    for (
        let current = causeOf(error), depth = 0;
        current !== undefined && current !== null && depth < MAX_CAUSE_DEPTH;
        current = causeOf(current), depth++
    ) {
        innermostType = telemetryErrorTypeOf(current);
        if (innermostType !== 'Error') {
            specificType = innermostType;
        }
    }
    return specificType ?? innermostType;
}
