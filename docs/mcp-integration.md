# DocumentDB MCP Server Integration

This document describes the integration of the DocumentDB MCP (Model Context Protocol) server within the VS Code DocumentDB extension.

## Overview

The McpService provides seamless integration between the VS Code DocumentDB extension and the documentdb-mcp server, enabling VS Code and GitHub Copilot to access DocumentDB tools, prompts, and resources.

## Architecture

### McpService

The `McpService` is a singleton service that manages the lifecycle of the documentdb-mcp server:

- **Automatic Initialization**: Started during extension activation
- **Graceful Fallback**: Works without documentdb-mcp module present
- **Connection Sync**: Automatically syncs connections with MCP server
- **Error Handling**: Comprehensive error handling with telemetry

### Integration Points

1. **Extension Activation** (`src/extension.ts`)
   - McpService is initialized automatically when the extension starts
   - Runs in HTTP transport mode
   - Non-blocking initialization (extension works even if MCP fails)

2. **New Connections** (`src/commands/newConnection/ExecuteStep.ts`)
   - When users create new connections, they are automatically synced with MCP
   - Full connection string with credentials is passed to MCP server

3. **Connection Updates** (`src/commands/updateConnectionString/ExecuteStep.ts`)
   - Connection string changes are automatically synced with MCP
   - Ensures MCP server always has the latest connection information

4. **Session Creation** (`src/documentdb/ClusterSession.ts`)
   - When collection views are opened, the connection is synced with MCP
   - Enables real-time access to database schema and data for AI tools

5. **User Commands** (`src/commands/checkMcpStatus/checkMcpStatus.ts`)
   - Command Palette: "DocumentDB: Check MCP Server Status"
   - Provides users visibility into MCP server status
   - Shows connection information and troubleshooting details

## API Usage

The service provides these key methods:

```typescript
// Get the singleton instance
const mcpService = McpService.getInstance();

// Initialize the MCP server (done automatically)
await mcpService.initialize();

// Sync a connection (done automatically during connection workflows)
await mcpService.syncConnection('mongodb://user:pass@host:27017');

// Check connection status
const status = await mcpService.getConnectionStatus();

// Check if server is running
const isRunning = mcpService.isServerRunning;
```

## MCP Module Interface

The service expects the documentdb-mcp module to export these functions:

```typescript
interface DocumentDBMcpModule {
    runHttpServer(): Promise<void>;
    setDocumentDBUri(uri: string): void;
    ensureConnected(): Promise<void>;
    connectToDocumentDB(uri: string, force?: boolean): Promise<void>;
    getConnectionStatus(): Promise<{ connected: boolean; uri?: string }>;
}
```

## User Features

### Command Palette

Users can check MCP server status via Command Palette:
- Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
- Type "DocumentDB: Check MCP Server Status"
- Get real-time status information and troubleshooting details

### Automatic Sync

- **New Connections**: Automatically synced when created
- **Connection Updates**: Automatically synced when modified
- **Collection Access**: Automatically synced when opening collection views
- **Background Operation**: All sync operations are non-blocking and optional

## Benefits

1. **Seamless Integration**: No manual setup required - works automatically
2. **AI Enhancement**: GitHub Copilot and VS Code can access DocumentDB context
3. **Real-time Sync**: Connections are always up-to-date in MCP server
4. **Fault Tolerance**: Extension works normally even without MCP module
5. **Telemetry**: Comprehensive logging and telemetry for debugging
6. **User Visibility**: Command to check status and troubleshoot issues

## Development Environment

- Works in both development and production environments
- Gracefully handles missing documentdb-mcp submodule
- Comprehensive error logging for troubleshooting
- TypeScript strict mode and ESLint compliant

## Testing

Unit tests verify:
- Singleton pattern implementation
- Graceful handling of missing MCP module
- Error handling and dispose functionality
- Non-blocking operation when MCP is unavailable

## Implementation Files

### Core Service
- `src/services/McpService.ts` - Main service implementation

### Integration Points
- `src/extension.ts` - Service registration and initialization
- `src/commands/newConnection/ExecuteStep.ts` - New connection sync
- `src/commands/updateConnectionString/ExecuteStep.ts` - Connection update sync
- `src/documentdb/ClusterSession.ts` - Session-based sync

### User Commands
- `src/commands/checkMcpStatus/checkMcpStatus.ts` - Status check command

### Configuration
- `package.json` - Command registration for Command Palette

### Tests
- `test/McpService.test.ts` - Unit tests

The implementation ensures the VS Code extension remains fully functional regardless of MCP server availability, while providing enhanced AI capabilities when the documentdb-mcp module is present.