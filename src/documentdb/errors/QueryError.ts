/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ext } from '../../extensionVariables';

/**
 * Query error codes for different types of query failures.
 * Use these codes to identify the type of error and provide appropriate user feedback.
 */
export type QueryErrorCode = 'INVALID_FILTER' | 'INVALID_PROJECTION' | 'INVALID_SORT';

/**
 * A unified error class for all query-related failures.
 * This includes parsing errors (invalid JSON/BSON syntax) and will be extended
 * in the future to include execution errors, transformation errors, etc.
 *
 * @example
 * ```typescript
 * throw new QueryError('INVALID_FILTER', vscode.l10n.t('Invalid filter syntax: {0}', originalError.message));
 * ```
 */
export class QueryError extends Error {
    public readonly name = 'QueryError';

    /**
     * Creates a new QueryError.
     * @param code - Error code identifying the type of query failure
     * @param message - Localized error message for display to the user
     * @param cause - The original error that caused this failure (optional)
     */
    constructor(
        public readonly code: QueryErrorCode,
        message: string,
        public readonly cause?: Error,
    ) {
        super(message);

        // Log detailed trace information to the output channel
        ext.outputChannel.trace(
            `QueryError [${code}]: ${message}${cause ? `\n  Cause: ${cause.message}\n  Stack: ${cause.stack}` : ''}`,
        );
    }
}
