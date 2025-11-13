# Index Advisor Testing Framework

This testing framework allows you to run batch tests for the Index Advisor feature using either CSV-based test cases or directory-based test cases.

## Overview

The testing framework supports two modes:
1. **CSV Mode**: Run tests from a CSV file with query execution and performance measurement
2. **Directory Mode**: Run tests from pre-loaded execution plans (no database connection required)

## CSV Mode

### Configuration File

Create a JSON configuration file with the following structure:

```json
{
  "connectionString": "mongodb://username:password@host:port/database?authSource=admin",
  "databaseName": "testDatabase",
  "preferredModel": "gpt-4o",
  "fallbackModels": ["gpt-4o-mini"],
  "shouldWarmup": true,
  "connectionTimeout": 30000,
  "queryTimeout": 60000
}
```

**Required Fields:**
- `connectionString`: MongoDB connection string to the test cluster
- `databaseName`: Name of the database containing test collections

**Optional Fields:**
- `preferredModel`: Preferred AI model for index recommendations (default: "gpt-4o")
- `fallbackModels`: Array of fallback models if preferred model is unavailable
- `shouldWarmup`: Whether to warm up the connection before tests (default: true)
- `connectionTimeout`: Connection timeout in milliseconds (default: 30000)
- `queryTimeout`: Query timeout in milliseconds (default: 60000)

### CSV Test Cases File

Create a CSV file with the following columns:

| Column | Description | Required |
|--------|-------------|----------|
| Category | Test category (e.g., "Missing Index", "Unused Index") | Yes |
| Test Case | Test case name/identifier | Yes |
| Tags | Semicolon-separated tags for categorization | No |
| Collection | Name of the collection to test | Yes |
| Positive / Negative | Test type (Positive/Negative) | No |
| Query | MongoDB query to test (e.g., "db.users.find({user_id: 1234})") | Yes |
| Expected Index Advisor Suggestion | Expected index creation/drop command | Yes |
| Explanation | Description of the test scenario | No |
| Current Index | Existing indexes on the collection | No |
| Comment | Additional comments or notes | No |

**Example CSV:**

```csv
Category,Test Case,Tags,Collection,Positive / Negative,Query,Expected Index Advisor Suggestion,Explanation,Current Index,Comment
Missing Index,Test Case 1,basic;single-field,users,Positive,db.users.find({user_id: 1234}),"db.getCollection('users').createIndex({'user_id':1},{})","No single index exists for the query field user_id",None,Basic single-field index creation test
```

### Output Format

The testing framework generates two output files:

1. **CSV File**: Contains all input columns plus result columns:
   - Suggested Indexes
   - If Matches Expected (true/false)
   - Analysis
   - Execution Plan (Sanitized)
   - Updated Execution Plan (if performance measurement enabled)
   - Query Performance (ms)
   - Updated Performance (ms)
   - Performance Improvement (%)
   - Collection Stats
   - Index Stats
   - Model Used
   - Errors
   - Timestamp

2. **JSON File**: Structured JSON output with metadata and detailed results

### Running Tests

1. Open the Command Palette (Ctrl+Shift+P or Cmd+Shift+P)
2. Run the command: "DocumentDB: Run Index Advisor Tests"
3. Select the configuration file (test-config.json)
4. Select the test cases file (CSV file)
5. Choose whether to measure performance (CSV mode only)
6. Select the output location for results

### Performance Measurement

When performance measurement is enabled (CSV mode only), the framework will:
1. Execute the query and measure initial performance
2. Apply the suggested index changes
3. Re-execute the query and measure updated performance
4. Calculate performance improvement percentage
5. Restore the original index state

**Note**: Performance measurement is slower and modifies indexes temporarily. Choose "Skip Performance Measurement" for faster testing without database modifications.

## Directory Mode

Directory mode allows testing with pre-loaded execution plans without requiring a database connection.

### Directory Structure

```
testcases/
  test-case-1/
    description.json
    executionPlan.json
    collectionStats.json (optional)
    indexStats.json (optional)
  test-case-2/
    ...
```

**description.json format:**
```json
{
  "collectionName": "users",
  "category": "Missing Index",
  "description": "Test single field index",
  "expectedResults": "db.getCollection('users').createIndex({'user_id':1},{})"
}
```

## Best Practices

1. **Test Organization**: Use meaningful categories and tags to organize tests
2. **Test Data**: Ensure test collections have representative data for accurate results
3. **Expected Results**: Write expected index suggestions in MongoDB shell format
4. **Performance Testing**: Use performance measurement only when needed, as it's slower
5. **Version Control**: Keep test cases in version control for reproducibility

## Troubleshooting

- **Connection Issues**: Verify connection string format and credentials
- **Query Parsing Errors**: Ensure queries are in valid MongoDB shell format
- **Missing Collections**: Verify all collections exist in the test database
- **Performance Measurement Failures**: Check that user has permissions to create/drop indexes

## Example Workflow

1. Create test collections in your test database
2. Populate collections with representative data
3. Create configuration file with connection details
4. Create CSV file with test cases
5. Run tests using the VS Code command
6. Review results in the output CSV and JSON files
7. Analyze performance improvements and match rates

## Notes

- All test collections should exist in the database specified in the configuration
- The framework uses AI models to generate index suggestions, so results may vary
- CSV mode requires database connection; directory mode does not
- Performance measurement temporarily modifies indexes but restores original state
