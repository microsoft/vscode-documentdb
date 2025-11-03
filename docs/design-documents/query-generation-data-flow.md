# Query Generation Data Flow - Privacy Review Documentation

## Overview

This document describes the data flow for the MongoDB query generation feature, with emphasis on customer data handling and privacy considerations. The query generation feature uses GitHub Copilot's language models to convert natural language descriptions into MongoDB queries.

## Current Implementation (v1.0)

### Data Flow Diagram

```
┌─────────────────┐
│  User Input     │
│  (Natural Lang) │
└────────┬────────┘
         │
         v
┌─────────────────────────────────────────────────────────┐
│  Query Generation Context                               │
│  - Database name                                        │
│  - Collection name(s)                                   │
│  - Target query type (Find/Aggregation)                 │
│  - Natural language query description                   │
└────────┬────────────────────────────────────────────────┘
         │
         v
┌─────────────────────────────────────────────────────────┐
│  Schema Inference Process                               │
│  1. Fetch sample documents from customer database       │
│  2. Analyze document structure locally                  │
│  3. Generate schema definition (field types only)       │
│  4. DISCARD original documents                          │
└────────┬────────────────────────────────────────────────┘
         │
         v
┌─────────────────────────────────────────────────────────┐
│  Data Sent to LLM (GitHub Copilot)                      │
│  ✓ Database name (metadata)                             │
│  ✓ Collection name(s) (metadata)                        │
│  ✓ Schema structure (field names and types only)        │
│  ✓ Natural language query from user                     │
│  ✗ NO actual customer data values                       │
│  ✗ NO sample documents                                  │
└────────┬────────────────────────────────────────────────┘
         │
         v
┌─────────────────────────────────────────────────────────┐
│  GitHub Copilot LLM Processing                          │
│  - Processes schema structure                           │
│  - Generates MongoDB query syntax                       │
└────────┬────────────────────────────────────────────────┘
         │
         v
┌─────────────────────────────────────────────────────────┐
│  Response                                               │
│  - Generated MongoDB query (JSON)                       │
│  - Explanation of the query logic                       │
└────────┬────────────────────────────────────────────────┘
         │
         v
┌─────────────────┐
│  Display to     │
│  User           │
└─────────────────┘
```

### Customer Data Categories

#### Data Collected Locally (Never Sent to LLM)

1. **Sample Documents**:
   - Fetched: 3-10 documents per collection
   - Purpose: Schema inference only
   - Lifecycle: Used for schema analysis, then immediately discarded
   - Storage: Temporary in-memory only, never persisted

2. **Actual Data Values**:
   - Type: Any customer data content (strings, numbers, objects, etc.)
   - Handling: Never extracted, never sent to LLM
   - Example: If a document has `{"name": "John Doe", "age": 30}`, these values are never sent

#### Data Sent to LLM

1. **Metadata**:
   - Database name (e.g., "customerDB")
   - Collection name(s) (e.g., "users", "orders")
   - Target query type ("Find" or "Aggregation")

2. **Schema Structure**:
   - Field names (e.g., "name", "age", "email")
   - Field types (e.g., "string", "number", "object")
   - Nested structure (e.g., "address.city" is a string)
   - **NO actual values from customer documents**

3. **User Input**:
   - Natural language query description provided by the user
   - Example: "Find all users who are over 25 years old"

### Schema Inference Example

#### Customer's Actual Document (Never Sent):
```json
{
  "_id": "507f1f77bcf86cd799439011",
  "name": "John Doe",
  "email": "john.doe@example.com",
  "age": 30,
  "address": {
    "city": "Seattle",
    "state": "WA",
    "zipCode": "98101"
  },
  "orders": [
    {"orderId": "ORD-001", "total": 99.99}
  ]
}
```

#### Schema Definition Sent to LLM:
```json
{
  "collectionName": "users",
  "fields": {
    "_id": "string",
    "name": "string",
    "email": "string",
    "age": "number",
    "address": {
      "city": "string",
      "state": "string",
      "zipCode": "string"
    },
    "orders": [
      {
        "orderId": "string",
        "total": "number"
      }
    ]
  }
}
```

**Key Privacy Point**: Only the structure (field names and types) is sent. Actual values like "John Doe", "john.doe@example.com", "Seattle", etc., are never included in the LLM request.

### Code Reference

The schema inference is implemented in `src/utils/schemaInference.ts`:

```typescript
export function generateSchemaDefinition(
    documents: Array<Document>,
    collectionName?: string,
): SchemaDefinition {
    // Processes documents to extract ONLY field names and types
    // Returns structure without any actual data values
}
```

The query generation call in `src/commands/llmEnhancedCommands/queryGenerationCommands.ts`:

```typescript
// Sample documents are fetched
const sampleDocs = await client.getSampleDocuments(
    queryContext.databaseName,
    queryContext.collectionName,
    10
);

// Schema is extracted (structure only)
const schema = generateSchemaDefinition(sampleDocs, queryContext.collectionName);

// Original documents are discarded after this point
// Only schema structure is used in prompt template
```

## Proposed Future Enhancement (v2.0) - Under Privacy Review

### Overview of Proposed Change

To enable query modification features, we are considering allowing users to provide their existing MongoDB queries for modification or optimization.

### Additional Data Flow (Proposed)

```
┌─────────────────────────────────────┐
│  User Input (New)                   │
│  - Natural language modification    │
│    request                          │
│  - Existing MongoDB query (CUSTOMER │
│    CREATED, may contain literals)   │
└────────┬────────────────────────────┘
         │
         v
┌─────────────────────────────────────┐
│  Data Sent to LLM (Additional)      │
│  ✓ User's original query structure  │
│  ⚠ May contain customer-specified   │
│    literals/values in query filters │
└─────────────────────────────────────┘
```

### Privacy Concerns with Proposed Enhancement

#### New Customer Data Being Sent to LLM:

1. **User's Original Query**:
   - Content: MongoDB query syntax provided by the user
   - Risk: May contain literal values used in filters
   - Example:
     ```javascript
     // User's query may contain:
     db.users.find({
       "email": "specific@customer.com",  // ⚠ Customer email
       "accountId": "ACCT-12345"          // ⚠ Customer account ID
     })
     ```

2. **Embedded Literals**:
   - Query filters often contain specific values
   - These values could be sensitive customer data
   - Examples: email addresses, account IDs, names, dates, amounts

#### Privacy Risk Assessment:

| Data Type | Current (v1.0) | Proposed (v2.0) | Risk Level |
|-----------|----------------|-----------------|------------|
| Sample document values | ✗ Never sent | ✗ Never sent | None |
| Schema structure | ✓ Sent | ✓ Sent | Low (metadata only) |
| Database/collection names | ✓ Sent | ✓ Sent | Low (metadata) |
| User's natural language input | ✓ Sent | ✓ Sent | Low-Medium (user provided) |
| Query literals/filters | ✗ Not applicable | ⚠ **Would be sent** | **Medium-High** |
