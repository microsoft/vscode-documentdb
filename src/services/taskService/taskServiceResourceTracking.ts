/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Represents a resource that can be used by tasks.
 * Resources are hierarchical (connection > database > collection)
 * and all fields are optional to support partial matching.
 */
export interface ResourceDefinition {
    /**
     * The stable cluster identifier for resource tracking.
     * Use `cluster.clusterId` (NOT treeId) to ensure tasks remain valid after folder moves.
     *
     * - Connections View: storageId (UUID from ConnectionStorageService)
     * - Azure Resources View: Sanitized Azure Resource ID (/ replaced with _)
     */
    clusterId?: string;

    /**
     * The database name within the connection
     */
    databaseName?: string;

    /**
     * The collection name within the database
     */
    collectionName?: string;

    // Future extensibility: add more resource types as needed
}

/**
 * Interface that tasks can optionally implement to declare what resources they use.
 * This enables the task service to check for resource conflicts before operations.
 */
export interface ResourceTrackingTask {
    /**
     * Returns all resources currently being used by this task.
     * Should return an empty array if the task doesn't use trackable resources.
     *
     * @returns Array of resource definitions that this task is currently using
     */
    getUsedResources(): ResourceDefinition[];
}

/**
 * Information about a task that is using a resource
 */
export interface TaskInfo {
    /**
     * Unique identifier of the task
     */
    taskId: string;

    /**
     * Human-readable name of the task
     */
    taskName: string;

    /**
     * Type identifier of the task
     */
    taskType: string;
}

/**
 * Checks if a requested resource conflicts with a resource in use.
 * Returns true if there's a conflict (operation should be blocked).
 *
 * The conflict detection follows hierarchical rules:
 * - Deleting a connection affects all databases and collections in that connection
 * - Deleting a database affects all collections in that database
 * - Deleting a collection affects only that specific collection
 *
 * @param requestedResource The resource that is being requested for deletion/modification
 * @param usedResource A resource that is currently in use by a task
 * @returns true if there's a conflict, false otherwise
 */
export function hasResourceConflict(requestedResource: ResourceDefinition, usedResource: ResourceDefinition): boolean {
    // Must have cluster IDs to compare
    if (!requestedResource.clusterId || !usedResource.clusterId) {
        return false;
    }

    // Different clusters never conflict
    if (requestedResource.clusterId !== usedResource.clusterId) {
        return false;
    }

    // Same connection - now check hierarchical conflicts
    return isHierarchicalConflict(requestedResource, usedResource);
}

/**
 * Checks for hierarchical conflicts between two resources in the same connection.
 * The hierarchy is: connection > database > collection
 */
function isHierarchicalConflict(requestedResource: ResourceDefinition, usedResource: ResourceDefinition): boolean {
    // If requesting connection-level operation (no database specified)
    if (!requestedResource.databaseName) {
        return true; // Affects everything in this connection
    }

    // If used resource has no database, it can't conflict with database/collection operations
    if (!usedResource.databaseName) {
        return false;
    }

    // Different databases don't conflict
    if (requestedResource.databaseName !== usedResource.databaseName) {
        return false;
    }

    // Same database - check collection level
    return isCollectionLevelConflict(requestedResource, usedResource);
}

/**
 * Checks for collection-level conflicts between two resources in the same database.
 */
function isCollectionLevelConflict(requestedResource: ResourceDefinition, usedResource: ResourceDefinition): boolean {
    // If requesting database-level operation (no collection specified)
    if (!requestedResource.collectionName) {
        return true; // Affects everything in this database
    }

    // If used resource has no collection, it can't conflict with collection operations
    if (!usedResource.collectionName) {
        return false;
    }

    // Both specify collections - conflict only if they're the same
    return requestedResource.collectionName === usedResource.collectionName;
}
