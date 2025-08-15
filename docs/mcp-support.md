# DocumentDB MCP (Model Context Protocol) Support

This document describes the MCP (Model Context Protocol) support in the DocumentDB VS Code extension, which enables AI models like GitHub Copilot to interact with DocumentDB/MongoDB databases.

## Overview

The DocumentDB MCP server provides a standardized interface for AI models to:
- Connect to DocumentDB/MongoDB databases
- Query collections and databases
- Switch between different database contexts
- Get schema information from collections

## Getting Started

### 1. Start the MCP Server

To enable MCP functionality, you need to start the MCP server:

1. Open the DocumentDB view in VS Code
2. Click the "MCP: Start Server" button in the view title bar, OR
3. Use the Command Palette (`Cmd/Ctrl + Shift + P`) and run "DocumentDB: MCP: Start Server"

### 2. Set a Connection

Before using MCP tools, you need to set an active connection:

**Option A: From existing connections**
1. Right-click on any cluster in the Connections View
2. Select "MCP: Set Connection"

**Option B: Via MCP tools**
Use the `set_connection` tool with a connection string:
```json
{
  "tool": "set_connection",
  "arguments": {
    "connectionString": "mongodb://username:password@host:port/database",
    "databaseName": "myDatabase",
    "collectionName": "myCollection"
  }
}
```

### 3. Switch Context

You can switch database and collection contexts:

**Switch Database:**
- Use Command Palette: "DocumentDB: MCP: Switch Database"
- Or use the `set_connection` tool with only `databaseName`

**Switch Collection:**
- Use Command Palette: "DocumentDB: MCP: Switch Collection"
- Or use the `set_connection` tool with only `collectionName`

## Available MCP Tools

### `set_connection`
Set or update the current connection context.

**Parameters:**
- `connectionString` (optional): MongoDB connection string
- `databaseName` (optional): Database name to use
- `collectionName` (optional): Collection name to use

### `get_connection_info`
Get information about the current connection context.

**Returns:** JSON object with current connection state.

### `list_databases`
List all databases in the current connection.

**Returns:** Array of database names.

### `list_collections`
List all collections in the specified or current database.

**Parameters:**
- `databaseName` (optional): Database name (uses current context if not provided)

**Returns:** Array of collection names.

### `run_query`
Execute a MongoDB query on the specified or current collection.

**Parameters:**
- `query` (required): MongoDB query string (e.g., `"{name: 'John'}"`)
- `databaseName` (optional): Database name (uses current context if not provided)
- `collectionName` (optional): Collection name (uses current context if not provided)
- `limit` (optional): Maximum number of documents to return (default: 100, max: 1000)

**Returns:** Query results as JSON.

### `get_collection_schema`
Get schema information for the specified or current collection.

**Parameters:**
- `databaseName` (optional): Database name (uses current context if not provided)
- `collectionName` (optional): Collection name (uses current context if not provided)

**Returns:** Schema information including inferred field types and sample count.

## Commands

The following VS Code commands are available:

- `DocumentDB: MCP: Start Server` - Start the MCP server
- `DocumentDB: MCP: Stop Server` - Stop the MCP server
- `DocumentDB: MCP: Switch Database` - Switch to a different database
- `DocumentDB: MCP: Switch Collection` - Switch to a different collection
- `DocumentDB: MCP: Set Connection` - Set connection from tree view (context menu)

## Configuration

No additional configuration is required. The MCP server automatically starts when activated and uses existing DocumentDB connections stored in the extension.

## Troubleshooting

### MCP Server Won't Start
- Ensure you have the @modelcontextprotocol/sdk dependency installed
- Check the VS Code Output panel for error messages

### Connection Issues
- Verify your connection strings are valid
- Check that the MongoDB server is accessible
- Ensure proper authentication credentials

### Query Errors
- Verify the MongoDB query syntax
- Check that the database and collection exist
- Ensure you have proper permissions to read the data

## Architecture

The MCP support is implemented as:
- `McpService` - Main service managing the MCP server instance
- `McpConnectionCommands` - VS Code commands for MCP operations
- MCP tools that map to DocumentDB operations using existing `ClusterSession` and `ClustersClient` classes

The implementation reuses the existing DocumentDB connection management and query execution infrastructure, ensuring consistency with the rest of the extension.