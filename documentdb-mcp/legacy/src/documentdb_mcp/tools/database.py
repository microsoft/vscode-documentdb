from typing import Dict, List

from mcp.server.fastmcp import Context

from src.documentdb_mcp.models import DBInfoResponse, ErrorResponse, SuccessResponse


async def list_databases(ctx: Context) -> List[str]:
    """
    List all databases in the DocumentDB instance.
    
    Returns:
        List of database names
    """
    try:
        client = ctx.request_context.lifespan_context.client
        return client.list_database_names()
    except Exception as e:
        return ErrorResponse(error=str(e))

async def db_stats(ctx: Context, db_name: str) -> Dict:
    """
    Get detailed statistics about a database's size and storage usage.

    Containing
    - size: Total data size in bytes
    - avgObjSize: Average object size in bytes
    - storageSize: Storage size in bytes
    - indexSize: Total index size in bytes
    - totalSize: Total size in bytes
    - scaleFactor: Scale factor for size measurements (default=1)
    
    Args:
        db_name: Name of the database
    """
    try:
        client = ctx.request_context.lifespan_context.client
        db = client[db_name]
        return db.command("dbStats")
    except Exception as e:
        return ErrorResponse(error=str(e))

async def get_db_info(ctx: Context, db_name: str) -> DBInfoResponse:
    """
    Get database information including name and collection names.
    
    Args:
        db_name: Name of the database
    """
    try:
        client = ctx.request_context.lifespan_context.client
        db = client[db_name]
        stats = {
            "collections": len(db.list_collection_names()),
            "estimated_total_count": sum(
                db[collection_name].estimated_document_count() 
                for collection_name in db.list_collection_names()
            )
        }
        return DBInfoResponse(
            database_name=db.name,
            collection_names=db.list_collection_names(),
            stats=stats
        )
    except Exception as e:
        return ErrorResponse(error=str(e))

async def drop_database(ctx: Context, db_name: str) -> SuccessResponse:
    """
    Drop a database and all its collections.
    
    Args:
        db_name: Name of the database to drop
    """
    try:
        client = ctx.request_context.lifespan_context.client
        client.drop_database(db_name)
        return SuccessResponse(message="Database dropped successfully")
    except Exception as e:
        return ErrorResponse(error=str(e))
