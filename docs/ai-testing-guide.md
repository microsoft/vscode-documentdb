# AI Enhanced Features Testing Guide

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Prerequisites](#prerequisites)
4. [Quick Start](#quick-start)
5. [Configuration](#configuration)
6. [Writing Test Cases](#writing-test-cases)
7. [Understanding Results](#understanding-results)
8. [Advanced Usage](#advanced-usage)
9. [Troubleshooting](#troubleshooting)
10. [API Reference](#api-reference)

## Overview

The AI Enhanced Features Testing Framework provides a comprehensive solution for testing and evaluating AI-powered capabilities in the DocumentDB extension, specifically:

- **Index Advisor**: Analyzes queries and suggests optimal indexes
- **Query Generation**: Generates MongoDB queries from natural language descriptions

This framework enables:
- Automated batch testing of AI features
- Performance measurement and comparison
- Detailed analysis and reporting
- Reproducible testing across different environments

## Architecture

### Component Overview

```
┌─────────────────────────────────────────────────────┐
│                  Testing Framework                   │
├─────────────────────────────────────────────────────┤
│                                                       │
│  ┌──────────────┐     ┌─────────────────────────┐  │
│  │ Config File  │────▶│    Test Runner          │  │
│  │  (JSON)      │     │  (testRunner.ts)        │  │
│  └──────────────┘     └─────────────────────────┘  │
│                              │                       │
│  ┌──────────────┐            │                       │
│  │  CSV Input   │────────────┤                       │
│  │ (Test Cases) │            │                       │
│  └──────────────┘            ▼                       │
│                       ┌──────────────┐               │
│                       │  Testing API │               │
│                       └──────────────┘               │
│                              │                       │
│                              ▼                       │
│                   ┌───────────────────┐              │
│                   │  Extension Core   │              │
│                   │  - optimizeQuery  │              │
│                   │  - generateQuery  │              │
│                   └───────────────────┘              │
│                              │                       │
│  ┌──────────────┐            │                       │
│  │ CSV Output   │◀───────────┘                       │
│  │  (Results)   │                                    │
│  └──────────────┘                                    │
│                                                       │
└─────────────────────────────────────────────────────┘
```

### Key Components

1. **Testing API** (`api/src/testing/`):
   - Exposes internal methods for testing
   - Only enabled via environment variable
   - Provides access to `optimizeQuery`, `generateQuery`, and `detectCommandType`

2. **Test Runner** (`test/aiEnhancedTests/testRunner.ts`):
   - Orchestrates test execution
   - Manages connections and warmup
   - Collects metrics and results

3. **CSV Utilities** (`test/aiEnhancedTests/csvUtils.ts`):
   - Parses input CSV files
   - Generates output CSV reports
   - Handles special characters and escaping

4. **CLI Script** (`scripts/runAITests.js`):
   - Command-line interface
   - Sets up VS Code test environment
   - Manages environment variables

## Prerequisites

Before running tests, ensure you have:

1. **Development Environment**:
   - Node.js 20.x or later
   - VS Code 1.90.0 or later
   - Git

2. **Extensions**:
   - DocumentDB extension (this extension)
   - GitHub Copilot extension (with active subscription)

3. **Test Infrastructure**:
   - MongoDB cluster accessible for testing
   - Test database with sample collections
   - Cluster pre-configured in the extension

## Quick Start

### 1. Build the Extension

```bash
npm install
npm run build
```

### 2. Create a Test Configuration

Create `test-config.json`:

```json
{
  "connectionString": "mongodb://localhost:27017",
  "clusterId": "local-mongodb",
  "databaseName": "testdb",
  "csvFilePath": "./test/aiEnhancedTests/examples/sample-test-cases.csv",
  "outputCsvPath": "./test/aiEnhancedTests/results/my-results.csv",
  "warmupCount": 3
}
```

### 3. Create Test Cases CSV

Create `test-cases.csv`:

```csv
Collection Name,Query,Expected Result
users,db.users.find({'age': {$gt: 25}}),Should suggest index on age field
products,db.products.find({'category': 'electronics'}),Should suggest index on category field
```

### 4. Run Tests

```bash
npm run test:ai-enhanced test-config.json
```

### 5. Review Results

Results are written to the path specified in `outputCsvPath`. Open the CSV file in Excel or any spreadsheet application.

## Configuration

### Configuration File Reference

```json
{
  // Required: MongoDB connection string
  "connectionString": "mongodb://localhost:27017",
  
  // Required: Cluster ID (must be pre-configured in extension)
  "clusterId": "my-cluster-id",
  
  // Required: Database to test against
  "databaseName": "testdb",
  
  // Optional: Preferred AI model
  "preferredModel": "gpt-4",
  
  // Optional: Custom prompt template file
  "promptFilePath": "./prompts/custom-prompt.txt",
  
  // Required: Path to input CSV with test cases
  "csvFilePath": "./test-cases.csv",
  
  // Required: Path for output CSV with results
  "outputCsvPath": "./results.csv",
  
  // Optional: Number of warmup queries (default: 3)
  "warmupCount": 5
}
```

### Finding Your Cluster ID

To find your cluster ID:

1. Connect to your cluster in VS Code using the DocumentDB extension
2. The cluster ID is typically visible in the connection tree view
3. Alternatively, check your workspace settings or connection configuration

### Custom Prompts

You can customize AI prompts by:

1. Creating a custom prompt template file
2. Setting `promptFilePath` in your config
3. Using configuration settings in VS Code:
   - `documentDB.llm.findQueryPromptPath`
   - `documentDB.llm.aggregateQueryPromptPath`
   - `documentDB.llm.countQueryPromptPath`

## Writing Test Cases

### CSV Format

Test cases are defined in CSV format with three columns:

```csv
Collection Name,Query,Expected Result
```

### Column Descriptions

| Column | Description | Example |
|--------|-------------|---------|
| Collection Name | Name of the collection to test | `users` |
| Query | MongoDB query to optimize | `db.users.find({'age': {$gt: 25}})` |
| Expected Result | Expected optimization suggestions | `Should suggest index on age field` |

### Supported Query Types

The framework supports three types of queries:

#### 1. Find Queries

```csv
users,db.users.find({'status': 'active'}).sort({'created': -1}),Index on status and created
```

Supports:
- Filter conditions
- Sort operations
- Projection (`.project()` or `.projection()`)
- Skip and limit

#### 2. Aggregation Queries

```csv
orders,"db.orders.aggregate([{$match: {status: 'completed'}}, {$group: {_id: '$customer', total: {$sum: '$amount'}}}])",Index on status field
```

Supports:
- Full aggregation pipelines
- Multiple stages
- Complex operations

#### 3. Count Queries

```csv
inventory,db.inventory.countDocuments({'stock': {$lt: 10}}),Index on stock field
```

Supports:
- Filter conditions
- Both `.count()` and `.countDocuments()` syntax

### Escaping Special Characters

When your query contains commas or quotes, use proper CSV escaping:

```csv
users,"db.users.find({'name': 'John, Smith'})",Expected result
```

Rules:
- Wrap fields with commas in double quotes
- Escape internal quotes by doubling them: `""`

### Best Practices

1. **Start Simple**: Begin with basic queries and gradually add complexity
2. **One Concern Per Test**: Test one optimization scenario per test case
3. **Descriptive Expected Results**: Clearly describe what you expect the AI to suggest
4. **Vary Collections**: Test different collections to cover various schemas
5. **Include Edge Cases**: Test empty collections, missing indexes, etc.

## Understanding Results

### Output CSV Format

The test runner generates a CSV with these columns:

| Column | Description |
|--------|-------------|
| Collection Name | Name of the tested collection |
| Query | Original query |
| Expected Result | Your expected optimization |
| Collection Stats | Collection size, document count, etc. |
| Index Stats | Current indexes and their usage |
| Execution Plan | Query execution plan from explain() |
| Query Performance (ms) | Original query execution time |
| Suggestions | AI-generated MongoDB commands for improvements |
| Analysis | Full AI analysis and recommendations |
| Updated Performance (ms) | Performance after applying suggestions (if applicable) |
| Notes | Additional notes or error messages |

### Interpreting Results

#### Collection Stats Example

```json
{
  "ns": "testdb.users",
  "count": 10000,
  "size": 2500000,
  "avgObjSize": 250,
  "storageSize": 3000000,
  "nindexes": 2,
  "totalIndexSize": 204800,
  "indexSizes": {
    "_id_": 102400,
    "email_1": 102400
  }
}
```

Key metrics:
- `count`: Number of documents
- `avgObjSize`: Average document size in bytes
- `nindexes`: Number of indexes
- `totalIndexSize`: Total space used by indexes

#### Index Stats Example

```json
[
  {
    "name": "email_1",
    "key": { "email": 1 },
    "host": "localhost:27017",
    "accesses": {
      "ops": 156,
      "since": "2024-01-15T10:30:00.000Z"
    }
  }
]
```

Key metrics:
- `ops`: Number of times index was used
- `since`: When tracking started

#### Performance Metrics

- **Query Performance**: Time to execute original query
- **Updated Performance**: Time after applying suggestions (when available)
- **Improvement**: Calculate `(original - updated) / original * 100%`

### Success Criteria

A test is considered successful when:
1. The query executes without errors
2. AI provides meaningful suggestions
3. Suggestions align with expected results
4. Performance improvements are documented

## Advanced Usage

### Batch Testing Multiple Configurations

Create multiple config files for different scenarios:

```bash
# Test local environment
npm run test:ai-enhanced configs/local-config.json

# Test staging
npm run test:ai-enhanced configs/staging-config.json

# Test production (read-only queries!)
npm run test:ai-enhanced configs/prod-config.json
```

### Automated Testing in CI/CD

Add to your CI pipeline:

```yaml
# .github/workflows/ai-tests.yml
name: AI Enhanced Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      - run: npm install
      - run: npm run build
      - run: npm run test:ai-enhanced test-config.json
        env:
          MONGODB_CONNECTION: ${{ secrets.MONGODB_CONNECTION }}
          CLUSTER_ID: ${{ secrets.CLUSTER_ID }}
```

### Performance Baseline Testing

Create baseline results and compare:

```bash
# Create baseline
npm run test:ai-enhanced baseline-config.json

# After changes, compare
npm run test:ai-enhanced current-config.json

# Use a diff tool to compare CSVs
diff baseline-results.csv current-results.csv
```

### Testing with Different AI Models

Configure different models in your test configs:

```json
{
  "preferredModel": "gpt-4",
  // ... other settings
}
```

Compare results across models to evaluate which provides better suggestions.

## Troubleshooting

### Common Issues

#### 1. "Testing API is not available"

**Cause**: Environment variable not set

**Solution**: The npm script should set this automatically. If running manually:
```bash
export VSCODE_DOCUMENTDB_TESTING_API=true
npm run test:ai-enhanced config.json
```

#### 2. "Cluster ID not found"

**Cause**: Cluster not pre-configured in extension

**Solution**:
1. Open VS Code
2. Connect to your cluster using the DocumentDB extension
3. Note the cluster ID from the connection
4. Update your config file

#### 3. "GitHub Copilot is not available"

**Cause**: Copilot extension missing or not activated

**Solution**:
1. Install GitHub Copilot extension
2. Sign in and activate subscription
3. Restart VS Code
4. Run tests again

#### 4. "Failed to gather query optimization data"

**Cause**: Database or collection doesn't exist, or connection issues

**Solution**:
1. Verify database and collection names
2. Check connection string
3. Ensure collections have documents
4. Check network connectivity

#### 5. Performance Measurements Show Zero

**Cause**: Query is too fast or collection is empty

**Solution**:
1. Use collections with more documents
2. Increase warmup count
3. Add more complex queries

### Debug Mode

Enable detailed logging:

```bash
# Set debug environment variable
export DEBUG=vscode-documentdb:*
npm run test:ai-enhanced config.json
```

### Validating Your Setup

Before running full test suite:

1. **Test Connection**:
   ```bash
   # Connect via mongosh
   mongosh "your-connection-string"
   ```

2. **Verify Collections**:
   ```javascript
   use testdb
   show collections
   db.users.findOne()
   ```

3. **Check Extension**:
   - Open VS Code
   - Open DocumentDB view
   - Verify cluster appears

## API Reference

### TestConfig Interface

```typescript
interface TestConfig {
  connectionString: string;    // MongoDB connection string
  clusterId?: string;          // Cluster ID (if pre-configured)
  databaseName: string;        // Database to test
  preferredModel?: string;     // AI model preference
  promptFilePath?: string;     // Custom prompt template
  csvFilePath: string;         // Input CSV path
  outputCsvPath: string;       // Output CSV path
  warmupCount?: number;        // Warmup queries count
}
```

### TestCase Interface

```typescript
interface TestCase {
  collectionName: string;   // Collection to test
  query: string;            // Query to optimize
  expectedResult: string;   // Expected optimization
}
```

### TestResult Interface

```typescript
interface TestResult {
  testCase: TestCase;
  collectionStats: string;      // JSON string
  indexStats: string;           // JSON string
  executionPlan: string;        // JSON string
  queryPerformance: number;     // Milliseconds
  suggestions: string;          // AI suggestions
  analysis: string;             // Full AI analysis
  updatedPerformance?: number;  // After optimization (ms)
  notes: string;                // Notes or errors
  passed: boolean;              // Success flag
}
```

### Testing API

```typescript
interface TestingApi {
  optimizeQuery(
    context: IActionContext,
    queryContext: QueryOptimizationContext
  ): Promise<OptimizationResult>;

  generateQuery(
    context: IActionContext,
    queryContext: QueryGenerationContext
  ): Promise<QueryGenerationResult>;

  detectCommandType(command: string): CommandType;
}
```

## Examples

### Example 1: Basic Index Advisor Test

**Config** (`basic-test.json`):
```json
{
  "connectionString": "mongodb://localhost:27017",
  "clusterId": "local",
  "databaseName": "sample",
  "csvFilePath": "./basic-tests.csv",
  "outputCsvPath": "./basic-results.csv"
}
```

**Test Cases** (`basic-tests.csv`):
```csv
Collection Name,Query,Expected Result
users,db.users.find({'email': 'user@example.com'}),Index on email field
products,db.products.find({'price': {$gt: 100}}).sort({'name': 1}),Compound index on price and name
```

**Run**:
```bash
npm run test:ai-enhanced basic-test.json
```

### Example 2: Aggregation Performance Test

**Test Cases**:
```csv
Collection Name,Query,Expected Result
orders,"db.orders.aggregate([{$match: {'date': {$gte: ISODate('2024-01-01')}}}, {$group: {_id: '$product', count: {$sum: 1}}}])",Index on date field for faster matching
sales,"db.sales.aggregate([{$lookup: {from: 'products', localField: 'productId', foreignField: '_id', as: 'product'}}])",Index on productId for lookup optimization
```

### Example 3: Complex Query Patterns

**Test Cases**:
```csv
Collection Name,Query,Expected Result
customers,"db.customers.find({$and: [{'city': 'Seattle'}, {'age': {$gte: 18}}, {'status': 'active'}]})",Compound index on city, age, and status
events,db.events.find({'timestamp': {$gte: 1704067200}}).sort({'priority': -1}).limit(100),Compound index on timestamp and priority
```

## Best Practices Summary

1. **Environment Setup**:
   - Use dedicated test databases
   - Never run tests on production databases
   - Pre-populate collections with representative data

2. **Test Design**:
   - Start with simple queries
   - Progressively increase complexity
   - Cover different query patterns
   - Include both optimized and unoptimized scenarios

3. **Execution**:
   - Run tests consistently
   - Use warmup queries
   - Measure multiple times for accuracy
   - Document any environmental factors

4. **Analysis**:
   - Review all suggestions
   - Compare with expected results
   - Measure performance improvements
   - Document unexpected behaviors

5. **Maintenance**:
   - Keep test cases updated
   - Review and update expected results
   - Archive historical results
   - Version control test configurations

## Related Documentation

- [AI Enhanced Features User Guide](./ai-features.md)
- [Extension API Documentation](../api/README.md)
- [Query Optimization Best Practices](./query-optimization.md)
- [MongoDB Index Design](https://docs.mongodb.com/manual/indexes/)

## Contributing

To add support for new AI features:

1. Add methods to `TestingApi` interface
2. Expose methods in `extension.ts`
3. Update test runner for new feature
4. Add example test cases
5. Update documentation

## Support

For issues or questions:
- [GitHub Issues](https://github.com/microsoft/vscode-documentdb/issues)
- [Documentation](https://microsoft.github.io/vscode-documentdb/)
- [Discussions](https://github.com/microsoft/vscode-documentdb/discussions)
