/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Experience } from '../../../DocumentDBExperiences';
import { type BaseClusterModel } from '../../../tree/models/BaseClusterModel';

/**
 * Cluster model for MongoDB Atlas clusters discovered via the Atlas Admin API.
 * Extends BaseClusterModel with Atlas-specific metadata.
 */
export interface AtlasClusterModel extends BaseClusterModel {
    /** Atlas project (group) ID this cluster belongs to */
    readonly projectId: string;

    /** Atlas project name */
    readonly projectName: string;

    /** Cluster state (IDLE, CREATING, UPDATING, etc.) */
    readonly stateName: string;

    /** Cluster type (REPLICASET, SHARDED, GEOSHARDED) */
    readonly clusterType: string;

    /** Cloud provider name (AWS, GCP, AZURE) */
    readonly providerName: string;

    /** Cloud region (e.g., US_EAST_1) */
    readonly regionName: string;

    /** Instance size (e.g., M10, M30) */
    readonly instanceSizeName: string;

    /** MongoDB version running on the cluster */
    readonly mongoDBVersion: string;
}

/**
 * Creates an AtlasClusterModel from Atlas API response data.
 */
export function createAtlasClusterModel(
    projectId: string,
    projectName: string,
    cluster: {
        id: string;
        name: string;
        mongoDBVersion: string;
        connectionStrings: { standardSrv?: string; standard?: string };
        stateName: string;
        clusterType: string;
        providerSettings?: { providerName: string; regionName: string; instanceSizeName: string };
        replicationSpecs?: {
            regionConfigs?: {
                providerName?: string;
                regionName?: string;
                electableSpecs?: { instanceSize?: string };
            }[];
        }[];
    },
    dbExperience: Experience,
): AtlasClusterModel {
    // clusterId must not contain '/' — use provider prefix + project + cluster name
    const clusterId = `atlas-mongodb-discovery_${projectId}_${cluster.name}`;

    // Resolve provider info from top-level providerSettings or replicationSpecs
    const provider =
        cluster.providerSettings ??
        (() => {
            const rc = cluster.replicationSpecs?.[0]?.regionConfigs?.[0];
            return rc
                ? {
                      providerName: rc.providerName ?? '',
                      regionName: rc.regionName ?? '',
                      instanceSizeName: rc.electableSpecs?.instanceSize ?? '',
                  }
                : { providerName: '', regionName: '', instanceSizeName: '' };
        })();

    return {
        name: cluster.name,
        connectionString: cluster.connectionStrings.standardSrv ?? cluster.connectionStrings.standard,
        dbExperience,
        clusterId,
        projectId,
        projectName,
        stateName: cluster.stateName,
        clusterType: cluster.clusterType,
        providerName: provider.providerName,
        regionName: provider.regionName,
        instanceSizeName: provider.instanceSizeName,
        mongoDBVersion: cluster.mongoDBVersion,
    };
}
