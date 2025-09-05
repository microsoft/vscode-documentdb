# DocumentDB MCP Server

A Model Context Protocol (MCP) server implementation for DocumentDB operations, enabling seamless integration with AI agents and LLMs.

## Supported Operations

| Category | Operation | Description |
|----------|-----------|-------------|
| **Database Management** | `list_databases` | List all databases |
| | `db_stats` | Get database statistics |
| | `get_db_info` | Get database information |
| | `drop_database` | Drop a database |
| **Collection Management** | `collection_stats` | Get collection statistics |
| | `rename_collection` | Rename a collection |
| | `drop_collection` | Drop a collection |
| **Index Management** | `create_index` | Create an index |
| | `list_indexes` | List indexes |
| | `drop_index` | Drop an index |
| | `current_ops` | Monitor current operations (including index builds) |
| **Document Operations** | `find_documents` | Find documents with pagination |
| | `find_and_modify` | Find and modify a document |
| | `count_documents` | Count documents |
| | `insert_document` | Insert a single document |
| | `insert_many` | Insert multiple documents |
| | `update_document` | Update a single document |
| | `update_many` | Update multiple documents |
| | `delete_document` | Delete a single document |
| | `delete_many` | Delete multiple documents |
| **Aggregation & Query** | `aggregate` | Run aggregation pipelines |
| | `explain_aggregate_query` | Explain aggregation query plans |
| | `explain_find_query` | Explain find query plans |

## Onboard DocumentDB MCP Server

### Prerequisites
- DocumentDB must be running with a valid connection URI
- Refer to the [DocumentDB Setup Guide](#documentdb-setup-guide) for setup instructions

### Transport Options
- **HTTP-Stream**: Ideal for web-based applications and multi-client scenarios
- **STDIO**: Recommended for local development and single-client use
- **SSE**: Deprecated in favor of HTTP-Stream

### Using Docker (Recommended)

1. Copy and configure the environment file:
```bash
cp .env.example .env
# Set TRANSPORT=streamable-http in .env
# Update DocumentDB URI and other variables
```

2. Build and run the Docker container:
```bash
docker build -t documentdb-mcp --build-arg PORT=8070 .
docker run --env-file .env -p 8070:8070 documentdb-mcp
```
The MCP server will run as an API endpoint within the container.
Note: You can change the port number (8070) if needed, but ensure consistency between the build argument and port mapping.

### Local Setup

#### Prerequisites
- Python environment
  - uv for project management


#### Installation
```bash
pip install uv
uv venv
uv pip install -e .
```

#### Configuration
```bash
cp .env.example .env
# Edit .env with your DocumentDB configuration and transport variables
```


#### Running the Server
- **Streamable HTTP**: 
  ```bash
  # Set TRANSPORT=streamable-http or sse in .env then:
  uv run src/documentdb_mcp.py
  ```
- **Stdio**: 
  - The MCP client will automatically launch the server
  - No manual server start required
  - Check mcp.json for more information
### Client Configuration

#### VSCode
```json
{
    "DocumentDB_stdio": {
        "type": "stdio",
        "command": "uv",
        "args": [
            "run",
            "--with",
            "mcp[cli]>=1.9.3,pymongo>=4.12.0,httpx>=0.28.1",
            "mcp",
            "run",
            "your_script_path"
        ],
        "env": {
            "DOCUMENTDB_URI": "your_connection_string",
            "DB_NAME": "your_database_name"
        }
    },
    "DocumentDB_sse": {
            "type": "sse",
            "url": "http://localhost:8070/sse"
        },
}
```

#### Important Notes
- Copilot will automatically detect and try to onboard your MCP with one-click `start` running
- For Streamable HTTP: Start the server first using `uv run src/documentdb_mcp.py`
- For Stdio: VSCode will manage the server startup automatically
- For SSE: Same as Streamable HTTP, Server must be running first (refer to the previous section for local/Docker setup)
- Windows users: Use PowerShell for VSCode and Copilot setup to avoid connection issues.
- For more information, refer to the VSCode official guide [here](https://code.visualstudio.com/docs/copilot/chat/chat-agent-mode).

#### Claude and Windsurf
The same configuration can be used for Claude and Windsurf.

### DocumentDB Setup Guide
To get started with DocumentDB locally, follow these steps:

1. Pull the latest DocumentDB local image:
```bash
docker pull ghcr.io/microsoft/documentdb/documentdb-local:latest
```

2. Pull the latest gateway image:
```bash
# From https://github.com/microsoft/documentdb/pkgs/container/documentdb%2Fdocumentdb-local/419775665?tag=latest
docker pull ghcr.io/microsoft/documentdb/documentdb-local:latest
```

3. Run the DocumentDB container:
```bash
docker run -dt -p 10260:10260 \
  -e USERNAME=your_username \
  -e PASSWORD=your_password \
  ghcr.io/microsoft/documentdb/documentdb-local:latest
```

4. Connect to DocumentDB using mongosh:
```bash
# Option 1: Direct connection
mongosh localhost:10260 \
  -u your_username \
  -p your_password \
  --authenticationMechanism SCRAM-SHA-256 \
  --tls \
  --tlsAllowInvalidCertificates

# Option 2: Connection string (recommended)
mongosh "mongodb://your_username:your_password@localhost:10260/?authMechanism=SCRAM-SHA-256&tls=true&tlsAllowInvalidCertificates=true"
```

The connection string from Option 2 should be used as the `DOCUMENTDB_URI` environment variable.

For more detailed information about the DocumentDB gateway, refer to the official documentation [here](https://github.com/microsoft/documentdb/blob/main/docs/v1/gateway.md#getting-started-with-documentdb-gateway).

### Environment Variables
After provisioning your DocumentDB instance, set the following in your `.env` file:
```bash
DOCUMENTDB_URI=your_documentdb_uri
```

Make sure to replace `your_documentdb_uri` with your actual DocumentDB connection string.



#### Debugging the MCP

Use the MCP Inspector to validate the MCP server, make sure it's up and running!

1. Install the inspector:
```bash
npx @modelcontextprotocol/inspector
```

2. For different transports:
   - **Stdio**: Start in development mode:
     ```bash
     uv run mcp dev vcore_mcp.py
     ```
   - **Streamable HTTP**: Ensure server is running first, then connect to `http://[host]:[port]/mcp`
   - **SSE**: Ensure server is running first, then connect to `http://[host]:[port]/sse`

For more details, see the [MCP Inspector documentation](https://modelcontextprotocol.io/docs/tools/inspector).

## Contributing

This project welcomes contributions and suggestions. Most contributions require you to agree to a Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us the rights to use your contribution. For details, visit https://cla.opensource.microsoft.com.

When you submit a pull request, a CLA bot will automatically determine whether you need to provide a CLA and decorate the PR appropriately (e.g., status check, comment). Simply follow the instructions provided by the bot. You will only need to do this once across all repos using our CLA.

This project has adopted the Microsoft Open Source Code of Conduct. For more information see the Code of Conduct FAQ or contact opencode@microsoft.com with any additional questions or comments.
