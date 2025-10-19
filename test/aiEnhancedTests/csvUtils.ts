/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { type TestCase, type TestConfig } from './types';

/**
 * Reads and parses the test configuration from a JSON file
 * @param configPath Path to the configuration file
 * @returns Parsed test configuration
 */
export function readConfig(configPath: string): TestConfig {
    const absolutePath = path.resolve(configPath);
    const content = fs.readFileSync(absolutePath, 'utf-8');
    return JSON.parse(content) as TestConfig;
}

/**
 * Parses a CSV line while handling quoted fields that may contain commas
 * @param line The CSV line to parse
 * @returns Array of field values
 */
function parseCSVLine(line: string): string[] {
    const fields: string[] = [];
    let currentField = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
            // Handle escaped quotes
            if (inQuotes && line[i + 1] === '"') {
                currentField += '"';
                i++; // Skip next quote
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            fields.push(currentField.trim());
            currentField = '';
        } else {
            currentField += char;
        }
    }

    // Add the last field
    fields.push(currentField.trim());

    return fields;
}

/**
 * Reads test cases from a CSV file
 * Expected CSV format: collectionName, query, expectedResult
 * @param csvPath Path to the CSV file
 * @returns Array of test cases
 */
export function readTestCases(csvPath: string): TestCase[] {
    const absolutePath = path.resolve(csvPath);
    const content = fs.readFileSync(absolutePath, 'utf-8');
    const lines = content.split('\n').filter((line) => line.trim().length > 0);

    // Skip header row
    const testCases: TestCase[] = [];
    for (let i = 1; i < lines.length; i++) {
        const fields = parseCSVLine(lines[i]);

        if (fields.length >= 3) {
            testCases.push({
                collectionName: fields[0],
                query: fields[1],
                expectedResult: fields[2],
            });
        }
    }

    return testCases;
}

/**
 * Escapes a field value for CSV output
 * @param value The value to escape
 * @returns Escaped CSV field
 */
function escapeCSVField(value: string | number | undefined): string {
    if (value === undefined || value === null) {
        return '';
    }

    const stringValue = String(value);

    // If the value contains comma, newline, or quote, wrap in quotes
    if (stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('"')) {
        // Escape quotes by doubling them
        return `"${stringValue.replace(/"/g, '""')}"`;
    }

    return stringValue;
}

/**
 * Writes test results to a CSV file
 * @param results Array of test results
 * @param outputPath Path to write the CSV file
 */
export function writeResultsCSV(
    results: Array<{
        collectionName: string;
        query: string;
        expectedResult: string;
        collectionStats: string;
        indexStats: string;
        executionPlan: string;
        queryPerformance: number;
        suggestions: string;
        analysis: string;
        updatedPerformance?: number;
        notes: string;
    }>,
    outputPath: string,
): void {
    const absolutePath = path.resolve(outputPath);

    // Create CSV header
    const header = [
        'Collection Name',
        'Query',
        'Expected Result',
        'Collection Stats',
        'Index Stats',
        'Execution Plan',
        'Query Performance (ms)',
        'Suggestions',
        'Analysis',
        'Updated Performance (ms)',
        'Notes',
    ].join(',');

    // Create CSV rows
    const rows = results.map((result) => {
        return [
            escapeCSVField(result.collectionName),
            escapeCSVField(result.query),
            escapeCSVField(result.expectedResult),
            escapeCSVField(result.collectionStats),
            escapeCSVField(result.indexStats),
            escapeCSVField(result.executionPlan),
            escapeCSVField(result.queryPerformance),
            escapeCSVField(result.suggestions),
            escapeCSVField(result.analysis),
            escapeCSVField(result.updatedPerformance),
            escapeCSVField(result.notes),
        ].join(',');
    });

    // Write to file
    const csvContent = [header, ...rows].join('\n');
    fs.writeFileSync(absolutePath, csvContent, 'utf-8');
}
