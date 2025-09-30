from typing import List, Dict, Any, Union

from mcp.server.fastmcp import Context

from src.documentdb_mcp.models import (
    AggregateResponse,
    DeleteResponse,
    DocumentQueryResponse,
    ErrorResponse,
    InsertManyResponse,
    InsertOneResponse,
    UpdateResponse,
)

async def find_documents(
    ctx: Context,
    db_name: str,
    collection_name: str,
    query: Dict = {},
    limit: int = 100,
    skip: int = 0,
) -> DocumentQueryResponse:
    """Find documents in a collection using a query.

    Args:
        db_name: Name of the database
        collection_name: Name of the collection to query
        query: Query filter (MongoDB style)
        limit: Maximum number of documents to return
        skip: Number of documents to skip
    """
    try:
        client = ctx.request_context.lifespan_context.client
        db = client[db_name]
        collection = db[collection_name]

        cursor = collection.find(query).skip(skip).limit(limit)
        documents = list(cursor)
        total_count = (
            collection.estimated_document_count()
            if not query
            else collection.count_documents(query)
        )

        return DocumentQueryResponse(
            documents=documents,
            total_count=total_count,
            limit=limit,
            skip=skip,
            has_more=(skip + len(documents)) < total_count,
        )
    except Exception as e:
        return ErrorResponse(error=str(e))

async def find_and_modify(
    ctx: Context,
    db_name: str,
    collection_name: str,
    query: Dict,
    update: Dict,
    upsert: bool = False,
) -> DocumentQueryResponse:
    """Find and modify a document in a collection.
        Will return the document before the update if it exists, or None if it doesn't.
    Args:
        db_name: Name of the database
        collection_name: Name of the collection to query
        query: Query filter (MongoDB style)
        update: Update operations ($set, $inc, etc.)
        upsert: Create document if it doesn't exist
    """
    try:
        client = ctx.request_context.lifespan_context.client
        db = client[db_name]
        collection = db[collection_name]
        result = collection.find_one_and_update(query, update, upsert=upsert)

        return result
    except Exception as e:
        return ErrorResponse(error=str(e))

async def count_documents(
    ctx: Context,
    db_name: str,
    collection_name: str,
    query: Dict = {},
) -> int:
    """Count the number of documents in a collection.

    Args:
        db_name: Name of the database
        collection_name: Name of the collection
        query: Query filter (MongoDB style)
    """
    try:
        client = ctx.request_context.lifespan_context.client
        db = client[db_name]
        collection = db[collection_name]
        return collection.count_documents(query)
    except Exception as e:
        return ErrorResponse(error=str(e))

async def insert_document(
    ctx: Context,
    db_name: str,
    collection_name: str,
    document: Dict,
) -> InsertOneResponse:
    """Insert a single document into a collection.

    Args:
        db_name: Name of the database
        collection_name: Name of the collection
        document: Document to insert
    """
    try:
        client = ctx.request_context.lifespan_context.client
        db = client[db_name]
        collection = db[collection_name]
        result = collection.insert_one(document)
        return InsertOneResponse(
            inserted_id=str(result.inserted_id),
            acknowledged=result.acknowledged,
            inserted_count=1,
        )
    except Exception as e:
        return ErrorResponse(error=str(e))

async def insert_many(
    ctx: Context,
    db_name: str,
    collection_name: str,
    documents: List[Dict],
) -> InsertManyResponse:
    """Insert multiple documents into a collection.

    Args:
        db_name: Name of the database
        collection_name: Name of the collection
        documents: List of documents to insert
    """
    try:
        client = ctx.request_context.lifespan_context.client
        db = client[db_name]
        collection = db[collection_name]
        result = collection.insert_many(documents)
        return InsertManyResponse(
            inserted_ids=[str(id) for id in result.inserted_ids],
            acknowledged=result.acknowledged,
            inserted_count=len(result.inserted_ids),
        )
    except Exception as e:
        return ErrorResponse(error=str(e))

async def update_document(
    ctx: Context,
    db_name: str,
    collection_name: str,
    filter: Dict,
    update: Dict,
    upsert: bool = False,
) -> UpdateResponse:
    """Update a document in a collection.

    Args:
        db_name: Name of the database
        collection_name: Name of the collection
        filter: Query filter to find the document
        update: Update operations ($set, $inc, etc.)
        upsert: Create document if it doesn't exist
    """
    try:
        client = ctx.request_context.lifespan_context.client
        db = client[db_name]
        collection = db[collection_name]
        result = collection.update_one(filter, update, upsert=upsert)
        return UpdateResponse(
            matched_count=result.matched_count,
            modified_count=result.modified_count,
            upserted_id=str(result.upserted_id) if result.upserted_id else None,
            acknowledged=result.acknowledged,
        )
    except Exception as e:
        return ErrorResponse(error=str(e))

