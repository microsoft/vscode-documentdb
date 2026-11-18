/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { z } from 'zod';
import { DocumentViewMode } from '../documentdb/DocumentViewMode';
import { ext } from '../extensionVariables';
import { type AtlasViewMode } from '../plugins/service-atlas-mongodb/config';

const collectionDocumentViewKey = 'documentDB.liveConfig.collectionDocumentView';
const atlasViewModeKey = 'documentDB.liveConfig.atlasViewMode';
const legacyAtlasViewModeKey = 'atlas-mongodb-discovery.viewMode';

export const documentViewModeSchema = z.enum(DocumentViewMode);
const atlasViewModeSchema = z.enum(['tree', 'list']);

/** Remembers UI choices without exposing them as VS Code settings. */
export class LiveConfigService {
    static getCollectionDocumentView(): DocumentViewMode {
        return this.read(collectionDocumentViewKey, documentViewModeSchema) ?? DocumentViewMode.TABLE;
    }

    static async setCollectionDocumentView(mode: DocumentViewMode): Promise<void> {
        await ext.context.globalState.update(collectionDocumentViewKey, mode);
    }

    static getAtlasViewMode(): AtlasViewMode {
        return this.read(atlasViewModeKey, atlasViewModeSchema) ?? this.getLegacyAtlasViewMode() ?? 'tree';
    }

    static async setAtlasViewMode(mode: AtlasViewMode): Promise<void> {
        await ext.context.globalState.update(atlasViewModeKey, mode);
    }

    static async migrateAtlasViewMode(): Promise<void> {
        if (this.read(atlasViewModeKey, atlasViewModeSchema) !== undefined) {
            return;
        }

        const legacyMode = this.getLegacyAtlasViewMode();
        if (legacyMode !== undefined) {
            // Copy rather than delete so older versions can still read their original key.
            await this.setAtlasViewMode(legacyMode);
        }
    }

    private static getLegacyAtlasViewMode(): AtlasViewMode | undefined {
        return this.read(legacyAtlasViewModeKey, atlasViewModeSchema);
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
