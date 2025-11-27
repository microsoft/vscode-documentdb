# Query Insights Debug Override Files

This directory contains debug override files for testing Query Insights with different MongoDB explain plan responses.

## Quick Start

1. **Copy an example** from `examples/` to the parent directory:

   ```bash
   cp examples/collscan-stage1.json query-insights-stage1.json
   cp examples/collscan-stage2.json query-insights-stage2.json
   ```

2. **Set `_debug_active` to `true`** in each file to activate

3. **Run any query** in the Query Insights tab - your debug data will be used instead!

4. **Edit live** - changes take effect on next query execution

## How It Works

When you execute a query in Query Insights:

1. The system checks for `query-insights-stage1.json` and `query-insights-stage2.json`
2. If found and `"_debug_active": true`, uses that data instead of calling MongoDB
3. The data is processed through the same `ExplainPlanAnalyzer` as real queries
4. You see real UX with your custom explain plans

## Files

- `query-insights-stage1.json` - Override Stage 1 (Query Planner) - uses `explain("queryPlanner")`
- `query-insights-stage2.json` - Override Stage 2 (Execution Stats) - uses `explain("executionStats")`
- `examples/` - Pre-made examples to copy and modify

## Examples Provided

### Efficient Index Scan (Default in main files)

- IXSCAN → FETCH → PROJECTION
- 100% efficiency (100 docs examined, 100 returned)
- Fast execution (~120ms)

### Collection Scan with Sort (examples/collscan-\*)

- COLLSCAN → SORT (in-memory)
- 0% index usage
- Poor efficiency (2400 docs examined, 20 returned)
- Slow execution (~550ms)

## Creating Your Own Test Data

### From MongoDB Shell

```javascript
// For Stage 1 (Query Planner)
db.collection.explain('queryPlanner').find({ yourQuery });

// For Stage 2 (Execution Stats)
db.collection.explain('executionStats').find({ yourQuery });
```

Copy the entire JSON output into the respective file.

### Important: The JSON Format

The files should contain the **raw MongoDB explain response**, exactly as returned by:

- `db.collection.explain("queryPlanner").find(...)`
- `db.collection.explain("executionStats").find(...)`

This includes fields like `queryPlanner`, `executionStats`, `serverInfo`, etc.

## Testing Scenarios

Edit the files to test different query patterns:

### ✅ Good Performance

- Index scans (IXSCAN)
- Covered queries
- Low examined/returned ratio

### ⚠️ Poor Performance

- Collection scans (COLLSCAN)
- In-memory sorts (SORT without index)
- High examined/returned ratio
- Multiple rejected plans

### 🔍 Complex Queries

- Multiple stages
- Sharded queries
- Compound index usage

## Tips

- **Live editing**: Files are read on every query execution
- **Output panel**: Check "DocumentDB" output channel for debug messages
- **Validation**: VS Code validates JSON syntax automatically
- **Reset**: Set `"_debug_active"` to `false` or delete files to return to normal mode
- **Both stages**: You can override just Stage 1, just Stage 2, or both independently

## Deactivating

To stop using debug files:

1. Set `"_debug_active": false` in the JSON, OR
2. Delete the files

The system will automatically fall back to real MongoDB queries.
