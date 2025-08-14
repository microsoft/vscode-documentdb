# MCP (Model Context Protocol) Support

This document describes the MCP (Model Context Protocol) support added to the VS Code DocumentDB extension.

## Overview

The MCP integration allows you to interact with your DocumentDB clusters using AI-powered chat functionality. This MVP implementation provides basic collection listing capabilities through Azure OpenAI integration.

## Features

### 1. Link MCP Command

**Command:** `DocumentDB: Link MCP`

- Starts the MCP server with Azure OpenAI connection
- Configures Azure OpenAI credentials if not already set
- Shows status notifications about server startup

### 2. MCP Chat Context Menu

**Location:** Right-click on any MongoDB cluster in the tree view

- **Menu Item:** "MCP Chat"
- **Functionality:** Lists collections in the selected cluster
- **Output:** Shows collections in a quick pick dialog

## Configuration

The MCP feature can be configured through VS Code settings:

### Settings

- **`documentDB.mcp.enabled`** (boolean, default: false)
  - Enable/disable MCP support
  
- **`documentDB.mcp.azureOpenAiKey`** (string)
  - Your Azure OpenAI API key
  - Can be configured interactively when using Link MCP command
  
- **`documentDB.mcp.azureOpenAiEndpoint`** (string)
  - Your Azure OpenAI endpoint URL
  - Optional, can be set during interactive configuration

## Usage

### Setting Up MCP

1. **Configure Azure OpenAI:**
   - Run the "DocumentDB: Link MCP" command from the command palette (`Ctrl/Cmd + Shift + P`)
   - If Azure OpenAI key is not configured, you'll be prompted to enter it
   - Enter your Azure OpenAI API key and endpoint when prompted

2. **Start MCP Server:**
   - The server will start automatically after configuration
   - You'll see confirmation messages in the output panel and notifications

### Using MCP Chat

1. **Access MCP Chat:**
   - Navigate to the DocumentDB Connections view
   - Right-click on any MongoDB cluster
   - Select "MCP Chat" from the context menu

2. **View Results:**
   - The extension will process your request
   - Collections will be displayed in a quick pick dialog
   - Select any collection to see more details

## Implementation Details

### MVP Scope

This is an MVP (Minimum Viable Product) implementation with the following characteristics:

- **Hardcoded Collections:** Returns predefined collection names for demonstration
- **Basic UI:** Uses VS Code's built-in quick pick for results
- **Simulated Processing:** Mimics real MCP server behavior without actual LLM processing

### Architecture

- **`McpServerService`:** Core service managing MCP server lifecycle and LLM integration
- **Commands:**
  - `linkMcp`: Starts MCP server with configuration
  - `mcpChat`: Handles chat requests for clusters
- **Configuration:** Uses VS Code settings for Azure OpenAI credentials

### File Structure

```
src/
├── services/
│   ├── McpServerService.ts          # Core MCP service
│   └── mcpServerService.test.ts     # Unit tests
├── commands/
│   ├── linkMcp/
│   │   └── linkMcp.ts              # Link MCP command
│   └── mcpChat/
│       └── mcpChat.ts              # MCP Chat command
└── ...
```

## Future Enhancements

The MVP can be extended with:

1. **Real MCP Protocol:** Implement actual MCP server communication
2. **Advanced Queries:** Support complex database operations beyond collection listing
3. **Enhanced UI:** Custom webview for richer chat experience
4. **Multiple LLM Providers:** Support for different AI services
5. **Persistent Chat History:** Save and restore conversation history
6. **Schema Analysis:** AI-powered database schema insights

## Troubleshooting

### Common Issues

1. **"MCP server is not running"**
   - Solution: Run "DocumentDB: Link MCP" command first

2. **Azure OpenAI connection failed**
   - Check your API key and endpoint in settings
   - Verify network connectivity

3. **No collections shown**
   - Ensure you're right-clicking on a valid MongoDB cluster
   - Check that the cluster is accessible

### Logs

Check the "DocumentDB for VS Code" output channel for detailed logs:
- View → Output → Select "DocumentDB for VS Code" from dropdown

## Contributing

When extending MCP functionality:

1. Follow the existing command pattern under `src/commands/`
2. Add proper TypeScript types and error handling
3. Include unit tests for new functionality
4. Update this documentation for new features
5. Use the localization system (`vscode.l10n.t()`) for user-facing strings

## Security Notes

- Azure OpenAI keys are stored securely using VS Code's settings
- Sensitive information is masked in telemetry
- No database credentials are exposed through MCP chat