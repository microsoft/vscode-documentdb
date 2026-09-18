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
    selectedIndexCount: number;
    createdCount: number;
    skippedCount: number;
    renamedCount: number;
    conflictingCount: number;
    cancelled: boolean;
}

export interface SourceIndexSummary {
    readonly count: number;
    readonly uniqueIndexNames: string[];
    readonly ttlIndexNames: string[];
}

export interface GetSourceIndexSummaryOptions {
    /** Omit for every copyable secondary index. */
    readonly sourceIndexNames?: readonly string[];
    readonly signal?: AbortSignal;
}

export interface CopyIndexesOptions {
    /** Omit for every copyable secondary index. */
    readonly sourceIndexNames?: readonly string[];
    /** Dedicated index-only flows must explicitly opt in to indexes that can reject or delete documents. */
    readonly allowDocumentAffectingIndexes?: boolean;
    readonly signal?: AbortSignal;
    /** Called once after source selection resolves and before target processing starts. */
    readonly onStart?: (total: number) => void;
    /** Called once for each evaluated selected index, including equivalent indexes that are skipped. */
    readonly onProgress?: (progress: IndexCopyProgress) => void;
}

/**
 * Copies indexes between two collections understood by one database-specific implementation.
 */
export interface CollectionIndexCopier {
    getSourceIndexSummary(options?: GetSourceIndexSummaryOptions): Promise<SourceIndexSummary>;
    copyIndexes(options?: CopyIndexesOptions): Promise<IndexCopyResult>;
}
