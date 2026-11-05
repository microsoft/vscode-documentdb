/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type TaskOptions } from '../../taskHost';

export interface CopyCollectionStrings {
    taskName: (
        sourceCollection: string,
        sourceDatabase: string,
        targetDatabase: string,
        targetCollection: string,
    ) => string;
    countingSourceDocuments: string;
    failedToCountSourceDocuments: string;
    ensuringTargetExists: string;
    failedToEnsureTargetExists: string;
    sourceCollectionEmpty: string;
    failedAfterPartialCompletion: (summary: string) => string;
    indexCopyServicesNotConfigured: string;
    copyingIndexesBeforeDocuments: string;
    copyingIndexes: (total: string) => string;
    failedToCopyIndexes: (message: string) => string;
    indexesCopied: (count: string) => string;
    processed: (count: string) => string;
    inserted: (count: string) => string;
    skipped: (count: string) => string;
    replaced: (count: string) => string;
    created: (count: string) => string;
    documentProgress: (processed: string, total: string) => string;
    writingBatch: string;
}

export const defaultCopyCollectionStrings: CopyCollectionStrings = {
    taskName: (
        sourceCollection: string,
        sourceDatabase: string,
        targetDatabase: string,
        targetCollection: string,
    ): string => `Copy "${sourceCollection}" from "${sourceDatabase}" to "${targetDatabase}/${targetCollection}"`,
    countingSourceDocuments: 'Counting documents in the source collection...',
    failedToCountSourceDocuments: 'Failed to count documents in the source collection.',
    ensuringTargetExists: 'Ensuring target exists...',
    failedToEnsureTargetExists: 'Failed to ensure the target collection exists.',
    sourceCollectionEmpty: 'Source collection is empty.',
    failedAfterPartialCompletion: (summary: string): string => `Task failed after partial completion: ${summary}`,
    indexCopyServicesNotConfigured: 'Index copy services were not configured.',
    copyingIndexesBeforeDocuments: 'Copying indexes before documents...',
    copyingIndexes: (total: string): string => `Copying ${total} indexes...`,
    failedToCopyIndexes: (message: string): string => `Failed to copy indexes before copying documents: ${message}`,
    indexesCopied: (count: string): string => `${count} indexes copied. Document copy will begin shortly...`,
    processed: (count: string): string => `${count} processed`,
    inserted: (count: string): string => `${count} inserted`,
    skipped: (count: string): string => `${count} skipped`,
    replaced: (count: string): string => `${count} replaced`,
    created: (count: string): string => `${count} created`,
    documentProgress: (processed: string, total: string): string => `${processed}/${total} documents`,
    writingBatch: 'writing batch...',
};

export interface CopyPasteCollectionTaskOptions extends TaskOptions {
    copyCollectionStrings?: Partial<CopyCollectionStrings>;
}
