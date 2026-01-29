/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type BaseClusterModel } from '../../models/BaseClusterModel';

/**
 * Cluster model for Azure views (Discovery, Azure Resources, Workspace).
 * Includes Azure metadata from ARM API.
 *
 * NOTE: For Discovery View, treeId is sanitized (no '/'), but clusterId
 * keeps the full Azure Resource ID for cache lookups.
 *
 * For Azure Resources View, treeId === clusterId === Azure Resource ID (no sanitization).
 */
export interface AzureClusterModel extends BaseClusterModel {
    /**
     * Azure Resource ID (e.g., /subscriptions/xxx/resourceGroups/yyy/...)
     *
     * ⚠️ This is the original Azure ID with '/' characters.
     * For Discovery View treeId, this gets sanitized (replace '/' with '-').
     * For Azure Resources View, treeId === id (no sanitization needed).
     */
    id: string;

    /** Resource group name (extracted from Azure Resource ID) */
    resourceGroup?: string;

    /** Azure region */
    location?: string;

    /** Server version (e.g., "6.0") */
    serverVersion?: string;

    /**
     * System data from Azure, including creation timestamp.
     * Useful for displaying cluster age or sorting by creation date.
     */
    systemData?: {
        createdAt?: Date;
    };

    // Compute/capacity properties

    /** SKU/tier of the cluster (e.g., "M30", "Free") */
    sku?: string;

    /** Number of nodes in the cluster */
    nodeCount?: number;

    /** Disk size in GB */
    diskSize?: number;

    /** High availability enabled */
    enableHa?: boolean;

    // Additional Azure-specific properties can be added as needed
    // These match what's returned from the ARM API and stored in the legacy ClusterModel

    /** Cluster capabilities (comma-separated list of enabled features) */
    capabilities?: string;

    /** Administrator password (used during cluster operations, should NOT be persisted) */
    administratorLoginPassword?: string;
}

/**
 * Helper function to sanitize an Azure Resource ID for use as a treeId in Discovery View.
 *
 * The Discovery View has a nested tree structure where VS Code performs parent resolution
 * by splitting on '/'. Azure Resource IDs contain '/' characters which break this resolution.
 *
 * This function replaces '/' with '-' to create a safe treeId.
 *
 * @param azureResourceId The Azure Resource ID to sanitize
 * @returns A sanitized string safe for use as treeId in Discovery View
 */
export function sanitizeAzureResourceIdForTreeId(azureResourceId: string): string {
    return azureResourceId.replace(/\//g, '-');
}
