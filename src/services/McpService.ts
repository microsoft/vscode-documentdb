/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { type Disposable } from 'vscode';
import { ext } from '../extensionVariables';

/**
 * Interface for the documentdb-mcp module functions
 */
interface DocumentDBMcpModule {
    runHttpServer(): Promise<void>;
    setDocumentDBUri(uri: string): void;
    ensureConnected(): Promise<void>;
    connectToDocumentDB(uri: string, force?: boolean): Promise<void>;
    getConnectionStatus(): Promise<{ connected: boolean; uri?: string }>;
}

/**
 * Represents the connection status of the MCP server
 */
export interface McpConnectionStatus {
    readonly serverRunning: boolean;
    readonly connected: boolean;
    readonly connectionUri?: string;
    readonly error?: string;
}

/**
 * Service for managing the DocumentDB MCP (Model Context Protocol) server
 * This service starts and manages the documentdb-mcp server in HTTP transport mode,
 * allowing VS Code and GitHub Copilot extension to use DocumentDB tools, prompts and resources.
 */
export class McpService implements Disposable {
    private static _instance: McpService | undefined;
    private _mcpModule: DocumentDBMcpModule | undefined;
    private _isServerRunning = false;
    private _currentConnectionUri: string | undefined;
    private _disposables: Disposable[] = [];
    private _isDisposed = false;

    private constructor() {
        // Private constructor for singleton pattern
    }

    /**
     * Gets the singleton instance of McpService
     */
    public static getInstance(): McpService {
        if (!McpService._instance) {
            McpService._instance = new McpService();
        }
        return McpService._instance;
    }

    /**
     * Initializes the MCP service by loading the documentdb-mcp module and starting the server
     */
    public async initialize(): Promise<void> {
        if (this._isDisposed) {
            throw new Error('McpService has been disposed');
        }

        await callWithTelemetryAndErrorHandling('McpService.initialize', async (context: IActionContext) => {
            try {
                context.telemetry.properties.mcpServiceInitialized = 'true';
                
                // Try to load the documentdb-mcp module
                this._mcpModule = await this.loadMcpModule();
                
                if (this._mcpModule) {
                    // Start the HTTP server
                    await this._mcpModule.runHttpServer();
                    this._isServerRunning = true;
                    
                    context.telemetry.properties.mcpServerStarted = 'true';
                    ext.outputChannel.appendLog(
                        l10n.t('DocumentDB MCP server started successfully')
                    );
                } else {
                    context.telemetry.properties.mcpServerStarted = 'false';
                    context.telemetry.properties.reason = 'module_not_available';
                    ext.outputChannel.appendLog(
                        l10n.t('DocumentDB MCP server is not available - documentdb-mcp module not found')
                    );
                }
            } catch (error) {
                context.telemetry.properties.mcpServerStarted = 'false';
                context.telemetry.properties.errorType = error instanceof Error ? error.constructor.name : 'UnknownError';
                
                const errorMessage = error instanceof Error ? error.message : String(error);
                ext.outputChannel.appendLog(
                    l10n.t('Failed to start DocumentDB MCP server: {error}', { error: errorMessage })
                );
                
                // Don't throw here to allow the extension to continue working without MCP
                console.warn('McpService initialization failed:', error);
            }
        });
    }

