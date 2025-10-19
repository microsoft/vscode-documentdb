# AI Testing Framework - Architecture

## Overview

The AI Testing Framework is designed with a modular architecture that separates concerns and allows for easy extension and maintenance.

## Component Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      User Interface Layer                    │
│                                                               │
│  ┌──────────────────┐         ┌──────────────────────────┐  │
│  │  CLI Test Runner │         │  Web UI (Future/Optional)│  │
│  │  (testRunner.ts) │         │                          │  │
│  └────────┬─────────┘         └────────────┬─────────────┘  │
│           │                                 │                │
└───────────┼─────────────────────────────────┼────────────────┘
            │                                 │
            └─────────────┬───────────────────┘
                          │
┌─────────────────────────▼──────────────────────────────────┐
│                   Test Orchestration Layer                 │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │           Test Executor (testExecutor.ts)             │ │
│  │  - Batch test execution                               │ │
│  │  - Progress tracking                                  │ │
│  │  - Performance measurement                            │ │
│  │  - Error handling                                     │ │
│  └───────────────────────────────────────────────────────┘ │
│                          │                                  │
└──────────────────────────┼──────────────────────────────────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                ▼                ▼
┌─────────────────┐  ┌────────────┐  ┌─────────────────┐
│ Config Parser   │  │  Testing   │  │ Result          │
│                 │  │  Interface │  │ Formatter       │
│ - JSON config   │  │            │  │                 │
│ - CSV test      │  │ - Security │  │ - CSV output    │
│   cases         │  │   check    │  │ - Summary       │
│ - Validation    │  │ - Feature  │  │   reports       │
│                 │  │   exposure │  │                 │
└─────────────────┘  └────┬───────┘  └─────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│                  AI Features Layer                           │
│                                                               │
│  ┌─────────────────────┐      ┌──────────────────────────┐  │
│  │  Query Optimization │      │  Query Generation        │  │
│  │  (optimizeQuery)    │      │  (generateQuery)         │  │
│  │                     │      │                          │  │
│  │  - Index Advisor    │      │  - Natural Language →    │  │
│  │  - Performance      │      │    MongoDB Query         │  │
│  │    Analysis         │      │  - Schema Analysis       │  │
│  └─────────────────────┘      └──────────────────────────┘  │
│                                                               │
└───────────────────────────────┬───────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────┐
│                  External Services Layer                      │
│                                                               │
│  ┌──────────────┐    ┌──────────────┐    ┌───────────────┐  │
│  │   MongoDB    │    │    GitHub    │    │   VS Code     │  │
│  │   Cluster    │    │   Copilot    │    │   Extension   │  │
│  │              │    │              │    │   APIs        │  │
│  └──────────────┘    └──────────────┘    └───────────────┘  │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

## Data Flow

### Test Execution Flow

```
1. User Input
   ├── Configuration File (JSON)
   └── Test Cases (CSV)
        │
        ▼
2. Parsing & Validation
   ├── Parse JSON configuration
   ├── Parse CSV test cases
   ├── Validate required fields
   └── Check environment setup
        │
        ▼
3. Test Execution Loop (for each test case)
   ├── Initialize connection
   ├── Measure baseline performance
   ├── Call AI feature (e.g., optimizeQuery)
   ├── Parse AI response
   ├── Extract recommendations
   ├── Measure improved performance (if applicable)
   └── Collect results
        │
        ▼
4. Result Processing
   ├── Format as CSV
   ├── Generate summary report
   ├── Write to file
   └── Display to user
```

### Performance Measurement Flow

```
Test Case
    │
    ▼
┌─────────────────────────────────────┐
│ 1. Initialize Connection            │
│    - Execute lightweight command    │
│    - Ensure connection is ready     │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│ 2. Execute Original Query           │
│    - Start timer                    │
│    - Run query                      │
│    - Stop timer                     │
│    - Record baseline performance    │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│ 3. Get AI Optimization              │
│    - Send to Copilot                │
│    - Receive recommendations        │
│    - Parse suggestions              │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│ 4. Execute Optimized Query          │
│    - Apply AI suggestions           │
│    - Start timer                    │
│    - Run optimized query            │
│    - Stop timer                     │
│    - Record improved performance    │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│ 5. Calculate Improvement            │
│    - Compare before/after           │
│    - Calculate percentage gain      │
│    - Store in results               │
└─────────────────────────────────────┘
```

## Module Responsibilities

### llmTestingInterface.ts
**Purpose:** Security gateway for AI features in test environment

**Responsibilities:**
- Environment validation (test mode only)
- Expose `optimizeQuery` for testing
- Expose `generateQuery` for testing
- Type exports for test framework

**Key Design Decisions:**
- Only accessible when `VSCODE_TEST=true`
- Prevents accidental exposure in production
- Maintains same signature as original functions

### configParser.ts
**Purpose:** Parse and validate test configuration and test cases

**Responsibilities:**
- Parse JSON configuration files
- Parse CSV test case files
- Validate required fields
- Handle CSV edge cases (quotes, commas, newlines)
- Generate sample files

**Key Design Decisions:**
- Flexible CSV parsing with quoted value support
- Auto-generate test IDs if not provided
- Clear error messages for validation failures
- Sample generation for quick start

### testExecutor.ts
**Purpose:** Execute tests and measure performance

**Responsibilities:**
- Execute individual test cases
- Batch test execution
- Performance measurement
- Progress reporting
- Error handling and recovery

