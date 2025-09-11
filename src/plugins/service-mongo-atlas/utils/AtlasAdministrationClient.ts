/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { AtlasHttpClient } from './AtlasHttpClient';

/**
 * Atlas project (group) information
 */
export type AtlasProject = {
    id?: string;
    name: string;
    orgId: string;
    created: string;
    clusterCount: number;
    links?: Array<{
        href: string;
        rel: string;
    }>;
    regionUsageRestrictions?: 'COMMERCIAL_FEDRAMP_REGIONS_ONLY' | 'GOV_REGIONS_ONLY';
    tags?: Array<{
        key: string;
        value: string;
    }>;
    withDefaultAlertsSettings?: boolean;
};

/**
 * Atlas cluster information
 */
export type AtlasCluster = {
    id?: string;
    name?: string;
    groupId?: string;
    mongoDBMajorVersion?: string;
    mongoDBVersion?: string;
    clusterType: 'REPLICASET' | 'SHARDED' | 'GEOSHARDED';
    providerSettings: {
        providerName: string;
        regionName: string;
        instanceSizeName: string;
    };
    connectionStrings?: {
        awsPrivateLink?: object;
        awsPrivateLinkSrv?: object;
        standard?: string;
        standardSrv?: string;
        private?: string;
        privateEndpoint?: Array<{
            connectionString?: string;
            endpoints?: Array<{
                endpointId?: string;
                providerName?: 'AWS' | 'AZURE' | 'GCP';
                region?: string;
            }>;
            srvConnectionString?: string;
            srvShardOptimizedConnectionString?: string;
            type?: 'MONGOD' | 'MONGOS';
        }>;
        privateSrv?: string;
    };
    stateName: 'IDLE' | 'CREATING' | 'UPDATING' | 'DELETING' | 'DELETED' | 'REPAIRING';
    createDate?: string; // DATE-TIME
    links?: Array<{
        href: string;
        rel: string;
    }>;
    acceptDataRisksAndForceReplicaSetReconfig?: string; // DATE-TIME
    advancedConfiguration?: {
        customOpensslCipherConfigTls12?: Array<string>;
        minimumEnabledTlsProtocol?: 'TLS1_0' | 'TLS1_1' | 'TLS1_2';
        tlsCipherConfigMode?: 'CUSTOM' | 'DEFAULT';
    };
    backupEnabled?: boolean;
    biConnector?: {
        enabled?: boolean;
        readPreference?: 'PRIMARY' | 'SECONDARY' | 'ANALYTICS';
    };
    configServerManagementMode?: 'ATLAS_MANAGED' | 'FIXED_TO_DEDICATED';
    configServerType?: 'DEDICATED' | 'EMBEDDED';
    diskWarmingMode?: 'FULLY_WARMED' | 'VISIBLE_EARLIER';
    encryptionAtRestProvider?: 'AWS' | 'AZURE' | 'GCP' | 'NONE';
    featureCompatibilityVersion?: string;
    featureCompatibilityVersionExpirationDate?: string; // DATE-TIME
    globalClusterSelfManagedSharding?: boolean;
    mongoDBEmployeeAccessGrant?: {
        expirationTime: string; // DATE-TIME
        grantType:
            | 'CLUSTER_DATABASE_LOGS'
            | 'CLUSTER_INFRASTRUCTURE'
            | 'CLUSTER_INFRASTRUCTURE_AND_APP_SERVICES_SYNC_DATA';
        links?: Array<{
            href: string;
            rel: string;
        }>;
    };
    paused?: boolean;
    pitEnabled?: boolean;
    redactClientLogData?: boolean;
    replicaSetScalingStrategy?: 'SEQUENTIAL' | 'WORKLOAD_TYPE' | 'NODE_TYPE';
    replicationSpecs?: Array<{
        id?: string;
        regionConfigs?: Array<{
            electableSpecs?: {
                diskSizeGB?: number; // DOUBLE
                diskIOPS?: number; // INTEGER
                ebsVolumeType?: 'STANDARD' | 'PROVISIONED';
                instanceSize?:
                    | 'M10'
                    | 'M20'
                    | 'M30'
                    | 'M40'
                    | 'M50'
                    | 'M60'
                    | 'M80'
                    | 'M100'
                    | 'M140'
                    | 'M200'
                    | 'M300'
                    | 'R40'
                    | 'R50'
                    | 'R60'
                    | 'R80'
                    | 'R200'
                    | 'R300'
                    | 'R400'
                    | 'R700'
                    | 'M40_NVME'
                    | 'M50_NVME'
                    | 'M60_NVME'
                    | 'M80_NVME'
                    | 'M200_NVME'
                    | 'M400_NVME';
                nodeCount?: number; // INTEGER
            };
            priority?: number; // INTEGER, Minimum 0, Maximum 7
            providerName?: 'AWS' | 'AZURE' | 'GCP' | 'TENANT'; // DISCRIMINATOR
            regionName?: string; // Options are provider-specific: https://www.mongodb.com/docs/api/doc/atlas-admin-api-v2/operation/operation-listgroupclusters#operation-listgroupclusters-200-body-application-vnd-atlas-2024-08-05-json-results-replicationspecs-regionconfigs-tenant-object-regionname
            analyticsAutoScaling?: {
                compute?: {
                    enabled: boolean;
                    maxInstanceSize?: string; // Options are provider-specific: https://www.mongodb.com/docs/api/doc/atlas-admin-api-v2/operation/operation-listgroupclusters#operation-listgroupclusters-200-body-application-vnd-atlas-2024-08-05-json-results-replicationspecs-regionconfigs-analyticsautoscaling-compute-maxinstancesize
                    minInstanceSize?: string; // Options are provider-specific: https://www.mongodb.com/docs/api/doc/atlas-admin-api-v2/operation/operation-listgroupclusters#operation-listgroupclusters-200-body-application-vnd-atlas-2024-08-05-json-results-replicationspecs-regionconfigs-analyticsautoscaling-compute-mininstancesize
                    predictiveEnabled?: boolean;
                    scaleDownEnabled?: boolean;
                };
                diskGB?: {
                    enabled?: boolean;
                };
            };
            analyticsSpecs?: object; // Options are provider-specific: https://www.mongodb.com/docs/api/doc/atlas-admin-api-v2/operation/operation-listgroupclusters#operation-listgroupclusters-200-body-application-vnd-atlas-2024-08-05-json-results-replicationspecs-regionconfigs-analyticsspecs
            autoScaling?: {
                compute?: {
                    enabled: boolean;
                    maxInstanceSize?: string; // Options are provider-specific: https://www.mongodb.com/docs/api/doc/atlas-admin-api-v2/operation/operation-listgroupclusters#operation-listgroupclusters-200-body-application-vnd-atlas-2024-08-05-json-results-replicationspecs-regionconfigs-analyticsautoscaling-compute-maxinstancesize
                    minInstanceSize?: string; // Options are provider-specific: https://www.mongodb.com/docs/api/doc/atlas-admin-api-v2/operation/operation-listgroupclusters#operation-listgroupclusters-200-body-application-vnd-atlas-2024-08-05-json-results-replicationspecs-regionconfigs-analyticsautoscaling-compute-mininstancesize
                    predictiveEnabled?: boolean;
                    scaleDownEnabled?: boolean;
                };
                diskGB?: {
                    enabled?: boolean;
                };
            };
            readOnlySpecs?: object; // Options are provider-specific: https://www.mongodb.com/docs/api/doc/atlas-admin-api-v2/operation/operation-listgroupclusters#operation-listgroupclusters-200-body-application-vnd-atlas-2024-08-05-json-results-replicationspecs-regionconfigs-readonlyspecs
            zoneId?: string;
            zoneName?: string;
        }>;
        rootCertType?: 'ISRGROOTX1';
        stateName?: 'IDLE' | 'CREATING' | 'UPDATING' | 'DELETING' | 'REPAIRING';
        tags?: Array<{
            key: string;
            value: string;
        }>;
        terminationProtectionEnabled?: boolean;
        versionReleaseSystem?: 'LTS' | 'CONTINUOUS';
    }>;
};

