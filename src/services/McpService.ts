/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import {
    type connectToDocumentDB as connectToDocumentDBType,
    type getConnectionStatus as getConnectionStatusType,
    type runHttpServer as runHttpServerType,
    type setDocumentDBUri as setDocumentDBUriType,
} from '../../documentdb-mcp/dist/index';

// Dynamic import to avoid bundling issues
let mcpModule: {
    runHttpServer: typeof runHttpServerType;
    setDocumentDBUri: typeof setDocumentDBUriType;
    connectToDocumentDB: typeof connectToDocumentDBType;
    getConnectionStatus: typeof getConnectionStatusType;
} | null = null;

async function getMcpModule() {
    if (!mcpModule) {
        mcpModule = await import('../../documentdb-mcp/dist/index');
    }
    return mcpModule;
}

/**
 * Service that manages the DocumentDB MCP server instance.
 * This service starts an HTTP server that exposes DocumentDB tools, prompts, and resources
 * to GitHub Copilot and other MCP clients.
 */
class McpServiceImpl implements vscode.Disposable {
    private isServerRunning: boolean = false;

    /**
     * Initialize and start the MCP HTTP server.
     * The server will be accessible to GitHub Copilot extension and other MCP clients.
     */
    public async start(): Promise<void> {
        if (this.isServerRunning) {
            console.log('[McpService] MCP server is already running');
            return;
        }

        try {
            console.log('[McpService] Starting DocumentDB MCP server...');
            const mcp = await getMcpModule();
            void mcp.runHttpServer();
            this.isServerRunning = true;
            console.log('[McpService] DocumentDB MCP server started successfully');
        } catch (error) {
            this.isServerRunning = false;
            console.error('[McpService] Failed to start MCP server:', error);
            throw error;
        }
    }

    /**
     * Update the connection URI for the MCP server.
     * This allows switching between different DocumentDB cluster instances.
     *
     * @param connectionString - The MongoDB connection string
     */
    public async setConnectionUri(connectionString: string): Promise<void> {
        const mcp = await getMcpModule();
        mcp.setDocumentDBUri(connectionString);
        console.log('[McpService] Connection URI updated');
    }

    /**
     * Connect to DocumentDB with the specified connection string.
     * This establishes an active connection that the MCP server can use.
     *
     * @param connectionString - The MongoDB connection string
     * @param testConnection - Whether to test the connection (default: true)
     */
    public async connect(connectionString: string, testConnection: boolean = true): Promise<void> {
        try {
            const mcp = await getMcpModule();
            const result = await mcp.connectToDocumentDB(connectionString, testConnection);
            if (result.success) {
                console.log('[McpService] Successfully connected to DocumentDB:', result.message);
            } else {
                throw new Error('Connection failed');
            }
        } catch (error) {
            console.error('[McpService] Failed to connect to DocumentDB:', error);
            throw error;
        }
    }

    /**
     * Get the current connection status of the MCP server.
     */
    public async getStatus(): Promise<{
        connected: boolean;
        connection_string?: string;
        connected_at?: string;
        connection_duration?: string;
        server_info?: unknown;
    }> {
        const mcp = await getMcpModule();
        return await mcp.getConnectionStatus();
    }

    /**
     * Check if the MCP server is running.
     */
    public isRunning(): boolean {
        return this.isServerRunning;
    }

    /**
     * Dispose of the service and clean up resources.
     */
    public dispose(): void {
        // Note: The MCP server will be cleaned up when the extension is deactivated
        // We don't explicitly stop the server here as it may be in use by Copilot
        console.log('[McpService] Disposing MCP service');
        this.isServerRunning = false;
    }
}

/**
 * Singleton instance of the MCP service.
 * Use this to start the MCP server and manage DocumentDB connections.
 */
export const McpService = new McpServiceImpl();
