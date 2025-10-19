# AI-Enhanced Feature Testing Framework

This testing framework provides a reliable and efficient mechanism for validating AI-enhanced features (such as query optimization and index advisor) in the DocumentDB VS Code extension.

## Overview

The testing framework consists of several components:

1. **Testing Interface** (`src/testing/llmTestingInterface.ts`) - Exposes internal AI features for testing
2. **Configuration Parser** (`src/testing/configParser.ts`) - Handles test configuration and test case definitions
3. **Test Executor** (`src/testing/testExecutor.ts`) - Executes tests and measures performance
4. **Result Formatter** (`src/testing/resultFormatter.ts`) - Formats and exports test results
5. **Test Runner** (`src/testing/testRunner.ts`) - Command-line interface for running tests

## Prerequisites

- VS Code with the DocumentDB extension installed
- Node.js runtime
- Access to a MongoDB cluster for testing
- GitHub Copilot extension (for AI features)

## Quick Start

### 1. Generate Sample Files

```bash
cd src/testing
node testRunner.ts --generate-samples
```

This will create:
- `sample-config.json` - Sample configuration file
- `sample-test-cases.csv` - Sample test cases file

### 2. Configure Your Tests

Edit `sample-config.json` with your cluster and database information:

```json
{
  "connection": {
    "clusterId": "your-cluster-id",
    "databaseName": "your-database-name"
  },
  "model": {
    "preferredModel": "gpt-4",
    "promptFilePath": "./prompts/index-advisor.txt"
  },
  "output": {
    "outputDir": "./test-results",
    "filePrefix": "test-run"
  }
}
```

### 3. Define Test Cases

Edit `sample-test-cases.csv` with your test cases:

```csv
id,collection,query,expected_result,notes
test_1,users,"db.users.find({age: {$gt: 25}})","Should recommend index on age field","Basic range query"
test_2,orders,"db.orders.find({status: 'pending'}).sort({createdAt: -1})","Should recommend compound index","Query with sort"
```

### 4. Run Tests

```bash
node testRunner.ts --config sample-config.json --tests sample-test-cases.csv
```

## Configuration File Format

The configuration file is a JSON file with the following structure:

```json
{
  "connection": {
    "clusterId": "string",      // Cluster ID or connection identifier
    "databaseName": "string"    // Target database name
  },
  "model": {
    "preferredModel": "string",    // Optional: AI model preference (e.g., "gpt-4")
    "promptFilePath": "string"     // Optional: Custom prompt template file
  },
  "output": {
    "outputDir": "string",      // Optional: Output directory for results
    "filePrefix": "string"      // Optional: Prefix for output filenames
  }
}
```

### Required Fields

- `connection.clusterId` - The cluster/connection ID to use for testing
- `connection.databaseName` - The database to run tests against

### Optional Fields

- `model.preferredModel` - Preferred AI model (defaults to extension settings)
- `model.promptFilePath` - Path to custom prompt template file
- `output.outputDir` - Directory for test results (defaults to `./test-results`)
- `output.filePrefix` - Prefix for result files (defaults to `test-run`)

## Test Cases CSV Format

The test cases file is a CSV with the following columns:

| Column | Required | Description |
|--------|----------|-------------|
| `id` | No | Test case identifier (auto-generated if omitted) |
| `collection` | Yes | Collection name to test against |
| `query` | Yes | MongoDB query to optimize |
| `expected_result` | No | Expected optimization result (for validation) |
| `notes` | No | Additional notes or description |

### Example CSV

```csv
id,collection,query,expected_result,notes
test_1,users,"db.users.find({age: {$gt: 25}})","Index on age","Range query test"
test_2,orders,"db.orders.aggregate([{$match: {status: 'active'}}])","Index on status","Aggregation test"
```

### CSV Tips

- Enclose values containing commas in double quotes
- Use double quotes within quoted values by doubling them (`""`)
- Multi-line values are supported within quoted fields
- Empty fields are allowed for optional columns

## Test Results

Test results are exported as CSV files with the following columns:

1. **Test ID** - Unique identifier for the test case
2. **Collection Name** - The collection tested
3. **Query** - The original query
4. **Expected Result** - Expected result (if provided)
5. **Success** - PASS or FAIL status
6. **Error** - Error message (if test failed)
7. **Collection Stats** - Collection statistics from MongoDB
8. **Index Stats** - Current index statistics
9. **Execution Plan** - Query execution plan
10. **Query Performance (ms)** - Query execution time before optimization
11. **Suggestions** - AI-generated optimization suggestions
12. **Analysis** - AI-generated analysis
13. **Updated Performance (ms)** - Query execution time after applying suggestions
14. **Model Used** - AI model that generated the recommendations
15. **Notes** - Additional notes from test case

### Summary Report

After test execution, a summary report is displayed:

