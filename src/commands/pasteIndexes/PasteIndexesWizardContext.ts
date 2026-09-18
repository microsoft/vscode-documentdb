/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type IndexExclusionReason, type IndexItemModel } from '../../documentdb/ClustersClient';
import { type CopiedIndexScope } from '../../services/CopyPasteBufferService';
import { type CollectionIndexCopier } from '../../services/taskService/data-api/indexes/CollectionIndexCopier';
import { type DocumentDbCollectionEndpoint } from '../../services/taskService/data-api/indexes/DocumentDbCollectionIndexCopier';

export interface ExcludedSourceIndex {
    readonly name: string;
    readonly type: IndexItemModel['type'];
    readonly reason: IndexExclusionReason;
}

export interface PasteIndexesWizardContext extends IActionContext {
    readonly source: DocumentDbCollectionEndpoint;
    readonly target: DocumentDbCollectionEndpoint;
    readonly sourceConnectionName: string;
    readonly targetConnectionName: string;
    readonly targetIndexesId: string;
    readonly scope: CopiedIndexScope;
    readonly copyOperationCorrelationId: string;
    readonly indexCopier: CollectionIndexCopier;
    sourceIndexNames?: readonly string[];
    catalogCount: number;
    copyableCount: number;
    copyableIndexNames: string[];
    excluded: ExcludedSourceIndex[];
    uniqueIndexNames: string[];
    ttlIndexNames: string[];
}
