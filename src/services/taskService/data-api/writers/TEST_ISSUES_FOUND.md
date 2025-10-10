# Issues Found During Test Development - Pending Investigation

## Summary

While creating comprehensive tests for `BaseDocumentWriter.ts` and `StreamDocumentWriter.ts`, the following issues were discovered in the production code that need investigation and fixing.

**Current Status**: 81/85 tests passing (95.3%)

- **BaseDocumentWriter**: 26/26 passing (100%) ✅
- **StreamDocumentWriter**: 55/59 passing (93%) ⚠️

**Issues Fixed**: ✅

- Issue #1: Empty array now returns `null` for errors (fixed in BaseDocumentWriter.ts line 142)
- Issue #2: Fake timers implemented in all retry tests (fixed in BaseDocumentWriter.test.ts)

**Issues Requiring Investigation**: ⚠️ (documented below)

---

## 🐛 Issue #1: Conflict error fallback path processedCount calculation

**File**: `BaseDocumentWriter.ts` lines 424-476
**Severity**: Medium
**Status**: ⚠️ **NEEDS INVESTIGATION**

**Failing Tests**:

- `StreamDocumentWriter.test.ts` - "should throw StreamWriterError with partial stats on \_id collision after N documents"

**Description**:
When a conflict error is thrown via the fallback path (not the primary errors array path) with Abort strategy, the `processedCount` in the returned result is 0 instead of the actual number of documents processed before the conflict.

**Test Expectation**:

```typescript
// After inserting 4 documents successfully, then hitting a conflict
expect(caughtError?.partialStats.totalProcessed).toBeGreaterThan(0); // Expected > 0
// Actual: 0
```

**Code Path Analysis**:

```typescript
// BaseDocumentWriter.ts lines 424-476
if (errorType === 'conflict') {
  // Fallback path: conflict was thrown unexpectedly (race condition, unknown index, etc.)
  const conflictErrors = this.extractConflictDetails(error, actionContext);
  const details =
    this.extractDetailsFromError(error, actionContext) ?? this.createFallbackDetails(conflictErrors.length); // ⚠️ Problem here?

  // ...reporting and progress updates...

  insertedCount += details.insertedCount ?? 0;
  skippedCount += details.skippedCount ?? 0;
  matchedCount += details.matchedCount ?? 0;
  upsertedCount += details.upsertedCount ?? 0;

  if (conflictErrors.length > 0) {
    batchErrors.push(...conflictErrors);
  }

  currentBatch = currentBatch.slice(details.processedCount);

  if (this.conflictResolutionStrategy === ConflictResolutionStrategy.Skip) {
    attempt = 0;
    continue;
  }

  // For Abort strategy, stop processing immediately
  return {
    insertedCount,
    skippedCount,
    matchedCount,
    upsertedCount,
    processedCount: details.processedCount, // ⚠️ Returns 0 when it should return actual count
    wasThrottled,
    errors: batchErrors.length > 0 ? batchErrors : undefined,
  };
}
```

**Root Cause Possibilities**:

1. **`extractDetailsFromError()` returns `undefined`** when it should extract partial progress from the error
2. **`createFallbackDetails(conflictErrors.length)`** is called with `conflictErrors.length = 0` or 1, creating details with `processedCount = 0` or 1
3. **The MockDocumentWriter's `extractDetailsFromError`** implementation may not properly return the `partialProgress` value set in the error config
4. **Real implementations** (DocumentDbDocumentWriter, MongoDbDocumentWriter) may not include processedCount in thrown conflict errors

**Why This Matters**:

When streaming documents and a conflict occurs mid-batch, the user/caller needs to know:

- How many documents were successfully processed before the error
- Accurate progress reporting for large migrations
- Correct statistics for partial completion scenarios

**Recommendations**:

1. **Verify `extractDetailsFromError` implementations**:
   - Check DocumentDbDocumentWriter.ts - does it extract processedCount from MongoDB BulkWriteError?
   - Check if MongoDB driver includes partial progress in conflict errors

2. **Review `createFallbackDetails` logic**:

   ```typescript
   private createFallbackDetails(documentCount: number): ProcessedDocumentsDetails {
     return {
       processedCount: documentCount, // ⚠️ Is this correct?
       insertedCount: 0,
     };
   }
   ```

   - Should `documentCount` parameter represent conflicts found or documents processed?
   - Consider renaming parameter for clarity

3. **Add defensive logging**:
   - Log when `extractDetailsFromError` returns `undefined`
   - Log the values used in `createFallbackDetails`
   - Help diagnose production issues with this code path

4. **Consider test scenario validity**:
   - Is the MockDocumentWriter accurately simulating MongoDB behavior?
   - Do real MongoDB conflict errors include processedCount?
   - May need to adjust test expectations based on real-world behavior

---

## 🐛 Issue #2: Progress reporting details not captured in tests

**File**: `StreamDocumentWriter.ts` (progress callback implementation)
**Severity**: Low
**Status**: ⚠️ **NEEDS INVESTIGATION**

**Failing Tests** (StreamDocumentWriter.test.ts):

- "should show inserted count for Abort strategy"
- "should show inserted + skipped for Skip strategy"
- "should show matched + upserted for Overwrite strategy"

**Description**:
The progress callback receives `ProcessedDocumentsDetails` objects, but tests are checking for specific keywords in the details that may not be present or may be formatted differently than expected.

**Test Pattern**:

```typescript
const progressDetails: string[] = [];

await writer.streamDocuments(documentStream, {
  progressCallback: (details) => {
    progressDetails.push(JSON.stringify(details)); // Convert to string for inspection
  },
});

// Expectation
expect(progressDetails.some((detail) => detail.includes('inserted'))).toBe(true);
// Actual: false - keyword not found
```

**Possible Causes**:

1. **Property names don't match**: The details object may use `insertedCount` but test looks for `'inserted'` (without 'Count')
2. **Undefined properties**: Properties like `insertedCount` may be `undefined` and not included in JSON.stringify output
3. **No progress callbacks triggered**: Buffer never flushes, so callback never called
4. **Wrong test approach**: Should check actual property values instead of string searching

**Recommendations**:

1. **Update test approach**:

   ```typescript
   const progressCallbacks: ProcessedDocumentsDetails[] = [];

   await writer.streamDocuments(documentStream, {
     progressCallback: (details) => {
       progressCallbacks.push(details); // Store actual object
     },
   });

   // Check actual properties
   const hasInserted = progressCallbacks.some((d) => (d.insertedCount ?? 0) > 0);
   expect(hasInserted).toBe(true);
   ```

2. **Verify progress callback is called**:
   - Add assertion that `progressCallbacks.length > 0`
   - Ensure buffer flushes occur (may need more documents)

3. **Document expected progress detail structure**:
   - Clarify which properties are populated for each strategy
   - Update type documentation

---

## 📋 Next Steps

### Priority 1: Issue #1 (Conflict fallback path)

1. Review `extractDetailsFromError` in DocumentDbDocumentWriter
2. Test with real MongoDB to see what error details are available
3. Fix either the code logic or adjust test expectations

### Priority 2: Issue #2 (Progress reporting)

1. Update tests to check actual property values instead of string matching
2. Verify buffer flush behavior in tests
3. Document progress callback behavior for each strategy

### Testing Recommendations:

- Add integration tests with real DocumentDbDocumentWriter if not present
- Consider adding debug logging in production code for fallback paths
- Validate MockDocumentWriter accurately represents real MongoDB behavior

---

**Created**: October 10, 2025
**Test Coverage**: 81/85 tests passing (95.3%)
**Status**: Pending Investigation & Fixes
