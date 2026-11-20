/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';

/**
 * Records a tree index action the way the Indexes tab records its own, so both entry points
 * read alike: the action, whether the confirmation was declined, and the index's size and
 * usage when it was confirmed. A declined confirmation returns normally, so without
 * `userCancelled` it would read as a completed action. The index name is never recorded.
 */
export function recordIndexActionTelemetry(
    context: IActionContext,
    actionType: 'drop' | 'hide' | 'unhide',
    confirmed: boolean,
    stats: { sizeBytes?: number; usageOps?: number },
): void {
    context.telemetry.properties.actionType = actionType;
    context.telemetry.properties.userCancelled = confirmed ? 'false' : 'true';
    if (stats.sizeBytes !== undefined) {
        context.telemetry.measurements.indexSizeBytes = stats.sizeBytes;
    }
    if (stats.usageOps !== undefined) {
        context.telemetry.measurements.indexUsageOps = stats.usageOps;
    }
}
