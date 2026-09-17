/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IndexCopyProgress {
    completed: number;
    total: number;
    indexName: string;
}

export interface IndexCopyResult {
    sourceIndexCount: number;
    createdCount: number;
    skippedCount: number;
    renamedCount: number;
    cancelled: boolean;
}

export interface SourceIndexSummary {
    count: number;
    uniqueIndexNames: string[];
    ttlIndexNames: string[];
}

export interface CopyIndexesOptions {
    signal?: AbortSignal;
    onStart?: (total: number) => void;
    onProgress?: (progress: IndexCopyProgress) => void;
}

/**
 * Copies indexes between two collections understood by one database-specific implementation.
 */
export interface CollectionIndexCopier {
    getSourceIndexSummary(signal?: AbortSignal): Promise<SourceIndexSummary>;
    copyIndexes(options?: CopyIndexesOptions): Promise<IndexCopyResult>;
}
