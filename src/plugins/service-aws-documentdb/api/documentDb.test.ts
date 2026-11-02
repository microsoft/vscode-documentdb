/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
    l10n: {
        t: (template: string, ...args: unknown[]): string =>
            template.replace(/\{(\d+)\}/g, (_match: string, index: string) => String(args[Number(index)])),
    },
}));
vi.mock('@aws-sdk/client-docdb', () => ({
    DocDBClient: class {
        constructor(options: unknown) { clientOptions(options); }
        public send(...args: unknown[]): unknown { return describeSubnetGroup(...args); }
        public destroy(): void { destroyed(); }
    },
    paginateDescribeDBClusters: (...args: unknown[]): unknown => pages(...args),
    DescribeDBSubnetGroupsCommand: class {
        constructor(public readonly input: unknown) {}
    },
}));

import { type AwsCredentialRecord } from '../types';
import { discoverRegion } from './documentDb';

const pages = vi.hoisted(() => vi.fn());
const describeSubnetGroup = vi.hoisted(() => vi.fn());
const destroyed = vi.hoisted(() => vi.fn());
const clientOptions = vi.hoisted(() => vi.fn());
const record: AwsCredentialRecord = {
    id: 'opaque-entry',
    authMethod: 'accessKey',
    label: 'Test',
    regions: ['us-east-1'],
    accountId: '123456789012',
    arn: 'arn:aws:iam::123456789012:user/test',
};
const credentials = { accessKeyId: 'key', secretAccessKey: 'secret' };

describe('DocumentDB regional enumeration', () => {
    beforeEach(() => {
        pages.mockReset();
        describeSubnetGroup.mockReset();
        destroyed.mockClear();
        clientOptions.mockClear();
    });

    it('paginates clusters and subnet groups to map VPC, subnet and security-group information', async () => {
        pages.mockImplementation(async function* (): AsyncGenerator<unknown> {
            yield { DBClusters: [{
                DBClusterArn: 'arn:first', DBClusterIdentifier: 'first', Engine: 'docdb', Endpoint: 'first.example',
                DBSubnetGroup: 'subnet-group', VpcSecurityGroups: [{ VpcSecurityGroupId: 'sg-123', Status: 'active' }],
                AvailabilityZones: ['us-east-1a', 'us-east-1b'], NetworkType: 'IPV4',
            }] };
            yield { DBClusters: [
                { DBClusterArn: 'arn:second', DBClusterIdentifier: 'second', Engine: 'docdb', Status: 'creating' },
                { DBClusterArn: 'arn:not-docdb', DBClusterIdentifier: 'other', Engine: 'aurora' },
            ] };
        });
        describeSubnetGroup.mockResolvedValue({ DBSubnetGroups: [{
                DBSubnetGroupName: 'subnet-group',
                VpcId: 'vpc-123',
                Subnets: [
                    { SubnetIdentifier: 'subnet-a', SubnetAvailabilityZone: { Name: 'us-east-1a' }, SubnetStatus: 'Active' },
                    { SubnetIdentifier: 'subnet-b', SubnetAvailabilityZone: { Name: 'us-east-1b' }, SubnetStatus: 'Active' },
                ],
            }] });
        const controller = new AbortController();
        const clusters = await discoverRegion(record, credentials, 'us-east-1', controller.signal);
        expect(clusters.map((cluster) => cluster.name)).toEqual(['first', 'second']);
        expect(clusters[0]).toMatchObject({
            ownerCredentialId: record.id, port: 27017, endpoint: 'first.example',
            vpcInfo: {
                vpcId: 'vpc-123', subnetGroupName: 'subnet-group',
                subnets: [
                    { id: 'subnet-a', availabilityZone: 'us-east-1a', status: 'Active' },
                    { id: 'subnet-b', availabilityZone: 'us-east-1b', status: 'Active' },
                ],
                securityGroups: [{ id: 'sg-123', status: 'active' }],
                availabilityZones: ['us-east-1a', 'us-east-1b'], networkType: 'IPV4',
            },
        });
        expect(clusters[1].endpoint).toBeUndefined();
        expect(pages.mock.calls[0][2]).toEqual({ abortSignal: controller.signal });
        expect(describeSubnetGroup.mock.calls[0][0]).toMatchObject({
            input: { DBSubnetGroupName: 'subnet-group' },
        });
        expect(describeSubnetGroup.mock.calls[0][1]).toEqual({ abortSignal: controller.signal });
        expect(clientOptions).toHaveBeenCalledWith({ region: 'us-east-1', credentials, maxAttempts: 2 });
        expect(destroyed).toHaveBeenCalledTimes(1);
    });

    it('aborts between pages and always releases the client', async () => {
        const controller = new AbortController();
        pages.mockImplementation(async function* (): AsyncGenerator<unknown> {
            yield { DBClusters: [] };
            controller.abort();
            yield { DBClusters: [] };
        });

        await expect(discoverRegion(record, credentials, 'us-east-1', controller.signal))
            .rejects.toMatchObject({ name: 'AbortError' });
        expect(destroyed).toHaveBeenCalledTimes(1);
    });

    it('keeps cluster discovery available and exposes a sanitized message when subnet-group permission is missing', async () => {
        pages.mockImplementation(async function* (): AsyncGenerator<unknown> {
            yield { DBClusters: [{
                DBClusterArn: 'arn:first', DBClusterIdentifier: 'first', Engine: 'docdb',
                DBSubnetGroup: 'private-group',
            }] };
        });
        describeSubnetGroup.mockRejectedValue(Object.assign(new Error('secret request metadata'), { name: 'AccessDeniedException' }));
        const clusters = await discoverRegion(record, credentials, 'us-east-1');
        expect(clusters).toHaveLength(1);
        expect(clusters[0].vpcInfoError).toContain('AWS denied this operation');
        expect(clusters[0].vpcInfoError).not.toContain('secret request metadata');
    });

    it('does not make AWS calls for an already cancelled request', async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(discoverRegion(record, credentials, 'us-east-1', controller.signal))
            .rejects.toMatchObject({ name: 'AbortError' });
        expect(clientOptions).not.toHaveBeenCalled();
    });
});
