from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from mcp.server.fastmcp import FastMCP
from pymongo import MongoClient

from src.documentdb_mcp.mcp_config import DOCUMENTDB_URI
from src.documentdb_mcp.models import DocumentDBContext


@asynccontextmanager
async def documentdb_lifespan(server: FastMCP) -> AsyncIterator["DocumentDBContext"]:
    """Manages the DocumentDB client lifecycle."""
    try:
        client = MongoClient(DOCUMENTDB_URI)
        yield DocumentDBContext(client=client)
    finally:
        client.close()
