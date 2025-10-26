# Test Cases Directory

This directory contains test cases for the Index Advisor in the **new pre-loaded data format**.

## Quick Reference

Each test case is a directory with these 4 required files:

```
TestCaseName/
├── executionPlan.json      ← MongoDB explain() output
├── collectionStats.json    ← Collection statistics
├── indexStats.json         ← Array of index info
└── description.json        ← Test metadata
```

## File Templates

### description.json

```json
{
  "collectionName": "your_collection",
  "category": "test-category",
  "description": "What this test case is testing",
  "expectedResults": "db.getCollection('collection').createIndex({'field':1},{})"
}
```

### executionPlan.json

Get this from MongoDB shell:

```javascript
db.collection.find({ your_query }).explain('executionStats');
```

### collectionStats.json

Get this from MongoDB shell:

```javascript
db.collection.stats();
```

### indexStats.json

Get this from MongoDB shell:

```javascript
db.collection.aggregate([{ $indexStats: {} }]);
```

## Example: Creating a New Test Case

1. Create a new directory with your test case name:

   ```bash
   mkdir MyNewTest
   ```

2. Run queries in MongoDB shell to gather data:

   ```javascript
   // Get execution plan
   db.myCollection.find({ userId: 123 }).explain('executionStats');
   // Save output to MyNewTest/executionPlan.json

   // Get collection stats
   db.myCollection.stats();
   // Save output to MyNewTest/collectionStats.json

   // Get index stats
   db.myCollection.aggregate([{ $indexStats: {} }]);
   // Save output to MyNewTest/indexStats.json
   ```

3. Create description.json with expected index

4. Run the test using VS Code command palette

## Advantages of This Format

✅ **No database connection needed** - Run tests anywhere
✅ **Fast execution** - No waiting for query execution
✅ **Reproducible** - Same data every time
✅ **Version control friendly** - JSON files in git
✅ **CI/CD ready** - Perfect for automated testing

## See Also

- [Main Test Framework README](../test/indexAdvisor/README.md) - Full documentation
- [Legacy CSV Format](../test/indexAdvisor/test-cases.example.csv) - Old format
