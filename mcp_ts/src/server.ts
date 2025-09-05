/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// Import tools
import { 
    listDatabasesTool, 
    listDatabases, 
    dbStatsTool, 
    dbStats, 
    getDbInfoTool, 
    getDbInfo, 
    dropDatabaseTool, 
    dropDatabase 
} from './tools/database.js';
import { 
    collectionStatsTool, 
    collectionStats, 
    renameCollectionTool, 
    renameCollection, 
    dropCollectionTool, 
    dropCollection, 
    sampleDocumentsTool, 
    sampleDocuments 
} from './tools/collection.js';
import { 
    findDocumentsTool, 
    findDocuments, 
    countDocumentsTool, 
    countDocuments, 
    insertDocumentTool, 
    insertDocument, 
    insertManyTool, 
    insertMany, 
    updateDocumentTool, 
    updateDocument, 
    deleteDocumentTool, 
    deleteDocument, 
    aggregateTool, 
    aggregate 
} from './tools/document.js';
import { 
    createIndexTool, 
    createIndex, 
    listIndexesTool, 
    listIndexes, 
    dropIndexTool, 
    dropIndex, 
    indexStatsTool, 
    indexStats, 
    currentOpsTool, 
    currentOps 
} from './tools/index.js';
import { 
    optimizeFindQueryTool, 
    optimizeFindQuery, 
    optimizeAggregateQueryTool, 
    optimizeAggregateQuery, 
    listDatabasesForGenerationTool, 
    listDatabasesForGeneration, 
    getDbInfoForGenerationTool, 
    getDbInfoForGeneration 
} from './tools/workflow.js';

import { initializeDocumentDBContext, closeDocumentDBContext } from './context/documentdb.js';

/**
 * Create and configure the MCP server
 */
export function createServer(): Server {
    const server = new Server(
        {
            name: 'documentdb-mcp-server',
            version: '0.1.0',
        },
        {
            capabilities: {
                tools: {},
            },
        }
    );

    // All available tools
    const tools = [
        // Database tools
        listDatabasesTool,
        dbStatsTool,
        getDbInfoTool,
        dropDatabaseTool,
        
        // Collection tools
        collectionStatsTool,
        renameCollectionTool,
        dropCollectionTool,
        sampleDocumentsTool,
        
        // Document tools
        findDocumentsTool,
        countDocumentsTool,
        insertDocumentTool,
        insertManyTool,
        updateDocumentTool,
        deleteDocumentTool,
        aggregateTool,
        
        // Index tools
        createIndexTool,
        listIndexesTool,
        dropIndexTool,
        indexStatsTool,
        currentOpsTool,
        
        // Workflow tools
        optimizeFindQueryTool,
        optimizeAggregateQueryTool,
        listDatabasesForGenerationTool,
        getDbInfoForGenerationTool,
    ];

    // Tool handlers mapping
    const toolHandlers = new Map([
        // Database handlers
        ['list_databases', listDatabases],
        ['db_stats', dbStats],
        ['get_db_info', getDbInfo],
        ['drop_database', dropDatabase],
        
        // Collection handlers
        ['collection_stats', collectionStats],
        ['rename_collection', renameCollection],
        ['drop_collection', dropCollection],
        ['sample_documents', sampleDocuments],
        
        // Document handlers
        ['find_documents', findDocuments],
        ['count_documents', countDocuments],
        ['insert_document', insertDocument],
        ['insert_many', insertMany],
        ['update_document', updateDocument],
        ['delete_document', deleteDocument],
        ['aggregate', aggregate],
        
        // Index handlers
        ['create_index', createIndex],
        ['list_indexes', listIndexes],
        ['drop_index', dropIndex],
        ['index_stats', indexStats],
        ['current_ops', currentOps],
        
        // Workflow handlers
        ['optimize_find_query', optimizeFindQuery],
        ['optimize_aggregate_query', optimizeAggregateQuery],
        ['list_databases_for_generation', listDatabasesForGeneration],
        ['get_db_info_for_generation', getDbInfoForGeneration],
    ]);

    // Register list tools handler
    server.setRequestHandler(ListToolsRequestSchema, async () => {
        return {
            tools,
        };
    });

    // Register call tool handler
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const toolName = request.params.name;
        const handler = toolHandlers.get(toolName);
        
        if (!handler) {
            throw new Error(`Unknown tool: ${toolName}`);
        }
        
        return await handler(request);
    });

    return server;
}

/**
 * Run the server with the specified transport
 */
export async function runServer(): Promise<void> {
    const server = createServer();
    
    // Initialize DocumentDB context
    await initializeDocumentDBContext();
    
    // Setup cleanup on process termination
    const cleanup = async () => {
        await closeDocumentDBContext();
        process.exit(0);
    };
    
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('uncaughtException', async (error) => {
        console.error('Uncaught exception:', error);
        await cleanup();
    });
    process.on('unhandledRejection', async (reason) => {
        console.error('Unhandled rejection:', reason);
        await cleanup();
    });

    // Create and run transport
    const transport = new StdioServerTransport();
    await server.connect(transport);
    
    console.error('DocumentDB MCP Server running on stdio transport');
}