/**
 * Atlas database user information
 */
export type AtlasDatabaseUser = {
    username: string; // Max length is 1024
    databaseName: 'admin' | '$external';
    groupId: string;
    roles: Array<{
        roleName: string;
        databaseName: string;
        collectionName?: string;
    }>;
    scopes?: Array<{
        name: string;
        type: 'CLUSTER' | 'DATA_LAKE' | 'STREAM';
    }>;
    labels?: Array<{
        key: string;
        value: string;
    }>;
    ldapAuthType?: 'NONE' | 'USER' | 'GROUP';
    x509Type?: 'NONE' | 'MANAGED' | 'CUSTOMER';
    awsIAMType?: 'NONE' | 'USER' | 'ROLE';
    links?: Array<{
        href: string;
        rel: string;
    }>;
    deleteAfterDate?: string; // DATE-TIME
    description?: string; // Max 100 chars
    oidcAuthType?: 'NONE' | 'USER' | 'IDP_GROUP';
};

/**
 * Atlas IP access list entry
 */
export type AtlasAccessListEntry = {
    groupId: string;
    ipAddress?: string;
    cidrBlock?: string;
    awsSecurityGroup?: string;
    comment?: string;
    deleteAfterDate?: string;
    links?: Array<{
        href: string;
        rel: string;
    }>;
};