    /**
     * Connects to a DocumentDB instance using the MCP server
     */
    public async connectToDocumentDB(connectionUri: string, force?: boolean): Promise<void> {
        if (this._isDisposed) {
            throw new Error('McpService has been disposed');
        }

        if (!this._mcpModule || !this._isServerRunning) {
            ext.outputChannel.appendLog(
                l10n.t('Cannot connect to DocumentDB: MCP server is not running')
            );
            return;
        }

        await callWithTelemetryAndErrorHandling('McpService.connectToDocumentDB', async (context: IActionContext) => {
            try {
                context.telemetry.properties.forceConnection = String(!!force);
                
                await this._mcpModule!.connectToDocumentDB(connectionUri, force);
                this._currentConnectionUri = connectionUri;
                
                context.telemetry.properties.connectionSuccessful = 'true';
                ext.outputChannel.appendLog(
                    l10n.t('Connected to DocumentDB via MCP server: {uri}', { uri: connectionUri })
                );
            } catch (error) {
                context.telemetry.properties.connectionSuccessful = 'false';
                context.telemetry.properties.errorType = error instanceof Error ? error.constructor.name : 'UnknownError';
                
                const errorMessage = error instanceof Error ? error.message : String(error);
                ext.outputChannel.appendLog(
                    l10n.t('Failed to connect to DocumentDB via MCP server: {error}', { error: errorMessage })
                );
                throw error;
            }
        });
    }

    /**
     * Sets the DocumentDB connection URI for the MCP server
     */
    public async setDocumentDBUri(connectionUri: string): Promise<void> {
        if (this._isDisposed) {
            throw new Error('McpService has been disposed');
        }

        if (!this._mcpModule || !this._isServerRunning) {
            ext.outputChannel.appendLog(
                l10n.t('Cannot set DocumentDB URI: MCP server is not running')
            );
            return;
        }

        await callWithTelemetryAndErrorHandling('McpService.setDocumentDBUri', async (context: IActionContext) => {
            try {
                this._mcpModule!.setDocumentDBUri(connectionUri);
                this._currentConnectionUri = connectionUri;
                
                context.telemetry.properties.uriSetSuccessful = 'true';
                ext.outputChannel.appendLog(
                    l10n.t('Set DocumentDB URI for MCP server: {uri}', { uri: connectionUri })
                );
            } catch (error) {
                context.telemetry.properties.uriSetSuccessful = 'false';
                context.telemetry.properties.errorType = error instanceof Error ? error.constructor.name : 'UnknownError';
                
                const errorMessage = error instanceof Error ? error.message : String(error);
                ext.outputChannel.appendLog(
                    l10n.t('Failed to set DocumentDB URI for MCP server: {error}', { error: errorMessage })
                );
                throw error;
            }
        });
    }

    /**
     * Ensures the MCP server is connected to DocumentDB
     */
    public async ensureConnected(): Promise<void> {
        if (this._isDisposed) {
            throw new Error('McpService has been disposed');
        }

        if (!this._mcpModule || !this._isServerRunning) {
            ext.outputChannel.appendLog(
                l10n.t('Cannot ensure connection: MCP server is not running')
            );
            return;
        }

        await callWithTelemetryAndErrorHandling('McpService.ensureConnected', async (context: IActionContext) => {
            try {
                await this._mcpModule!.ensureConnected();
                
                context.telemetry.properties.ensureConnectedSuccessful = 'true';
                ext.outputChannel.appendLog(
                    l10n.t('Ensured DocumentDB connection via MCP server')
                );
            } catch (error) {
                context.telemetry.properties.ensureConnectedSuccessful = 'false';
                context.telemetry.properties.errorType = error instanceof Error ? error.constructor.name : 'UnknownError';
                
                const errorMessage = error instanceof Error ? error.message : String(error);
                ext.outputChannel.appendLog(
                    l10n.t('Failed to ensure DocumentDB connection via MCP server: {error}', { error: errorMessage })
                );
                throw error;
            }
        });
    }

    /**
     * Gets the current connection status of the MCP server
     */
    public async getConnectionStatus(): Promise<McpConnectionStatus> {
        if (this._isDisposed) {
            return {
                serverRunning: false,
                connected: false,
                error: 'McpService has been disposed'
            };
        }

        if (!this._mcpModule || !this._isServerRunning) {
            return {
                serverRunning: false,
                connected: false,
                error: 'MCP server is not running'
            };
        }

        try {
            const status = await this._mcpModule.getConnectionStatus();
            return {
                serverRunning: this._isServerRunning,
                connected: status.connected,
                connectionUri: status.uri || this._currentConnectionUri,
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                serverRunning: this._isServerRunning,
                connected: false,
                error: errorMessage
            };
        }
    }

