/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Represents a resource that can be used by tasks.
 * Resources are hierarchical (connection > database > collection > document)
 * and all fields are optional to support partial matching.
 */
export interface ResourceDefinition {
    /**
     * The connection identifier
     */
    connectionId?: string;

    /**
     * The database name within the connection
     */
    databaseName?: string;

    /**
     * The collection name within the database
     */
    collectionName?: string;

    /**
     * Optional document identifier within the collection
     */
    documentId?: string;

    /**
     * Optional file name for file-based operations
     */
    fileName?: string;

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
export interface TaskResourceInfo {
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
 * Result of checking resource usage
 */
export interface ResourceUsageResult {
    /**
     * Whether there are any conflicts with the requested resource
     */
    hasConflicts: boolean;

    /**
     * List of tasks that are conflicting with the requested resource
     */
    conflictingTasks: TaskResourceInfo[];
}

/**
 * Information about all resources used by a specific task
 */
export interface TaskResourceUsage {
    /**
     * Task information
     */
    task: TaskResourceInfo;

    /**
     * Resources being used by this task
     */
    resources: ResourceDefinition[];
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
    // If no connection ID specified in either, no conflict can be determined
    if (!requestedResource.connectionId || !usedResource.connectionId) {
        return false;
    }

    // Different connections never conflict
    if (requestedResource.connectionId !== usedResource.connectionId) {
        return false;
    }

    // If requesting to delete/modify a connection (no database specified),
    // check if any task uses that connection
    if (!requestedResource.databaseName) {
        return true; // Any use of this connection is a conflict
    }

    // If used resource doesn't specify a database, no conflict
    if (!usedResource.databaseName) {
        return false;
    }

    // Different databases in same connection don't conflict
    if (requestedResource.databaseName !== usedResource.databaseName) {
        return false;
    }

    // If requesting to delete/modify a database (no collection specified),
    // check if any task uses that database
    if (!requestedResource.collectionName) {
        return true; // Any use of this database is a conflict
    }

    // If used resource doesn't specify a collection, no conflict
    if (!usedResource.collectionName) {
        return false;
    }

    // Check for exact collection match
    if (requestedResource.collectionName !== usedResource.collectionName) {
        return false;
    }

    // Same connection, database, and collection - this is a conflict
    return true;
}
