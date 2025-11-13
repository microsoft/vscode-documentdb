/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Extracts error code from a tRPC error by accessing error.cause.cause.code.
 *
 * TRPCClientError wraps errors in nested structures, and when serialized across
 * process boundaries, Error instances may become plain objects.
 *
 * The error code is typically at: error.cause.cause.code (depth 3)
 *
 * @param error - The error to extract the code from (Error instance or plain object)
 * @returns The extracted error code string, or null if not found
 *
 * @example
 * ```typescript
 * const errorCode = extractErrorCode(trpcError);
 * if (errorCode === 'QUERY_INSIGHTS_PLATFORM_NOT_SUPPORTED_RU') {
 *   // Handle specific error
 * }
 * ```
 */
export function extractErrorCode(error: unknown): string | null {
    // Direct access: error.cause.cause.code using optional chaining
    type ErrorWithCause = { cause?: ErrorWithCause; code?: unknown };
    const code = (error as ErrorWithCause | null)?.cause?.cause?.code;

    return typeof code === 'string' ? code : null;
}
