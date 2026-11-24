/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, it, vi } from 'vitest';
import { getConnectionSurfaces, registerConnectionSurface, type ConnectionSurface } from './connectionSurfaces';

it('keeps teardown scoped to the current registered surfaces for one cluster', (): void => {
    const makeSurface = (clusterId: string, kind: ConnectionSurface['kind']): ConnectionSurface => ({
        clusterId,
        kind,
        disable: vi.fn(),
        dispose: vi.fn(),
    });
    const document = makeSurface('cluster-a', 'documentView');
    const dashboard = makeSurface('cluster-a', 'clusterDashboard');
    const otherCluster = makeSurface('cluster-b', 'collectionView');
    const registrations = [document, dashboard, otherCluster].map(registerConnectionSurface);

    try {
        expect(getConnectionSurfaces('cluster-a')).toEqual([document, dashboard]);
        registrations[0].dispose();
        expect(getConnectionSurfaces('cluster-a')).toEqual([dashboard]);
        expect(getConnectionSurfaces('cluster-b')).toEqual([otherCluster]);
        expect(document.dispose).not.toHaveBeenCalled();
        expect(document.disable).not.toHaveBeenCalled();
    } finally {
        for (const registration of registrations) {
            registration.dispose();
        }
    }

    expect(getConnectionSurfaces('cluster-a')).toEqual([]);
    expect(getConnectionSurfaces('cluster-b')).toEqual([]);
});
