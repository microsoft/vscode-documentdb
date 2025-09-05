from enum import Enum
from typing import Dict, List

from mcp.server.fastmcp import Context

from src.documentdb_mcp.models import (
    ErrorResponse,
)
from src.documentdb_mcp.tools.collection import (
    collection_stats,
)
from src.documentdb_mcp.tools.document import (
    explain_aggregate_query,
    explain_find_query,
    explain_count_query
)
from src.documentdb_mcp.tools.index import (
    list_indexes,
    index_stats,
)
from src.documentdb_mcp.models import ErrorResponse

class QueryType(Enum):
    FIND = "find"
    AGGREGATE = "aggregate"

def normalize_query_shape(query: Dict) -> Dict:
    """Convert a query into a normalized 'shape' with EQ and RANGE fields."""
    eq_fields = []
    range_fields = []

    for k, v in query.items():
        if isinstance(v, dict):
            # checking range operator
            if any(op in v for op in ["$gt", "$gte", "$lt", "$lte", "$in", "$nin", "$regex"]):
                range_fields.append(k)
            else:
                eq_fields.append(k)
        else:
            eq_fields.append(k)

    # construct shape key
    shape_key = f"EQ[{','.join(eq_fields)}]|RANGE[{','.join(range_fields)}]"
    return {
        "shapeKey": shape_key,
        "eqFields": eq_fields,
        "rangeFields": range_fields
    }

def query_shape(query: Dict) -> Dict:
    """Normalize a query into shapes for analysis.

    Args:
        query: A query dictionary to normalize.
    """
    try:
        shape_info = normalize_query_shape(query.get("filter", query))
        return shape_info
    except Exception as e:
        return ErrorResponse(error=str(e))

def analyze_explain_metrics(explain_output: dict, projection: dict = None) -> dict:
    """
    Analyze MongoDB explain output (including aggregate with multiple stages)
    and compute key metrics for each stage.

    Returns:
        dict with a list of per-stage metrics and suggestions
    """

    def search_for_sort(stage_dict):
        """Recursively search for SORT stage"""
        if not stage_dict:
            return False
        if stage_dict.get("stage") == "SORT":
            return True
        for key in ["inputStage", "inputStages", "shards", "innerStage", "outerStage"]:
            substage = stage_dict.get(key)
            if isinstance(substage, dict):
                if search_for_sort(substage):
                    return True
            elif isinstance(substage, list):
                for s in substage:
                    if search_for_sort(s):
                        return True
        return False

    results = []

    # --- case 1: simple query (no "stages")
    if "stages" not in explain_output:
        query_planner = explain_output.get("queryPlanner", {})
        winning_plan = query_planner.get("winningPlan", {})
        execution_stats = explain_output.get("executionStats", {})

        stage_type = winning_plan.get("stage", "UNKNOWN")
        n_returned = execution_stats.get("nReturned", 0)
        total_docs_examined = execution_stats.get("totalDocsExamined", 0)
        total_keys_examined = execution_stats.get("totalKeysExamined", 0)

        amplification_ratio = (
            total_docs_examined / n_returned if n_returned else float("inf")
        )
        key_doc_ratio = (
            total_keys_examined / total_docs_examined if total_docs_examined else float("inf")
        )

        covered = False
        if projection and winning_plan.get("inputStage"):
            index_keys = set(winning_plan.get("inputStage", {}).get("keyPattern", {}).keys())
            proj_fields = set(k for k, v in projection.items() if v)
            if "_id" in projection and projection["_id"] != 0:
                proj_fields.add("_id")
            covered = proj_fields.issubset(index_keys)

        results.append({
            "stage": stage_type,
            "healthMetrics": {
                "nReturned": n_returned,
                "totalDocsExamined": total_docs_examined,
                "totalKeysExamined": total_keys_examined,
                "amplificationRatio": amplification_ratio,
                "keyDocRatio": key_doc_ratio,
                "triggersSort": search_for_sort(winning_plan),
                "covered": covered
            }
        })

    # --- case 2: aggregation with multiple stages
    else:
        for stage in explain_output["stages"]:
            # stage is like {"$cursor": {...}} or {"$sort": {...}}
            stage_name, stage_detail = next(iter(stage.items()))

            qp = stage_detail.get("queryPlanner", {})
            winning_plan = qp.get("winningPlan", {})
            stats = stage_detail.get("executionStats", {})

            stage_type = winning_plan.get("stage", stage_name.strip("$").upper())

            n_returned = stats.get("nReturned", 0)
            total_docs_examined = stats.get("totalDocsExamined", 0)
            total_keys_examined = stats.get("totalKeysExamined", 0)

            amplification_ratio = (
                total_docs_examined / n_returned if n_returned else float("inf")
            )
            key_doc_ratio = (
                total_keys_examined / total_docs_examined if total_docs_examined else float("inf")
            )

            covered = False
            if projection and winning_plan.get("inputStage"):
                index_keys = set(winning_plan.get("inputStage", {}).get("keyPattern", {}).keys())
                proj_fields = set(k for k, v in projection.items() if v)
                if "_id" in projection and projection["_id"] != 0:
                    proj_fields.add("_id")
                covered = proj_fields.issubset(index_keys)

            results.append({
                "stage": stage_type,
                "healthMetrics": {
                    "nReturned": n_returned,
                    "totalDocsExamined": total_docs_examined,
                    "totalKeysExamined": total_keys_examined,
                    "amplificationRatio": amplification_ratio,
                    "keyDocRatio": key_doc_ratio,
                    "triggersSort": search_for_sort(winning_plan),
                    "covered": covered
                }
            })

    return {"stagesAnalysis": results}

