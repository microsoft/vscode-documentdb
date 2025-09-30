/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type MongoClient } from 'mongodb';

export interface DocumentDBContext {
    /** MongoDB client instance */
    client?: MongoClient;
    connected: boolean;
}

export interface DBInfoResponse {
    database_name: string;
    collection_names: string[];
    stats: Record<string, unknown>;
}

export interface DocumentQueryResponse {
    documents: Record<string, unknown>[];
    total_count: number;
    limit: number;
    skip: number;
    has_more: boolean;
}

export interface InsertOneResponse {
    /** Response for single document insert operation */
    inserted_id: string;
    acknowledged: boolean;
    inserted_count: number;
}

export interface InsertManyResponse {
    /** Response for multiple document insert operation */
    inserted_ids: string[];
    acknowledged: boolean;
    inserted_count: number;
}

export interface UpdateResponse {
    matched_count: number;
    modified_count: number;
    upserted_id?: string;
    acknowledged: boolean;
}

export interface DeleteResponse {
    deleted_count: number;
    acknowledged: boolean;
}

export interface AggregateResponse {
    results: Record<string, unknown>[];
    total_count: number;
}

export interface CreateIndexResponse {
    index_name: string;
    keys: Record<string, unknown>;
    unique: boolean;
}

export interface ListIndexesResponse {
    indexes: Record<string, unknown>[];
}

export interface SuccessResponse {
    /** Response for successful operations */
    message: string;
}

export interface ErrorResponse {
    error: string;
}
