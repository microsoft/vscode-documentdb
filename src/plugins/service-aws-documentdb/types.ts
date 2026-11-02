/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type AwsAuthMethod = 'profile' | 'accessKey' | 'sso' | 'temporary';

export interface AwsCredentialInput {
    authMethod: AwsAuthMethod;
    label?: string;
    regions: string[];
    profile?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    sessionToken?: string;
    expiration?: string;
    ssoFlowId?: string;
    accountId?: string;
    roleName?: string;
}

export interface AwsCredentialRecord {
    id: string;
    label: string;
    authMethod: AwsAuthMethod;
    regions: string[];
    accountId: string;
    arn: string;
    profile?: string;
    ssoRegion?: string;
    startUrl?: string;
    roleName?: string;
    expiresAt?: number;
}

export interface AwsCluster {
    id: string;
    arn: string;
    accountId: string;
    region: string;
    name: string;
    endpoint?: string;
    readerEndpoint?: string;
    port: number;
    status: string;
    engineVersion?: string;
    masterUsername?: string;
    vpcInfo?: AwsVpcInfo;
    vpcInfoError?: string;
    ownerCredentialId: string;
}

export interface AwsVpcInfo {
    vpcId?: string;
    subnetGroupName?: string;
    subnets: Array<{
        id: string;
        availabilityZone?: string;
        status?: string;
    }>;
    securityGroups: Array<{
        id: string;
        status?: string;
    }>;
    availabilityZones: string[];
    networkType?: string;
}

export interface AwsDiscoveryFailure {
    credentialId: string;
    region?: string;
    message: string;
    kind: 'auth' | 'permission' | 'network' | 'other';
}

export interface AwsDiscoverySnapshot {
    clusters: AwsCluster[];
    errors: AwsDiscoveryFailure[];
}

export interface AwsProfile {
    name: string;
    kind: string;
    startUrl?: string;
    ssoRegion?: string;
    accountId?: string;
    roleName?: string;
}

export interface AwsSsoAccount {
    accountId: string;
    accountName: string;
}

export interface AwsSsoStart {
    flowId: string;
    verificationUri: string;
    userCode: string;
    intervalSeconds: number;
}

export interface AwsSsoPoll {
    status: 'pending' | 'authorized';
    accounts?: AwsSsoAccount[];
}
