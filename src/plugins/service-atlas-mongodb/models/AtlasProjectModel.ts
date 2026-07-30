/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Represents a MongoDB Atlas organization.
 */
export interface AtlasOrganization {
    readonly id: string;
    readonly name: string;
}

/**
 * Represents the authenticated Atlas user.
 */
export interface AtlasUserInfo {
    readonly id: string;
    readonly emailAddress: string;
    readonly firstName: string;
    readonly lastName: string;
    readonly username: string;
}

/**
 * Represents a MongoDB Atlas project (also called "group" in the API).
 */
export interface AtlasProject {
    readonly id: string;
    readonly name: string;
    readonly orgId: string;
    readonly clusterCount: number;
    readonly created: string;
}

/**
 * Represents a MongoDB Atlas cluster.
 * Atlas API v2 may return providerSettings at the top level (legacy)
 * or embed provider info inside replicationSpecs[].regionConfigs[].
 */
export interface AtlasCluster {
    readonly id: string;
    readonly name: string;
    readonly groupId: string;
    readonly mongoDBVersion: string;
    readonly connectionStrings: AtlasConnectionStrings;
    readonly stateName: AtlasClusterState;
    readonly clusterType: AtlasClusterType;
    readonly providerSettings?: AtlasProviderSettings;
    readonly replicationSpecs?: AtlasReplicationSpec[];
}

export interface AtlasConnectionStrings {
    readonly standardSrv?: string;
    readonly standard?: string;
}

export interface AtlasProviderSettings {
    readonly providerName: string;
    readonly regionName: string;
    readonly instanceSizeName: string;
}

export interface AtlasReplicationSpec {
    readonly regionConfigs?: AtlasRegionConfig[];
}

export interface AtlasRegionConfig {
    readonly providerName?: string;
    readonly regionName?: string;
    readonly electableSpecs?: AtlasElectableSpecs;
}

export interface AtlasElectableSpecs {
    readonly instanceSize?: string;
}

export type AtlasClusterState = 'IDLE' | 'CREATING' | 'UPDATING' | 'DELETING' | 'REPAIRING' | 'UNKNOWN';

export type AtlasClusterType = 'REPLICASET' | 'SHARDED' | 'GEOSHARDED';

/**
 * A database user defined in an Atlas project.
 *
 * Database users are project-scoped, not cluster-scoped: `scopes` is what ties a user to
 * particular clusters, and an empty `scopes` array means the user applies to every cluster in
 * the project. Atlas never returns the password.
 */
export interface AtlasDatabaseUser {
    readonly username: string;
    /**
     * Authentication database. `admin` is a SCRAM (username plus password) user; `$external`
     * means the user authenticates through X.509, AWS IAM, LDAP or OIDC and therefore cannot be
     * used with the username and password prompt.
     */
    readonly databaseName: string;
    readonly description?: string;
    readonly scopes?: AtlasDatabaseUserScope[];
    readonly roles?: AtlasDatabaseUserRole[];

    /**
     * Which non-SCRAM method a `$external` user signs in with. Atlas sets exactly one of these to
     * something other than `NONE`, so together they name the method precisely.
     */
    readonly x509Type?: string;
    readonly awsIAMType?: string;
    readonly ldapAuthType?: string;
    readonly oidcAuthType?: string;
}

export interface AtlasDatabaseUserScope {
    readonly name: string;
    readonly type: 'CLUSTER' | 'DATA_LAKE' | 'STREAM';
}

export interface AtlasDatabaseUserRole {
    readonly roleName: string;
    readonly databaseName?: string;
    readonly collectionName?: string;
}