async def optimize_find_query(
    ctx: Context,
    db_name: str,
    collection_name: str,
    query_doc: Dict,
    sort: Dict = None,
    limit: int  = None,
    projection: Dict = None
) -> dict:
    """Provide all the information needed for optimizing find query.

    Args:
        db_name: Name of the database.
        collection_name: Name of the collection.
        query_doc: The query document extracted from the original query.
        sort: The sort stage behind the find query.
        limit: The limit stage behind the find query.
        projection: The projection stage behind the find query.
    """
    try:
        explain_output = await explain_find_query(ctx, db_name, collection_name, query=query_doc, sort=sort, limit=limit, projection=projection)
        analysis = analyze_explain_metrics(explain_output, projection)
        indexes = await list_indexes(ctx, db_name, collection_name)
        indexes_stats = await index_stats(ctx, db_name, collection_name)
        collections_stats = await collection_stats(ctx, db_name, collection_name)
        return {
            "explain": explain_output,
            "analysis": analysis,
            "indexes": indexes,
            "indexes_stats": indexes_stats,
            "collections_stats": collections_stats
        }
    except Exception as e:
        return ErrorResponse(error=str(e))

async def optimize_count_query(
    ctx: Context,
    db_name: str,
    collection_name: str,
    query: Dict
) -> dict:
    """Provide all the information needed for optimizing count query.

    Args:
        db_name: Name of the database.
        collection_name: Name of the collection.
        query: The query from the original count query.
    """
    try:
        explain_output = await explain_count_query(ctx, db_name, collection_name, query)
        analysis = analyze_explain_metrics(explain_output)
        indexes = await list_indexes(ctx, db_name, collection_name)
        indexes_stats = await index_stats(ctx, db_name, collection_name)
        collections_stats = await collection_stats(ctx, db_name, collection_name)
        return {
            "explain": explain_output,
            "analysis": analysis,
            "indexes": indexes,
            "indexes_stats": indexes_stats,
            "collections_stats": collections_stats
        }
    except Exception as e:
        return ErrorResponse(error=str(e))
    
async def optimize_aggregate_query(
    ctx: Context,
    db_name: str,
    collection_name: str,
    pipeline: List[Dict]
) -> dict:
    """Provide all the information needed for optimizing aggregate query.

    Args:
        db_name: Name of the database.
        collection_name: Name of the collection.
        pipeline: The pipeline from the original query.
    """
    try:
        explain_output = await explain_aggregate_query(ctx, db_name, collection_name, pipeline)
        analysis = analyze_explain_metrics(explain_output)
        indexes = await list_indexes(ctx, db_name, collection_name)
        indexes_stats = await index_stats(ctx, db_name, collection_name)
        collections_stats = await collection_stats(ctx, db_name, collection_name)
        return {
            "explain": explain_output,
            "analysis": analysis,
            "indexes": indexes,
            "indexes_stats": indexes_stats,
            "collections_stats": collections_stats
        }
    except Exception as e:
        return ErrorResponse(error=str(e))

async def list_databases_for_generation(ctx: Context) -> List[str]:
    """
    List databases in the DocumentDB instance to provide better insights for query generation.
    
    Returns:
        List of database names
    """
    try:
        client = ctx.request_context.lifespan_context.client
        return {
            "databases": client.list_database_names(),
            "next_step": "Run `get_db_info_for_generation` on relative databases"
        }
    except Exception as e:
        return ErrorResponse(error=str(e))

async def db_stats_for_generation(ctx: Context, db_name: str) -> Dict:
    """
    Get detailed statistics about a database's size and storage usage for query generation.

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

async def get_db_info_for_generation(ctx: Context, db_name: str) -> Dict:
    """Get database information including name and collection names. Useful for query generation.
    
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
        return {
            "database_name": db.name,
            "collection_names": db.list_collection_names(),
            "next_step": "Run `sample_documents` on relative collections"
        }
    except Exception as e:
        return ErrorResponse(error=str(e))