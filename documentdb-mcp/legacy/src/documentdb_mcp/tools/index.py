from typing import Dict, List, Optional

from mcp.server.fastmcp import Context

from src.documentdb_mcp.models import ErrorResponse, SuccessResponse


async def create_index(ctx: Context, db_name: str, collection_name: str, keys: Dict, 
                      unique: bool = False, name: Optional[str] = None) -> SuccessResponse:
    """
    Create an index on a collection.
    
    Args:
        db_name: Name of the database
        collection_name: Name of the collection
        keys: Dictionary defining the index (e.g., {'field': 1} for ascending)
        unique: Whether the index should be unique
        name: Optional name for the index
    """
    try:
        client = ctx.request_context.lifespan_context.client
        db = client[db_name]
        collection = db[collection_name]
        collection.create_index(keys, unique=unique, name=name)
        return SuccessResponse(message="Index created successfully")
    except Exception as e:
        return ErrorResponse(error=str(e))

async def list_indexes(ctx: Context, db_name: str, collection_name: str) -> List[Dict]:
    """
    List all indexes on a collection.
    
    Args:
        db_name: Name of the database
        collection_name: Name of the collection
    """
    try:
        client = ctx.request_context.lifespan_context.client
        db = client[db_name]
        collection = db[collection_name]
        indexes = list(collection.list_indexes())
        return indexes
    except Exception as e:
        return ErrorResponse(error=str(e))

async def drop_index(ctx: Context, db_name: str, collection_name: str, index_name: str) -> SuccessResponse:
    """
    Drop an index from a collection.
    
    Args:
        db_name: Name of the database
        collection_name: Name of the collection
        index_name: Name of the index to drop
    """
    try:
        client = ctx.request_context.lifespan_context.client
        db = client[db_name]
        collection = db[collection_name]
        collection.drop_index(index_name)
        return SuccessResponse(message="Index dropped successfully")
    except Exception as e:
        return ErrorResponse(error=str(e))

async def current_ops(ctx: Context, ops: Optional[Dict]) -> Dict:
    """
    Get information about current MongoDB operations.

    Args:
        ops: Optional filter to narrow down the operations returned

    Example command for index building
            {"$or": [
                {"op": "command", "command.createIndexes": {"$exists": True}},
                {"op": "none", "msg": "/^Index Build/"},
            ]}
    """
    try:
        client = ctx.request_context.lifespan_context.client
        command = {"currentOp": True}
        if ops:
            command.update(ops)
        return client.admin.command(command)
    except Exception as e:
        return ErrorResponse(error=str(e))

async def index_stats(ctx: Context, db_name: str, collection_name: str) -> Dict:
    """
    Get statistics about the indexes on a collection.

    Args:
        db_name: Name of the database
        collection_name: Name of the collection
    """
    try:
        client = ctx.request_context.lifespan_context.client
        db = client[db_name]
        collection = db[collection_name]
        stats = collection.aggregate([{"$indexStats": {}}])
        return {"indexes": list(stats)}
    except Exception as e:
        return ErrorResponse(error=str(e))