async def update_many(
    ctx: Context,
    db_name: str,
    collection_name: str,
    filter: Dict,
    update: Dict,
    upsert: bool = False,
) -> UpdateResponse:
    """Update multiple documents in a collection.

    Args:
        db_name: Name of the database
        collection_name: Name of the collection
        filter: Query filter to find the documents
        update: Update operations ($set, $inc, etc.)
        upsert: Create document if it doesn't exist
    """
    try:
        client = ctx.request_context.lifespan_context.client
        db = client[db_name]
        collection = db[collection_name]
        result = collection.update_many(filter, update, upsert=upsert)
        return UpdateResponse(
            matched_count=result.matched_count,
            modified_count=result.modified_count,
            upserted_id=str(result.upserted_id) if result.upserted_id else None,
            acknowledged=result.acknowledged,
        )
    except Exception as e:
        return ErrorResponse(error=str(e))

async def delete_document(
    ctx: Context,
    db_name: str,
    collection_name: str,
    filter: Dict,
) -> DeleteResponse:
    """Delete a document from a collection.

    Args:
        db_name: Name of the database
        collection_name: Name of the collection
        filter: Query filter to find the document
    """
    try:
        client = ctx.request_context.lifespan_context.client
        db = client[db_name]
        collection = db[collection_name]
        result = collection.delete_one(filter)
        return DeleteResponse(
            deleted_count=result.deleted_count,
            acknowledged=result.acknowledged,
        )
    except Exception as e:
        return ErrorResponse(error=str(e))

async def delete_many(
    ctx: Context,
    db_name: str,
    collection_name: str,
    filter: Dict,
) -> DeleteResponse:
    """Delete multiple documents from a collection.

    Args:
        db_name: Name of the database
        collection_name: Name of the collection
        filter: Query filter to find the documents
    """
    try:
        client = ctx.request_context.lifespan_context.client
        db = client[db_name]
        collection = db[collection_name]
        result = collection.delete_many(filter)
        return DeleteResponse(
            deleted_count=result.deleted_count,
            acknowledged=result.acknowledged,
        )
    except Exception as e:
        return ErrorResponse(error=str(e))

async def aggregate(ctx: Context, db_name: str, collection_name: str, pipeline: List[Dict], 
                   allow_disk_use: bool = False) -> AggregateResponse:
    """
    Run an aggregation pipeline on a collection.
    
    Args:
        db_name: Name of the database
        collection_name: Name of the collection
        pipeline: List of aggregation stages
        allow_disk_use: Allow pipeline stages to write to disk
    """
    try:
        client = ctx.request_context.lifespan_context.client
        db = client[db_name]
        collection = db[collection_name]
        results = list(collection.aggregate(pipeline, allowDiskUse=allow_disk_use))
        return AggregateResponse(
            results=results,
            total_count=len(results)
        )
    except Exception as e:
        return ErrorResponse(error=str(e))

async def explain_aggregate_query(
    ctx: Context,
    db_name: str,
    collection_name: str,
    pipeline: List[Dict],
) -> dict:
    """Explain the execution plan with execution stats for an aggregation query on a given collection.

    Useful for analyzing performance (e.g. COLLSCAN vs IDXSCAN) or debugging
    vector search queries. Internally runs:
        db.command('aggregate', collection, pipeline=..., explain=True, verbosity='executionStats')

    Args:
        db_name: Database name.
        collection_name: Collection name.
        pipeline: Aggregation pipeline to explain.
    """
    try:
        client = ctx.request_context.lifespan_context.client
        db = client[db_name]
        explain_output = db.command({
            "explain": {
                "aggregate": collection_name,
                "pipeline": pipeline,
                "cursor": {}
            },
            "verbosity": "executionStats"
        })
        return explain_output
    except Exception as e:
        return ErrorResponse(error=str(e))