/**
 * Response wrapper for paginated Atlas API responses
 */
export type AtlasApiResponse<T> = {
    results: T[];
    totalCount: number;
    links?: Array<{
        href: string;
        rel: string;
    }>;
};

/**
 * Parameters for creating IP access list entries
 */
export type CreateAccessListEntryParams = {
    ipAddress?: string;
    cidrBlock?: string;
    awsSecurityGroup?: string;
    comment?: string;
    deleteAfterDate?: string;
};

/**
 * MongoDB Atlas Administration Client for managing Atlas resources
 * Provides methods for projects, clusters, database users, and IP access lists
 */
export class AtlasAdministrationClient {
    /**
     * Lists all projects (groups) accessible to the authenticated user
     *
     * @param orgId - The organization id for the Atlas credential instance
     * @param options - Optional query parameters
     * @returns Promise resolving to list of Atlas projects
     */
    public static async listProjects(
        orgId: string,
        options: {
            pageNum?: number;
            itemsPerPage?: number;
            includeCount?: boolean;
        } = {},
    ): Promise<AtlasApiResponse<AtlasProject>> {
        const queryParams = new URLSearchParams();

        if (options.pageNum !== undefined) {
            queryParams.append('pageNum', options.pageNum.toString());
        }
        if (options.itemsPerPage !== undefined) {
            queryParams.append('itemsPerPage', options.itemsPerPage.toString());
        }
        if (options.includeCount !== undefined) {
            queryParams.append('includeCount', options.includeCount.toString());
        }

        const endpoint = `/groups${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
        const response = await AtlasHttpClient.get(orgId, endpoint);

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(l10n.t('Failed to list Atlas projects: {0} {1}', response.status.toString(), errorText));
        }

        return response.json() as Promise<AtlasApiResponse<AtlasProject>>;
    }

    /**
     * Lists all clusters within a specific project
     *
     * @param orgId - The organization id for the Atlas credential instance
     * @param projectId - The Atlas project ID
     * @param options - Optional query parameters
     * @returns Promise resolving to list of Atlas clusters
     */
    public static async listClusters(
        orgId: string,
        projectId: string,
        options: {
            pageNum?: number;
            itemsPerPage?: number;
            includeCount?: boolean;
        } = {},
    ): Promise<AtlasApiResponse<AtlasCluster>> {
        const queryParams = new URLSearchParams();

        if (options.pageNum !== undefined) {
            queryParams.append('pageNum', options.pageNum.toString());
        }
        if (options.itemsPerPage !== undefined) {
            queryParams.append('itemsPerPage', options.itemsPerPage.toString());
        }
        if (options.includeCount !== undefined) {
            queryParams.append('includeCount', options.includeCount.toString());
        }

        const endpoint = `/groups/${projectId}/clusters${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
        const response = await AtlasHttpClient.get(orgId, endpoint);

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(
                l10n.t(
                    'Failed to list clusters for project {0}: {1} {2}',
                    projectId,
                    response.status.toString(),
                    errorText,
                ),
            );
        }

        return response.json() as Promise<AtlasApiResponse<AtlasCluster>>;
    }

    /**
     * Gets detailed information about a specific cluster, including connection strings
     *
     * @param orgId - The organization id for the Atlas credential instance
     * @param projectId - The Atlas project ID
     * @param clusterName - The name of the cluster
     * @returns Promise resolving to cluster details with connection strings
     */
    public static async getCluster(orgId: string, projectId: string, clusterName: string): Promise<AtlasCluster> {
        const endpoint = `/groups/${projectId}/clusters/${clusterName}`;
        const response = await AtlasHttpClient.get(orgId, endpoint);

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(
                l10n.t(
                    'Failed to get cluster {0} in project {1}: {2} {3}',
                    clusterName,
                    projectId,
                    response.status.toString(),
                    errorText,
                ),
            );
        }

