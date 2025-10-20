#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Main entry point for the Index Advisor testing framework
 * This script runs as a standalone Node.js application and communicates with VS Code
 * to execute optimization tests.
 */

import * as fs from 'fs';
import type { TestResult } from './types';
import { generateOutputPath, loadConfig, loadTestCases, saveResults } from './utils';

// Parse command line arguments
interface CliArgs {
    config: string;
    cases: string;
    output?: string;
    verbose: boolean;
    skipPerformance: boolean;
    help: boolean;
}

function parseArgs(): CliArgs {
    const args: CliArgs = {
        config: './test-config.json',
        cases: './test-cases.csv',
        verbose: false,
        skipPerformance: false,
        help: false,
    };

    for (let i = 2; i < process.argv.length; i++) {
        const arg = process.argv[i];

        switch (arg) {
            case '--config':
                args.config = process.argv[++i];
                break;
            case '--cases':
                args.cases = process.argv[++i];
                break;
            case '--output':
                args.output = process.argv[++i];
                break;
            case '--verbose':
                args.verbose = true;
                break;
            case '--skip-performance':
                args.skipPerformance = true;
                break;
            case '--help':
            case '-h':
                args.help = true;
                break;
            default:
                console.warn(`Unknown argument: ${arg}`);
        }
    }

    return args;
}

function printHelp(): void {
    console.log(`
Index Advisor Testing Framework

Usage: node runTests.js [options]

Options:
  --config <path>         Path to configuration file (default: ./test-config.json)
  --cases <path>          Path to test cases CSV (default: ./test-cases.csv)
  --output <path>         Path to output results CSV (default: ./test-results-{timestamp}.csv)
  --verbose               Enable verbose logging
  --skip-performance      Skip performance measurements
  --help, -h              Show this help message

Examples:
  node runTests.js
  node runTests.js --config ./my-config.json --cases ./my-tests.csv
  node runTests.js --verbose --skip-performance
`);
}

async function main(): Promise<void> {
    const args = parseArgs();

    if (args.help) {
        printHelp();
        return;
    }

    console.log('='.repeat(60));
    console.log('Index Advisor Testing Framework');
    console.log('='.repeat(60));
    console.log('');

    // Validate files exist
    if (!fs.existsSync(args.config)) {
        console.error(`Error: Configuration file not found: ${args.config}`);
        console.log('Use --config to specify a different path or create the file.');
        process.exit(1);
    }

    if (!fs.existsSync(args.cases)) {
        console.error(`Error: Test cases file not found: ${args.cases}`);
        console.log('Use --cases to specify a different path or create the file.');
        process.exit(1);
    }

    try {
        // Load configuration and test cases
        console.log(`Loading configuration from: ${args.config}`);
        const config = loadConfig(args.config);

        console.log(`Loading test cases from: ${args.cases}`);
        const testCases = loadTestCases(args.cases);

        console.log(`Found ${testCases.length} test case(s)`);
        console.log('');

        if (testCases.length === 0) {
            console.warn('Warning: No test cases found. Exiting.');
            return;
        }

        // Display configuration
        if (args.verbose) {
            console.log('Configuration:');
            console.log(`  Cluster ID: ${config.clusterId}`);
            console.log(`  Database: ${config.databaseName}`);
            console.log(`  Preferred Model: ${config.preferredModel || 'default'}`);
            console.log(`  Skip Performance: ${args.skipPerformance}`);
            console.log('');
        }

        // NOTE: Since this is a standalone Node.js script, it cannot directly call VS Code APIs
        // We need to create a VS Code command that can be triggered from the terminal
        console.log('');
        console.log('⚠️  IMPORTANT: This test runner requires VS Code to be open with the extension loaded.');
        console.log('');
        console.log('To run the tests, you have two options:');
        console.log('');
        console.log('Option 1: Use the VS Code command palette');
        console.log('  1. Open VS Code with the DocumentDB extension installed');
        console.log('  2. Press Ctrl+Shift+P (Cmd+Shift+P on Mac)');
        console.log('  3. Run: "DocumentDB: Run Index Advisor Tests"');
        console.log('  4. Select your config and test cases files');
        console.log('');
        console.log('Option 2: Use the npm script (recommended)');
        console.log('  1. Ensure VS Code is open with the extension');
        console.log('  2. Run: npm run test:index-advisor');
        console.log('');
        console.log('The script will create a VS Code command to execute the tests.');
        console.log('Please see the README.md for detailed instructions.');
        console.log('');

        // Generate output path
        const outputPath = args.output || generateOutputPath();
        console.log(`Results will be saved to: ${outputPath}`);
        console.log('');

        // Create placeholder results file
        const placeholderResults: TestResult[] = testCases.map((tc) => ({
            collectionName: tc.collectionName,
            query: tc.query,
            expectedResult: tc.expectedResult,
            notes: tc.notes,
            errors: 'Test not executed - please run via VS Code extension',
        }));

        saveResults(placeholderResults, outputPath);

        console.log('✓ Placeholder results file created.');
        console.log('  To execute tests, use the VS Code command or npm script as described above.');

    } catch (error) {
        console.error('');
        console.error('Error running tests:');
        console.error(error instanceof Error ? error.message : String(error));
        console.error('');
        process.exit(1);
    }
}

// Run the main function
main().catch((error) => {
    console.error('Unexpected error:', error);
    process.exit(1);
});
