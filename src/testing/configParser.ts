/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Configuration parser for AI-enhanced feature testing
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Test configuration containing shared information across all test cases
 */
export interface TestConfig {
    // Connection configuration
    connection: {
        // Cluster ID or connection string
        clusterId: string;
        // Target database name
        databaseName: string;
    };

    // AI model configuration
    model?: {
        // Preferred model to use
        preferredModel?: string;
        // Prompt file path (optional)
        promptFilePath?: string;
    };

    // Output configuration
    output?: {
        // Output directory for results
        outputDir?: string;
        // Output file name prefix
        filePrefix?: string;
    };
}

/**
 * Individual test case from CSV
 */
export interface TestCase {
    // Test case ID/name
    id: string;
    // Collection name
    collectionName: string;
    // Query to test
    query: string;
    // Expected result (optional)
    expectedResult?: string;
    // Additional notes
    notes?: string;
}

/**
 * Parse JSON configuration file
 * @param configPath Path to the configuration file
 * @returns Parsed configuration
 */
export function parseConfig(configPath: string): TestConfig {
    try {
        const absolutePath = path.resolve(configPath);
        const configData = fs.readFileSync(absolutePath, 'utf-8');
        const config = JSON.parse(configData) as TestConfig;

        // Validate required fields
        if (!config.connection?.clusterId) {
            throw new Error('Configuration must include connection.clusterId');
        }
        if (!config.connection?.databaseName) {
            throw new Error('Configuration must include connection.databaseName');
        }

        return config;
    } catch (error) {
        throw new Error(
            `Failed to parse configuration file: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}

/**
 * Parse CSV test cases file
 * @param csvPath Path to the CSV file
 * @returns Array of test cases
 */
export function parseTestCases(csvPath: string): Array<TestCase> {
    try {
        const absolutePath = path.resolve(csvPath);
        const csvData = fs.readFileSync(absolutePath, 'utf-8');
        const lines = csvData.split('\n').filter((line) => line.trim().length > 0);

        if (lines.length < 2) {
            throw new Error('CSV file must contain at least a header row and one test case');
        }

        // Parse header to get column indices
        const header = parseCSVLine(lines[0]);
        const idIndex = header.findIndex((h) => h.toLowerCase() === 'id' || h.toLowerCase() === 'test_id');
        const collectionIndex = header.findIndex(
            (h) => h.toLowerCase() === 'collection' || h.toLowerCase() === 'collection_name',
        );
        const queryIndex = header.findIndex((h) => h.toLowerCase() === 'query');
        const expectedIndex = header.findIndex(
            (h) => h.toLowerCase() === 'expected' || h.toLowerCase() === 'expected_result',
        );
        const notesIndex = header.findIndex((h) => h.toLowerCase() === 'notes');

        if (collectionIndex === -1 || queryIndex === -1) {
            throw new Error('CSV must contain "collection" and "query" columns');
        }

        // Parse test cases
        const testCases: Array<TestCase> = [];
        for (let i = 1; i < lines.length; i++) {
            const row = parseCSVLine(lines[i]);
            if (row.length === 0) {
                continue;
            }

            const testCase: TestCase = {
                id: idIndex >= 0 && row[idIndex] ? row[idIndex] : `test_${i}`,
                collectionName: row[collectionIndex] || '',
                query: row[queryIndex] || '',
                expectedResult: expectedIndex >= 0 ? row[expectedIndex] : undefined,
                notes: notesIndex >= 0 ? row[notesIndex] : undefined,
            };

            if (!testCase.collectionName || !testCase.query) {
                console.warn(`Skipping invalid test case at line ${i + 1}`);
                continue;
            }

            testCases.push(testCase);
        }

        return testCases;
    } catch (error) {
        throw new Error(`Failed to parse test cases file: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Parse a single CSV line handling quoted values
 * @param line CSV line to parse
 * @returns Array of values
 */
function parseCSVLine(line: string): Array<string> {
    const result: Array<string> = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                // Escaped quote
                current += '"';
                i++;
            } else {
                // Toggle quote state
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            // End of field
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }

    // Add last field
    result.push(current.trim());

    return result;
}

/**
 * Create a sample configuration file
 * @param outputPath Path where to create the sample file
 */
export function createSampleConfig(outputPath: string): void {
    const sampleConfig: TestConfig = {
        connection: {
            clusterId: 'your-cluster-id',
            databaseName: 'your-database-name',
        },
        model: {
            preferredModel: 'gpt-4',
            promptFilePath: './prompts/index-advisor.txt',
        },
        output: {
            outputDir: './test-results',
            filePrefix: 'test-run',
        },
    };

    fs.writeFileSync(outputPath, JSON.stringify(sampleConfig, null, 2), 'utf-8');
}

/**
 * Create a sample test cases CSV file
 * @param outputPath Path where to create the sample file
 */
export function createSampleTestCases(outputPath: string): void {
    const sampleCSV = `id,collection,query,expected_result,notes
test_1,users,"db.users.find({age: {$gt: 25}})","Should recommend index on age field","Basic range query"
test_2,orders,"db.orders.find({status: 'pending'}).sort({createdAt: -1})","Should recommend compound index on status and createdAt","Query with sort"
test_3,products,"db.products.aggregate([{$match: {category: 'electronics'}}, {$group: {_id: '$brand', total: {$sum: 1}}}])","Should recommend index on category field","Aggregation pipeline"
`;

    fs.writeFileSync(outputPath, sampleCSV, 'utf-8');
}
