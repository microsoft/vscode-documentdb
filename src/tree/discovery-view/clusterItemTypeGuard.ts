/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type TreeElement } from '../TreeElement';
import { type BaseClusterModel, type TreeCluster } from '../models/BaseClusterModel';

/**
 * Interface for tree elements that contain cluster data.
 * Used by the Discovery branch data provider to identify items that need
 * clusterId augmentation.
 */
export interface ClusterTreeElement extends TreeElement {
    cluster: TreeCluster<BaseClusterModel>;
}

/**
 * Type guard to check if a tree element contains cluster data.
 *
 * This is used by DiscoveryBranchDataProvider to identify which child elements
 * need their clusterId augmented with the provider prefix.
 *
 * @param element The tree element to check
 * @returns True if the element has a cluster property with a clusterId
 */
export function isClusterTreeElement(element: TreeElement): element is ClusterTreeElement {
    return (
        element !== null &&
        typeof element === 'object' &&
        'cluster' in element &&
        element.cluster !== null &&
        typeof element.cluster === 'object' &&
        'clusterId' in element.cluster &&
        typeof element.cluster.clusterId === 'string'
    );
}