        return response.json() as Promise<AtlasCluster>;
    }

    /**
     * Lists all database users for a specific project
     *
     * @param orgId - The organization id for the Atlas credential instance
     * @param projectId - The Atlas project ID
     * @param options - Optional query parameters
     * @returns Promise resolving to list of database users
     */
    public static async listDatabaseUsers(
        orgId: string,
        projectId: string,
        options: {
            pageNum?: number;
            itemsPerPage?: number;
            includeCount?: boolean;
        } = {},
    ): Promise<AtlasApiResponse<AtlasDatabaseUser>> {
        const queryParams = new URLSearchParams();

        if (options.pageNum !== undefined) {
            queryParams.append('pageNum', options.pageNum.toString());
        }
        if (options.itemsPerPage !== undefined) {
            queryParams.append('itemsPerPage', options.itemsPerPage.toString());
        }
        if (options.includeCount !== undefined) {
            queryParams.append('includeCount', options.includeCount.toString());
        }

        const endpoint = `/groups/${projectId}/databaseUsers${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
        const response = await AtlasHttpClient.get(orgId, endpoint);

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(
                l10n.t(
                    'Failed to list database users for project {0}: {1} {2}',
                    projectId,
                    response.status.toString(),
                    errorText,
                ),
            );
        }

        return response.json() as Promise<AtlasApiResponse<AtlasDatabaseUser>>;
    }

    /**
     * Gets the IP access list (firewall entries) for a specific project
     *
     * @param orgId - The organization id for the Atlas credential instance
     * @param projectId - The Atlas project ID
     * @param options - Optional query parameters
     * @returns Promise resolving to list of access list entries
     */
    public static async getAccessList(
        orgId: string,
        projectId: string,
        options: {
            pageNum?: number;
            itemsPerPage?: number;
            includeCount?: boolean;
        } = {},
    ): Promise<AtlasApiResponse<AtlasAccessListEntry>> {
        const queryParams = new URLSearchParams();

        if (options.pageNum !== undefined) {
            queryParams.append('pageNum', options.pageNum.toString());
        }
        if (options.itemsPerPage !== undefined) {
            queryParams.append('itemsPerPage', options.itemsPerPage.toString());
        }
        if (options.includeCount !== undefined) {
            queryParams.append('includeCount', options.includeCount.toString());
        }

        const endpoint = `/groups/${projectId}/accessList${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
        const response = await AtlasHttpClient.get(orgId, endpoint);

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(
                l10n.t(
                    'Failed to get access list for project {0}: {1} {2}',
                    projectId,
                    response.status.toString(),
                    errorText,
                ),
            );
        }

        return response.json() as Promise<AtlasApiResponse<AtlasAccessListEntry>>;
    }

    /**
     * Creates one or more IP access list entries for a project
     *
     * @param orgId - The organization id for the Atlas credential instance
     * @param projectId - The Atlas project ID
     * @param entries - Array of access list entries to create
     * @returns Promise resolving to created access list entries
     */
    public static async createAccessListEntries(
        orgId: string,
        projectId: string,
        entries: CreateAccessListEntryParams[],
    ): Promise<AtlasApiResponse<AtlasAccessListEntry>> {
        const endpoint = `/groups/${projectId}/accessList`;
        const response = await AtlasHttpClient.post(orgId, endpoint, entries);

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(
                l10n.t(
                    'Failed to create access list entries for project {0}: {1} {2}',
                    projectId,
                    response.status.toString(),
                    errorText,
                ),
            );
        }

        return response.json() as Promise<AtlasApiResponse<AtlasAccessListEntry>>;
    }

    /**
     * Deletes a specific IP access list entry from a project
     *
     * @param orgId - The organization id for the Atlas credential instance
     * @param projectId - The Atlas project ID
     * @param entryId - The ID of the access list entry to delete (IP address or CIDR block)
     * @returns Promise resolving when deletion is complete
     */
    public static async deleteAccessListEntry(orgId: string, projectId: string, entryId: string): Promise<void> {
        // URL encode the entry ID to handle IP addresses and CIDR blocks properly
        const encodedEntryId = encodeURIComponent(entryId);
        const endpoint = `/groups/${projectId}/accessList/${encodedEntryId}`;

        try {
            const response = await AtlasHttpClient.delete(orgId, endpoint);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(
                    l10n.t(
                        'Failed to delete access list entry {0} from project {1}: {2} {3}',
                        entryId,
                        projectId,
                        response.status.toString(),
                        errorText,
                    ),
                );
            }
        } catch (error) {
            // Re-throw known errors or wrap unknown ones
            if (error instanceof Error) {
                throw error;
            }
            throw new Error(
                l10n.t(
                    'Failed to delete access list entry {0} from project {1}: {2}',
                    entryId,
                    projectId,
                    String(error),
                ),
            );
        }
    }
}
