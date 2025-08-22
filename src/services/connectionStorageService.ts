/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AuthMethodId } from '../documentdb/auth/AuthMethod';
import { DocumentDBConnectionString } from '../documentdb/utils/DocumentDBConnectionString';
import { API } from '../DocumentDBExperiences';
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
}
