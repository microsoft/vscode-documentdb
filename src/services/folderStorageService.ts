/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { StorageNames, StorageService, type Storage, type StorageItem } from './storageService';

/**
 * Represents a folder in the connections view
 */
export interface FolderItem {
    id: string;
    name: string;
    parentId?: string; // undefined means root level folder
}

/**
 * Service for managing folder hierarchy in the connections view.
 * Folders provide organization for connections and can be nested.
 */
export class FolderStorageService {
    private static _storageService: Storage | undefined;

    private static async getStorageService(): Promise<Storage> {
        if (!this._storageService) {
            this._storageService = StorageService.get(StorageNames.Folders);
        }
        return this._storageService;
    }

    /**
     * Get all folders
     */
    public static async getAll(): Promise<FolderItem[]> {
        const storageService = await this.getStorageService();
        const items = await storageService.getItems<Record<string, unknown>>('folders');
        return items.map((item) => this.fromStorageItem(item));
    }

    /**
     * Get a folder by id
     */
    public static async get(folderId: string): Promise<FolderItem | undefined> {
        const storageService = await this.getStorageService();
        const storageItem = await storageService.getItem<Record<string, unknown>>('folders', folderId);
        return storageItem ? this.fromStorageItem(storageItem) : undefined;
    }

    /**
     * Get all child folders of a parent folder
     */
    public static async getChildren(parentId?: string): Promise<FolderItem[]> {
        const allFolders = await this.getAll();
        return allFolders.filter((folder) => folder.parentId === parentId);
    }

    /**
     * Save a folder
     */
    public static async save(folder: FolderItem, overwrite?: boolean): Promise<void> {
        const storageService = await this.getStorageService();
        await storageService.push('folders', this.toStorageItem(folder), overwrite);
    }

    /**
     * Delete a folder and all its descendants
     */
    public static async delete(folderId: string): Promise<void> {
        const storageService = await this.getStorageService();
        
        // Delete all child folders recursively
        const children = await this.getChildren(folderId);
        for (const child of children) {
            await this.delete(child.id);
        }
        
        // Delete the folder itself
        await storageService.delete('folders', folderId);
    }

    /**
     * Move a folder to a new parent
     */
    public static async move(folderId: string, newParentId?: string): Promise<void> {
        const folder = await this.get(folderId);
        if (!folder) {
            throw new Error(`Folder with id ${folderId} not found`);
        }

        // Check for circular reference
        if (newParentId && (await this.isDescendantOf(newParentId, folderId))) {
            throw new Error('Cannot move a folder into one of its descendants');
        }

        folder.parentId = newParentId;
        await this.save(folder, true);
    }

    /**
     * Check if a folder is a descendant of another folder
     */
    private static async isDescendantOf(folderId: string, potentialAncestorId: string): Promise<boolean> {
        const folder = await this.get(folderId);
        if (!folder || !folder.parentId) {
            return false;
        }

        if (folder.parentId === potentialAncestorId) {
            return true;
        }

        return this.isDescendantOf(folder.parentId, potentialAncestorId);
    }

    /**
     * Get the full path of a folder (e.g., "Folder1/Folder2/Folder3")
     */
    public static async getPath(folderId: string): Promise<string> {
        const folder = await this.get(folderId);
        if (!folder) {
            return '';
        }

        if (!folder.parentId) {
            return folder.name;
        }

        const parentPath = await this.getPath(folder.parentId);
        return `${parentPath}/${folder.name}`;
    }

    private static toStorageItem(folder: FolderItem): StorageItem<Record<string, unknown>> {
        return {
            id: folder.id,
            name: folder.name,
            version: '1.0',
            properties: {
                parentId: folder.parentId,
            },
            secrets: [],
        };
    }

    private static fromStorageItem(item: StorageItem<Record<string, unknown>>): FolderItem {
        return {
            id: item.id,
            name: item.name,
            parentId: item.properties?.parentId as string | undefined,
        };
    }
}
