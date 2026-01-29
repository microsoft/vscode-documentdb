/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Experience } from '../../DocumentDBExperiences';

/**
 * Minimal interface for any MongoDB/DocumentDB cluster.
 * This is what the core extension needs to connect and display a cluster.
 *
 * NOTE: Authentication is intentionally NOT part of this model.
 * Auth info is stored separately in ConnectionStorageService (persistent)
 * and CredentialCache (runtime) for security and flexibility.
 */
export interface BaseClusterModel {
    /** Display name shown in the tree */
    name: string;

    /**
     * Connection string (does NOT contain credentials - those are in auth configs).
     * Can be undefined for clusters where connection info hasn't been retrieved yet.
     */
    connectionString?: string;

    /** API type - determines behavior and icons */
    dbExperience: Experience;

    /**
     * Hierarchical path for VS Code TreeView navigation.
     *
     * ⚠️ IMPORTANT: This ID changes when the item moves between folders.
     * Do NOT use for caching - use `clusterId` instead.
     *
     * Construction rules (from PR #472):
     * - Connections View: `${parentId}/${storageId}` (hierarchical)
     * - Discovery View: `sanitize(azureResourceId)` - replace '/' with '-'
     * - Azure Resources View: `azureResourceId` (unchanged, flat tree)
     */
    treeId: string;

    /**
     * Stable identifier for credential and client caching.
     *
     * ⚠️ IMPORTANT: Always use this for CredentialCache and ClustersClient lookups.
     *
     * Values:
     * - Connections View: `storageId` (UUID from ConnectionStorageService)
     * - Discovery View: Azure Resource ID (with '/' characters, NOT sanitized)
     * - Azure Resources View: Azure Resource ID (same as treeId in this case)
     */
    clusterId: string;

    /**
     * Identifies which tree view this cluster belongs to.
     *
     * This is critical for webviews that need to find the tree node later (e.g., for
     * import/export operations). The same clusterId (Azure Resource ID) can appear in
     * multiple views (Discovery View, Azure Resources View, Workspace View), so we need
     * to know which view's branch data provider to query.
     *
     * @see Views enum for possible values
     */
    viewId?: string;
}

/**
 * Helper type for tree context - used when creating cluster tree items.
 */
export interface ClusterTreeContext {
    treeId: string;
    clusterId: string;
    viewId: string;
}

/**
 * A cluster that's ready to be displayed in a tree.
 * This ensures the cluster has all required tree navigation properties.
 */
export type TreeCluster<T extends BaseClusterModel = BaseClusterModel> = T & ClusterTreeContext;
