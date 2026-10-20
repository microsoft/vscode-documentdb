/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
export interface QueryInsightsPrefill {
    explain?: string;
    query?: string;
    commandType?: 'find' | 'aggregate' | 'count';
    collectionStats?: string;
    indexes?: string;
    databaseName?: string;
    collectionName?: string;
    clusterType?: 'azure-documentdb' | 'documentdb' | 'other';
}

export interface StandaloneInput {
    explain: string;
    query: string;
    commandType: 'auto' | 'find' | 'aggregate' | 'count';
    collectionStats: string;
    indexes: string;
    databaseName: string;
    collectionName: string;
    clusterType: 'azure-documentdb' | 'documentdb' | 'other';
    modelId?: string;
}
