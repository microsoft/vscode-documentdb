# Quick Start Guide - AI Testing Framework

This guide will help you quickly set up and run tests for AI-enhanced features.

## Prerequisites

Before running tests, ensure you have:

1. ✅ VS Code with DocumentDB extension installed
2. ✅ GitHub Copilot extension with active subscription  
3. ✅ MongoDB cluster connection configured in the extension
4. ✅ Node.js installed (version specified in .nvmrc)

## Step 1: Generate Sample Files

From the repository root:

```bash
npm run ai-test:samples
```

This creates:
- `sample-config.json` - Test configuration template
- `sample-test-cases.csv` - Test cases template

## Step 2: Configure Your Tests

### Edit `sample-config.json`

Replace placeholders with your actual values:

```json
{
  "connection": {
    "clusterId": "my-mongodb-cluster",  // Your cluster ID from VS Code
    "databaseName": "myDatabase"         // Database to test
  },
  "model": {
    "preferredModel": "gpt-4"           // Optional: AI model preference
  },
  "output": {
    "outputDir": "./test-results",      // Where to save results
    "filePrefix": "test-run"            // Result file prefix
  }
}
```

### Edit `sample-test-cases.csv`

Add your test cases:

```csv
id,collection,query,expected_result,notes
test_1,users,"db.users.find({age: {$gt: 25}})","Index on age","Test range query"
test_2,orders,"db.orders.find({status: 'active'})","Index on status","Test equality"
```

**CSV Columns:**
- `id` - Unique test identifier (optional, auto-generated if omitted)
- `collection` - Collection name (required)
- `query` - MongoDB query to optimize (required)
- `expected_result` - What you expect the AI to recommend (optional)
- `notes` - Description or notes (optional)

## Step 3: Run Tests

### Option A: Using npm script (recommended)

```bash
npm run ai-test -- --config sample-config.json --tests sample-test-cases.csv
```

### Option B: Direct execution

```bash
npm run build
node out/src/testing/testRunner.js --config sample-config.json --tests sample-test-cases.csv
```

### Option C: Custom output location

```bash
npm run ai-test -- -c sample-config.json -t sample-test-cases.csv -o my-results.csv
```

## Step 4: Review Results

After test execution:

1. **Console Output** - See summary statistics
2. **CSV File** - Find detailed results in `test-results/` directory

### Understanding Results

The output CSV contains:

| Column | Description |
|--------|-------------|
| Test ID | Your test case identifier |
| Success | PASS or FAIL |
| Query Performance (ms) | Execution time before optimization |
| Updated Performance (ms) | Execution time after applying suggestions |
| Suggestions | AI-generated index recommendations |
| Analysis | AI's detailed analysis |
| Model Used | Which AI model generated the response |

### Example Summary

```
============================================================
AI-Enhanced Feature Test Summary
============================================================
Total Tests: 10
Passed: 8
Failed: 2
Pass Rate: 80.00%
============================================================

Performance Statistics:
  Average Query Performance (before): 45.32 ms
  Average Query Performance (after): 12.18 ms
  Average Improvement: 73.12%
============================================================
```

## Common Query Patterns to Test

### Range Queries
```csv
range_test,products,"db.products.find({price: {$gt: 100, $lt: 500}})"
```

### Sort Operations
```csv
sort_test,orders,"db.orders.find({status: 'pending'}).sort({createdAt: -1})"
```

### Aggregation Pipelines
```csv
agg_test,sales,"db.sales.aggregate([{$match: {year: 2024}}, {$group: {_id: '$region', total: {$sum: '$amount'}}}])"
```

### Text Search
```csv
text_test,articles,"db.articles.find({title: {$regex: 'mongodb', $options: 'i'}})"
```

### Compound Filters
```csv
compound_test,users,"db.users.find({country: 'USA', age: {$gte: 18}, active: true})"
```

## Troubleshooting

### Issue: "GitHub Copilot is not available"

**Solution:**
1. Install GitHub Copilot extension in VS Code
2. Sign in to GitHub
3. Ensure active Copilot subscription
4. Restart VS Code

### Issue: "Failed to gather query optimization data"

**Solution:**
1. Verify cluster connection in VS Code DocumentDB extension
2. Check database and collection exist
3. Ensure you have read permissions on the cluster

### Issue: "testOptimizeQuery is only available in test environment"

**Solution:**
- This error should not occur when using the test runner
- If it does, ensure `VSCODE_TEST=true` is set (test runner does this automatically)

### Issue: Performance measurement returns -1

**Solution:**
- Query syntax might be invalid
- Collection might be empty
- Try with a simpler query to verify connection

## Advanced Usage

### Environment Variables

```bash
# Enable debug logging
export DEBUG=true
npm run ai-test -- -c config.json -t tests.csv

# Use specific test environment
export VSCODE_TEST=true
export NODE_ENV=test
```

### Batch Testing Different Configurations

Create multiple config files for different scenarios:

```bash
# Test production cluster
npm run ai-test -- -c config-prod.json -t tests.csv -o results-prod.csv

# Test staging cluster
npm run ai-test -- -c config-staging.json -t tests.csv -o results-staging.csv

# Compare results
diff results-prod.csv results-staging.csv
```

### Testing Specific Collections

Create separate test case files per collection:

```bash
npm run ai-test -- -c config.json -t users-tests.csv -o users-results.csv
npm run ai-test -- -c config.json -t orders-tests.csv -o orders-results.csv
npm run ai-test -- -c config.json -t products-tests.csv -o products-results.csv
```

## Best Practices

1. **Start Small** - Begin with 3-5 test cases to verify setup
2. **Use Real Queries** - Test actual queries from your application
3. **Document Expected Results** - Help validate AI recommendations
4. **Version Control** - Keep configs and test cases in git
5. **Regular Testing** - Run tests when:
   - Adding new features
   - Modifying database schema
   - Performance issues arise
   - Before production deployments

## Next Steps

1. Review full documentation: `docs/AI_TESTING_FRAMEWORK.md`
2. Explore example files: `src/testing/examples/`
3. Check framework source: `src/testing/`
4. Customize for your needs

## Getting Help

- Report issues: [GitHub Issues](https://github.com/microsoft/vscode-documentdb/issues)
- Documentation: `docs/AI_TESTING_FRAMEWORK.md`
- Source code: `src/testing/`

---

**Happy Testing! 🚀**
