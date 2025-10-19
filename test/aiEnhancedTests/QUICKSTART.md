# AI Enhanced Testing - Quick Start

This is a quick reference guide for the AI Enhanced Features Testing Framework. For complete documentation, see [docs/ai-testing-guide.md](../docs/ai-testing-guide.md).

## Overview

Test AI features (Index Advisor, Query Generation) with automated batch testing and performance measurement.

## Quick Start (3 Steps)

### 1. Setup

```bash
npm install
npm run build
```

### 2. Configure

Create `my-config.json`:

```json
{
  "connectionString": "mongodb://localhost:27017",
  "clusterId": "your-cluster-id",
  "databaseName": "testdb",
  "csvFilePath": "./test/aiEnhancedTests/examples/sample-test-cases.csv",
  "outputCsvPath": "./test/aiEnhancedTests/results/my-results.csv",
  "warmupCount": 3
}
```

**Important**: The `clusterId` must be a cluster already connected in the DocumentDB extension.

### 3. Run

```bash
npm run test:ai-enhanced my-config.json
```

Results are written to the path specified in `outputCsvPath`.

## Test Case Format

Create a CSV file with your test cases:

```csv
Collection Name,Query,Expected Result
users,db.users.find({'age': {$gt: 25}}),Should suggest index on age field
products,db.products.find({'category': 'electronics'}),Should suggest index on category
orders,"db.orders.aggregate([{$match: {status: 'completed'}}])",Should suggest index on status
```

## Output

The framework generates a CSV with these columns:
- Collection Name, Query, Expected Result
- Collection Stats, Index Stats, Execution Plan
- Query Performance (ms)
- Suggestions (AI-generated MongoDB commands)
- Analysis (full AI recommendations)
- Updated Performance (ms), Notes

## Examples

See `test/aiEnhancedTests/examples/` for:
- `sample-config.json` - Example configuration
- `sample-test-cases.csv` - Example test cases

## Requirements

- VS Code with DocumentDB extension
- GitHub Copilot extension (active subscription)
- MongoDB cluster accessible for testing
- Cluster pre-configured in the extension

## Common Issues

### "Testing API is not available"
The npm script should handle this automatically. If running manually, set:
```bash
export VSCODE_DOCUMENTDB_TESTING_API=true
```

### "Cluster ID not found"
Connect to your cluster in VS Code first using the DocumentDB extension.

### "GitHub Copilot is not available"
Install the GitHub Copilot extension and ensure you have an active subscription.

## Supported Query Types

1. **Find Queries**: `db.collection.find({filter}).sort({field: 1})`
2. **Aggregation**: `db.collection.aggregate([{$match: {...}}])`
3. **Count**: `db.collection.countDocuments({filter})`

## More Information

- [Complete Testing Guide](../docs/ai-testing-guide.md) - Full documentation
- [README.md](./README.md) - Framework details
- [GitHub Issues](https://github.com/microsoft/vscode-documentdb/issues) - Report problems
