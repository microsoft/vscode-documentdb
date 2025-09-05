import asyncio

from src.documentdb_mcp.app import mcp
from src.documentdb_mcp.mcp_config import TRANSPORT


async def main():
    transport = TRANSPORT
    print(f"Starting MCP server with transport: {transport}")
    if transport == 'sse':
        await mcp.run_sse_async()
    elif transport == 'stdio':
        await mcp.run_stdio_async()
    elif transport == 'streamable-http':
        await mcp.run_streamable_http_async()
    else:
        raise ValueError(f"Invalid transport: {transport}")

if __name__ == "__main__":
    asyncio.run(main())
