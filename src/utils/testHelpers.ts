/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Test helper utilities for creating test contexts and mock objects
 */

import { type IActionContext } from '@microsoft/vscode-azext-utils';

/**
 * Creates a basic action context for testing
 * @returns Action context suitable for testing
 */
export function createActionContext(): IActionContext {
    return {
        telemetry: {
            properties: {},
            measurements: {},
        },
        errorHandling: {
            suppressDisplay: true,
            suppressReportIssue: true,
        },
        valuesToMask: [],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
}
