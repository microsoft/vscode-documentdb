/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import * as vscode from 'vscode';
import { ClusterSession } from '../documentdb/ClusterSession';
import { DocumentDBConnectionString } from '../documentdb/utils/DocumentDBConnectionString';
import { StorageNames, StorageService } from './storageService';

/**
 * Interface for MCP connection context that tracks the current
 * database connection state for MCP operations
 */
export interface McpConnectionContext {
    connectionString?: string;
    databaseName?: string;
    collectionName?: string;
    clusterId?: string;
}

/**
 * Tool argument interfaces for MCP tools
 */
interface SetConnectionArgs {
    connectionString?: string;
    databaseName?: string;
    collectionName?: string;
}

interface ListCollectionsArgs {
    databaseName?: string;
}

interface RunQueryArgs {
    query?: string;
    databaseName?: string;
    collectionName?: string;
    limit?: number;
}

interface GetCollectionSchemaArgs {
    databaseName?: string;
    collectionName?: string;
}

/**
 * MCP Service that provides Model Context Protocol server functionality
 * for DocumentDB operations. This enables AI models like GitHub Copilot
 * to interact with DocumentDB databases through standardized tools.
 */
class McpServiceImpl implements vscode.Disposable {
    private server: Server | undefined;
    private currentContext: McpConnectionContext = {};
    private clusterSession: ClusterSession | undefined;
    private readonly _onDidChangeContext = new vscode.EventEmitter<McpConnectionContext>();
    public readonly onDidChangeContext = this._onDidChangeContext.event;

    constructor() {
        // Initialize the MCP server
        this.initializeServer();
    }

    private initializeServer(): void {
        this.server = new Server(
            {
                name: 'vscode-documentdb-mcp',
                version: '1.0.0',
            },
            {
                capabilities: {
                    tools: {},
                },
            }
        );

        this.setupToolHandlers();
    }

