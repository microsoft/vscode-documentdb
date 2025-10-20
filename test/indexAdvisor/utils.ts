/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { type TestCase, type TestConfig, type TestResult } from './types';

/**
 * Loads test configuration from a JSON file
 * @param configPath Path to the configuration file
 * @returns Test configuration
 */
export function loadConfig(configPath: string): TestConfig {
    const configContent = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(configContent) as TestConfig;

    // Validate required fields
    if (!config.clusterId && !config.connectionString) {
        throw new Error('Either clusterId or connectionString is required in configuration');
    }
    if (!config.databaseName) {
        throw new Error('databaseName is required in configuration');
    }

    return config;
}

/**
 * Loads test cases from a CSV file
 * @param csvPath Path to the CSV file
 * @returns Array of test cases
 */
export function loadTestCases(csvPath: string): TestCase[] {
    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    const lines = csvContent.trim().split('\n');

    if (lines.length < 2) {
        return [];
    }

    // Parse header
    const header = lines[0].split(',').map((h) => h.trim());
    const colNameIdx = header.indexOf('collectionName');
    const queryIdx = header.indexOf('query');
    const expectedIdx = header.indexOf('expectedResult');
    const notesIdx = header.indexOf('notes');

    // Parse rows
    const testCases: TestCase[] = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) {
            continue;
        }

        // Simple CSV parsing (handles quoted fields)
        const values = parseCSVLine(line);

        testCases.push({
            collectionName: values[colNameIdx] || '',
            query: values[queryIdx] || '',
            expectedResult: values[expectedIdx] || '',
            notes: notesIdx >= 0 ? values[notesIdx] : undefined,
        });
    }

    return testCases;
}

/**
 * Simple CSV line parser that handles quoted fields
 * @param line CSV line to parse
 * @returns Array of values
 */
function parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const nextChar = i < line.length - 1 ? line[i + 1] : '';

        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                // Escaped quote
                current += '"';
                i++; // Skip next quote
            } else {
                // Toggle quote mode
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            // Field separator
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
 * Saves test results to a CSV file
 * @param results Array of test results
 * @param outputPath Path to the output CSV file
 */
export function saveResults(results: TestResult[], outputPath: string): void {
    const header = [
        'collectionName',
        'query',
        'expectedResult',
        'collectionStats',
        'indexStats',
        'executionPlan',
        'queryPerformance',
        'suggestions',
        'analysis',
        'updatedPerformance',
        'performanceImprovement',
        'matchesExpected',
        'modelUsed',
        'notes',
        'errors',
        'timestamp',
    ];

    const rows = results.map((result) => [
        escapeCSV(result.collectionName),
        escapeCSV(result.query),
        escapeCSV(result.expectedResult),
        escapeCSV(result.collectionStats || ''),
        escapeCSV(result.indexStats || ''),
        escapeCSV(result.executionPlan || ''),
        result.queryPerformance?.toString() || '',
        escapeCSV(result.suggestions || ''),
        escapeCSV(result.analysis || ''),
        result.updatedPerformance?.toString() || '',
        result.performanceImprovement?.toFixed(2) || '',
        result.matchesExpected?.toString() || '',
        result.modelUsed || '',
        escapeCSV(result.notes || ''),
        escapeCSV(result.errors || ''),
        result.timestamp || '',
    ]);

    const csvContent = [header.join(','), ...rows.map((row) => row.join(','))].join('\n');

    // Ensure directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputPath, csvContent, 'utf-8');
}

/**
 * Escapes a CSV field value
 * @param value Value to escape
 * @returns Escaped value
 */
function escapeCSV(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
}

/**
 * Generates a timestamped output filename
 * @param basePath Base path for the output file
 * @returns Full path with timestamp
 */
export function generateOutputPath(basePath?: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const defaultPath = path.join(process.cwd(), `test-results-${timestamp}.csv`);
    return basePath || defaultPath;
}

/**
 * Loads custom prompt template if specified
 * @param promptPath Path to the prompt template file
 * @returns Prompt template content or undefined
 */
export function loadCustomPrompt(promptPath?: string): string | undefined {
    if (!promptPath) {
        return undefined;
    }

    if (!fs.existsSync(promptPath)) {
        throw new Error(`Prompt template file not found: ${promptPath}`);
    }

    return fs.readFileSync(promptPath, 'utf-8');
}

/**
 * Normalizes a Mongo shell command for comparison
 * Removes whitespace and formatting differences
 * @param command Mongo shell command
 * @returns Normalized command
 */
export function normalizeMongoCommand(command: string): string {
    return command
        .replace(/\s+/g, '') // Remove all whitespace
        .replace(/'/g, '"') // Normalize quotes
        .toLowerCase();
}

/**
 * Compares two Mongo shell commands for equality
 * @param actual Actual command
 * @param expected Expected command
 * @returns True if commands match
 */
export function compareMongoCommands(actual: string, expected: string): boolean {
    const normalizedActual = normalizeMongoCommand(actual);
    const normalizedExpected = normalizeMongoCommand(expected);

    return normalizedActual.includes(normalizedExpected) || normalizedExpected.includes(normalizedActual);
}
