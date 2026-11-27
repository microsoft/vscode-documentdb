/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { z } from 'zod';
import { DocumentViewMode } from '../documentdb/DocumentViewMode';
import { ext } from '../extensionVariables';
import { type AtlasViewMode } from '../plugins/service-atlas-mongodb/config';
import { type KubernetesViewMode } from '../plugins/service-kubernetes/config';

const collectionDocumentViewKey = 'documentDB.liveConfig.collectionDocumentView';
const atlasViewModeKey = 'documentDB.liveConfig.atlasViewMode';
const legacyAtlasViewModeKey = 'atlas-mongodb-discovery.viewMode';
const kubernetesViewModeKey = 'documentDB.liveConfig.kubernetesViewMode';
const legacyKubernetesViewModeKey = 'kubernetes-discovery.viewMode';

export const documentViewModeSchema = z.enum(DocumentViewMode);
const discoveryViewModeSchema = z.enum(['tree', 'list']);

/** Remembers UI choices without exposing them as VS Code settings. */
export class LiveConfigService {
    static getCollectionDocumentView(): DocumentViewMode {
        return this.read(collectionDocumentViewKey, documentViewModeSchema) ?? DocumentViewMode.TABLE;
    }

    static async setCollectionDocumentView(mode: DocumentViewMode): Promise<void> {
        await ext.context.globalState.update(collectionDocumentViewKey, mode);
    }

    static getAtlasViewMode(): AtlasViewMode {
        return (
            this.read(atlasViewModeKey, discoveryViewModeSchema) ??
            this.read(legacyAtlasViewModeKey, discoveryViewModeSchema) ??
            'tree'
        );
    }

    static async setAtlasViewMode(mode: AtlasViewMode): Promise<void> {
        await ext.context.globalState.update(atlasViewModeKey, mode);
    }

    static async migrateAtlasViewMode(): Promise<void> {
        await this.migrateDiscoveryViewMode(atlasViewModeKey, legacyAtlasViewModeKey);
    }

    static getKubernetesViewMode(): KubernetesViewMode {
        return (
            this.read(kubernetesViewModeKey, discoveryViewModeSchema) ??
            this.read(legacyKubernetesViewModeKey, discoveryViewModeSchema) ??
            'list'
        );
    }

    static async setKubernetesViewMode(mode: KubernetesViewMode): Promise<void> {
        await ext.context.globalState.update(kubernetesViewModeKey, mode);
    }

    static async migrateKubernetesViewMode(): Promise<void> {
        await this.migrateDiscoveryViewMode(kubernetesViewModeKey, legacyKubernetesViewModeKey);
    }

    private static async migrateDiscoveryViewMode(key: string, legacyKey: string): Promise<void> {
        if (this.read(key, discoveryViewModeSchema) !== undefined) {
            return;
        }

        const legacyMode = this.read(legacyKey, discoveryViewModeSchema);
        if (legacyMode !== undefined) {
            // Copy rather than delete so older versions can still read their original key.
            await ext.context.globalState.update(key, legacyMode);
        }
    }

    private static read<T>(key: string, schema: z.ZodType<T>): T | undefined {
        const stored = ext.context.globalState.get<unknown>(key);
        if (stored === undefined) {
            return undefined;
        }

        const result = schema.safeParse(stored);
        if (!result.success) {
            ext.outputChannel?.warn(`[LiveConfig] Ignoring invalid stored value for ${key}.`);
            return undefined;
        }
        return result.data;
    }
}
