/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CollectionView } from '../documentdb/collectionView/CollectionView';
import { DocumentView } from '../documentdb/documentView/documentView';
import { LocalQuickStart } from '../documentdb/localQuickStart/LocalQuickStart';

export const WebviewRegistry = {
    collectionView: CollectionView,
    documentView: DocumentView,
    localQuickStart: LocalQuickStart,
} as const;

/**
 * Union type of all registered webview name keys.
 * Used by WebviewController to ensure the webviewName matches a registered entry.
 */
export type WebviewName = keyof typeof WebviewRegistry;
