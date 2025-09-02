/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { AuthMethodId } from '../documentdb/auth/AuthMethod';
import { DocumentDBConnectionString } from '../documentdb/utils/DocumentDBConnectionString';
import { API } from '../DocumentDBExperiences';
import { ext } from '../extensionVariables';
import { StorageNames, StorageService, type Storage, type StorageItem } from './storageService';

export enum ConnectionType {
    Clusters = 'clusters',
    Emulators = 'emulators',
}

export interface ConnectionProperties extends Record<string, unknown> {
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
 * Represents a connection item with a clean, type-safe interface for use throughout the application.
 *
 * @note For code maintainers: The `version` field from the underlying `StorageItem` is intentionally
 * omitted from this interface. The `ConnectionStorageService` handles versioning and migration
 * internally, simplifying the logic for consumers of this service.
 */
export interface ConnectionItem {
    id: string;
    name: string;
    properties: ConnectionProperties;
    secrets: {
        /** assume that the connection string doesn't contain the username and password */
        connectionString: string;
        userName?: string;
        password?: string;
    };
}

/**
 * StorageService offers secrets storage as a string[] so we need to ensure
 * we keep using correct indexes when accessing secrets.
 */
const enum SecretIndex {
    ConnectionString = 0,
    UserName = 1,
    Password = 2,
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
    // Lazily-initialized underlying storage instance. We must not call StorageService.get
    // at module-load time because `ext.context` may not be available until the extension
    // is activated. Create the Storage on first access instead.
    private static _storageService: Storage | undefined;

    private static get storageService(): Storage {
        if (!this._storageService) {
            this._storageService = StorageService.get(StorageNames.Connections);
            // Trigger migration on first access
            void this.migrateFromAzureDatabases();
        }
        return this._storageService;
    }

    public static async getAll(connectionType: ConnectionType): Promise<ConnectionItem[]> {
        const items = await this.storageService.getItems<ConnectionProperties>(connectionType);
        return items.map((item) => this.fromStorageItem(item));
    }

    /**
     * Returns a single connection by id, or undefined if not found.
     */
    public static async get(connectionId: string, connectionType: ConnectionType): Promise<ConnectionItem | undefined> {
        const storageItem = await this.storageService.getItem<ConnectionProperties>(connectionType, connectionId);
        return storageItem ? this.fromStorageItem(storageItem) : undefined;
    }

    public static async save(connectionType: ConnectionType, item: ConnectionItem, overwrite?: boolean): Promise<void> {
        await this.storageService.push(connectionType, this.toStorageItem(item), overwrite);
    }

    public static async delete(connectionType: ConnectionType, itemId: string): Promise<void> {
        await this.storageService.delete(connectionType, itemId);
    }

    private static toStorageItem(item: ConnectionItem): StorageItem<ConnectionProperties> {
        const secretsArray: string[] = [];
        if (item.secrets) {
            secretsArray[SecretIndex.ConnectionString] = item.secrets.connectionString;
            if (item.secrets.userName) {
                secretsArray[SecretIndex.UserName] = item.secrets.userName;
            }
            if (item.secrets.password) {
                secretsArray[SecretIndex.Password] = item.secrets.password;
            }
        }

        return {
            id: item.id,
            name: item.name,
            version: '2.0',
            properties: item.properties,
            secrets: secretsArray,
        };
    }

    private static fromStorageItem(item: StorageItem<ConnectionProperties>): ConnectionItem {
        if (item.version !== '2.0') {
            return this.migrateToV2(item);
        }

        const secretsArray = item.secrets ?? [];
        const secrets = {
            connectionString: secretsArray[SecretIndex.ConnectionString] ?? '',
            password: secretsArray[SecretIndex.Password],
            userName: secretsArray[SecretIndex.UserName],
        };

        return {
            id: item.id,
            name: item.name,
            properties: item.properties ?? ({} as ConnectionProperties),
            secrets,
        };
    }

    /**
     * Migrates an unversioned `StorageItem` (v1) to the `ConnectionItem` (v2) format.
     *
     * This function handles the transformation of the old data structure to the new,
     * more structured format. It ensures backward compatibility by converting legacy
     * connection data on the fly.
     *
     * The migration logic is simple because we currently only support one legacy version.
     *
     * @param item The legacy `StorageItem` to migrate.
     * @returns A `ConnectionItem` in the v2 format.
     */
    private static migrateToV2(item: StorageItem): ConnectionItem {
        // in V2, the connection string shouldn't contain the username/password combo
        const parsedCS = new DocumentDBConnectionString(item?.secrets?.[0] ?? '');
        const username = parsedCS.username;
        const password = parsedCS.password;
        parsedCS.username = '';
        parsedCS.password = '';

        return {
            id: item.id,
            name: item.name,
            properties: {
                api: (item.properties?.api as API) ?? API.DocumentDB,
                emulatorConfiguration: {
                    isEmulator: !!item.properties?.isEmulator,
                    disableEmulatorSecurity: !!item.properties?.disableEmulatorSecurity,
                },
                availableAuthMethods: [AuthMethodId.NativeAuth],
                selectedAuthMethod: AuthMethodId.NativeAuth,
            },
            secrets: {
                connectionString: parsedCS.toString(),
                userName: username,
                password: password,
            },
        };
    }

    /**
     * Migrates connections from Azure Databases extension storage to DocumentDB extension storage.
     * This function is called automatically on first storage access to ensure one-time migration.
     *
     * TODO: remove this once the measured 'migratedCount' remains 0 for "a longer period of time"
     *
     * @returns Promise resolving to migration statistics
     */
    private static async migrateFromAzureDatabases(): Promise<{ migrated: number; skipped: number }> {
        const result = await callWithTelemetryAndErrorHandling(
            'migrateFromAzureDatabases',
            async (context: IActionContext) => {
                const MIGRATION_PREFIX = 'migrated-to-documentdb-';
                let migratedCount = 0;
                let skippedCount = 0;
                const startTime = Date.now();

                try {
                    // Access the old Azure Databases storage
                    const legacyAzureDatabasesStorage = StorageService.get('workspace');
                    const allLegacyItems = await legacyAzureDatabasesStorage.getItems('vscode.cosmosdb.workspace.mongoclusters-resourceType');

                    // Set telemetry properties
                    context.telemetry.properties.migrationAttempted = 'true';
                    context.telemetry.properties.hasOldStorage = allLegacyItems.length > 0 ? 'true' : 'false';

                    context.telemetry.measurements.itemsReadFromLegacyStorage = allLegacyItems.length;

                    // Format current date (inline helper)
                    const currentDate = new Date().toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                    });

                    for (const legacyItem of allLegacyItems) {
                        // Check if already migrated (inline helper)
                        const isAlreadyMigrated = legacyItem.id.startsWith(MIGRATION_PREFIX);

                        if (isAlreadyMigrated) {
                            skippedCount++;
                            continue;
                        }

                        try {
                            // Migrate the item using existing migrateToV2 logic
                            const migratedItem = this.migrateToV2(legacyItem);

                            // Create imported name (inline helper)
                            const importedName = l10n.t('Imported: {name} (imported on {date})', {
                                name: migratedItem.name,
                                date: currentDate,
                            });
                            migratedItem.name = importedName;

                            // Determine connection type based on emulator flag
                            const connectionType = legacyItem.properties?.isEmulator
                                ? ConnectionType.Emulators
                                : ConnectionType.Clusters;

                            // Save to new storage
                            await this.save(connectionType, migratedItem, true);

                            // Mark as migrated in old storage by updating the ID
                            const updatedLegacyItem = { ...legacyItem, id: `${MIGRATION_PREFIX}${legacyItem.id}` };

                            await legacyAzureDatabasesStorage.push(
                                'vscode.cosmosdb.workspace.mongoclusters-resourceType',
                                updatedLegacyItem,
                                true,
                            );

                            await legacyAzureDatabasesStorage.delete('vscode.cosmosdb.workspace.mongoclusters-resourceType', legacyItem.id);

                            migratedCount++;
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
                                {
                                    migratedCount,
                                },
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

                    // Log storage access errors but don't throw to avoid breaking extension initialization
                    ext.outputChannel.appendLog(
                        l10n.t('Failed to access Azure Databases VS Code Extension storage for migration: {error}', {
                            error: error instanceof Error ? error.message : String(error),
                        }),
                    );

                    // Don't rethrow the error - we want storage initialization to continue
                }

                return { migrated: migratedCount, skipped: skippedCount };
            },
        );

        return result ?? { migrated: 0, skipped: 0 };
    }
}
