from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from pymongo import MongoClient


@dataclass
class DocumentDBContext:
    """Context for the DocumentDB MCP server."""
    client: MongoClient

@dataclass
class DBInfoResponse:
    database_name: str
    collection_names: List[str]
    stats: Dict[str, Any]

@dataclass
class DocumentQueryResponse:
    documents: List[Dict[str, Any]]
    total_count: int
    limit: int
    skip: int
    has_more: bool

@dataclass
class InsertOneResponse:
    """Response for single document insert operation."""
    inserted_id: str
    acknowledged: bool
    inserted_count: int

@dataclass
class InsertManyResponse:
    """Response for multiple document insert operation."""
    inserted_ids: List[str]
    acknowledged: bool
    inserted_count: int

@dataclass
class UpdateResponse:
    matched_count: int
    modified_count: int
    upserted_id: Optional[str]
    acknowledged: bool

@dataclass
class DeleteResponse:
    deleted_count: int
    acknowledged: bool

@dataclass
class AggregateResponse:
    results: List[Dict[str, Any]]
    total_count: int

@dataclass
class CreateIndexResponse:
    index_name: str
    keys: Dict[str, Any]
    unique: bool

@dataclass
class ListIndexesResponse:
    indexes: List[Dict[str, Any]]

@dataclass
class SuccessResponse:
    """Response for successful operations."""
    message: str

@dataclass
class ErrorResponse:
    error: str

