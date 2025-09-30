# Steps for Setting Up Index Advisor with Github Copilot
This guide provides instructions for setting up the Index Advisor MVP. **Currently, it is required to run on Windows**, but support for additional operating systems will be added soon.

## Prerequisites
- Python is required for setting up the MVP. We use `uv` for project management.
- Install the `GitHub Copilot` extension in VS Code.

## Install Dependencies
Navigate to the project directory and run the following commands to install the dependencies:
```
pip install uv
uv venv
uv pip install -e .
```

## Configure Environment Variables
Create and modify the `.env` file at the root of the project:
```
cp .env.example .env
# In MVP, we use 'streamable-http' mode
# Need to update DOCUMENTDB_URI with your cluster's connection string
```

## Start MCP Server
Run the following command to start the MCP server locally:
```
uv run .\src\documentdb_mcp\main.py
```

## Configuration Instructions
![Access Profiles Editor](/pics/Accessing_Profiles_Editor.png)

In VS Code, open the Profiles editor by navigating to `File -> Preferences -> Profile -> Profiles`.

![Edit Profile Settings](/pics/Edit_Settings_File.png)

Double-click `Settings` to edit the `settings.json` file and add the following block:
```
// The codeGeneration is deprecating and is migrating to instruction files
// We only use this filed to set up MVP
"github.copilot.chat.codeGeneration.instructions": [
        {
            "text": "Always use optimize APIs for resolving performance issue, rather than collect data by yourself."
        },
        {
            "text": "When answering questions about queries, **always retrieve real data from the database** using the provided MCP tools."
        },
        {
            "text": "**Never invent or assume data** if it is not in context."
        },
        {
            "text": "Suggest **Considering enable Index-Only scan feature to improve the performance** when optimize count operation"
        }
    ],
    "chat.mcp.autostart": true
```

## Configure the MCP Server

![Edit MCP Servers](/pics/Edit_MCP_Servers.png)

Double-click MCP Servers in the Profiles editor to edit the `mcp.json` file:
```
{
  "servers": {
    "documentDB": {
      "url": "http://localhost:8070/mcp",
      "type": "http"
    }
  },
  "inputs": []
}
```

Start the server defined in the `mcp.json` file

![Start MCP Server](/pics/Start_MCP_Server.png)

**NOTE**: You need to restart the server if you changed the code to apply the new updates.

## Confirm the DocumentDB MCP is Selected
Open the GitHub Copilot chat window and verify that the DocumentDB MCP server is selected.

![Verify MCP Server Selected](/pics/Confirm_MCP_Selected.png)

**NOTE**: It is highly recommended to uncheck unused MCP servers and tools to improve the performance and stability of the Index Advisor.

## Add Test Data
Run the following scripts to ingest testing data into your cluster
```
python .\query_generation_data.py
python .\index_advisor_data.py
```

## Test Query Generation
![Test Query Generation](/pics/Test_Query_Generation.png)

Change the copilot mode to `Agent` and type in: `Help me generate a mongoshell query to get how many books bought by Americans`

![Generation Process](/pics/Generation_Process.png)

The agent is expected to call the MCP Server APIs to get databases and collections list, and try to retrieve sample documents from relevant collections. (You nned to auth the agent on every API calls by clicking `Continue` during the process; or you can choose broader auth scope from droplist)

After fetching required information, the agent will generate mongoshell query for you. Then you can copy the code block and run it in your client:

![Generation Result](/pics/Generation_Result.png)

## Test Index Advisor
Similarly, you can ask performance related questions and check optimization solutions

![Index Advisor Result](/pics/Index_Advisor_Result.png)