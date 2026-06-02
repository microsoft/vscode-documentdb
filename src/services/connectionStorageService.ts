/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import { type EntraIdAuthConfig, type NativeAuthConfig } from '../documentdb/auth/AuthConfig';
import { AuthMethodId } from '../documentdb/auth/AuthMethod';
import { redactCredentialsFromConnectionString } from '../documentdb/utils/connectionStringHelpers';
import { DocumentDBConnectionString } from '../documentdb/utils/DocumentDBConnectionString';
import { API } from '../DocumentDBExperiences';
import { ext } from '../extensionVariables';
import { StorageNames, StorageService, type Storage, type StorageItem } from './storageService';

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
    /**
     * globalState key recording the cleanup-schema version that has already completed for this install.
     */
    private static readonly STORAGE_CLEANUP_COMPLETED_VERSION_KEY = 'ConnectionStorageService.cleanupCompletedVersion';

    /**
     * The current startup cleanup-schema version. Once `resolvePostMigrationErrors` completes, this
     * value is written to globalState. On subsequent loads, if the stored value matches, the whole
     * cleanup pass is skipped — the most common case for an established install.
     *
     * This is deliberately set to the extension version that first ships this gating ('0.8.1'). Any
     * install carrying this marker is known to have run every one-time format upgrade and corruption
     * cleanup that existed up to and including 0.8.1.
     *
     * Bump this constant ONLY when a new one-time cleanup/upgrade step is added that existing installs
     * must run exactly once; existing users will then re-run the cleanup pass a single time.
     */
    private static readonly STORAGE_CLEANUP_VERSION = '0.8.1';

    // Lazily-initialized underlying storage instance. We must not call StorageService.get
    // at module-load time because `ext.context` may not be available until the extension
    // is activated. Create the Storage on first access instead.
    private static _storageService: Storage | undefined;

    private static async getStorageService(): Promise<Storage> {
        if (!this._storageService) {
            this._storageService = StorageService.get(StorageNames.Connections);

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
     *
     * @param zone - The storage zone whose items are being processed
     * @param items - Pre-loaded items for the zone (loaded once by the caller to avoid re-reading storage)
     * @returns The number of folders that were fixed
     */
    private static async fixFolderConnectionStrings(
        zone: StorageZone,
        items: StorageItem<StoredItemProperties>[],
    ): Promise<number> {
        let foldersFixed = 0;

        // Find folders without the placeholder connection string
        // (items created before this fix will have empty string or undefined)
        const foldersToFix = items.filter(
            (item) =>
                KNOWN_STORAGE_VERSIONS.has(item.version) &&
                item.properties?.type === ItemType.Folder &&
                (!item.secrets?.[SecretIndex.ConnectionString] || item.secrets[SecretIndex.ConnectionString] === ''),
        );

        for (const folder of foldersToFix) {
            try {
                // Convert to ConnectionItem (wraps into current shape if needed)
                const connectionItem = this.fromStorageItem(folder);

                // Re-save to apply the placeholder connection string
                // toStorageItem will automatically add FOLDER_PLACEHOLDER_CONNECTION_STRING for folders
                await this.save(zone, connectionItem, true);
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

        return foldersFixed;
    }

    /**
     * Cleans up connection strings with duplicate query parameters.
     * This can happen due to bugs in previous versions where parameters were doubled
     * during migration or editing.
     *
     * @param zone - The storage zone whose items are being processed
     * @param items - Pre-loaded items for the zone (loaded once by the caller to avoid re-reading storage)
     * @returns The number of connections that were fixed
     */
    private static async cleanupDuplicateConnectionStringParameters(
        zone: StorageZone,
        items: StorageItem<StoredItemProperties>[],
    ): Promise<number> {
        let connectionsFixed = 0;

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
                    await this.save(zone, connectionItem, true);
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

        return connectionsFixed;
    }

    /**
     * Resolves post-migration errors and inconsistencies.
     *
     * Order matters:
     * 1. Fix folder connection strings for backward compatibility
     * 2. Deduplicate connection string parameters
     * 3. Remove connections with invalid/empty connection strings
     * 4. Clean up orphaned items
     */
    private static async resolvePostMigrationErrors(): Promise<void> {
        await callWithTelemetryAndErrorHandling('resolvePostMigrationErrors', async (context: IActionContext) => {
            context.telemetry.properties.isActivationEvent = 'true';

            // Skip the entire cleanup pass if this install has already completed it for the current
            // cleanup-schema version. This is the common path for an established install: no folders to
            // fix, no duplicate params, no invalid connections, no orphans — yet we used to re-scan every
            // zone on every load. The marker is only written after a successful run, so an interrupted
            // run simply retries next time.
            const completedVersion = ext.context.globalState.get<string>(this.STORAGE_CLEANUP_COMPLETED_VERSION_KEY);
            if (completedVersion === this.STORAGE_CLEANUP_VERSION) {
                context.telemetry.properties.cleanupSkipped = 'true';
                context.telemetry.properties.cleanupVersion = completedVersion;
                return;
            }
            context.telemetry.properties.cleanupSkipped = 'false';

            const storageService = await this.getStorageService();

            let foldersFixed = 0;
            let duplicateParamsFixed = 0;
            let invalidConnectionsRemoved = 0;

            // Load each zone's items exactly once and thread the same array through every cleaner.
            // Previously each cleaner re-read every zone from storage, multiplying the (WSL2-expensive)
            // SecretStorage round-trips. The cleaners do not overlap on the items they mutate
            // (folders vs. connections vs. invalid/unparseable connections), so a single read per zone
            // is safe and substantially cheaper.
            for (const zone of [StorageZone.Clusters, StorageZone.Emulators]) {
                const items = await storageService.getItems<StoredItemProperties>(zone);

                // 1. Fix any existing folders that don't have the placeholder connection string
                // This ensures backward compatibility for beta testers who created folders before this fix
                foldersFixed += await this.fixFolderConnectionStrings(zone, items);

                // 2. Clean up any connection strings with duplicate query parameters
                // This fixes corruption from previous bugs in editing
                duplicateParamsFixed += await this.cleanupDuplicateConnectionStringParameters(zone, items);

                // 3. Remove connections with invalid/empty connection strings that cannot be parsed
                // This prevents corrupt stored items from blocking operations like duplicate checking
                invalidConnectionsRemoved += await this.cleanupInvalidConnectionStrings(storageService, zone, items);
            }

            context.telemetry.measurements.foldersFixed = foldersFixed;
            context.telemetry.measurements.duplicateParamsFixed = duplicateParamsFixed;
            context.telemetry.measurements.invalidConnectionsRemoved = invalidConnectionsRemoved;

            if (foldersFixed > 0) {
                ext.outputChannel.appendLog(
                    `Fixed ${foldersFixed} folder(s) with placeholder connection string for backward compatibility.`,
                );
            }
            if (duplicateParamsFixed > 0) {
                ext.outputChannel.appendLog(
                    `Fixed ${duplicateParamsFixed} connection(s) with duplicate query parameters.`,
                );
            }
            if (invalidConnectionsRemoved > 0) {
                ext.outputChannel.appendLog(
                    `Cleaned up ${invalidConnectionsRemoved} connection(s) with invalid or empty connection strings.`,
                );
            }

            // 4. Clean up orphaned items after folder and connection string fixes (fire-and-forget)
            void this.cleanupOrphanedItems();

            // Record that the cleanup pass has completed for this schema version so future loads can
            // skip it entirely. Orphan cleanup is best-effort and self-healing, so we don't wait for it.
            await ext.context.globalState.update(
                this.STORAGE_CLEANUP_COMPLETED_VERSION_KEY,
                this.STORAGE_CLEANUP_VERSION,
            );
            context.telemetry.properties.cleanupVersion = this.STORAGE_CLEANUP_VERSION;
        });
    }

    /**
     * Removes connection items with empty or unparseable connection strings.
     * These can result from interrupted writes (globalState saved but SecretStorage failed),
     * incomplete migrations, or other storage corruption. Such items block operations like
     * duplicate checking that need to parse every stored connection string.
     *
     * **Design note — intentional automatic deletion:**
     * Permanently deleting these items on startup is acceptable because:
     *   1. An empty/unparseable connection string means the entry is non-functional —
     *      the user cannot connect, rename, or export it.
     *   2. The most common cause is an interrupted write (globalState committed but
     *      SecretStorage did not), which leaves an orphan that would otherwise block
     *      the duplicate-check loop every session.
     *   3. All removals are logged at warn level and reported via telemetry
     *      (`invalidConnectionsRemoved`) so they remain auditable.
     *
     * @param storageService - The storage service to use for deletions
     * @param zone - The storage zone whose items are being processed
     * @param items - Pre-loaded items for the zone (loaded once by the caller to avoid re-reading storage)
     * @returns The number of invalid connections that were removed
     */
    private static async cleanupInvalidConnectionStrings(
        storageService: Storage,
        zone: StorageZone,
        items: StorageItem<StoredItemProperties>[],
    ): Promise<number> {
        let invalidRemoved = 0;

        // Only check connection items with known versions (skip folders and unknown versions)
        const connectionsToCheck = items.filter(
            (item) =>
                KNOWN_STORAGE_VERSIONS.has(item.version) &&
                item.properties?.type === ItemType.Connection &&
                item.secrets?.[SecretIndex.ConnectionString] !== FOLDER_PLACEHOLDER_CONNECTION_STRING,
        );

        for (const item of connectionsToCheck) {
            const connectionString = item.secrets?.[SecretIndex.ConnectionString] ?? '';

            // Skip connections with a non-empty, parseable connection string
            if (connectionString) {
                try {
                    new DocumentDBConnectionString(connectionString);
                    continue; // Valid — nothing to do
                } catch {
                    // Falls through to removal below
                }
            }

            // Connection string is empty or unparseable — remove the item
            try {
                await storageService.delete(zone, item.id);
                invalidRemoved++;

                ext.outputChannel.warn(
                    `[Storage] Removed invalid connection "${item.name}" (id: ${item.id}, zone: ${zone}) — ` +
                        `connection string was ${connectionString ? 'unparseable' : 'empty'}.`,
                );
                ext.outputChannel.trace(
                    `[Storage]   └ version: ${item.version ?? 'none'}, secrets[0] length: ${connectionString.length}`,
                );
            } catch (error) {
                ext.outputChannel.trace(
                    `[Storage] Failed to remove invalid connection ${item.id}: ${error instanceof Error ? error.message : String(error)}`,
                );
            }
        }

        return invalidRemoved;
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

        ext.outputChannel.trace(
            `[Storage] getAllItems(${connectionType}): loaded ${items.length} raw item(s) from storage`,
        );

        // Filter out items with unknown versions (future-proofing)
        const knownItems = items.filter((item) => {
            if (!KNOWN_STORAGE_VERSIONS.has(item.version)) {
                ext.outputChannel.trace(
                    `[Storage] Skipping item "${item.id}" (version: "${item.version}") — unknown storage version`,
                );
                return false;
            }
            return true;
        });

        const result: StoredItem[] = [];
        for (const item of knownItems) {
            try {
                result.push(this.fromStorageItem(item));
            } catch (error) {
                // Do not let one corrupt item break the entire list.
                // Log at warn level so it is visible in the output channel.
                const errorMessage = redactCredentialsFromConnectionString(
                    error instanceof Error ? error.message : String(error),
                );
                ext.outputChannel.warn(
                    `[Storage] Skipping corrupt stored item "${item.name}" (id: ${item.id}, version: ${item.version ?? 'none'}): ${errorMessage}`,
                );
                ext.outputChannel.trace(
                    `[Storage]   └ secrets present: ${!!item.secrets}, secrets[0] length: ${item.secrets?.[0]?.length ?? 'N/A'}, properties.type: ${item.properties?.type ?? 'undefined'}`,
                );
            }
        }

        ext.outputChannel.trace(
            `[Storage] getAllItems(${connectionType}): returning ${result.length} valid item(s) (${knownItems.length - result.length} skipped due to errors)`,
        );

        return result;
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
            ext.outputChannel.trace(
                `[Storage] get(${connectionId}): skipping item with unknown storage version "${storageItem.version}"`,
            );
            return undefined;
        }

        try {
            return this.fromStorageItem(storageItem);
        } catch (error) {
            const errorMessage = redactCredentialsFromConnectionString(
                error instanceof Error ? error.message : String(error),
            );
            ext.outputChannel.warn(
                `[Storage] get(${connectionId}): failed to load item "${storageItem.name}": ${errorMessage}`,
            );
            return undefined;
        }
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
        // NOTE: Any "upgrade" performed below is a pure in-memory transformation used to wrap the
        // raw stored item into the current `StoredItem` shape. It is NOT a persisted migration —
        // nothing is written back to storage here. The wrapped result is recomputed on every read,
        // which is intentional and cheap (string parsing + object reshaping, no I/O).
        ext.outputChannel.trace(
            `[Storage] fromStorageItem (in-memory wrap): id=${item.id}, name="${item.name}", version=${item.version ?? 'none'}, type=${item.properties?.type ?? 'undefined'}`,
        );

        switch (item.version) {
            case '3.0':
                // v3.0 - already current shape, reconstruct directly from storage
                return this.reconstructStoredItemFromSecrets(item);

            case '2.0':
                // v2.0 - wrap v2.0 format into the current shape (in-memory only, not persisted)
                return this.wrapV2AsCurrent(this.convertV2ToConnectionItem(item));

            default:
                // v1.0 (no version field) - wrap v1.0 → v2 shape → current shape (in-memory only)
                return this.wrapV2AsCurrent(this.wrapV1AsV2(item));
        }
    }

    /**
     * Helper function to reconstruct a StoredItem from a StorageItem's secrets array.
     * This is shared between v2.0 and v3.0 formats since they use the same secrets structure.
     */
    private static reconstructStoredItemFromSecrets(item: StorageItem<StoredItemProperties>): StoredItem {
        const secretsArray = item.secrets ?? [];

        const rawConnectionString = secretsArray[SecretIndex.ConnectionString] ?? '';
        if (
            !rawConnectionString &&
            item.properties?.type !== ItemType.Folder &&
            rawConnectionString !== FOLDER_PLACEHOLDER_CONNECTION_STRING
        ) {
            ext.outputChannel.warn(
                `[Storage] Item "${item.name}" (id: ${item.id}) has an empty connection string in secrets — ` +
                    `this may indicate incomplete storage write or missing SecretStorage data.`,
            );
        }

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
     * Wraps an unversioned `StorageItem` (v1) into the v2 `StoredItem` shape, in memory.
     *
     * This is a pure read-time transformation: it reshapes the legacy data structure into the
     * newer, more structured format so consumers always see a consistent type. Nothing is written
     * back to storage — the result is recomputed on every read. It is therefore cheap (string
     * parsing + object reshaping only) and intentionally not persisted.
     *
     * The logic is simple because we currently only support one legacy version.
     *
     * @param item The legacy `StorageItem` to wrap.
     * @returns A `StoredItem` in the v2 shape.
     */
    private static wrapV1AsV2(item: StorageItem): StoredItem {
        // in V2, the connection string shouldn't contain the username/password combo
        const rawSecret = item?.secrets?.[0] ?? '';

        ext.outputChannel.trace(
            `[Storage] wrapV1AsV2 (in-memory): id=${item.id}, name="${item.name}", secret length=${rawSecret.length}`,
        );

        // Guard: If the stored connection string is empty or clearly invalid, we cannot
        // parse it. Throw a descriptive error so the caller (getAllItems) can skip it.
        if (!rawSecret || rawSecret.trim().length === 0) {
            throw new Error(`Cannot wrap v1 item "${item.name}" (id: ${item.id}): stored connection string is empty`);
        }

        const parsedCS = new DocumentDBConnectionString(rawSecret);
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
     * Wraps a v2 item into the current (v3) shape by ensuring the `type` and `parentId` fields
     * exist. In-memory only — not persisted back to storage.
     */
    private static wrapV2AsCurrent(item: StoredItem): StoredItem {
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
}
