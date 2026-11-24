/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Disposable } from 'vscode';
import { type ConnectionUnavailableReason } from './ConnectionUnavailableError';

export interface ConnectionSurface {
    readonly clusterId: string;
    readonly kind: 'collectionView' | 'documentView' | 'clusterDashboard';
    disable(reason: ConnectionUnavailableReason): void;
    dispose(): void;
    isDirty?(): boolean;
}

const surfacesByCluster = new Map<string, Set<ConnectionSurface>>();

export function registerConnectionSurface(surface: ConnectionSurface): Disposable {
    const { clusterId } = surface;
    let surfaces = surfacesByCluster.get(clusterId);
    if (!surfaces) {
        surfaces = new Set();
        surfacesByCluster.set(clusterId, surfaces);
    }

    surfaces.add(surface);
    return {
        dispose(): void {
            if (surfaces.delete(surface) && surfaces.size === 0) {
                surfacesByCluster.delete(clusterId);
            }
        },
    };
}

export function getConnectionSurfaces(clusterId: string): readonly ConnectionSurface[] {
    return [...(surfacesByCluster.get(clusterId) ?? [])];
}
