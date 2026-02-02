/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type TreeElement } from '../TreeElement';
import { type BaseClusterModel, type TreeCluster } from '../models/BaseClusterModel';

/**
 * Context value prefix that identifies cluster items (ClusterItemBase and its subclasses).
 * This distinguishes actual cluster tree items from descendant items (databases, collections)
 * that merely reference the cluster.
 */
const CLUSTER_ITEM_CONTEXT_VALUE = 'treeItem_documentdbcluster';

/**
 * Interface for tree elements that ARE cluster items (not just elements that reference a cluster).
 * Used by the Discovery branch data provider to identify items that need
 * clusterId augmentation.
 */
export interface ClusterTreeElement extends TreeElement {
    cluster: TreeCluster<BaseClusterModel>;
    contextValue: string;
}

/**
 * Type guard to check if a tree element is a cluster item that needs ID augmentation.
 *
 * This identifies actual cluster items (extending ClusterItemBase) by checking:
 * 1. The element has a `cluster` property with a `clusterId`
 * 2. The element's `contextValue` contains 'treeItem_documentdbcluster'
 *
 * This distinguishes cluster items from descendant items (databases, collections, indexes)
 * that also have a `cluster` property but should NOT have their cluster ID augmented.
 *
 * @param element The tree element to check
 * @returns True if the element is a cluster item that needs clusterId augmentation
 */
export function isClusterTreeElement(element: TreeElement): element is ClusterTreeElement {
    return (
        element !== null &&
        typeof element === 'object' &&
        'cluster' in element &&
        element.cluster !== null &&
        typeof element.cluster === 'object' &&
        'clusterId' in element.cluster &&
        typeof element.cluster.clusterId === 'string' &&
        'contextValue' in element &&
        typeof element.contextValue === 'string' &&
        element.contextValue.toLowerCase().includes(CLUSTER_ITEM_CONTEXT_VALUE.toLowerCase())
    );
}
