/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MongoClient } from 'mongodb';
import { config } from '../config';
import { type DocumentDBContext } from '../models';

/**
 * Global MongoDB client instance and connection info
 */
let mongoClient: MongoClient | null = null;
let currentConnectionString: string | null = null;
let connectionStartTime: Date | null = null;

/**
 * Set (or override) the connection string without immediately connecting
 */
export function setDocumentDBUri(uri: string): void {
    currentConnectionString = uri;
}

/**
 * Initialize MongoDB client connection using current or default config.
 * If no connection string is available yet, returns a non-connected context.
 */
export async function initializeDocumentDBContext(lazy: boolean = true): Promise<DocumentDBContext> {
    if (!mongoClient) {
        const uri = currentConnectionString || config.documentDbUri;
        if (!uri) {
            if (lazy) {
                // No uri yet; return disconnected context and wait for explicit connect later.
                return { client: undefined, connected: false };
            } else {
                throw new Error('No DocumentDB URI configured');
            }
        }
        if (lazy) {
            // Attempt connection but swallow errors
            try {
                mongoClient = new MongoClient(uri);
                await mongoClient.connect();
                currentConnectionString = uri;
                connectionStartTime = new Date();
            } catch (e) {
                // Connection failed; keep client null for later retry.
                mongoClient = null;
                return { client: undefined, connected: false };
            }
        } else {
            mongoClient = new MongoClient(uri);
            await mongoClient.connect();
            currentConnectionString = uri;
            connectionStartTime = new Date();
        }
    }
    return {
        client: mongoClient ?? undefined,
        connected: mongoClient !== null,
    };
}

/**
 * Connect to MongoDB with a specific connection string
 */
export async function connectToDocumentDB(
    connectionString: string,
    testConnection: boolean = true,
): Promise<{
    success: boolean;
    message: string;
    connection_string: string;
    connected_at: string;
    server_info?: any;
}> {
    try {
        // Close existing connection if any
        if (mongoClient) {
            await mongoClient.close();
            mongoClient = null;
        }

        // Create new connection
        mongoClient = new MongoClient(connectionString);
        await mongoClient.connect();
        currentConnectionString = connectionString;
        connectionStartTime = new Date();

        let serverInfo;
        if (testConnection) {
            // Test the connection by getting server info
            const adminDb = mongoClient.db().admin();
            serverInfo = await adminDb.serverInfo();
        }

        return {
            success: true,
            message: 'Successfully connected to MongoDB',
            connection_string: connectionString,
            connected_at: connectionStartTime.toISOString(),
            server_info: testConnection ? serverInfo : undefined,
        };
    } catch (error) {
        // Clean up on error
        if (mongoClient) {
            try {
                await mongoClient.close();
            } catch {
                // Ignore close errors
            }
            mongoClient = null;
            currentConnectionString = null;
            connectionStartTime = null;
        }

        throw error;
    }
}

/**
 * Disconnect from MongoDB
 */
export async function disconnectFromDocumentDB(): Promise<{
    success: boolean;
    message: string;
    was_connected: boolean;
    connection_duration?: string;
}> {
    const wasConnected = mongoClient !== null;
    let connectionDuration: string | undefined;

    if (mongoClient && connectionStartTime) {
        const duration = Date.now() - connectionStartTime.getTime();
        connectionDuration = `${Math.round(duration / 1000)} seconds`;
    }

    if (mongoClient) {
        await mongoClient.close();
        mongoClient = null;
        currentConnectionString = null;
        connectionStartTime = null;
    }

    return {
        success: true,
        message: wasConnected ? 'Disconnected from MongoDB' : 'No active connection to disconnect',
        was_connected: wasConnected,
        connection_duration: connectionDuration,
    };
}

/**
 * Get current connection status
 */
export async function getConnectionStatus(): Promise<{
    connected: boolean;
    connection_string?: string;
    connected_at?: string;
    connection_duration?: string;
    server_info?: any;
}> {
    if (!mongoClient || !currentConnectionString || !connectionStartTime) {
        return {
            connected: false,
        };
    }

    try {
        // Test if connection is still alive
        await mongoClient.db().admin().ping();

        const duration = Date.now() - connectionStartTime.getTime();
        const connectionDuration = `${Math.round(duration / 1000)} seconds`;

        // Get server info
        const serverInfo = await mongoClient.db().admin().serverInfo();

        return {
            connected: true,
            connection_string: currentConnectionString,
            connected_at: connectionStartTime.toISOString(),
            connection_duration: connectionDuration,
            server_info: serverInfo,
        };
    } catch {
        // Connection is dead, clean up
        mongoClient = null;
        currentConnectionString = null;
        connectionStartTime = null;

        return {
            connected: false,
        };
    }
}

/**
 * Close MongoDB client connection
 */
export async function closeDocumentDBContext(): Promise<void> {
    if (mongoClient) {
        await mongoClient.close();
        mongoClient = null;
        currentConnectionString = null;
        connectionStartTime = null;
    }
}

/**
 * Get current DocumentDB context
 */
export function getDocumentDBContext(): DocumentDBContext {
    const connected: boolean = mongoClient !== null;
    return {
        client: mongoClient ?? undefined,
        connected,
    };
}

/**
 * Create a context wrapper for MCP server with client parameter
 */
export function createDocumentDBContextWrapper(client?: MongoClient): DocumentDBContext {
    if (client) {
        mongoClient = client;
    }

    return getDocumentDBContext();
}

/**
 * Ensure MongoDB connection is established
 */
export async function ensureConnected(): Promise<DocumentDBContext> {
    const ctx = await initializeDocumentDBContext(true);
    if (ctx.connected) return ctx;
    // If still not connected, try explicit connect if we have a URI recorded
    const uri = currentConnectionString || config.documentDbUri;
    if (!uri) {
        return { client: undefined, connected: false };
    }
    try {
        mongoClient = new MongoClient(uri);
        await mongoClient.connect();
        currentConnectionString = uri;
        connectionStartTime = new Date();
        return { client: mongoClient, connected: true };
    } catch {
        // remain disconnected
        return { client: undefined, connected: false };
    }
}
