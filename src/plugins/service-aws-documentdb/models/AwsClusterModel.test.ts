/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';

import { type AwsCluster } from '../types';
import { awsClusterSuffix, createAwsClusterModel, isAwsClusterConnectable } from './AwsClusterModel';

const resource: AwsCluster = {
    id: 'resource-id',
    arn: 'arn:aws:rds:us-east-1:123456789012:cluster:example',
    accountId: '123456789012',
    region: 'us-east-1',
    name: 'example',
    port: 27017,
    endpoint: 'example.cluster-abc.us-east-1.docdb.amazonaws.com',
    status: 'available',
    ownerCredentialId: 'credential-1',
};

describe('AWS cluster identity', () => {
    it('uses the same slash-free cache identity in tree and list modes', () => {
        const tree = createAwsClusterModel(resource, 'discoveryView/aws-documentdb-discovery/123456789012/us-east-1');
        const list = createAwsClusterModel(resource, 'discoveryView/aws-documentdb-discovery');
        expect(tree.clusterId).toBe(list.clusterId);
        expect(tree.clusterId).not.toContain('/');
        expect(tree.treeId).not.toBe(list.treeId);
        expect(tree.treeId.endsWith(`/${awsClusterSuffix(resource)}`)).toBe(true);
        expect(list.treeId.endsWith(`/${awsClusterSuffix(resource)}`)).toBe(true);
        expect(tree.viewId).toBe('discoveryView');
    });

    it('ignores credential/session and display-name changes but distinguishes ARN resource identities', () => {
        expect(awsClusterSuffix({ ...resource, ownerCredentialId: 'other', name: 'renamed' })).toBe(
            awsClusterSuffix(resource),
        );
        for (const arn of [
            'arn:aws:rds:us-west-2:123456789012:cluster:example',
            'arn:aws:rds:us-east-1:999999999999:cluster:example',
            'arn:aws-cn:rds:us-east-1:123456789012:cluster:example',
            'arn:aws:rds:us-east-1:123456789012:cluster:other',
        ]) {
            expect(awsClusterSuffix({ ...resource, arn })).not.toBe(awsClusterSuffix(resource));
        }
    });

    it('only enables database expansion for available endpoints', () => {
        expect(isAwsClusterConnectable(resource)).toBe(true);
        expect(isAwsClusterConnectable({ ...resource, status: 'creating' })).toBe(false);
        expect(isAwsClusterConnectable({ ...resource, endpoint: undefined })).toBe(false);
    });
});
