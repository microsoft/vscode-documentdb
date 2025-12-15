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
    folderId?: string; // Optional folder ID to organize connections in hierarchy
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

        // Structured authentication configurations
        nativeAuthConfig?: NativeAuthConfig;
        entraIdAuthConfig?: EntraIdAuthConfig;
    };
}

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
        }
        return this._storageService;
    }

    public static async getAll(connectionType: ConnectionType): Promise<ConnectionItem[]> {
        const storageService = await this.getStorageService();
        const items = await storageService.getItems<ConnectionProperties>(connectionType);
        return items.map((item) => this.fromStorageItem(item));
    }

    /**
     * Returns a single connection by id, or undefined if not found.
     */
    public static async get(connectionId: string, connectionType: ConnectionType): Promise<ConnectionItem | undefined> {
        const storageService = await this.getStorageService();
        const storageItem = await storageService.getItem<ConnectionProperties>(connectionType, connectionId);
        return storageItem ? this.fromStorageItem(storageItem) : undefined;
    }

    public static async save(connectionType: ConnectionType, item: ConnectionItem, overwrite?: boolean): Promise<void> {
        const storageService = await this.getStorageService();
        await storageService.push(connectionType, this.toStorageItem(item), overwrite);
    }

    public static async delete(connectionType: ConnectionType, itemId: string): Promise<void> {
        const storageService = await this.getStorageService();
        await storageService.delete(connectionType, itemId);
    }

    private static toStorageItem(item: ConnectionItem): StorageItem<ConnectionProperties> {
        const secretsArray: string[] = [];
        if (item.secrets) {
            secretsArray[SecretIndex.ConnectionString] = item.secrets.connectionString;

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
