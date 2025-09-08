# DocumentDB MCP Server (TypeScript)

A Model Context Protocol (MCP) server for DocumentDB/MongoDB database operations, implemented in TypeScript.

## Features

This MCP server provides comprehensive DocumentDB/MongoDB database operations through a set of tools organized by category:

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

## Installation

1. Clone the repository and navigate to the `mcp_ts` directory
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file from the example:
   ```bash
   cp .env.example .env
   ```
4. Configure your DocumentDB/MongoDB connection in `.env`:
   ```env
   DOCUMENTDB_URI=mongodb://localhost:27017
   ```

## Usage

### Development
```bash
npm run dev
```

### Production
```bash
npm run build
npm start
```

## Configuration

The server can be configured using environment variables:

- `TRANSPORT` - Transport mode: "stdio" (default) or "streamable-http"
- `DOCUMENTDB_URI` - MongoDB/DocumentDB connection string
- `HOST` - Server host (default: "localhost", used for HTTP transport)
- `PORT` - Server port (default: 8070, used for HTTP transport)

### Transport Modes

#### stdio (Default)
The server communicates over standard input/output streams. This is the recommended mode for MCP client integration.

```env
TRANSPORT=stdio
```

#### streamable-http
The server runs as an HTTP server implementing the MCP Streamable HTTP transport specification. This enables browser-based clients and HTTP-based integrations.

```env
TRANSPORT=streamable-http
HOST=localhost
PORT=8070
```

When running in HTTP mode, the server will be available at:
- **Endpoint**: `http://localhost:8070/mcp`
- **Methods**: GET (SSE streams), POST (requests), DELETE (session termination)

## MCP Integration

This server implements the Model Context Protocol and can be used with any MCP-compatible client. All tools follow the MCP specification for tool calling and response formatting.

### Example Tool Call

```json
{
  "name": "find_documents",
  "arguments": {
    "db_name": "mydb",
    "collection_name": "users",
    "query": {"status": "active"},
    "limit": 10
  }
}
```

## Project Structure

```
src/
├── main.ts              # Entry point
├── server.ts            # MCP server setup and tool registration
├── config.ts            # Configuration management
├── models/              # TypeScript interfaces and types
│   └── index.ts
├── context/             # MongoDB client lifecycle management
│   └── documentdb.ts
└── tools/               # Tool implementations
    ├── database.ts      # Database operations
    ├── collection.ts    # Collection operations
    ├── document.ts      # Document CRUD operations
    └── index.ts         # Index management
```

## Error Handling

All tools implement comprehensive error handling and return structured error responses when operations fail. Errors include descriptive messages to help with debugging.

## TypeScript Features

- Strict TypeScript configuration
- Comprehensive type definitions
- ESM module support
- Proper async/await patterns
- Error boundary handling

## Dependencies

- `@modelcontextprotocol/sdk` - MCP SDK for TypeScript
- `mongodb` - Official MongoDB Node.js driver
- `dotenv` - Environment variable management
- `express` - Web framework for HTTP transport (when using streamable-http)
- `cors` - CORS middleware for HTTP transport

## License

See LICENSE.md in the project root.