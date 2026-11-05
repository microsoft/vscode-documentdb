/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DescribeDBSubnetGroupsCommand, DocDBClient, paginateDescribeDBClusters } from '@aws-sdk/client-docdb';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { type AwsCredentialIdentity } from '@aws-sdk/types';
import * as vscode from 'vscode';
import { AwsValidationError, safeAwsError, throwIfAborted } from '../auth/errors';
import { type AwsCluster, type AwsCredentialRecord } from '../types';

export interface AwsIdentity {
    accountId: string;
    arn: string;
}

export async function verifyIdentity(
    credentials: AwsCredentialIdentity,
    region: string,
    signal?: AbortSignal,
): Promise<AwsIdentity> {
    throwIfAborted(signal);
    const client = new STSClient({ region, credentials, maxAttempts: 2 });
    try {
        const identity = await client.send(new GetCallerIdentityCommand({}), { abortSignal: signal });
        throwIfAborted(signal);
        if (!identity.Account || !identity.Arn) {
            throw new AwsValidationError(vscode.l10n.t('AWS did not return a verified account identity.'));
        }
        return { accountId: identity.Account, arn: identity.Arn };
    } finally {
        client.destroy();
    }
}

export async function discoverRegion(
    record: AwsCredentialRecord,
    credentials: AwsCredentialIdentity,
    region: string,
    signal?: AbortSignal,
): Promise<AwsCluster[]> {
    throwIfAborted(signal);
    const client = new DocDBClient({ region, credentials, maxAttempts: 2 });
    try {
        const discovered: Array<{ resource: AwsCluster; subnetGroupName?: string }> = [];
        const pages = paginateDescribeDBClusters(
            { client, pageSize: 100, stopOnSameToken: true },
            {},
            { abortSignal: signal },
        );
        for await (const page of pages) {
            throwIfAborted(signal);
            for (const cluster of page.DBClusters ?? []) {
                if (
                    !cluster.DBClusterArn ||
                    !cluster.DBClusterIdentifier ||
                    (cluster.Engine && cluster.Engine !== 'docdb')
                ) {
                    continue;
                }
                discovered.push({
                    resource: {
                        id: cluster.DBClusterArn,
                        arn: cluster.DBClusterArn,
                        accountId: cluster.DBClusterArn.split(':')[4] || record.accountId,
                        region,
                        name: cluster.DBClusterIdentifier,
                        endpoint: cluster.Endpoint,
                        readerEndpoint: cluster.ReaderEndpoint,
                        port: cluster.Port ?? 27017,
                        status: cluster.Status ?? 'unknown',
                        engineVersion: cluster.EngineVersion,
                        masterUsername: cluster.MasterUsername,
                        ownerCredentialId: record.id,
                        vpcInfo: {
                            subnetGroupName: cluster.DBSubnetGroup,
                            securityGroups: (cluster.VpcSecurityGroups ?? []).flatMap(
                                ({ VpcSecurityGroupId, Status }) =>
                                    VpcSecurityGroupId ? [{ id: VpcSecurityGroupId, status: Status }] : [],
                            ),
                            availabilityZones: cluster.AvailabilityZones ?? [],
                            subnets: [],
                            networkType: cluster.NetworkType,
                        },
                    },
                    subnetGroupName: cluster.DBSubnetGroup,
                });
            }
        }

        const groupNames = [
            ...new Set(discovered.flatMap(({ subnetGroupName }) => (subnetGroupName ? [subnetGroupName] : []))),
        ];
        if (groupNames.length === 0) {
            return discovered.map(({ resource }) => ({
                ...resource,
                vpcInfoError: vscode.l10n.t('AWS did not return the cluster subnet group name.'),
            }));
        }

        const subnetGroups = new Map<
            string,
            { vpcId?: string; subnets: NonNullable<AwsCluster['vpcInfo']>['subnets']; error?: string }
        >();
        let nextGroup = 0;
        const fetchSubnetGroups = async (): Promise<void> => {
            while (nextGroup < groupNames.length) {
                const groupName = groupNames[nextGroup++];
                try {
                    const response = await client.send(
                        new DescribeDBSubnetGroupsCommand({ DBSubnetGroupName: groupName }),
                        { abortSignal: signal },
                    );
                    throwIfAborted(signal);
                    const group = response.DBSubnetGroups?.find(
                        (candidate) => candidate.DBSubnetGroupName === groupName,
                    );
                    if (!group) {
                        subnetGroups.set(groupName, {
                            subnets: [],
                            error: vscode.l10n.t('AWS did not return this subnet group.'),
                        });
                    } else {
                        subnetGroups.set(groupName, {
                            vpcId: group.VpcId,
                            subnets: (group.Subnets ?? []).flatMap((subnet) =>
                                subnet.SubnetIdentifier
                                    ? [
                                          {
                                              id: subnet.SubnetIdentifier,
                                              availabilityZone: subnet.SubnetAvailabilityZone?.Name,
                                              status: subnet.SubnetStatus,
                                          },
                                      ]
                                    : [],
                            ),
                        });
                    }
                } catch (error) {
                    throwIfAborted(signal);
                    subnetGroups.set(groupName, { subnets: [], error: safeAwsError(error).message });
                }
            }
        };
        await Promise.all(Array.from({ length: Math.min(4, groupNames.length) }, fetchSubnetGroups));

        return discovered.map(({ resource, subnetGroupName }) => {
            const subnetGroup = subnetGroupName ? subnetGroups.get(subnetGroupName) : undefined;
            if (!subnetGroup || subnetGroup.error) {
                return {
                    ...resource,
                    vpcInfoError:
                        subnetGroup?.error ?? vscode.l10n.t('AWS did not return the cluster subnet group details.'),
                };
            }
            return {
                ...resource,
                vpcInfo: {
                    ...(resource.vpcInfo ?? { securityGroups: [], availabilityZones: [], subnets: [] }),
                    vpcId: subnetGroup.vpcId,
                    subnets: subnetGroup.subnets,
                },
            };
        });
    } finally {
        client.destroy();
    }
}