**Key Design Decisions:**
- Measure performance before and after optimization
- Lightweight connection initialization before timing
- Parse AI responses (JSON or text format)
- Handle test failures gracefully
- Add delays between tests to avoid overwhelming system

### resultFormatter.ts
**Purpose:** Format and export test results

**Responsibilities:**
- Format results as CSV
- Generate summary reports
- Calculate statistics (pass rate, performance improvement)
- Write results to files
- Handle CSV escaping

**Key Design Decisions:**
- Comprehensive CSV output with all relevant data
- Human-readable summary reports
- Performance statistics aggregation
- Proper CSV escaping for complex content

### testRunner.ts
**Purpose:** Command-line interface for test execution

**Responsibilities:**
- Parse command-line arguments
- Coordinate test execution
- Display progress
- Write results
- Exit with appropriate status code

**Key Design Decisions:**
- Standard command-line argument parsing
- Help text for usability
- Sample file generation
- Progress feedback during execution
- Exit code reflects test results (0 = success, 1 = failures)

## Security Considerations

### Test Environment Isolation

The testing interface includes security checks:

```typescript
function isTestEnvironment(): boolean {
    return process.env.NODE_ENV === 'test' || 
           process.env.VSCODE_TEST === 'true';
}
```

**Why?**
- Prevents accidental exposure of internal AI features
- Ensures test-only code doesn't run in production
- Provides clear error messages if misused

### Data Privacy

**Connection Strings:** Not stored in test results
**Credentials:** Rely on VS Code's secure storage
**Query Data:** Only what user explicitly includes in test cases

## Extension Points

### Adding New AI Features

To add support for a new AI feature:

1. **Expose in Testing Interface** (`llmTestingInterface.ts`)
   ```typescript
   export async function testNewFeature(
       context: IActionContext,
       featureContext: NewFeatureContext
   ): Promise<NewFeatureResult> {
       if (!isTestEnvironment()) {
           throw new Error('Only available in test environment');
       }
       return newFeature(context, featureContext);
   }
   ```

2. **Add Test Executor** (`testExecutor.ts`)
   ```typescript
   export async function executeNewFeatureTest(
       context: IActionContext,
       config: TestConfig,
       testCase: TestCase
   ): Promise<TestResult> {
       // Implementation
   }
   ```

3. **Update Test Runner** (`testRunner.ts`)
   ```typescript
   // Add command-line option
   // Call appropriate executor based on feature type
   ```

### Custom Result Formats

The result formatter can be extended to support additional formats:

```typescript
export function formatResultsAsJSON(results: TestResult[]): string {
    return JSON.stringify(results, null, 2);
}

export function formatResultsAsHTML(results: TestResult[]): string {
    // Generate HTML report
}
```

## Performance Characteristics

### Expected Performance

- **Test Initialization:** ~1-2 seconds per test
- **AI Processing:** 5-15 seconds per test (depends on Copilot)
- **Performance Measurement:** Varies by query complexity
- **Result Writing:** < 1 second for typical result set

### Scalability

- **Test Cases:** Tested up to 100 test cases in single run
- **Batch Size:** No hard limit, processes sequentially
- **Memory:** Minimal - results collected incrementally
- **Disk:** CSV files scale linearly with test count

### Optimization Opportunities

1. **Parallel Execution:** Currently sequential, could parallelize
2. **Connection Pooling:** Reuse connections across tests
3. **Caching:** Cache cluster metadata, schema information
4. **Incremental Results:** Write results as tests complete

## Future Enhancements

### Planned Improvements

1. **Query Generation Testing** - Full support in test runner
2. **Web-based UI** - Browser interface for test management
3. **Result Comparison** - Compare results across runs
4. **Semantic Validation** - Automatically validate AI suggestions
5. **CI/CD Integration** - GitHub Actions workflow
6. **Multi-cluster Support** - Test across multiple clusters
7. **Test Scheduling** - Automated recurring tests
8. **Real-time Monitoring** - Live test execution dashboard

### Web-based UI Vision

See `WEB_UI_DESIGN.md` for detailed design of the optional web-based testing framework.

## Dependencies

### Runtime Dependencies
- `@microsoft/vscode-azext-utils` - VS Code extension utilities
- `vscode` - VS Code extension APIs
- MongoDB drivers (via ClustersClient)

### Development Dependencies
- TypeScript compiler
- ESLint for linting
- Prettier for formatting

### External Services
- GitHub Copilot API
- MongoDB clusters
- VS Code extension host

## Testing the Framework

The framework itself can be tested using:

1. **Unit Tests** - Test individual functions
   ```typescript
   describe('parseCSVLine', () => {
       it('should handle quoted values', () => {
           // Test cases
       });
   });
   ```

2. **Integration Tests** - Test end-to-end with mock services
3. **Manual Testing** - Run against real clusters with sample data

## Maintenance Guidelines

### Code Organization
- Keep modules focused on single responsibility
- Use clear, descriptive function names
- Include JSDoc comments for public APIs
- Follow existing TypeScript patterns in the codebase

### Error Handling
- Provide clear, actionable error messages
- Include context in error messages (file names, line numbers)
- Handle edge cases gracefully
- Log errors for debugging

### Documentation
- Keep documentation in sync with code changes
- Update examples when interfaces change
- Document breaking changes
- Provide migration guides for major updates

## Conclusion

The AI Testing Framework provides a solid foundation for testing AI-enhanced features with:

- Clear separation of concerns
- Extensible architecture
- Comprehensive error handling
- Performance measurement
- Rich reporting capabilities

The modular design allows for easy extension to support new features and integration methods while maintaining security and reliability.
