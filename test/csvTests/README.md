# CSV Batch Testing Framework for Index Advisor

This framework allows you to run batch tests for the Index Advisor using CSV files. It's useful for regression testing, performance validation, and ensuring consistent Index Advisor recommendations across different scenarios.

## Overview

The CSV testing framework:
1. Reads test cases from a CSV file
2. Executes queries against a MongoDB database
3. Collects execution plans
4. Gets Index Advisor suggestions
5. Compares actual suggestions with expected ones
6. Outputs detailed results to a CSV file

## Setup

### 1. Create a Configuration File

Create a JSON configuration file (e.g., `config.json`) with your MongoDB connection details:

```json
{
  "connectionString": "mongodb://localhost:27017",
  "databaseName": "indexAdvisorTests",
  "preferredModel": "gpt-4",
  "fallbackModels": ["gpt-3.5-turbo"]
}
```

**Fields:**
- `connectionString`: MongoDB connection string to your test cluster
- `databaseName`: Name of the database containing test collections
- `preferredModel` (optional): Preferred LLM model for Index Advisor
- `fallbackModels` (optional): Fallback LLM models if preferred is unavailable

### 2. Create Test Cases CSV

Create a CSV file with test cases using pipe (`|`) as delimiter:

```csv
Category | Test Case | Tags | Collection | Positive/Negative | Query | Expected Index Advisor Suggestion | Explanation | Comment
Basic | Single Field Index | index,find | users | Positive | db.users.find({email: "test@example.com"}) | Create an index on email field | Query filters by email field without index | Basic find query test
Basic | Compound Index | index,find | users | Positive | db.users.find({status: "active", age: {$gt: 25}}) | Create a compound index on (status, age) | Query filters by multiple fields | Compound index recommendation
```

**Columns:**
- **Category**: Test category (e.g., "Basic", "Performance", "Edge Cases")
- **Test Case**: Descriptive name for the test
- **Tags**: Comma-separated tags for filtering (e.g., "index,find,sort")
- **Collection**: MongoDB collection name to run the query against
- **Positive/Negative**: Whether this is a positive (should find issues) or negative (should not find issues) test
- **Query**: MongoDB query to execute (e.g., `db.users.find({email: "test@example.com"})`)
- **Expected Index Advisor Suggestion**: What the Index Advisor should recommend
- **Explanation**: Why this suggestion is expected
- **Comment**: Additional notes or context

## Running Tests

### Using npm script

Add this to your `package.json` scripts section:

```json
"scripts": {
  "csv-test": "ts-node scripts/runCSVTests.ts"
}
```

Then run:

```bash
npm run csv-test -- --config ./test/csvTests/config.json \
                     --input ./test/csvTests/testCases.csv \
                     --output ./test/csvTests/results.csv
```

### Programmatically

```typescript
import { runCSVBatchTests } from './src/commands/llmEnhancedCommands/csvTestingFramework';

const context = {
    telemetry: { properties: {}, measurements: {} },
    errorHandling: { rethrow: true, suppressDisplay: false },
    ui: { showWarningMessage: async (msg) => console.warn(msg) },
    valuesToMask: []
};

await runCSVBatchTests(
    context,
    './test/csvTests/config.json',
    './test/csvTests/testCases.csv',
    './test/csvTests/results.csv'
);
```

## Output Format

The output CSV contains all input columns plus additional result columns:

- **Execution Plan**: JSON execution plan from MongoDB explain
- **Actual Suggestion**: Actual recommendation from Index Advisor
- **Test Passed**: PASS or FAIL based on comparison
- **Error**: Any error that occurred during testing

Example output:

```csv
Category | Test Case | ... | Execution Plan | Actual Suggestion | Test Passed | Error
Basic | Single Field Index | ... | {"queryPlanner": ...} | Create index on email | PASS | 
Basic | Compound Index | ... | {"queryPlanner": ...} | Create compound index (status, age) | PASS |
```

## Test Preparation

### Database Setup

1. Create a test database with your test collections
2. Populate collections with representative data
3. Ensure the database name matches your config file

### Example Setup

```javascript
// Connect to MongoDB
use indexAdvisorTests;

// Create test collection
db.users.insertMany([
  { email: "user1@example.com", status: "active", age: 30 },
  { email: "user2@example.com", status: "inactive", age: 25 },
  // ... more test data
]);

db.orders.insertMany([
  { userId: 1, createdAt: new Date(), total: 100 },
  // ... more test data
]);
```

## Tips for Writing Test Cases

1. **Cover Different Query Patterns**: Include find, aggregate, count queries
2. **Test Edge Cases**: Empty collections, missing fields, complex filters
3. **Include Negative Tests**: Queries that already have optimal indexes
4. **Test Performance Scenarios**: Large collections, complex aggregations
5. **Use Realistic Data**: Match production query patterns

## Troubleshooting

### Connection Issues
- Verify connection string in config file
- Ensure MongoDB is running and accessible
- Check network connectivity and firewall rules

### Test Failures
- Review the `Error` column in output CSV
- Check that collections exist in the test database
- Verify query syntax is correct
- Ensure GitHub Copilot is available for Index Advisor

### Comparison Mismatches
- The framework uses fuzzy matching for suggestions
- Review actual vs expected in the output CSV
- Update expected suggestions if needed
- Consider normalizing suggestion format

## Example Test Suite

See `test/csvTests/testCases.example.csv` for a sample test suite covering:
- Basic single-field indexes
- Compound indexes
- Sort optimization
- Projection optimization
- Aggregation pipeline optimization
- Edge cases and negative tests