    /**
     * Synchronizes a connection with the MCP server by setting the URI and ensuring connection
     */
    public async syncConnection(connectionString: string): Promise<void> {
        if (this._isDisposed) {
            throw new Error('McpService has been disposed');
        }

        if (!this._mcpModule || !this._isServerRunning) {
            // Log but don't throw - MCP integration is optional
            ext.outputChannel.appendLog(
                l10n.t('Cannot sync connection with MCP: server is not running')
            );
            return;
        }

        await callWithTelemetryAndErrorHandling('McpService.syncConnection', async (context: IActionContext) => {
            try {
                // Set the URI and ensure connection in sequence
                await this.setDocumentDBUri(connectionString);
                await this.ensureConnected();
                
                context.telemetry.properties.connectionSyncSuccessful = 'true';
                ext.outputChannel.appendLog(
                    l10n.t('Successfully synced connection with MCP server')
                );
            } catch (error) {
                context.telemetry.properties.connectionSyncSuccessful = 'false';
                context.telemetry.properties.errorType = error instanceof Error ? error.constructor.name : 'UnknownError';
                
                const errorMessage = error instanceof Error ? error.message : String(error);
                ext.outputChannel.appendLog(
                    l10n.t('Failed to sync connection with MCP server: {error}', { error: errorMessage })
                );
                // Don't rethrow - MCP integration failure shouldn't break the connection workflow
            }
        });
    }

    /**
     * Gets whether the MCP server is currently running
     */
    public get isServerRunning(): boolean {
        return this._isServerRunning && !this._isDisposed;
    }

    /**
     * Gets the current connection URI
     */
    public get currentConnectionUri(): string | undefined {
        return this._currentConnectionUri;
    }

    /**
     * Attempts to load the documentdb-mcp module
     */
    private async loadMcpModule(): Promise<DocumentDBMcpModule | undefined> {
        try {
            // Use dynamic import path construction to avoid TypeScript compile-time validation
            const mcpModulePath = `${process.cwd()}/documentdb-mcp/dist/index.js`;
            const mcpModule: unknown = await import(mcpModulePath);
            
            // Type guard to validate the module structure
            if (this.isValidMcpModule(mcpModule)) {
                return mcpModule;
            } else {
                ext.outputChannel.appendLog(
                    l10n.t('documentdb-mcp module found but required functions are missing')
                );
                return undefined;
            }
        } catch (error) {
            // Module not found or other import error
            ext.outputChannel.appendLog(
                l10n.t('documentdb-mcp module not available: {error}', { 
                    error: error instanceof Error ? error.message : String(error) 
                })
            );
            return undefined;
        }
    }

    /**
     * Type guard to validate the MCP module structure
     */
    private isValidMcpModule(module: unknown): module is DocumentDBMcpModule {
        return (
            typeof module === 'object' &&
            module !== null &&
            typeof (module as Record<string, unknown>).runHttpServer === 'function' &&
            typeof (module as Record<string, unknown>).setDocumentDBUri === 'function' &&
            typeof (module as Record<string, unknown>).ensureConnected === 'function' &&
            typeof (module as Record<string, unknown>).connectToDocumentDB === 'function' &&
            typeof (module as Record<string, unknown>).getConnectionStatus === 'function'
        );
    }

    /**
     * Disposes the MCP service and cleans up resources
     */
    public dispose(): void {
        if (this._isDisposed) {
            return;
        }

        this._isDisposed = true;
        this._isServerRunning = false;
        this._currentConnectionUri = undefined;
        this._mcpModule = undefined;

        // Dispose all registered disposables
        for (const disposable of this._disposables) {
            disposable.dispose();
        }
        this._disposables = [];

        ext.outputChannel.appendLog(
            l10n.t('DocumentDB MCP Service disposed')
        );
    }
}