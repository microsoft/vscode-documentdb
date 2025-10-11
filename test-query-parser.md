# Query Parser Test Cases

This file documents the test cases for the improved MongoDB query parser.

## Test Case 1: Original example with single quotes and chained methods
```javascript
db.test.find({'age': {$gt: 25}}).sort({'name': -1}).limit(15).project({'name': 1, 'age': 1, '_id':0})
```

**Expected parsing:**
- Filter: `{'age': {$gt: 25}}`
- Sort: `{'name': -1}`
- Limit: `15`
- Projection: `{'name': 1, 'age': 1, '_id': 0}`

## Test Case 2: Double quotes
```javascript
db.test.find({"age": {$gt: 25}}).sort({"name": -1})
```

## Test Case 3: No quotes on keys
```javascript
db.test.find({age: {$gt: 25}}).sort({name: -1})
```

## Test Case 4: Mixed quotes
```javascript
db.test.find({'age': {$gt: 25}, "status": "active"})
```

## Test Case 5: Aggregation pipeline
```javascript
db.test.aggregate([
  {$match: {'age': {$gt: 25}}},
  {$sort: {'name': -1}},
  {$limit: 10}
])
```

## Test Case 6: Count query
```javascript
db.test.countDocuments({'age': {$gt: 25}})
```

## Test Case 7: Projection method
```javascript
db.test.find({age: {$gt: 25}}).projection({name: 1, age: 1, _id: 0})
```

## Test Case 8: Skip and limit
```javascript
db.test.find({}).skip(10).limit(5)
```

## Improvements Made

1. **`mongoQueryToJSON()` function**: Converts MongoDB-like syntax to valid JSON
   - Replaces single quotes with double quotes
   - Adds quotes to MongoDB operators ($gt, $match, etc.)
   - Adds quotes to unquoted object keys

2. **`extractMethodArg()` function**: Extracts arguments from chained method calls
   - Supports `.sort()`, `.limit()`, `.skip()`, `.project()`, `.projection()`
   - Uses regex to find method calls anywhere in the query string

3. **Enhanced `parseQueryString()` function**:
   - Handles chained method calls for find queries
   - Supports both `.project()` and `.projection()`
   - Parses numeric arguments for skip and limit
   - Applies MongoDB-to-JSON conversion before parsing
