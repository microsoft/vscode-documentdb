/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { apiUtils, callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { type EntraIdAuthConfig, type NativeAuthConfig } from '../documentdb/auth/AuthConfig';
import { AuthMethodId } from '../documentdb/auth/AuthMethod';
import { DocumentDBConnectionString } from '../documentdb/utils/DocumentDBConnectionString';
import { API } from '../DocumentDBExperiences';
import { isVCoreAndRURolloutEnabled } from '../extension';
import { ext } from '../extensionVariables';
import { StorageNames, StorageService, type Storage, type StorageItem } from './storageService';

/**
 * API for migrating MongoDB cluster connections from Azure Databases extension
 */
interface MongoConnectionMigrationApi {
    apiVersion: string;
    exportMongoClusterConnections(context: vscode.ExtensionContext): Promise<unknown[] | undefined>;
    renameMongoClusterConnectionStorageId(
        context: vscode.ExtensionContext,
        oldId: string,
        newId: string,
    ): Promise<boolean>;
}

/**
 * Storage zones represent the top-level groupings in the connections view.
 * Each zone stores items (connections and folders) independently.
 *
 * @remarks Renamed from ConnectionType for clarity - zones are not connection types,
 * they are storage partitions.
 */
export enum StorageZone {
    Clusters = 'clusters',
    Emulators = 'emulators',
}

/**
 * @deprecated Use `StorageZone` instead. This alias exists for backward compatibility.
 */
export const ConnectionType = StorageZone;
/**
 * @deprecated Use `StorageZone` instead. This type alias exists for backward compatibility.
 */
export type ConnectionType = StorageZone;

/**
 * Item type discriminator for unified storage
 */
export enum ItemType {
    Connection = 'connection',
    Folder = 'folder',
}

/**
 * Known storage format versions that this code can handle.
 * Used to skip items with unknown future versions during loading.
 */
const KNOWN_STORAGE_VERSIONS = new Set(['1.0', '2.0', '3.0', undefined]);

/**
 * Placeholder connection string used for folder items.
 * This ensures backward compatibility with older extension versions that expect
 * all items to have a connection string. Older versions will see folders as
 * invalid connections rather than crashing.
 *
 * @internal This is an implementation detail - use `saveFolder()` instead of manually
 * constructing folder items with this placeholder.
 */
export const FOLDER_PLACEHOLDER_CONNECTION_STRING = 'mongodb://folder-item-placeholder';

// ============================================================================
// Folder Types (clean, minimal interface for organizational items)
// ============================================================================

/**
 * Input data for creating or updating a folder.
 * This is the minimal interface consumers need to work with folders.
 */
export interface FolderItemInput {
    id: string;
    name: string;
    parentId?: string; // Parent folder ID for hierarchy (undefined = root level)
}

/**
 * Properties specific to folder items in storage.
 */
export interface FolderProperties extends Record<string, unknown> {
    type: ItemType.Folder;
    parentId?: string;
    api: API;
    availableAuthMethods: string[];
}

// ============================================================================
// Connection Types (full interface for database connections)
// ============================================================================

/**
 * Properties for connection items (database connections).
 */
export interface ConnectionProperties extends Record<string, unknown> {
    type: ItemType.Connection;
    parentId?: string; // Parent folder ID for hierarchy (undefined = root level)
    api: API;
    emulatorConfiguration?: {
        /**
         * Indicates if the connection is to an emulator.
         */
        isEmulator: boolean;

        /**
         * Indicates if the emulator security should be disabled.
         */
        disableEmulatorSecurity: boolean;
    };
    availableAuthMethods: string[];
    selectedAuthMethod?: string; // Not using our `AuthMethod` here on purpose as it might change over time
}

/**
 * Secrets for connection items.
 */
export interface ConnectionSecrets {
    /** assume that the connection string doesn't contain the username and password */
    connectionString: string;

    // Structured authentication configurations
    nativeAuthConfig?: NativeAuthConfig;
    entraIdAuthConfig?: EntraIdAuthConfig;
}

/**
 * Input data for creating or updating a connection.
 * This is the interface consumers use when saving connections.
 */
export interface ConnectionItemInput {
    id: string;
    name: string;
    properties: ConnectionProperties;
    secrets: ConnectionSecrets;
}

// ============================================================================
// Unified Types (for loading/reading - discriminated union)
// ============================================================================

/**
 * Union type that covers both folder and connection properties.
 * Use the `type` field to discriminate between the two.
 */
export type StoredItemProperties = FolderProperties | ConnectionProperties;

/**
 * Represents a stored item (connection or folder) as returned from storage.
 * Use the `properties.type` field to discriminate between item types.
 *
 * @note For code maintainers: The `version` field from the underlying `StorageItem` is intentionally
 * omitted from this interface. The `ConnectionStorageService` handles versioning and migration
 * internally, simplifying the logic for consumers of this service.
 *
 * @example
 * ```typescript
 * const item = await ConnectionStorageService.get(id, zone);
 * if (item?.properties.type === ItemType.Folder) {
 *     // TypeScript knows this is a folder
 *     console.log(item.name);
 * } else if (item?.properties.type === ItemType.Connection) {
 *     // TypeScript knows this has connection properties
 *     console.log(item.secrets.connectionString);
 * }
 * ```
 */
export interface StoredItem {
    id: string;
    name: string;
    properties: StoredItemProperties;
    secrets: {
        /** For connections: the actual connection string. For folders: placeholder value. */
        connectionString: string;
        nativeAuthConfig?: NativeAuthConfig;
        entraIdAuthConfig?: EntraIdAuthConfig;
    };
}

/**
 * Type guard to check if a stored item is a connection.
 * Use this to safely access connection-specific properties.
 *
 * @example
 * ```typescript
 * const item = await ConnectionStorageService.get(id, zone);
 * if (item && isConnection(item)) {
 *     // TypeScript knows item.properties has connection fields
 *     console.log(item.properties.selectedAuthMethod);
 * }
 * ```
 */
export function isConnection(item: StoredItem): item is StoredItem & { properties: ConnectionProperties } {
    return item.properties.type === ItemType.Connection;
}

/**
 * Type guard to check if a stored item is a folder.
 */
export function isFolder(item: StoredItem): item is StoredItem & { properties: FolderProperties } {
    return item.properties.type === ItemType.Folder;
}

/**
 * @deprecated Use `StoredItem` for reading and `ConnectionItemInput`/`FolderItemInput` for writing.
 * This alias exists for backward compatibility during migration.
 */
export type ConnectionItem = StoredItem;

/**
 * StorageService offers secrets storage as a string[] so we need to ensure
 * we keep using correct indexes when accessing secrets.
 *
 * Auth config fields are stored individually as flat string values to avoid
 * nested object serialization issues with VS Code SecretStorage.
 */
const enum SecretIndex {
    ConnectionString = 0,
    // Native auth config fields (consolidated from legacy UserName/Password)
    NativeAuthConnectionUser = 1,
    NativeAuthConnectionPassword = 2,
    // Entra ID auth config fields
    EntraIdTenantId = 3,
    EntraIdSubscriptionId = 4,
}

/**
 * This service is a wrapper around the generic `StorageService`. It was introduced to support
 * a more complex connection properties interface, which became necessary with the addition of new
 * authentication methods.
 *
 * Instead of making the original `StorageItem` more complex with numerous optional fields,
 * we introduced a "version" field to `StorageItem`. This service handles the versioning
 * internally, upgrading stored items on the fly as they are accessed.
 *
 * The primary benefit is that consumers of this service receive a type-safe `ConnectionItem`,
 * which is easier and safer to work with throughout the codebase, abstracting away the
 * underlying storage and migration complexity.
 */
export class ConnectionStorageService {
    private static readonly MIGRATION_FROM_AZUREDATABASES_ATTEMPTS_KEY =
        'ConnectionStorageService.migrationAttemptsFromAzureDatabases';

    // Lazily-initialized underlying storage instance. We must not call StorageService.get
    // at module-load time because `ext.context` may not be available until the extension
    // is activated. Create the Storage on first access instead.
    private static _storageService: Storage | undefined;

    private static async getStorageService(): Promise<Storage> {
        if (!this._storageService) {
            this._storageService = StorageService.get(StorageNames.Connections);

            if (await isVCoreAndRURolloutEnabled()) {
                try {
                    // Trigger migration on first access, but only if we haven't reached the attempt limit
                    const migrationAttempts = ext.context.globalState.get<number>(
                        this.MIGRATION_FROM_AZUREDATABASES_ATTEMPTS_KEY,
                        0,
                    );

                    if (migrationAttempts < 20) {
                        // this is a good number as any, just keep trying for a while to account for failures
                        await this.migrateFromAzureDatabases();
                    }
                } catch (error) {
                    // Migration is optional - output error for debugging but don't break storage service initialization
                    console.debug(
                        'Optional migration check failed:',
                        error instanceof Error ? error.message : String(error),
                    );
                }
            }

            // Resolve critical post-migration errors before proceeding
            await this.resolvePostMigrationErrors();

            // Collect storage stats after cleanup completes
            await this.collectStorageStats();
        }
        return this._storageService;
    }

    /**
     * Fixes existing folder items that were created without the placeholder connection string.
     * This is needed for backward compatibility with older extension versions that expect
     * all items to have a connection string.
     *
     * This function is intended for beta testers who created folders before this fix was added.
     * It runs once during cleanup and updates folders that have an empty connection string.
     */
    private static async fixFolderConnectionStrings(context: IActionContext): Promise<void> {
        let foldersFixed = 0;

        for (const connectionType of [ConnectionType.Clusters, ConnectionType.Emulators]) {
            const storageService = await this.getStorageService();
            const items = await storageService.getItems<StoredItemProperties>(connectionType);

            // Find folders without the placeholder connection string
            // (items created before this fix will have empty string or undefined)
            const foldersToFix = items.filter(
                (item) =>
                    KNOWN_STORAGE_VERSIONS.has(item.version) &&
                    item.properties?.type === ItemType.Folder &&
                    (!item.secrets?.[SecretIndex.ConnectionString] ||
                        item.secrets[SecretIndex.ConnectionString] === ''),
            );

            for (const folder of foldersToFix) {
                try {
                    // Convert to ConnectionItem (triggers migration if needed)
                    const connectionItem = this.fromStorageItem(folder);

                    // Re-save to apply the placeholder connection string
                    // toStorageItem will automatically add FOLDER_PLACEHOLDER_CONNECTION_STRING for folders
                    await this.save(connectionType, connectionItem, true);
                    foldersFixed++;

                    ext.outputChannel.appendLog(
                        `Fixed folder "${folder.name}" (id: ${folder.id}) - added placeholder connection string for backward compatibility.`,
                    );
                } catch (error) {
                    console.debug(
                        `Failed to fix folder ${folder.id}:`,
                        error instanceof Error ? error.message : String(error),
                    );
                }
            }
        }

        context.telemetry.measurements.foldersFixed = foldersFixed;
        if (foldersFixed > 0) {
            ext.outputChannel.appendLog(
                `Fixed ${foldersFixed} folder(s) with placeholder connection string for backward compatibility.`,
            );
        }
    }

    /**
     * Cleans up connection strings with duplicate query parameters.
     * This can happen due to bugs in previous versions where parameters were doubled
     * during migration or editing.
     *
     * @param context - The action context for telemetry
     */
    private static async cleanupDuplicateConnectionStringParameters(context: IActionContext): Promise<void> {
        let connectionsFixed = 0;

        for (const connectionType of [ConnectionType.Clusters, ConnectionType.Emulators]) {
            const storageService = await this.getStorageService();
            const items = await storageService.getItems<StoredItemProperties>(connectionType);

            // Find connections (not folders) that might have duplicate parameters
            const connectionsToCheck = items.filter(
                (item) =>
                    KNOWN_STORAGE_VERSIONS.has(item.version) &&
                    item.properties?.type === ItemType.Connection &&
                    item.secrets?.[SecretIndex.ConnectionString],
            );

            for (const item of connectionsToCheck) {
                try {
                    const connectionString = item.secrets?.[SecretIndex.ConnectionString] ?? '';

                    // Skip placeholder or empty connection strings
                    if (!connectionString || connectionString === FOLDER_PLACEHOLDER_CONNECTION_STRING) {
                        continue;
                    }

                    // Check if the connection string has duplicate parameters
                    const parsed = new DocumentDBConnectionString(connectionString);
                    if (!parsed.hasDuplicateParameters()) {
                        continue;
                    }

                    // Normalize the connection string to remove duplicates
                    const normalizedConnectionString = parsed.deduplicateQueryParameters();

                    // Only update if something changed
                    if (normalizedConnectionString !== connectionString) {
                        // Convert to ConnectionItem and update the connection string
                        const connectionItem = this.fromStorageItem(item);
                        connectionItem.secrets.connectionString = normalizedConnectionString;

                        // Re-save with the cleaned connection string
                        await this.save(connectionType, connectionItem, true);
                        connectionsFixed++;

                        ext.outputChannel.appendLog(
                            `Fixed connection "${item.name}" (id: ${item.id}) - removed duplicate query parameters.`,
                        );
                    }
                } catch (error) {
                    console.debug(
                        `Failed to check/fix connection ${item.id} for duplicate parameters:`,
                        error instanceof Error ? error.message : String(error),
                    );
                }
            }
        }

        context.telemetry.measurements.duplicateParamsFixed = connectionsFixed;
        if (connectionsFixed > 0) {
            ext.outputChannel.appendLog(`Fixed ${connectionsFixed} connection(s) with duplicate query parameters.`);
        }
    }

    /**
     * Resolves post-migration errors and inconsistencies.
     *
     * Order matters:
     * 1. Fix folder connection strings for backward compatibility
     * 2. Deduplicate connection string parameters
     * 3. Clean up orphaned items
     */
    private static async resolvePostMigrationErrors(): Promise<void> {
        await callWithTelemetryAndErrorHandling('resolvePostMigrationErrors', async (context: IActionContext) => {
            context.telemetry.properties.isActivationEvent = 'true';

            // 1. Fix any existing folders that don't have the placeholder connection string
            // This ensures backward compatibility for beta testers who created folders before this fix
            await this.fixFolderConnectionStrings(context);

            // 2. Clean up any connection strings with duplicate query parameters
            // This fixes corruption from previous bugs in migration or editing
            await this.cleanupDuplicateConnectionStringParameters(context);

            // 3. Clean up orphaned items after folder and connection string fixes (fire-and-forget)
            void this.cleanupOrphanedItems();
        });
    }

    /**
     * Cleans up orphaned items (items whose parentId references a non-existent folder).
     * This can happen if a folder deletion fails to cascade to children.
     * Runs iteratively until no orphans remain (deleting a parent may orphan its children).
     */
    private static async cleanupOrphanedItems(): Promise<void> {
        await callWithTelemetryAndErrorHandling('cleanupOrphanedItems', async (context: IActionContext) => {
            context.telemetry.properties.isActivationEvent = 'true';
            let totalOrphansRemoved = 0;
            let iteration = 0;
            const maxIterations = 20; // Safety net to prevent infinite loops
            let previousIterationCount = -1;
            let consecutiveSameCount = 0;
            const maxConsecutiveSameCount = 5; // Require 5 consecutive same counts before aborting
            let terminationReason: 'complete' | 'maxIterations' | 'consecutiveSameCount' = 'complete';

            // Keep iterating until no orphans are found or we hit safety limits
            while (iteration < maxIterations) {
                iteration++;
                let orphansRemovedThisIteration = 0;

                for (const connectionType of [ConnectionType.Clusters, ConnectionType.Emulators]) {
                    const allItems = await this.getAllItems(connectionType);
                    const allIds = new Set(allItems.map((item) => item.id));

                    // Build set of valid parent IDs (only folders can be parents)
                    const validParentIds = new Set(
                        allItems.filter((item) => item.properties.type === ItemType.Folder).map((item) => item.id),
                    );

                    // Find orphaned items:
                    // 1. Items with a parentId that doesn't exist
                    // 2. Items with a parentId pointing to a non-folder (bug - parentId should only reference folders)
                    const orphanedItems = allItems.filter(
                        (item) =>
                            item.properties.parentId !== undefined &&
                            (!allIds.has(item.properties.parentId) || !validParentIds.has(item.properties.parentId)),
                    );

                    for (const orphan of orphanedItems) {
                        try {
                            await this.delete(connectionType, orphan.id);
                            orphansRemovedThisIteration++;
                            ext.outputChannel.appendLog(
                                `Cleaned up orphaned ${orphan.properties.type}: "${orphan.name}" (id: ${orphan.id})`,
                            );
                        } catch (error) {
                            console.debug(
                                `Failed to delete orphaned item ${orphan.id}:`,
                                error instanceof Error ? error.message : String(error),
                            );
                        }
                    }
                }

                totalOrphansRemoved += orphansRemovedThisIteration;

                // Exit if no orphans found this iteration (success)
                if (orphansRemovedThisIteration === 0) {
                    terminationReason = 'complete';
                    break;
                }

                // Track consecutive iterations with the same count
                if (orphansRemovedThisIteration === previousIterationCount) {
                    consecutiveSameCount++;
                    if (consecutiveSameCount >= maxConsecutiveSameCount) {
                        terminationReason = 'consecutiveSameCount';
                        ext.outputChannel.appendLog(
                            `Orphan cleanup stopped: same count (${orphansRemovedThisIteration}) for ${consecutiveSameCount} consecutive iterations.`,
                        );
                        break;
                    }
                } else {
                    consecutiveSameCount = 0; // Reset counter on different count
                }

                previousIterationCount = orphansRemovedThisIteration;
            }

            // Check if we exited due to max iterations
            if (iteration >= maxIterations && terminationReason === 'complete') {
                terminationReason = 'maxIterations';
                ext.outputChannel.appendLog(`Orphan cleanup stopped: reached maximum iterations (${maxIterations}).`);
            }

            context.telemetry.measurements.orphansRemoved = totalOrphansRemoved;
            context.telemetry.measurements.cleanupIterations = iteration;
            context.telemetry.properties.hadOrphans = totalOrphansRemoved > 0 ? 'true' : 'false';
            context.telemetry.properties.terminationReason = terminationReason;

            if (totalOrphansRemoved > 0) {
                ext.outputChannel.appendLog(
                    `Orphan cleanup complete: ${totalOrphansRemoved} items removed in ${iteration} iteration(s).`,
                );
            }
        });
    }

    /**
     * Collects and reports storage statistics via telemetry.
     * This runs asynchronously after orphan cleanup and provides insights into:
     * - Total connections and folders across all zones
     * - Maximum folder nesting depth
     * - Distribution between Clusters and Emulators zones
     */
    private static async collectStorageStats(): Promise<void> {
        await callWithTelemetryAndErrorHandling('connectionStorage.stats', async (context: IActionContext) => {
            context.telemetry.properties.isActivationEvent = 'true';

            let totalConnections = 0;
            let totalFolders = 0;
            let maxDepth = 0;

            // Calculate depth of an item by traversing up the parent chain
            const calculateDepth = async (
                item: ConnectionItem,
                allItems: Map<string, ConnectionItem>,
                depthCache: Map<string, number>,
            ): Promise<number> => {
                // Check cache first
                const cachedDepth = depthCache.get(item.id);
                if (cachedDepth !== undefined) {
                    return cachedDepth;
                }

                if (!item.properties.parentId) {
                    depthCache.set(item.id, 1);
                    return 1; // Root level = depth 1
                }

                const parent = allItems.get(item.properties.parentId);
                if (!parent) {
                    depthCache.set(item.id, 1);
                    return 1; // Orphaned item, treat as root
                }

                const parentDepth = await calculateDepth(parent, allItems, depthCache);
                const depth = parentDepth + 1;
                depthCache.set(item.id, depth);
                return depth;
            };

            for (const connectionType of [ConnectionType.Clusters, ConnectionType.Emulators]) {
                const allItems = await this.getAllItems(connectionType);

                // Create a map for efficient parent lookup
                const itemMap = new Map(allItems.map((item) => [item.id, item]));
                const depthCache = new Map<string, number>();

                let connectionsInZone = 0;
                let foldersInZone = 0;
                let rootConnectionsInZone = 0;
                let rootFoldersInZone = 0;
                let maxDepthInZone = 0;

                for (const item of allItems) {
                    const isRootLevel = !item.properties.parentId;

                    if (item.properties.type === ItemType.Connection) {
                        connectionsInZone++;
                        if (isRootLevel) {
                            rootConnectionsInZone++;
                        }
                    } else if (item.properties.type === ItemType.Folder) {
                        foldersInZone++;
                        if (isRootLevel) {
                            rootFoldersInZone++;
                        }
                        // Calculate depth for folders to find max nesting
                        const depth = await calculateDepth(item, itemMap, depthCache);
                        maxDepthInZone = Math.max(maxDepthInZone, depth);
                    }
                }

                // Zone-specific measurements
                const zonePrefix = connectionType === ConnectionType.Clusters ? 'clusters' : 'emulators';
                context.telemetry.measurements[`${zonePrefix}_Connections`] = connectionsInZone;
                context.telemetry.measurements[`${zonePrefix}_Folders`] = foldersInZone;
                context.telemetry.measurements[`${zonePrefix}_RootConnections`] = rootConnectionsInZone;
                context.telemetry.measurements[`${zonePrefix}_RootFolders`] = rootFoldersInZone;
                context.telemetry.measurements[`${zonePrefix}_MaxDepth`] = maxDepthInZone;
                totalConnections += connectionsInZone;
                totalFolders += foldersInZone;
                maxDepth = Math.max(maxDepth, maxDepthInZone);
            }

            // Aggregate measurements
            context.telemetry.measurements.totalConnections = totalConnections;
            context.telemetry.measurements.totalFolders = totalFolders;
            context.telemetry.measurements.maxFolderDepth = maxDepth;
            context.telemetry.properties.hasFolders = totalFolders > 0 ? 'true' : 'false';
            context.telemetry.properties.hasConnections = totalConnections > 0 ? 'true' : 'false';
        });
    }

    /**
     * Gets all connection items of a given connection type (excludes folders).
     * @param connectionType The type of connection storage (Clusters or Emulators)
     */
    public static async getAll(connectionType: ConnectionType): Promise<StoredItem[]> {
        const allItems = await this.getAllItems(connectionType);
        return allItems.filter((item) => item.properties.type === ItemType.Connection);
    }

    /**
     * Gets all items (connections and folders) from storage.
     * Filters out items with unknown/future storage versions for forward compatibility.
     * @param connectionType The type of connection storage (Clusters or Emulators)
     */
    public static async getAllItems(connectionType: ConnectionType): Promise<StoredItem[]> {
        const storageService = await this.getStorageService();
        const items = await storageService.getItems<StoredItemProperties>(connectionType);

        // Filter out items with unknown versions (future-proofing)
        const knownItems = items.filter((item) => {
            if (!KNOWN_STORAGE_VERSIONS.has(item.version)) {
                console.debug(
                    `Skipping item "${item.id}" with unknown storage version "${item.version}". ` +
                        `This may be from a newer extension version.`,
                );
                return false;
            }
            return true;
        });

        return knownItems.map((item) => this.fromStorageItem(item));
    }

    /**
     * Returns a single item (connection or folder) by id, or undefined if not found.
     * Returns undefined for items with unknown/future storage versions.
     */
    public static async get(connectionId: string, connectionType: ConnectionType): Promise<StoredItem | undefined> {
        const storageService = await this.getStorageService();
        const storageItem = await storageService.getItem<StoredItemProperties>(connectionType, connectionId);

        if (!storageItem) {
            return undefined;
        }

        // Skip items with unknown versions (future-proofing)
        if (!KNOWN_STORAGE_VERSIONS.has(storageItem.version)) {
            console.debug(
                `Skipping item "${storageItem.id}" with unknown storage version "${storageItem.version}". ` +
                    `This may be from a newer extension version.`,
            );
            return undefined;
        }

        return this.fromStorageItem(storageItem);
    }

    /**
     * @deprecated Use `saveFolder()` for folders or `saveConnection()` for connections.
     * This method remains for backward compatibility but new code should use the type-specific methods.
     */
    public static async save(connectionType: ConnectionType, item: ConnectionItem, overwrite?: boolean): Promise<void> {
        const storageService = await this.getStorageService();
        await storageService.push(connectionType, this.toStorageItem(item), overwrite);
    }

    /**
     * Saves a folder to storage. Handles all internal storage details including
     * the placeholder connection string needed for backward compatibility.
     *
     * @param zone The storage zone (Clusters or Emulators)
     * @param folder The folder data to save
     * @param overwrite If true, overwrites existing item with same ID
     *
     * @example
     * ```typescript
     * await ConnectionStorageService.saveFolder(StorageZone.Clusters, {
     *     id: randomUtils.getRandomUUID(),
     *     name: 'My Folder',
     *     parentId: parentFolderId, // optional
     * });
     * ```
     */
    public static async saveFolder(zone: StorageZone, folder: FolderItemInput, overwrite?: boolean): Promise<void> {
        const storageService = await this.getStorageService();

        // Convert FolderItemInput to internal storage format
        const storageItem: StorageItem<FolderProperties> = {
            id: folder.id,
            name: folder.name,
            version: '3.0',
            properties: {
                type: ItemType.Folder,
                parentId: folder.parentId,
                api: API.DocumentDB, // Folders don't use API, but we need a value for storage format
                availableAuthMethods: [], // Folders don't have auth methods
            },
            secrets: [FOLDER_PLACEHOLDER_CONNECTION_STRING], // Required for backward compatibility
        };

        await storageService.push(zone, storageItem, overwrite);
    }

    /**
     * Saves a connection to storage.
     *
     * @param zone The storage zone (Clusters or Emulators)
     * @param connection The connection data to save
     * @param overwrite If true, overwrites existing item with same ID
     *
     * @example
     * ```typescript
     * await ConnectionStorageService.saveConnection(StorageZone.Clusters, {
     *     id: generateStorageId(connectionString),
     *     name: 'My Connection',
     *     properties: {
     *         type: ItemType.Connection,
     *         api: API.DocumentDB,
     *         availableAuthMethods: [AuthMethodId.NativeAuth],
     *         selectedAuthMethod: AuthMethodId.NativeAuth,
     *     },
     *     secrets: {
     *         connectionString: 'mongodb://...',
     *     },
     * });
     * ```
     */
    public static async saveConnection(
        zone: StorageZone,
        connection: ConnectionItemInput,
        overwrite?: boolean,
    ): Promise<void> {
        const storageService = await this.getStorageService();
        await storageService.push(zone, this.connectionInputToStorageItem(connection), overwrite);
    }

    /**
     * Converts a ConnectionItemInput to the internal storage format.
     */
    private static connectionInputToStorageItem(item: ConnectionItemInput): StorageItem<ConnectionProperties> {
        const secretsArray: string[] = [];

        secretsArray[SecretIndex.ConnectionString] = item.secrets.connectionString;

        if (item.secrets.nativeAuthConfig) {
            secretsArray[SecretIndex.NativeAuthConnectionUser] = item.secrets.nativeAuthConfig.connectionUser;
            if (item.secrets.nativeAuthConfig.connectionPassword) {
                secretsArray[SecretIndex.NativeAuthConnectionPassword] =
                    item.secrets.nativeAuthConfig.connectionPassword;
            }
        }

        if (item.secrets.entraIdAuthConfig) {
            if (item.secrets.entraIdAuthConfig.tenantId) {
                secretsArray[SecretIndex.EntraIdTenantId] = item.secrets.entraIdAuthConfig.tenantId;
            }
            if (item.secrets.entraIdAuthConfig.subscriptionId) {
                secretsArray[SecretIndex.EntraIdSubscriptionId] = item.secrets.entraIdAuthConfig.subscriptionId;
            }
        }

        return {
            id: item.id,
            name: item.name,
            version: '3.0',
            properties: item.properties,
            secrets: secretsArray,
        };
    }

    public static async delete(connectionType: ConnectionType, itemId: string): Promise<void> {
        const storageService = await this.getStorageService();
        await storageService.delete(connectionType, itemId);
    }

    /**
     * @deprecated This method is for backward compatibility with the old `save()` method.
     * New code should use `saveFolder()` or `saveConnection()` instead.
     */
    private static toStorageItem(item: ConnectionItem): StorageItem<StoredItemProperties> {
        const secretsArray: string[] = [];
        if (item.secrets) {
            // For folders, use a placeholder connection string for backward compatibility
            // with older extension versions that expect all items to have a connection string
            const connectionString =
                item.properties.type === ItemType.Folder
                    ? FOLDER_PLACEHOLDER_CONNECTION_STRING
                    : item.secrets.connectionString;
            secretsArray[SecretIndex.ConnectionString] = connectionString;

            // Store nativeAuthConfig fields individually
            if (item.secrets.nativeAuthConfig) {
                secretsArray[SecretIndex.NativeAuthConnectionUser] = item.secrets.nativeAuthConfig.connectionUser;
                if (item.secrets.nativeAuthConfig.connectionPassword) {
                    secretsArray[SecretIndex.NativeAuthConnectionPassword] =
                        item.secrets.nativeAuthConfig.connectionPassword;
                }
            }

            // Store Entra ID auth config fields individually
            if (item.secrets.entraIdAuthConfig) {
                if (item.secrets.entraIdAuthConfig.tenantId) {
                    secretsArray[SecretIndex.EntraIdTenantId] = item.secrets.entraIdAuthConfig.tenantId;
                }
                if (item.secrets.entraIdAuthConfig.subscriptionId) {
                    secretsArray[SecretIndex.EntraIdSubscriptionId] = item.secrets.entraIdAuthConfig.subscriptionId;
                }
            }
        }

        return {
            id: item.id,
            name: item.name,
            version: '3.0',
            properties: item.properties,
            secrets: secretsArray,
        };
    }

    private static fromStorageItem(item: StorageItem<StoredItemProperties>): StoredItem {
        switch (item.version) {
            case '3.0':
                // v3.0 - reconstruct directly from storage
                return this.reconstructStoredItemFromSecrets(item);

            case '2.0':
                // v2.0 - convert v2.0 format to intermediate ConnectionItem, then migrate to v3
                return this.migrateToV3(this.convertV2ToConnectionItem(item));

            default:
                // v1.0 (no version field) - migrate to v2 then v3
                return this.migrateToV3(this.migrateToV2(item));
        }
    }

    /**
     * Helper function to reconstruct a StoredItem from a StorageItem's secrets array.
     * This is shared between v2.0 and v3.0 formats since they use the same secrets structure.
     */
    private static reconstructStoredItemFromSecrets(item: StorageItem<StoredItemProperties>): StoredItem {
        const secretsArray = item.secrets ?? [];

        // Reconstruct native auth config from individual fields
        let nativeAuthConfig: NativeAuthConfig | undefined;
        const nativeAuthUser = secretsArray[SecretIndex.NativeAuthConnectionUser];
        const nativeAuthPassword = secretsArray[SecretIndex.NativeAuthConnectionPassword];

        if (nativeAuthUser) {
            nativeAuthConfig = {
                connectionUser: nativeAuthUser,
                connectionPassword: nativeAuthPassword,
            };
        }

        // Reconstruct Entra ID auth config from individual fields
        let entraIdAuthConfig: EntraIdAuthConfig | undefined;
        const entraIdTenantId = secretsArray[SecretIndex.EntraIdTenantId];
        const entraIdSubscriptionId = secretsArray[SecretIndex.EntraIdSubscriptionId];

        if (entraIdTenantId || entraIdSubscriptionId) {
            entraIdAuthConfig = {
                tenantId: entraIdTenantId,
                subscriptionId: entraIdSubscriptionId,
            };
        }

        const secrets = {
            connectionString: secretsArray[SecretIndex.ConnectionString] ?? '',
            nativeAuthConfig: nativeAuthConfig,
            entraIdAuthConfig: entraIdAuthConfig,
        };

        return {
            id: item.id,
            name: item.name,
            properties: item.properties ?? ({ type: ItemType.Connection } as StoredItemProperties),
            secrets,
        };
    }

    /**
     * Migrates an unversioned `StorageItem` (v1) to the `StoredItem` (v2) format.
     *
     * This function handles the transformation of the old data structure to the new,
     * more structured format. It ensures backward compatibility by converting legacy
     * connection data on the fly.
     *
     * The migration logic is simple because we currently only support one legacy version.
     *
     * @param item The legacy `StorageItem` to migrate.
     * @returns A `StoredItem` in the v2 format.
     */
    private static migrateToV2(item: StorageItem): StoredItem {
        // in V2, the connection string shouldn't contain the username/password combo
        const parsedCS = new DocumentDBConnectionString(item?.secrets?.[0] ?? '');
        const username = parsedCS.username;
        const password = parsedCS.password;
        parsedCS.username = '';
        parsedCS.password = '';

        // Normalize the connection string to remove any duplicate parameters
        // that may have been introduced by bugs in previous versions
        const normalizedConnectionString = parsedCS.deduplicateQueryParameters();

        return {
            id: item.id,
            name: item.name,
            properties: {
                type: ItemType.Connection,
                parentId: undefined,
                api: (item.properties?.api as API) ?? API.DocumentDB,
                emulatorConfiguration: {
                    isEmulator: !!item.properties?.isEmulator,
                    disableEmulatorSecurity: !!item.properties?.disableEmulatorSecurity,
                },
                availableAuthMethods: [AuthMethodId.NativeAuth],
                selectedAuthMethod: AuthMethodId.NativeAuth,
            },
            secrets: {
                connectionString: normalizedConnectionString,
                // Structured auth configuration populated from the same data
                nativeAuthConfig: username
                    ? {
                          connectionUser: username,
                          connectionPassword: password,
                      }
                    : undefined,
            },
        };
    }

    /**
     * Converts a v2.0 StorageItem directly to StoredItem format (without adding v3 fields yet)
     */
    private static convertV2ToConnectionItem(item: StorageItem<StoredItemProperties>): StoredItem {
        // v2.0 uses the same secrets structure as v3.0, so we can reuse the helper
        return this.reconstructStoredItemFromSecrets(item);
    }

    /**
     * Migrates v2 items to v3 by adding type and parentId fields
     */
    private static migrateToV3(item: StoredItem): StoredItem {
        // Ensure type and parentId exist (defaults for v3)
        if (!item.properties.type) {
            (item.properties as StoredItemProperties).type = ItemType.Connection;
        }
        if (item.properties.parentId === undefined) {
            item.properties.parentId = undefined; // Explicit root level
        }
        return item;
    }

    /**
     * Get all children of a parent (folders and connections)
     * @param parentId The parent folder ID, or undefined for root-level items
     * @param connectionType The type of connection storage (Clusters or Emulators)
     * @param filter Optional filter to return only specific item types (ItemType.Connection or ItemType.Folder).
     *               Default returns all items.
     */
    public static async getChildren(
        parentId: string | undefined,
        connectionType: ConnectionType,
        filter?: ItemType,
    ): Promise<StoredItem[]> {
        const allItems = await this.getAllItems(connectionType);
        let children = allItems.filter((item) => item.properties.parentId === parentId);

        if (filter !== undefined) {
            children = children.filter((item) => item.properties.type === filter);
        }

        return children;
    }

    /**
     * Update the parent ID of an item
     */
    public static async updateParentId(
        itemId: string,
        connectionType: ConnectionType,
        newParentId: string | undefined,
    ): Promise<void> {
        const item = await this.get(itemId, connectionType);
        if (!item) {
            throw new Error(`Item with id ${itemId} not found`);
        }

        // Check for circular reference if moving a folder
        // Use getPath to detect if we're trying to move into our own subtree
        if (item.properties.type === ItemType.Folder && newParentId) {
            const targetPath = await this.getPath(newParentId, connectionType);
            const sourcePath = await this.getPath(itemId, connectionType);

            // Check if target path starts with source path (would be circular)
            if (targetPath.startsWith(sourcePath + '/') || targetPath === sourcePath) {
                throw new Error('Cannot move a folder into itself or one of its descendants');
            }
        }

        item.properties.parentId = newParentId;
        await this.save(connectionType, item, true);
    }

    /**
     * Check if a name is a duplicate within the same parent folder
     */
    public static async isNameDuplicateInParent(
        name: string,
        parentId: string | undefined,
        connectionType: ConnectionType,
        itemType: ItemType,
        excludeId?: string,
    ): Promise<boolean> {
        const siblings = await this.getChildren(parentId, connectionType);
        return siblings.some(
            (sibling) => sibling.name === name && sibling.properties.type === itemType && sibling.id !== excludeId,
        );
    }

    /**
     * Get the full path of an item (e.g., "Folder1/Folder2/Connection")
     */
    public static async getPath(itemId: string, connectionType: ConnectionType): Promise<string> {
        const item = await this.get(itemId, connectionType);
        if (!item) {
            return '';
        }

        if (!item.properties.parentId) {
            return item.name;
        }

        const parentPath = await this.getPath(item.properties.parentId, connectionType);
        return `${parentPath}/${item.name}`;
    }

    /**
     * Gets the MongoDB Migration API from the Azure Databases extension
     */
    private static async getMongoMigrationApi(): Promise<MongoConnectionMigrationApi | undefined> {
        try {
            const cosmosDbExtension = vscode.extensions.getExtension('ms-azuretools.vscode-cosmosdb');
            if (!cosmosDbExtension) {
                console.debug('getMongoMigrationApi: ms-azuretools.vscode-cosmosdb is not installed.');
                return undefined;
            }

            const api = await apiUtils.getAzureExtensionApi<MongoConnectionMigrationApi>(
                ext.context,
                'ms-azuretools.vscode-cosmosdb',
                '2.0.0',
            );

            if (
                !api ||
                typeof api.exportMongoClusterConnections !== 'function' ||
                typeof api.renameMongoClusterConnectionStorageId !== 'function'
            ) {
                console.debug('getMongoMigrationApi: Requested API version is not available.');
                return undefined;
            }

            return api;
        } catch (error) {
            console.debug(
                `getMongoMigrationApi: Error accessing MongoDB Migration API: ${error instanceof Error ? error.message : String(error)}`,
            );
            return undefined;
        }
    }

    /**
     * Migrates connections from Azure Databases extension storage to DocumentDB extension storage.
     * This function is called automatically on first storage access to ensure one-time migration.
     *
     * @returns Promise resolving to migration statistics
     */
    private static async migrateFromAzureDatabases(): Promise<{ migrated: number; skipped: number }> {
        const result = await callWithTelemetryAndErrorHandling(
            'migrateFromAzureDatabases',
            async (context: IActionContext) => {
                // Increment migration attempt counter at the start of each attempt
                const currentAttempts = ext.context.globalState.get<number>(
                    this.MIGRATION_FROM_AZUREDATABASES_ATTEMPTS_KEY,
                    0,
                );
                await ext.context.globalState.update(
                    this.MIGRATION_FROM_AZUREDATABASES_ATTEMPTS_KEY,
                    currentAttempts + 1,
                );
                context.telemetry.measurements.migrationAttemptNumber = currentAttempts + 1;

                const MIGRATION_PREFIX = 'migrated-to-vscode-documentdb-';
                let migratedCount = 0;
                let skippedCount = 0;
                const startTime = Date.now();

                try {
                    const mongoMigrationApi = await this.getMongoMigrationApi();

                    if (!mongoMigrationApi) {
                        context.telemetry.properties.migrationAttempted = 'false';
                        context.telemetry.properties.reason = 'api_not_available';
                        return { migrated: 0, skipped: 0 };
                    }

                    // Use the API to get MongoDB connections - cast to local StorageItem[]
                    const allLegacyItems = (await mongoMigrationApi.exportMongoClusterConnections(ext.context)) as
                        | StorageItem[]
                        | undefined;

                    if (!allLegacyItems || allLegacyItems.length === 0) {
                        context.telemetry.properties.migrationAttempted = 'true';
                        context.telemetry.properties.hasOldStorage = 'false';
                        return { migrated: 0, skipped: 0 };
                    }

                    context.telemetry.properties.migrationAttempted = 'true';
                    context.telemetry.properties.hasOldStorage = 'true';
                    context.telemetry.measurements.itemsReadFromLegacyStorage = allLegacyItems.length;

                    const currentDate = new Date().toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                    });

                    for (const legacyItem of allLegacyItems) {
                        if (legacyItem.id.startsWith(MIGRATION_PREFIX)) {
                            skippedCount++;
                            continue;
                        }

                        try {
                            // Migrate the item using existing migrateToV2 logic
                            const migratedItem = this.migrateToV2(legacyItem);

                            migratedItem.name = l10n.t('Imported: {name} (imported on {date})', {
                                name: migratedItem.name,
                                date: currentDate,
                            });

                            // Determine connection type based on emulator flag
                            const connectionType = legacyItem.properties?.isEmulator
                                ? ConnectionType.Emulators
                                : ConnectionType.Clusters;

                            // Save to new storage
                            await this.save(connectionType, migratedItem, true);

                            // Use the API to rename the connection ID in the legacy storage
                            const newId = `${MIGRATION_PREFIX}${legacyItem.id}`;
                            const renameSuccess = await mongoMigrationApi.renameMongoClusterConnectionStorageId(
                                ext.context,
                                legacyItem.id,
                                newId,
                            );

                            if (renameSuccess) {
                                migratedCount++;
                            } else {
                                ext.outputChannel.appendLog(
                                    `Failed to rename connection in Azure Databases extension: ${legacyItem.id}`,
                                );
                                skippedCount++;
                            }
                        } catch (error) {
                            // Log individual item migration errors but continue with others
                            ext.outputChannel.appendLog(
                                `Failed to migrate from Azure Databases VS Code Extension: connection item ${legacyItem.id}: ${error instanceof Error ? error.message : String(error)}`,
                            );
                            skippedCount++;
                        }
                    }

                    // Set success telemetry
                    context.telemetry.properties.migrationSuccessful = 'true';
                    context.telemetry.measurements.migrationDurationMs = Date.now() - startTime;
                    context.telemetry.measurements.itemsMigrated = migratedCount;
                    context.telemetry.measurements.itemsSkipped = skippedCount;

                    if (migratedCount > 0) {
                        ext.outputChannel.appendLog(
                            l10n.t(
                                'Migration of connections from the Azure Databases VS Code Extension to the DocumentDB for VS Code Extension completed: {migratedCount} connections migrated.',
                                { migratedCount },
                            ),
                        );
                    }
                } catch (error) {
                    // Set failure telemetry
                    context.telemetry.properties.migrationSuccessful = 'false';
                    context.telemetry.properties.errorType =
                        error instanceof Error ? error.constructor.name : 'UnknownError';
                    context.telemetry.measurements.migrationDurationMs = Date.now() - startTime;
                    context.telemetry.measurements.itemsMigrated = migratedCount;
                    context.telemetry.measurements.itemsSkipped = skippedCount;

                    // Log errors but don't throw
                    ext.outputChannel.appendLog(
                        l10n.t('Failed to access Azure Databases VS Code Extension storage for migration: {error}', {
                            error: error instanceof Error ? error.message : String(error),
                        }),
                    );
                }

                return { migrated: migratedCount, skipped: skippedCount };
            },
        );

        return result ?? { migrated: 0, skipped: 0 };
    }
}
