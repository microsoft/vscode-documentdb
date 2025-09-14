/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Centralized type contracts for MongoDB Atlas Administration API responses.
// These were originally defined in AtlasAdministrationClient.ts and moved out for reuse and clarity.

export interface AtlasProject {
    readonly id?: string;
    readonly name: string;
    readonly orgId: string;
    readonly created: string;
    readonly clusterCount: number;
    readonly links?: Array<{
        readonly href: string;
        readonly rel: string;
    }>;
    readonly regionUsageRestrictions?: 'COMMERCIAL_FEDRAMP_REGIONS_ONLY' | 'GOV_REGIONS_ONLY';
    readonly tags?: Array<{
        readonly key: string;
        readonly value: string;
    }>;
    readonly withDefaultAlertsSettings?: boolean;
}

export interface AtlasCluster {
    readonly id?: string;
    readonly name?: string;
    readonly groupId?: string;
    readonly mongoDBMajorVersion?: string;
    readonly mongoDBVersion?: string;
    readonly clusterType: 'REPLICASET' | 'SHARDED' | 'GEOSHARDED';
    readonly providerSettings: {
        readonly providerName: string;
        readonly regionName: string;
        readonly instanceSizeName: string;
    };
    readonly connectionStrings?: {
        readonly awsPrivateLink?: object;
        readonly awsPrivateLinkSrv?: object;
        readonly standard?: string;
        readonly standardSrv?: string;
        readonly private?: string;
        readonly privateEndpoint?: Array<{
            readonly connectionString?: string;
            readonly endpoints?: Array<{
                readonly endpointId?: string;
                readonly providerName?: 'AWS' | 'AZURE' | 'GCP';
                readonly region?: string;
            }>;
            readonly srvConnectionString?: string;
            readonly srvShardOptimizedConnectionString?: string;
            readonly type?: 'MONGOD' | 'MONGOS';
        }>;
        readonly privateSrv?: string;
    };
    readonly stateName: 'IDLE' | 'CREATING' | 'UPDATING' | 'DELETING' | 'DELETED' | 'REPAIRING';
    readonly createDate?: string; // DATE-TIME
    readonly links?: Array<{
        readonly href: string;
        readonly rel: string;
    }>;
    readonly acceptDataRisksAndForceReplicaSetReconfig?: string; // DATE-TIME
    readonly advancedConfiguration?: {
        readonly customOpensslCipherConfigTls12?: Array<string>;
        readonly minimumEnabledTlsProtocol?: 'TLS1_0' | 'TLS1_1' | 'TLS1_2';
        readonly tlsCipherConfigMode?: 'CUSTOM' | 'DEFAULT';
    };
    readonly backupEnabled?: boolean;
    readonly biConnector?: {
        readonly enabled?: boolean;
        readonly readPreference?: 'PRIMARY' | 'SECONDARY' | 'ANALYTICS';
    };
    readonly configServerManagementMode?: 'ATLAS_MANAGED' | 'FIXED_TO_DEDICATED';
    readonly configServerType?: 'DEDICATED' | 'EMBEDDED';
    readonly diskWarmingMode?: 'FULLY_WARMED' | 'VISIBLE_EARLIER';
    readonly encryptionAtRestProvider?: 'AWS' | 'AZURE' | 'GCP' | 'NONE';
    readonly featureCompatibilityVersion?: string;
    readonly featureCompatibilityVersionExpirationDate?: string; // DATE-TIME
    readonly globalClusterSelfManagedSharding?: boolean;
    readonly mongoDBEmployeeAccessGrant?: {
        readonly expirationTime: string; // DATE-TIME
        readonly grantType:
            | 'CLUSTER_DATABASE_LOGS'
            | 'CLUSTER_INFRASTRUCTURE'
            | 'CLUSTER_INFRASTRUCTURE_AND_APP_SERVICES_SYNC_DATA';
        readonly links?: Array<{
            readonly href: string;
            readonly rel: string;
        }>;
    };
    readonly paused?: boolean;
    readonly pitEnabled?: boolean;
    readonly redactClientLogData?: boolean;
    readonly replicaSetScalingStrategy?: 'SEQUENTIAL' | 'WORKLOAD_TYPE' | 'NODE_TYPE';
    readonly replicationSpecs?: Array<{
        readonly id?: string;
        readonly regionConfigs?: Array<{
            readonly electableSpecs?: {
                readonly diskSizeGB?: number; // DOUBLE
                readonly diskIOPS?: number; // INTEGER
                readonly ebsVolumeType?: 'STANDARD' | 'PROVISIONED';
                readonly instanceSize?:
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
                readonly nodeCount?: number; // INTEGER
            };
            readonly priority?: number; // 0-7
            readonly providerName?: 'AWS' | 'AZURE' | 'GCP' | 'TENANT';
            readonly regionName?: string;
            readonly analyticsAutoScaling?: {
                readonly compute?: {
                    readonly enabled: boolean;
                    readonly maxInstanceSize?: string;
                    readonly minInstanceSize?: string;
                    readonly predictiveEnabled?: boolean;
                    readonly scaleDownEnabled?: boolean;
                };
                readonly diskGB?: { readonly enabled?: boolean };
            };
            readonly analyticsSpecs?: object;
            readonly autoScaling?: {
                readonly compute?: {
                    readonly enabled: boolean;
                    readonly maxInstanceSize?: string;
                    readonly minInstanceSize?: string;
                    readonly predictiveEnabled?: boolean;
                    readonly scaleDownEnabled?: boolean;
                };
                readonly diskGB?: { readonly enabled?: boolean };
            };
            readonly readOnlySpecs?: object;
            readonly zoneId?: string;
            readonly zoneName?: string;
        }>;
        readonly rootCertType?: 'ISRGROOTX1';
        readonly stateName?: 'IDLE' | 'CREATING' | 'UPDATING' | 'DELETING' | 'REPAIRING';
        readonly tags?: Array<{ readonly key: string; readonly value: string }>;
        readonly terminationProtectionEnabled?: boolean;
        readonly versionReleaseSystem?: 'LTS' | 'CONTINUOUS';
    }>;
}

