# AI-Enhanced Feature Testing

This directory contains the testing framework for AI-enhanced features in the DocumentDB VS Code extension.

## Quick Links

- [Full Documentation](../../docs/AI_TESTING_FRAMEWORK.md)
- [Sample Configuration](./examples/sample-config.json) (to be created)
- [Sample Test Cases](./examples/sample-test-cases.csv) (to be created)

## Files

- **llmTestingInterface.ts** - Testing interface that exposes AI features for testing
- **configParser.ts** - Configuration and test case file parsers
- **testExecutor.ts** - Test execution engine with performance measurement
- **resultFormatter.ts** - Result formatting and CSV export
- **testRunner.ts** - Command-line test runner script
- **examples/** - Sample configuration and test case files

## Quick Start

1. Generate sample files:
   ```bash
   cd src/testing
   node testRunner.ts --generate-samples
   ```

2. Edit the generated files with your test data

3. Run tests:
   ```bash
   node testRunner.ts --config sample-config.json --tests sample-test-cases.csv
   ```

## Features

- ✅ Test AI query optimization (index advisor)
- ✅ Performance measurement before/after optimization
- ✅ CSV input for test cases
- ✅ JSON configuration
- ✅ CSV output with detailed results
- ✅ Summary reports with statistics
- ✅ Batch test execution
- 🚧 Query generation testing (interface available, not yet in runner)
- 🚧 Web-based UI (future enhancement)

## Requirements

- VS Code with DocumentDB extension installed
- GitHub Copilot extension with active subscription
- MongoDB cluster connection configured
- Node.js runtime

## Output Example

```csv
Test ID,Collection Name,Query,Success,Query Performance (ms),Updated Performance (ms),Model Used
test_1,users,"db.users.find({age: {$gt: 25}})",PASS,45.2,12.3,gpt-4
test_2,orders,"db.orders.find({status: 'active'})",PASS,38.7,9.1,gpt-4
```

## Architecture

```
┌─────────────────────────────────────────┐
│  Test Runner (CLI)                      │
│  - Parse command line args              │
│  - Load configuration                   │
│  - Coordinate execution                 │
└─────────────────┬───────────────────────┘
                  │
         ┌────────▼────────┐
         │  Test Executor  │
         │  - Run tests    │
         │  - Measure perf │
         └────────┬────────┘
                  │
    ┌─────────────▼──────────────┐
    │  Testing Interface         │
    │  - Expose AI features      │
    │  - Environment validation  │
    └─────────────┬──────────────┘
                  │
    ┌─────────────▼──────────────┐
    │  AI Features               │
    │  - optimizeQuery           │
    │  - generateQuery           │
    └────────────────────────────┘
```

## Contributing

When adding new AI features, update:

1. `llmTestingInterface.ts` - Add new test interface function
2. `testExecutor.ts` - Add new executor function if needed
3. `testRunner.ts` - Add command-line support for new feature
4. Documentation - Update docs with usage examples

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for general contribution guidelines.
