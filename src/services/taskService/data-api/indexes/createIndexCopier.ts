/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CollectionIndexCopier } from './CollectionIndexCopier';
import { DocumentDbCollectionIndexCopier, type DocumentDbCollectionEndpoint } from './DocumentDbCollectionIndexCopier';

export function createIndexCopier(
    source: DocumentDbCollectionEndpoint,
    target: DocumentDbCollectionEndpoint,
): CollectionIndexCopier {
    return new DocumentDbCollectionIndexCopier(source, target);
}
