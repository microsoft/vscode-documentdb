/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Experience } from '../../DocumentDBExperiences';

/**
 * Core cluster data - intrinsic properties of a cluster.
 * This is what gets stored and passed around.
 *
 * NOTE: treeId and viewId are NOT here - they are tree positioning concerns,
 * computed at runtime when building tree items. See {@link ClusterTreeContext}.
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
     * Stable identifier for credential and client caching.
     *
     * ⚠️ IMPORTANT: Always use this for CredentialCache and ClustersClient lookups.
     * ⚠️ CONSTRAINT: Must NOT contain '/' characters (enforced by architecture).
     *
     * Values:
     * - Connections View: `storageId` (UUID from ConnectionStorageService)
     * - Discovery/Azure Views: Sanitized Azure Resource ID (no '/' - replaced with '_')
     */
    clusterId: string;
}

/**
 * Tree positioning context - computed at runtime when building tree items.
 *
 * This is separate from BaseClusterModel because:
 * 1. treeId is computed from parent path + clusterId (not stored)
 * 2. Same cluster data can appear in different views with different treeIds
 * 3. Storage layer should not know about tree paths
 */
export interface ClusterTreeContext {
    /**
     * Hierarchical VS Code tree element ID.
     *
     * ⚠️ IMPORTANT: This changes when item moves between folders.
     * Do NOT use for caching - use cluster.clusterId instead.
     *
     * Construction rules:
     * - Connections View: `${parentId}/${storageId}` (hierarchical)
     * - Discovery/Azure Views: Same as clusterId (sanitized Azure Resource ID with '_' instead of '/')
     */
    treeId: string;

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
    viewId: string;
}

/**
 * A cluster ready for tree display - has both data and positioning.
 * Use this type for tree items that need both cluster data and tree context.
 *
 * This combines the intrinsic cluster data (BaseClusterModel) with the
 * computed tree positioning (ClusterTreeContext).
 */
export type TreeCluster<T extends BaseClusterModel = BaseClusterModel> = T & ClusterTreeContext;
