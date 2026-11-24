/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { ConnectionUnavailableError } from '../documentdb/ConnectionUnavailableError';

export function rethrowBoundCommandUnavailable(context: IActionContext, error: unknown): never {
    // AzureWizard's async input validation wraps the failure in Error with the original cause.
    const cause: unknown = error instanceof Error ? error.cause : undefined;
    const unavailable = error instanceof ConnectionUnavailableError ? error : cause;
    if (unavailable instanceof ConnectionUnavailableError) {
        context.errorHandling.suppressDisplay = true;
        context.errorHandling.rethrow = true;
        throw unavailable;
    }

    throw error;
}