export interface AtlasDatabaseUser {
    readonly username: string; // Max 1024
    readonly databaseName: 'admin' | '$external';
    readonly groupId: string;
    readonly roles: Array<{
        readonly roleName: string;
        readonly databaseName: string;
        readonly collectionName?: string;
    }>;
    readonly scopes?: Array<{
        readonly name: string;
        readonly type: 'CLUSTER' | 'DATA_LAKE' | 'STREAM';
    }>;
    readonly labels?: Array<{ readonly key: string; readonly value: string }>;
    readonly ldapAuthType?: 'NONE' | 'USER' | 'GROUP';
    readonly x509Type?: 'NONE' | 'MANAGED' | 'CUSTOMER';
    readonly awsIAMType?: 'NONE' | 'USER' | 'ROLE';
    readonly links?: Array<{ readonly href: string; readonly rel: string }>;
    readonly deleteAfterDate?: string; // DATE-TIME
    readonly description?: string; // Max 100
    readonly oidcAuthType?: 'NONE' | 'USER' | 'IDP_GROUP';
}

export interface AtlasAccessListEntry {
    readonly groupId: string;
    readonly ipAddress?: string;
    readonly cidrBlock?: string;
    readonly awsSecurityGroup?: string;
    readonly comment?: string;
    readonly deleteAfterDate?: string;
    readonly links?: Array<{ readonly href: string; readonly rel: string }>;
}

export interface AtlasApiResponse<T> {
    readonly results: T[];
    readonly totalCount: number;
    readonly links?: Array<{ readonly href: string; readonly rel: string }>;
}

export interface CreateAccessListEntryParams {
    readonly ipAddress?: string;
    readonly cidrBlock?: string;
    readonly awsSecurityGroup?: string;
    readonly comment?: string;
    readonly deleteAfterDate?: string;
}