    private setupToolHandlers(): void {
        if (!this.server) {
            return;
        }

        // List available tools
        this.server.setRequestHandler(ListToolsRequestSchema, async () => {
            return {
                tools: [
                    {
                        name: 'set_connection',
                        description: 'Set the current DocumentDB connection context',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                connectionString: {
                                    type: 'string',
                                    description: 'MongoDB/DocumentDB connection string',
                                },
                                databaseName: {
                                    type: 'string',
                                    description: 'Database name to connect to',
                                },
                                collectionName: {
                                    type: 'string',
                                    description: 'Collection name to work with',
                                },
                            },
                        },
                    },
                    {
                        name: 'get_connection_info',
                        description: 'Get current connection context information',
                        inputSchema: {
                            type: 'object',
                            properties: {},
                        },
                    },
                    {
                        name: 'list_databases',
                        description: 'List all databases in the current connection',
                        inputSchema: {
                            type: 'object',
                            properties: {},
                        },
                    },
                    {
                        name: 'list_collections',
                        description: 'List all collections in the current database',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                databaseName: {
                                    type: 'string',
                                    description: 'Database name (optional, uses current context if not provided)',
                                },
                            },
                        },
                    },
                    {
                        name: 'run_query',
                        description: 'Execute a MongoDB query on the current collection',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                query: {
                                    type: 'string',
                                    description: 'MongoDB query to execute',
                                },
                                databaseName: {
                                    type: 'string',
                                    description: 'Database name (optional, uses current context if not provided)',
                                },
                                collectionName: {
                                    type: 'string',
                                    description: 'Collection name (optional, uses current context if not provided)',
                                },
                                limit: {
                                    type: 'number',
                                    description: 'Maximum number of documents to return (default: 100)',
                                    default: 100,
                                },
                            },
                            required: ['query'],
                        },
                    },
                    {
                        name: 'get_collection_schema',
                        description: 'Get schema information for a collection',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                databaseName: {
                                    type: 'string',
                                    description: 'Database name (optional, uses current context if not provided)',
                                },
                                collectionName: {
                                    type: 'string',
                                    description: 'Collection name (optional, uses current context if not provided)',
                                },
                            },
                        },
                    },
                ],
            };
        });

        // Handle tool calls
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args = {} } = request.params;

            try {
                switch (name) {
                    case 'set_connection':
                        return await this.handleSetConnection(args as SetConnectionArgs);
                    case 'get_connection_info':
                        return await this.handleGetConnectionInfo();
                    case 'list_databases':
                        return await this.handleListDatabases();
                    case 'list_collections':
                        return await this.handleListCollections(args as ListCollectionsArgs);
                    case 'run_query':
                        return await this.handleRunQuery(args as RunQueryArgs);
                    case 'get_collection_schema':
                        return await this.handleGetCollectionSchema(args as GetCollectionSchemaArgs);
                    default:
                        throw new Error(`Unknown tool: ${name}`);
                }
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error executing tool ${name}: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        });
    }

    private async handleSetConnection(args: SetConnectionArgs) {
        const { connectionString, databaseName, collectionName } = args;

        // Validate connection string if provided
        if (connectionString) {
            try {
                const parsedCS = new DocumentDBConnectionString(connectionString);
                // Store the connection in the current context
                this.currentContext = {
                    connectionString,
                    databaseName: databaseName || parsedCS.pathname?.replace('/', '') || undefined,
                    collectionName,
                };
                
                // Create a new cluster session using the connection string as credential ID
                const sessionId = await ClusterSession.initNewSession(connectionString);
                this.clusterSession = ClusterSession.getSession(sessionId);
                
                this._onDidChangeContext.fire(this.currentContext);

                return {
                    content: [
                        {
                            type: 'text',
                            text: `Successfully connected to DocumentDB. Database: ${this.currentContext.databaseName || 'not set'}, Collection: ${this.currentContext.collectionName || 'not set'}`,
                        },
                    ],
                };
            } catch (error) {
                throw new Error(`Failed to connect: ${error instanceof Error ? error.message : String(error)}`);
            }
        } else {
            // Update context without changing connection
            this.currentContext = {
                ...this.currentContext,
                databaseName: databaseName || this.currentContext.databaseName,
                collectionName: collectionName || this.currentContext.collectionName,
            };

            this._onDidChangeContext.fire(this.currentContext);

            return {
                content: [
                    {
                        type: 'text',
                        text: `Updated context. Database: ${this.currentContext.databaseName || 'not set'}, Collection: ${this.currentContext.collectionName || 'not set'}`,
                    },
                ],
            };
        }
    }

    private async handleGetConnectionInfo() {
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(
                        {
                            connected: !!this.clusterSession,
                            databaseName: this.currentContext.databaseName,
                            collectionName: this.currentContext.collectionName,
                            clusterId: this.currentContext.clusterId,
                        },
                        null,
                        2
                    ),
                },
            ],
        };
    }

    private async handleListDatabases() {
        if (!this.clusterSession) {
            throw new Error('No active connection. Use set_connection tool first.');
        }

        try {
            const client = this.clusterSession.getClient();
            const databases = await client.listDatabases();
            
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(databases.map(db => db.name), null, 2),
                    },
                ],
            };
        } catch (error) {
            throw new Error(`Failed to list databases: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async handleListCollections(args: ListCollectionsArgs) {
        if (!this.clusterSession) {
            throw new Error('No active connection. Use set_connection tool first.');
        }

        const databaseName = args.databaseName || this.currentContext.databaseName;
        if (!databaseName) {
            throw new Error('Database name is required. Provide it in the tool call or set it in the context.');
        }

        try {
            const client = this.clusterSession.getClient();
            const collections = await client.listCollections(databaseName);
            
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(collections.map(col => col.name), null, 2),
                    },
                ],
            };
        } catch (error) {
            throw new Error(`Failed to list collections: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async handleRunQuery(args: RunQueryArgs) {
        if (!this.clusterSession) {
            throw new Error('No active connection. Use set_connection tool first.');
        }

        const { query, limit = 100 } = args;
        if (!query) {
            throw new Error('Query is required.');
        }
        
        const databaseName = args.databaseName || this.currentContext.databaseName;
        const collectionName = args.collectionName || this.currentContext.collectionName;

        if (!databaseName || !collectionName) {
            throw new Error('Database and collection names are required. Provide them in the tool call or set them in the context.');
        }

        try {
            // Execute the query and get the count
            await this.clusterSession.runQueryWithCache(
                databaseName,
                collectionName,
                query,
                1, // page number
                Math.min(limit, 1000) // page size with max limit
            );
            
            // Get the actual data
            const tableData = this.clusterSession.getCurrentPageAsTable([]);
            
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(tableData, null, 2),
                    },
                ],
            };
        } catch (error) {
            throw new Error(`Failed to execute query: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async handleGetCollectionSchema(args: GetCollectionSchemaArgs) {
        if (!this.clusterSession) {
            throw new Error('No active connection. Use set_connection tool first.');
        }

        const databaseName = args.databaseName || this.currentContext.databaseName;
        const collectionName = args.collectionName || this.currentContext.collectionName;

        if (!databaseName || !collectionName) {
            throw new Error('Database and collection names are required. Provide them in the tool call or set them in the context.');
        }

        try {
            // Get a sample of documents to infer schema
            const sampleQuery = '{}'; // Get all documents (limited by pagination)
            await this.clusterSession.runQueryWithCache(
                databaseName,
                collectionName,
                sampleQuery,
                1, // page number
                10 // small sample for schema inference
            );

            // Get the table data and schema
            const tableData = this.clusterSession.getCurrentPageAsTable([]);
            const schema = this.clusterSession.getCurrentSchema();

            // Extract field types from the sample
            const inferredSchema: Record<string, string> = {};
            if (tableData && tableData.data.length > 0) {
                const sampleDoc = tableData.data[0];
                for (const [key, value] of Object.entries(sampleDoc)) {
                    if (key !== 'x-objectid') {
                        inferredSchema[key] = typeof value;
                    }
                }
            }
            
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            database: databaseName,
                            collection: collectionName,
                            sampleCount: tableData?.data.length || 0,
                            inferredSchema,
                            jsonSchema: schema,
                        }, null, 2),
                    },
                ],
            };
        } catch (error) {
            throw new Error(`Failed to get collection schema: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Set the current connection context using an existing connection from storage
     */
    public async setConnectionFromStorage(clusterId: string): Promise<void> {
        try {
            const connections = await StorageService.get(StorageNames.Connections).getItems('clusters');
            const connection = connections.find(conn => conn.id === clusterId);
            
            if (!connection || !connection.secrets?.[0]) {
                throw new Error(`Connection ${clusterId} not found or has no connection string`);
            }

            const connectionString = connection.secrets[0];
            const parsedCS = new DocumentDBConnectionString(connectionString);
            
            this.currentContext = {
                connectionString,
                clusterId,
                databaseName: parsedCS.pathname?.replace('/', '') || undefined,
            };

            // Create a new cluster session using the connection string as credential ID
            const sessionId = await ClusterSession.initNewSession(connectionString);
            this.clusterSession = ClusterSession.getSession(sessionId);
            
            this._onDidChangeContext.fire(this.currentContext);
        } catch (error) {
            throw new Error(`Failed to set connection from storage: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Switch to a different database in the current connection
     */
    public async switchDatabase(databaseName: string): Promise<void> {
        this.currentContext = {
            ...this.currentContext,
            databaseName,
            collectionName: undefined, // Reset collection when switching database
        };
        
        this._onDidChangeContext.fire(this.currentContext);
    }

    /**
     * Switch to a different collection in the current database
     */
    public async switchCollection(collectionName: string): Promise<void> {
        this.currentContext = {
            ...this.currentContext,
            collectionName,
        };
        
        this._onDidChangeContext.fire(this.currentContext);
    }

    /**
     * Get the current connection context
     */
    public getConnectionContext(): McpConnectionContext {
        return { ...this.currentContext };
    }

    /**
     * Check if MCP server is active and has a connection
     */
    public isActive(): boolean {
        return !!this.server && !!this.clusterSession;
    }

    /**
     * Start the MCP server (if not already started)
     */
    public async start(): Promise<void> {
        if (!this.server) {
            this.initializeServer();
        }
        // MCP server is automatically started when initialized
    }

    /**
     * Stop the MCP server
     */
    public async stop(): Promise<void> {
        if (this.server) {
            await this.server.close();
            this.server = undefined;
        }
        this.clusterSession = undefined;
        this.currentContext = {};
    }

    public dispose(): void {
        void this.stop();
        this._onDidChangeContext.dispose();
    }
}

// Export singleton instance
export const McpService = new McpServiceImpl();