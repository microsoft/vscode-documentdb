/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const suppressionCounts = new Map<string, number>();

/** Suppresses the automatic Cluster Dashboard until every owner has released this cluster. */
export function suppressAutoOpenDashboard(clusterId: string): () => void {
    suppressionCounts.set(clusterId, (suppressionCounts.get(clusterId) ?? 0) + 1);
    let released = false;
    return (): void => {
        if (released) {
            return;
        }
        released = true;
        const remaining = (suppressionCounts.get(clusterId) ?? 0) - 1;
        if (remaining > 0) {
            suppressionCounts.set(clusterId, remaining);
        } else {
            suppressionCounts.delete(clusterId);
        }
    };
}

/** Whether a deep link asked to open the dashboard itself for this cluster. */
export function isAutoOpenDashboardSuppressed(clusterId: string): boolean {
    return suppressionCounts.has(clusterId);
}
