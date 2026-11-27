/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Views } from '../../../documentdb/Views';
import { QuickStartService } from '../../../services/localQuickStart/QuickStartService';
import { isQuickStartClusterId } from '../../../services/localQuickStart/quickStartTypes';

export { isQuickStartClusterId };

/** Builds the tree ID of the Quick Start root node. */
export function buildQuickStartTreeId(parentId: string = Views.ConnectionsView): string {
    return `${parentId}/localQuickStart`;
}

/** Builds the tree ID of the single managed instance. */
export function buildQuickStartInstanceTreeId(parentId: string = Views.ConnectionsView): string {
    return `${buildQuickStartTreeId(parentId)}/instance`;
}

/**
 * Resolves the current managed instance's stable cluster ID to its synthetic tree ID.
 *
 * Quick Start instances are service-owned and are not persisted in connection storage, so their
 * tree position must be resolved by the same feature that constructs the tree.
 */
export function resolveQuickStartClusterTreeId(clusterId: string): string | undefined {
    if (!isQuickStartClusterId(clusterId)) {
        return undefined;
    }

    const metadata = QuickStartService.getStatus().metadata;
    return metadata?.clusterId === clusterId ? buildQuickStartInstanceTreeId() : undefined;
}
