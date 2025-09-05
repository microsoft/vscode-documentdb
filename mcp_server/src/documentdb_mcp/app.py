from mcp.server.fastmcp import FastMCP

from src.documentdb_mcp.context_manager import documentdb_lifespan
from src.documentdb_mcp.mcp_config import HOST, PORT
from src.documentdb_mcp.tools.collection import (
    collection_stats,
    drop_collection,
    rename_collection,
    sample_documents,
)
from src.documentdb_mcp.tools.database import (
    db_stats,
    drop_database,
    get_db_info,
    list_databases,
)
from src.documentdb_mcp.tools.document import (
    aggregate,
    count_documents,
    delete_document,
    delete_many,
    explain_aggregate_query,
    explain_find_query,
    explain_count_query,
    find_documents,
    find_and_modify,
    insert_document,
    insert_many,
    update_document,
    update_many,
    query_on_different_collections
)
from src.documentdb_mcp.tools.index import (
    create_index,
    current_ops,
    drop_index,
    index_stats,
    list_indexes,
)

from src.documentdb_mcp.tools.workflow import (
    optimize_find_query,
    optimize_aggregate_query,
    optimize_count_query,
    list_databases_for_generation,
    get_db_info_for_generation
)

mcp = FastMCP(
    "documentdb-mcp",
    description="MCP server for DocumentDB database operations",
    lifespan=documentdb_lifespan,
    host=HOST,
    port=PORT,
)


# Database tools
mcp.add_tool(list_databases)
mcp.add_tool(db_stats)
mcp.add_tool(get_db_info)
mcp.add_tool(drop_database)

# Collection tools
mcp.add_tool(collection_stats)
mcp.add_tool(rename_collection)
mcp.add_tool(drop_collection)
mcp.add_tool(sample_documents)

# Index tools
mcp.add_tool(create_index)
mcp.add_tool(list_indexes)
mcp.add_tool(drop_index)
mcp.add_tool(current_ops)
mcp.add_tool(index_stats)

# Document tools
mcp.add_tool(find_documents)
mcp.add_tool(find_and_modify)
mcp.add_tool(count_documents)
mcp.add_tool(insert_document)
mcp.add_tool(insert_many)
mcp.add_tool(update_document)
mcp.add_tool(update_many)
mcp.add_tool(delete_document)
mcp.add_tool(delete_many)
mcp.add_tool(aggregate)
mcp.add_tool(explain_aggregate_query)
mcp.add_tool(explain_find_query)
mcp.add_tool(query_on_different_collections)
mcp.add_tool(explain_count_query)

# Index advisor tools
mcp.add_tool(optimize_find_query)
mcp.add_tool(optimize_aggregate_query)
mcp.add_tool(optimize_count_query)
# Query generation tools
mcp.add_tool(list_databases_for_generation)
mcp.add_tool(get_db_info_for_generation)