/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DocumentDBExperience } from '../../../DocumentDBExperiences';
import { type AtlasCluster } from './AtlasProjectModel';
import { createAtlasClusterModel } from './AtlasClusterModel';

function baseCluster(overrides: Partial<AtlasCluster> = {}): AtlasCluster {
    return {
        id: 'c1',
        name: 'Cluster0',
        groupId: 'g1',
        mongoDBVersion: '7.0',
        connectionStrings: { standardSrv: 'mongodb+srv://cluster0.example.invalid' },
        stateName: 'IDLE',
        clusterType: 'REPLICASET',
        providerSettings: { providerName: 'AWS', regionName: 'US_EAST_1', instanceSizeName: 'M10' },
        ...overrides,
    };
}

describe('createAtlasClusterModel (NEW-7 boundary guards)', () => {
    it('does not throw when Atlas omits connectionStrings, leaving the connection string undefined', () => {
        const cluster = baseCluster({ connectionStrings: undefined });

        const model = createAtlasClusterModel('p1', 'Project 0', cluster, DocumentDBExperience);

        expect(model.connectionString).toBeUndefined();
    });

    it('prefers standardSrv, then standard', () => {
        const model = createAtlasClusterModel(
            'p1',
            'Project 0',
            baseCluster({ connectionStrings: { standard: 'mongodb://cluster0.example.invalid' } }),
            DocumentDBExperience,
        );

        expect(model.connectionString).toBe('mongodb://cluster0.example.invalid');
    });

    it('normalizes an unrecognized cluster state to UNKNOWN', () => {
        const cluster = baseCluster({ stateName: 'PAUSED' as AtlasCluster['stateName'] });

        const model = createAtlasClusterModel('p1', 'Project 0', cluster, DocumentDBExperience);

        expect(model.stateName).toBe('UNKNOWN');
    });

    it('keeps a recognized cluster state', () => {
        const model = createAtlasClusterModel('p1', 'Project 0', baseCluster(), DocumentDBExperience);

        expect(model.stateName).toBe('IDLE');
    });
});
