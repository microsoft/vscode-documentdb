/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const suppressedClusterIds = new Set<string>();

/** Suppresses the automatic Cluster Dashboard for `clusterId` until the returned function is called. */
export function suppressAutoOpenDashboard(clusterId: string): () => void {
    suppressedClusterIds.add(clusterId);
    return (): void => {
        suppressedClusterIds.delete(clusterId);
    };
}

/** Whether a deep link asked to open the dashboard itself for this cluster. */
export function isAutoOpenDashboardSuppressed(clusterId: string): boolean {
    return suppressedClusterIds.has(clusterId);
}
