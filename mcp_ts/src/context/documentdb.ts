/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MongoClient } from 'mongodb';
import { type DocumentDBContext } from '../models/index.js';
import { config } from '../config.js';

/**
 * Global MongoDB client instance
 */
let mongoClient: MongoClient | null = null;

/**
 * Initialize MongoDB client connection
 */
export async function initializeDocumentDBContext(): Promise<DocumentDBContext> {
    if (!mongoClient) {
        mongoClient = new MongoClient(config.documentDbUri);
        await mongoClient.connect();
    }
    return {
        client: mongoClient,
    };
}

/**
 * Close MongoDB client connection
 */
export async function closeDocumentDBContext(): Promise<void> {
    if (mongoClient) {
        await mongoClient.close();
        mongoClient = null;
    }
}

/**
 * Get current DocumentDB context
 */
export function getDocumentDBContext(): DocumentDBContext {
    if (!mongoClient) {
        throw new Error('DocumentDB context not initialized. Call initializeDocumentDBContext() first.');
    }
    return {
        client: mongoClient,
    };
}