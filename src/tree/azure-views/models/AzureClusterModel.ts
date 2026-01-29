/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type BaseClusterModel } from '../../models/BaseClusterModel';

/**
 * Cluster model for Azure views (Discovery, Azure Resources, Workspace).
 * Includes Azure metadata from ARM API.
 *
 * NOTE: For Azure views, clusterId is SANITIZED (no '/' characters).
 * The original Azure Resource ID is preserved in the `id` property for ARM API correlation.
 */
export interface AzureClusterModel extends BaseClusterModel {
    /**
     * Azure Resource ID (e.g., /subscriptions/xxx/resourceGroups/yyy/...)
     *
     * ⚠️ This is the ORIGINAL Azure ID with '/' characters.
     * Use this when correlating with Azure ARM APIs.
     *
     * For caching/client lookups, use `clusterId` instead (sanitized, no '/').
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
 * Sanitizes an Azure Resource ID for use as clusterId and treeId.
 *
 * Azure Resource IDs contain '/' characters which:
 * 1. Break VS Code tree parent resolution (splits on '/')
 * 2. Make cache key handling inconsistent
 *
 * This function replaces '/' with '_' to create a safe identifier.
 * Used for BOTH clusterId and treeId in Azure views.
 *
 * @param azureResourceId The Azure Resource ID to sanitize
 * @returns A sanitized string safe for use as clusterId and treeId
 */
export function sanitizeAzureResourceIdForTreeId(azureResourceId: string): string {
    return azureResourceId.replace(/\//g, '_');
}
