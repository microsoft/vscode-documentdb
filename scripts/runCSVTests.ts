#!/usr/bin/env node

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * CLI tool for running CSV batch tests for Index Advisor
 *
 * Usage:
 *   npm run csv-test -- --config ./test/csvTests/config.json --input ./test/csvTests/testCases.csv --output ./test/csvTests/results.csv
 */

import { runCSVBatchTests } from '../src/commands/llmEnhancedCommands/csvTestingFramework';

// Parse command line arguments
const args = process.argv.slice(2);
const getArgValue = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    return index !== -1 && index + 1 < args.length ? args[index + 1] : undefined;
};

const configPath = getArgValue('--config');
const inputPath = getArgValue('--input');
const outputPath = getArgValue('--output');

if (!configPath || !inputPath || !outputPath) {
    console.error('Usage: npm run csv-test -- --config <config.json> --input <testCases.csv> --output <results.csv>');
    console.error('\nExample:');
    console.error(
        '  npm run csv-test -- --config ./test/csvTests/config.json --input ./test/csvTests/testCases.csv --output ./test/csvTests/results.csv',
    );
    process.exit(1);
}

// Create a minimal action context for testing
const context = {
    telemetry: {
        properties: {},
        measurements: {},
    },
    errorHandling: {
        rethrow: true,
        suppressDisplay: false,
    },
    ui: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        showWarningMessage: async (message: string) => console.warn(message),
    },
    valuesToMask: [],
};

// Run the tests
runCSVBatchTests(context as unknown as any, configPath!, inputPath!, outputPath!)
    .then(() => {
        console.log('\n✓ CSV batch tests completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n✗ CSV batch tests failed:', error);
        process.exit(1);
    });
