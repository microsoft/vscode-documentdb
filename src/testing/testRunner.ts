#!/usr/bin/env node

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Main test runner script for AI-enhanced features
 * This script can be executed from command line to run tests in batch
 *
 * Usage:
 *   node testRunner.js --config <config-file> --tests <test-cases-csv>
 *   node testRunner.js --generate-samples
 */

import * as path from 'path';
import { createActionContext } from '../utils/testHelpers';
import { createSampleConfig, createSampleTestCases, parseConfig, parseTestCases } from './configParser';
import { formatSummaryReport, writeResultsToFile } from './resultFormatter';
import { executeBatchTests } from './testExecutor';

/**
 * Command line arguments
 */
interface CommandLineArgs {
    config?: string;
    tests?: string;
    output?: string;
    generateSamples?: boolean;
    help?: boolean;
}

/**
 * Parse command line arguments
 */
function parseArgs(): CommandLineArgs {
    const args: CommandLineArgs = {};
    const argv = process.argv.slice(2);

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];

        switch (arg) {
            case '--config':
            case '-c':
                args.config = argv[++i];
                break;
            case '--tests':
            case '-t':
                args.tests = argv[++i];
                break;
            case '--output':
            case '-o':
                args.output = argv[++i];
                break;
            case '--generate-samples':
            case '-g':
                args.generateSamples = true;
                break;
            case '--help':
            case '-h':
                args.help = true;
                break;
        }
    }

    return args;
}

/**
 * Display usage help
 */
function displayHelp(): void {
    console.log(`
AI-Enhanced Feature Test Runner

Usage:
  node testRunner.js [options]

Options:
  --config, -c <file>        Path to configuration JSON file
  --tests, -t <file>         Path to test cases CSV file
  --output, -o <file>        Path to output results CSV file (optional)
  --generate-samples, -g     Generate sample configuration and test files
  --help, -h                 Display this help message

Examples:
  # Run tests with configuration and test cases
  node testRunner.js --config ./config.json --tests ./test-cases.csv

  # Generate sample files
  node testRunner.js --generate-samples

  # Run tests with custom output location
  node testRunner.js -c config.json -t tests.csv -o results/output.csv
`);
}

/**
 * Generate sample files
 */
function generateSamples(): void {
    try {
        createSampleConfig('./sample-config.json');
        createSampleTestCases('./sample-test-cases.csv');

        console.log('Sample files generated successfully:');
        console.log('  - sample-config.json');
        console.log('  - sample-test-cases.csv');
        console.log('\nEdit these files with your test data and run:');
        console.log('  node testRunner.js --config sample-config.json --tests sample-test-cases.csv');
    } catch (error) {
        console.error('Failed to generate sample files:', error);
        process.exit(1);
    }
}

/**
 * Main execution function
 */
async function main(): Promise<void> {
    const args = parseArgs();

    // Display help if requested or no arguments provided
    if (args.help || process.argv.length === 2) {
        displayHelp();
        process.exit(0);
    }

    // Generate samples if requested
    if (args.generateSamples) {
        generateSamples();
        process.exit(0);
    }

    // Validate required arguments
    if (!args.config || !args.tests) {
        console.error('Error: Both --config and --tests arguments are required');
        displayHelp();
        process.exit(1);
    }

    try {
        // Set test environment flag
        process.env.VSCODE_TEST = 'true';

        console.log('Loading configuration...');
        const config = parseConfig(args.config);

        console.log('Loading test cases...');
        const testCases = parseTestCases(args.tests);
        console.log(`Found ${testCases.length} test case(s)`);

        console.log('\nStarting test execution...');
        console.log('='.repeat(60));

        // Create action context for tests
        const context = createActionContext();

        // Execute tests with progress callback
        const results = await executeBatchTests(context, config, testCases, (current, total, testCase) => {
            console.log(`[${current}/${total}] Testing: ${testCase.id} - ${testCase.collectionName}`);
        });

        console.log('='.repeat(60));
        console.log('Test execution completed\n');

        // Determine output path
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
        const defaultOutput = path.join(
            config.output?.outputDir || './test-results',
            `${config.output?.filePrefix || 'test-run'}-${timestamp}.csv`,
        );
        const outputPath = args.output || defaultOutput;

        // Write results to file
        console.log('Writing results...');
        writeResultsToFile(results, outputPath);

        // Display summary
        console.log('\n' + formatSummaryReport(results));

        // Exit with appropriate code
        const failed = results.filter((r) => !r.success).length;
        process.exit(failed > 0 ? 1 : 0);
    } catch (error) {
        console.error('Test execution failed:', error);
        process.exit(1);
    }
}

// Execute main function
main().catch((error) => {
    console.error('Unhandled error:', error);
    process.exit(1);
});
