/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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
