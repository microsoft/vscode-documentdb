# DocumentDB MCP Integration

This document describes the integration of the DocumentDB MCP (Model Context Protocol) server into the VS Code DocumentDB extension.

## Overview

The DocumentDB extension now includes an integrated MCP server that exposes DocumentDB/MongoDB operations to GitHub Copilot and other MCP clients. This allows AI assistants to interact with your DocumentDB clusters through a standardized protocol.

## Architecture

### Components

1. **McpService** (`src/services/McpService.ts`)
   - Singleton service that manages the MCP server lifecycle
   - Starts an HTTP server on port 8070 (default)
   - Provides methods to connect and synchronize with DocumentDB clusters

2. **ClustersClient Integration** (`src/documentdb/ClustersClient.ts`)
   - Automatically synchronizes connections with the MCP server
   - When a cluster connection is established, the MCP server is updated with the same connection

3. **Extension Activation** (`src/extension.ts`)
   - MCP server is automatically started when the extension activates
   - Registered as a disposable to ensure proper cleanup

## MCP Server Features

The MCP server exposes the following categories of tools:

### Database Tools

- `list_databases` - List all databases
- `db_stats` - Get database statistics
- `get_db_info` - Get database information and collection names
- `drop_database` - Drop a database

### Collection Tools

- `collection_stats` - Get collection statistics
- `rename_collection` - Rename a collection
- `drop_collection` - Drop a collection
- `sample_documents` - Get sample documents from a collection

### Document Tools

- `find_documents` - Find documents with query, projection, sort, limit, skip
- `count_documents` - Count documents matching a query
- `insert_document` - Insert a single document
- `insert_many` - Insert multiple documents
- `update_document` - Update a single document
- `delete_document` - Delete a single document
- `aggregate` - Run aggregation pipelines

### Index Tools

- `create_index` - Create an index
- `list_indexes` - List all indexes on a collection
- `drop_index` - Drop an index
- `index_stats` - Get index usage statistics
- `current_ops` - Get current database operations

### Workflow Tools

- `optimize_find_query` - Analyze and optimize find queries
- `optimize_aggregate_query` - Analyze and optimize aggregation queries
- `list_databases_for_generation` - List databases with metadata for query generation
- `get_db_info_for_generation` - Get enhanced database info for query generation

## How It Works

### Initialization Flow

1. Extension activates → `activateInternal()` is called
2. `McpService.start()` initializes the HTTP MCP server
3. Server listens on `http://localhost:8070/mcp`
4. GitHub Copilot can now discover and use the MCP server

### Connection Synchronization

When you connect to a DocumentDB cluster through the extension:

1. User connects to a cluster → `ClustersClient.connect()` is called
2. MongoClient establishes connection
3. Connection string is synchronized to MCP server via `McpService.connect()`
4. MCP server now has access to the same cluster
5. GitHub Copilot can use MCP tools to query/manipulate the database

## Configuration

The MCP server uses the following default configuration:

- **Transport**: HTTP (streamable-http)
- **Host**: localhost
- **Port**: 8070
- **Endpoint**: `/mcp`

These can be configured via environment variables in the `documentdb-mcp` module:

```env
TRANSPORT=streamable-http
HOST=localhost
PORT=8070
```

## Using with GitHub Copilot

Once the extension is activated, GitHub Copilot can automatically discover and use the MCP server. You can:

1. Ask Copilot to list your databases
2. Query collections with natural language
3. Ask for database statistics and optimization suggestions
4. Generate and run queries based on your data schema

Example prompts:

- "Show me all databases in my DocumentDB cluster"
- "Find documents in the users collection where age > 25"
- "Optimize this aggregation pipeline for better performance"
- "Create an index on the email field in users collection"

## Development and Testing

### Local Development

1. Build the documentdb-mcp module:

   ```bash
   cd documentdb-mcp
   npm install
   npm run build
   cd ..
   ```

2. Build and run the extension:

   ```bash
   npm install
   npm run build
   npm run watch:ext
   ```

3. Open VS Code and press F5 to launch the Extension Development Host

4. Connect to a DocumentDB cluster in the extension

5. The MCP server will be available at `http://localhost:8070/mcp`

### Testing the MCP Server

You can test the MCP server directly using HTTP requests:

```bash
# Initialize a session
curl -X POST http://localhost:8070/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'

# List available tools
curl -X POST http://localhost:8070/mcp \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: <session-id-from-initialize>" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

## Troubleshooting

### MCP Server Not Starting

Check the Output panel (DocumentDB for VS Code) for error messages:

1. Open Command Palette (Ctrl+Shift+P / Cmd+Shift+P)
2. Run "Developer: Show Logs"
3. Select "Extension Host"
4. Look for `[McpService]` log entries

### Connection Not Synchronizing

If the MCP server doesn't receive the connection:

1. Check that you're using the built-in connection method (not external tools)
2. Verify the connection succeeds in the extension first
3. Check for `[ClustersClient] MCP server connection synchronized` in logs

### Port Conflicts

If port 8070 is already in use:

1. The MCP server will fail to start
2. Check what's using port 8070: `lsof -i :8070` (macOS/Linux) or `netstat -ano | findstr :8070` (Windows)
3. Either stop that process or configure a different port

## Security Considerations

- The MCP server runs on localhost only by default
- No external network access is allowed
- Connection strings are only synchronized to the local MCP server
- The server uses the same credentials as the extension

## Future Enhancements

Potential improvements for the MCP integration:

1. Add configuration UI for MCP server settings
2. Support multiple concurrent connections
3. Add telemetry for MCP tool usage
4. Implement connection pooling
5. Add MCP-specific prompts and resources
6. Support custom MCP tool definitions
