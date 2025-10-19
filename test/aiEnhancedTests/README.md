# AI Enhanced Features Test Framework

This framework provides automated testing for AI-enhanced features in the DocumentDB extension, including:
- **Query Optimization** (Index Advisor)
- **Query Generation**

## Overview

The test framework allows you to:
1. Define test cases in CSV files
2. Run batch tests against a MongoDB cluster
3. Collect detailed performance metrics and AI recommendations
4. Generate comprehensive result reports

## Quick Start

### Prerequisites

1. VS Code with the DocumentDB extension installed
2. A MongoDB cluster accessible for testing
3. GitHub Copilot extension installed and active

### Running Tests

```bash
# 1. Build the extension
npm run build

# 2. Run AI enhanced tests with a configuration file
npm run test:ai-enhanced path/to/your-config.json
```

## Configuration

### Config File Format

Create a JSON configuration file with the following structure:

```json
{
  "connectionString": "mongodb://localhost:27017",
  "clusterId": "your-cluster-id-here",
  "databaseName": "testdb",
  "preferredModel": "gpt-4",
  "csvFilePath": "./test/aiEnhancedTests/examples/sample-test-cases.csv",
  "outputCsvPath": "./test/aiEnhancedTests/results/test-results.csv",
  "warmupCount": 3
}
```

**Fields:**
- `connectionString`: MongoDB connection string
- `clusterId`: Existing cluster ID (must be pre-configured in the extension)
- `databaseName`: Database to test against
- `preferredModel`: (Optional) Preferred AI model to use
- `promptFilePath`: (Optional) Path to custom prompt template
- `csvFilePath`: Path to input CSV file with test cases
- `outputCsvPath`: Path where results CSV will be written
- `warmupCount`: (Optional) Number of warmup queries to run (default: 3)

### CSV Test Cases Format

Create a CSV file with test cases:

```csv
Collection Name,Query,Expected Result
users,db.users.find({'age': {$gt: 25}}).sort({'name': -1}).limit(10),Should suggest index on age and name fields
products,db.products.find({'category': 'electronics'}),Should suggest index on category field
orders,"db.orders.aggregate([{$match: {'status': 'completed'}}])",Should suggest index on status field
```

**Columns:**
- `Collection Name`: Name of the collection to test
- `Query`: MongoDB query to optimize (supports find, aggregate, count)
- `Expected Result`: Description of expected optimization suggestions

## Output Format

The test framework generates a CSV file with the following columns:

| Column | Description |
|--------|-------------|
| Collection Name | Name of the tested collection |
| Query | Original query that was tested |
| Expected Result | Expected optimization suggestions |
| Collection Stats | Statistics about the collection (size, document count, etc.) |
| Index Stats | Current indexes on the collection |
| Execution Plan | Query execution plan from explain() |
| Query Performance (ms) | Original query execution time in milliseconds |
| Suggestions | AI-generated suggestions (extracted MongoDB commands) |
| Analysis | Full AI analysis and recommendations |
| Updated Performance (ms) | Performance after applying suggestions (if applicable) |
| Notes | Additional notes or error messages |

## Examples

See the `test/aiEnhancedTests/examples/` directory for:
- `sample-config.json` - Example configuration file
- `sample-test-cases.csv` - Example test cases

## Architecture

### Components

1. **Testing API** (`api/src/testing/`):
   - Exposes `optimizeQuery` and `generateQuery` methods
   - Only available when `VSCODE_DOCUMENTDB_TESTING_API=true`

2. **Test Runner** (`test/aiEnhancedTests/testRunner.ts`):
   - Orchestrates test execution
   - Measures performance
   - Collects results

3. **CSV Utilities** (`test/aiEnhancedTests/csvUtils.ts`):
   - Reads test cases from CSV
   - Writes results to CSV
   - Handles CSV escaping and formatting

4. **CLI Script** (`scripts/runAITests.js`):
   - Command-line interface
   - Sets up VS Code test environment
   - Passes configuration to test runner

### Test Flow

1. **Setup**: Load configuration and test cases from files
2. **Connection**: Verify cluster connection
3. **Warmup**: Run warmup queries to establish stable connection
4. **Execution**: For each test case:
   - Detect query type (find/aggregate/count)
   - Measure original query performance
   - Collect collection and index statistics
   - Run AI optimization
   - Extract suggestions and analysis
5. **Results**: Write all results to output CSV file

## Advanced Usage

### Custom Prompt Templates

You can provide custom prompt templates in the config:

```json
{
  "promptFilePath": "./prompts/custom-index-advisor-prompt.txt"
}
```

### Performance Measurement

The framework automatically:
- Runs warmup queries to stabilize connection
- Measures original query execution time
- Can measure updated performance after applying suggestions

### Error Handling

- Failed tests are marked with `passed: false`
- Error messages are captured in the `Notes` column
- The framework continues running remaining tests

## Troubleshooting

### "Testing API is not available"

Make sure the `VSCODE_DOCUMENTDB_TESTING_API` environment variable is set to `true`. The npm script should handle this automatically.

### "Cluster ID not found"

The cluster must be pre-configured in the extension. Connect to your cluster in VS Code first, then use the cluster ID in your config.

### "GitHub Copilot is not available"

Ensure the GitHub Copilot extension is installed and you have an active subscription.

## Contributing

When adding new AI features:
1. Add methods to the `TestingApi` interface in `api/src/testing/testingApi.ts`
2. Expose methods in `src/extension.ts` when testing API is enabled
3. Update test runner to support the new feature
4. Add example test cases

## Security Note

⚠️ **Important**: The testing API is only available when explicitly enabled via environment variable. Never enable this in production builds.
