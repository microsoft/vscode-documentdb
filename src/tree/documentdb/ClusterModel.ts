/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AzureClusterModel } from '../azure-views/models/AzureClusterModel';
import { type ConnectionClusterModel } from '../connections-view/models/ConnectionClusterModel';
import { type TreeCluster } from '../models/BaseClusterModel';

/**
 * @deprecated Use `ConnectionClusterModel` or `AzureClusterModel` directly.
 *
 * This type is kept for backward compatibility during migration.
 * It represents a cluster that's ready for tree display (has both data and tree context).
 *
 * Migration guide:
 * - For Connections View: Use `TreeCluster<ConnectionClusterModel>`
 * - For Azure/Discovery Views: Use `TreeCluster<AzureClusterModel>`
 * - For generic tree items that work with both: Use `TreeCluster<BaseClusterModel>`
 *
 * The new types provide better type safety:
 * - `ConnectionClusterModel` has `storageId` and `emulatorConfiguration`
 * - `AzureClusterModel` has `id` (Azure Resource ID), `resourceGroup`, `location`, etc.
 */
export type ClusterModel = TreeCluster<ConnectionClusterModel> | TreeCluster<AzureClusterModel>;