async def explain_count_query(ctx: Context, db_name: str, collection_name: str, query: Dict) -> dict:
    """Explain the execution plan with execution stats for count query on a given collection
    
    Args:
        db_name: Name of the database
        collection_name: Name of the collection
        query: Query filter to explain.
    """
    try:
        client = ctx.request_context.lifespan_context.client
        db = client[db_name]
        explain_output = db.command({
            "explain": {
                "count": collection_name,
                "query": query
            },
            "verbosity": "executionStats"
        })
        return explain_output
    except Exception as e:
        return ErrorResponse(error=str(e))
    
async def explain_find_query(
    ctx: Context,
    db_name: str,
    collection_name: str,
    query: Dict,
    sort: Dict = None,
    limit: int = None,
    projection: Dict = None
) -> dict:
    """Explain the execution plan with execution stats for a find query.

    Example:
        collection.find({"cuisine": "Italian"}).explain('executionStats')

    Args:
        db_name: Database name.
        collection_name: Collection name.
        query: Filter query to explain.
        sort: Sort specification followed in the query, None if not specified in origin query.
        limit: Limit specification followed in the query, None if not specified in origin query.
        projection: Projection specification followed in the query, None if not specified in origin query.
    """
    try:
        client = ctx.request_context.lifespan_context.client
        db = client[db_name]
        find_command = {
            "find": collection_name,
        }
        if query is not None:
            find_command["filter"] = query
        if sort is not None:
            find_command["sort"] = sort
        if limit is not None:
            find_command["limit"] = limit
        if projection is not None:
            find_command["projection"] = projection
        explain_output = db.command(
            "explain",
            find_command,
            verbosity="executionStats"
        )
        return explain_output
    except Exception as e:
        return ErrorResponse(error=str(e))
    
async def query_on_different_collections(
    ctx: Context,
    left_db: str,
    right_db: str,
    left_collection: str,
    right_collection: str,
    local_field: str,
    foreign_field: str,
    left_query: Dict = {},
    right_query: Dict = {},
    limit: int = 100,
    skip: int = 0
) -> Dict[str, Any]:
    """Useful to retrieve data insight. Suggest to use `sample_documents` to get collection schema first
    Perform find on both collections and join the results on reference key.

    Args:
        left_db: First database name
        right_db: Second database name
        left_collection: First collection name
        right_collection: Second collection name
        local_field: Field in left collection to match
        foreign_field: Field in right collection to match
        left_query: Query filter for left collection
        right_query: Query filter for right collection
        limit: Max number of left docs to fetch
        skip: Skip number of left docs
    """
    try:
        left_resp = await find_documents(ctx, left_db, left_collection, left_query, limit, skip)
        print("left_resp: ", left_resp)
        right_resp = await find_documents(ctx, right_db, right_collection, right_query, 100)
        print("right_resp: ", right_resp)

        if hasattr(left_resp, "error"):
            return {"error": f"left query failed: {left_resp.error}"}
        if hasattr(right_resp, "error"):
            return {"error": f"right query failed: {right_resp.error}"}

        left_docs = left_resp.documents
        print("left_docs: ", left_docs)
        right_docs = right_resp.documents
        print("right_docs: ", right_docs)

        right_index = {}
        for doc in right_docs:
            key = doc.get(foreign_field)
            if key is not None:
                right_index.setdefault(key, []).append(doc)
        print("right_index: ", right_index)

        results = []

        # --- 3. Join ---
        for left in left_docs:
            pre_field = ".".join(local_field.split(".")[:-1])
            query_field = local_field.split(".")[-1]
            print("pre_field: ", pre_field)
            left_values = left.get(pre_field)
            copied_values = []
            if isinstance(left_values, list):
                # copied_values = left_values.copy()
                for item in left_values:
                    if isinstance(item, dict):
                        key = item.get(query_field)
                        if key not in right_index:
                            left_values.remove(item)
                        else:
                            for r in right_index[key]:
                                print("right doc: ", r)
                                item = {**item, **{f"{right_collection}_{k}": v for k, v in r.items() if k != "_id"}}
                                copied_values.append(item)
                if len(copied_values) > 0:
                    left[pre_field] = copied_values
                    results.append(left)
            else:
                key = left.get(local_field)
                if key is not None and key in right_index:
                    for r in right_index[key]:
                        print("right doc: ", r)
                        for k, v in r.items():
                            if k != "_id":
                                left[f"{right_collection}_{k}"] = v

                results.append(left)

        return {"documents": results, "total_count": len(results)}

    except Exception as e:
        return {"error": str(e)}