/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'crypto';
import { DocumentDBExperience } from '../../../DocumentDBExperiences';
import { Views } from '../../../documentdb/Views';
import { type BaseClusterModel, type TreeCluster } from '../../../tree/models/BaseClusterModel';
import { AWS_DISCOVERY_PROVIDER_ID } from '../config';
import { type AwsCluster } from '../types';

export interface AwsClusterModel extends BaseClusterModel {
    readonly resource: AwsCluster;
}

export function awsClusterSuffix(resource: AwsCluster): string {
    // Include a source marker even in the suffix: the shared lookup searches all cached providers.
    return `aws-${createHash('sha256').update(resource.arn).digest('hex')}`;
}

export function isAwsClusterConnectable(resource: AwsCluster): boolean {
    return resource.status === 'available' && !!resource.endpoint;
}

export function createAwsClusterModel(resource: AwsCluster, parentId: string): TreeCluster<AwsClusterModel> {
    const suffix = awsClusterSuffix(resource);
    return {
        name: resource.name,
        resource,
        dbExperience: DocumentDBExperience,
        clusterId: `${AWS_DISCOVERY_PROVIDER_ID}_${suffix}`,
        treeId: `${parentId}/${suffix}`,
        viewId: Views.DiscoveryView,
    };
}