```
============================================================
AI-Enhanced Feature Test Summary
============================================================
Total Tests: 10
Passed: 8
Failed: 2
Pass Rate: 80.00%
============================================================

Failed Tests:
  - test_3: Collection not found
  - test_7: Invalid query syntax

Performance Statistics:
  Average Query Performance (before): 45.32 ms
  Average Query Performance (after): 12.18 ms
  Average Improvement: 73.12%
============================================================
```

## Command-Line Options

```bash
node testRunner.ts [options]
```

### Options

- `--config, -c <file>` - Path to configuration JSON file (required)
- `--tests, -t <file>` - Path to test cases CSV file (required)
- `--output, -o <file>` - Path to output results CSV file (optional)
- `--generate-samples, -g` - Generate sample configuration and test files
- `--help, -h` - Display help message

### Examples

```bash
# Generate sample files
node testRunner.ts --generate-samples

# Run tests with default output location
node testRunner.ts --config config.json --tests test-cases.csv

# Run tests with custom output location
node testRunner.ts -c config.json -t tests.csv -o results/my-test-run.csv

# Display help
node testRunner.ts --help
```

## Integration with VS Code Extension

The testing framework can only run when the VS Code extension is active and properly configured. To use it:

1. **Install the Extension** - Ensure the DocumentDB extension is installed in VS Code
2. **Configure Connection** - Add your MongoDB cluster connection in the extension
3. **Install Copilot** - Ensure GitHub Copilot extension is installed and authenticated
4. **Set Environment Variable** - The test runner automatically sets `VSCODE_TEST=true`

## Performance Measurement

For index advisor tests, the framework automatically measures query performance:

1. **Before Optimization** - Executes the original query and measures execution time
2. **After Optimization** - If AI suggests index improvements, measures performance after suggestions

Performance metrics help validate that AI suggestions actually improve query performance.

### Performance Measurement Notes

- Connection is initialized with a lightweight command before timing starts
- Measurements are in milliseconds
- Failed measurements are marked with `-1`
- Some AI suggestions may not be executable queries (e.g., index creation commands)

## Extending the Framework

The framework is designed to support multiple AI features:

### Adding Support for Query Generation Tests

```typescript
import { testGenerateQuery } from './llmTestingInterface';

// Execute query generation test
const result = await testGenerateQuery(context, {
    clusterId: config.connection.clusterId,
    databaseName: config.connection.databaseName,
    collectionName: testCase.collectionName,
    naturalLanguageQuery: testCase.query,
    generationType: QueryGenerationType.SingleCollection
});
```

### Custom Test Executors

Create new executor functions in `testExecutor.ts`:

```typescript
export async function executeCustomTest(
    context: IActionContext,
    config: TestConfig,
    testCase: TestCase
): Promise<TestResult> {
    // Custom test logic
}
```

## Troubleshooting

### Common Issues

1. **"testOptimizeQuery is only available in test environment"**
   - Ensure `VSCODE_TEST` environment variable is set to `true`
   - The test runner sets this automatically

2. **"GitHub Copilot is not available"**
   - Install the GitHub Copilot extension
   - Ensure you have an active Copilot subscription
   - Authenticate with GitHub in VS Code

3. **"Failed to gather query optimization data"**
   - Verify cluster connection is valid
   - Ensure database and collection exist
   - Check that you have necessary permissions

4. **Performance measurement returns -1**
   - The query may not be executable
   - Collection might be empty
   - Connection issues

### Debug Mode

To enable verbose logging, set environment variable:

```bash
export DEBUG=true
node testRunner.ts --config config.json --tests test-cases.csv
```

## Best Practices

1. **Start Small** - Begin with a few test cases to validate setup
2. **Use Descriptive IDs** - Make test case IDs meaningful for easier debugging
3. **Document Expected Results** - Include expected results for manual validation
4. **Regular Testing** - Run tests regularly to catch regressions
5. **Version Control** - Keep test configurations and cases in version control
6. **Isolate Test Data** - Use dedicated test databases when possible

## Future Enhancements

The framework is designed for future expansion:

- **Web-based UI** - Browser interface for test execution and monitoring
- **Test Scheduling** - Automated test runs on a schedule
- **Result Comparison** - Compare results across test runs
- **Semantic Validation** - Automatically compare AI suggestions with expected results
- **Multi-cluster Support** - Test across multiple clusters simultaneously
- **CI/CD Integration** - Integration with continuous integration pipelines

## API Reference

See inline documentation in source files for detailed API reference:

- `src/testing/llmTestingInterface.ts` - Testing interface exports
- `src/testing/configParser.ts` - Configuration and test case parsing
- `src/testing/testExecutor.ts` - Test execution functions
- `src/testing/resultFormatter.ts` - Result formatting and export
- `src/testing/testRunner.ts` - Command-line runner

## License

Copyright (c) Microsoft Corporation. All rights reserved.
Licensed under the MIT License. See License.txt in the project root for license information.
