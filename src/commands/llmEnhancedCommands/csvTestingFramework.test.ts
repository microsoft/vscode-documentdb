/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseCSVTestCases, formatTestResultsAsCSV, type CSVTestResult } from './csvTestingFramework';

describe('CSV Testing Framework', () => {
    describe('parseCSVTestCases', () => {
        it('should parse valid CSV content', () => {
            const csv = `Category | Test Case | Tags | Collection | Positive/Negative | Query | Expected Index Advisor Suggestion | Explanation | Comment
Basic | Test 1 | tag1,tag2 | users | Positive | db.users.find({email: "test"}) | Create index on email | Test explanation | Test comment
Advanced | Test 2 | tag3 | orders | Negative | db.orders.find({_id: 1}) | No index needed | Already has index | Another comment`;

            const testCases = parseCSVTestCases(csv);

            expect(testCases).toHaveLength(2);
            expect(testCases[0].category).toBe('Basic');
            expect(testCases[0].testCase).toBe('Test 1');
            expect(testCases[0].tags).toBe('tag1,tag2');
            expect(testCases[0].collection).toBe('users');
            expect(testCases[0].positiveNegative).toBe('Positive');
            expect(testCases[0].query).toBe('db.users.find({email: "test"})');
            expect(testCases[0].expectedSuggestion).toBe('Create index on email');
            expect(testCases[0].explanation).toBe('Test explanation');
            expect(testCases[0].comment).toBe('Test comment');

            expect(testCases[1].category).toBe('Advanced');
            expect(testCases[1].testCase).toBe('Test 2');
        });

        it('should handle empty CSV', () => {
            const csv = `Category | Test Case | Tags | Collection | Positive/Negative | Query | Expected Index Advisor Suggestion | Explanation | Comment`;

            const testCases = parseCSVTestCases(csv);

            expect(testCases).toHaveLength(0);
        });

        it('should skip malformed lines', () => {
            const csv = `Category | Test Case | Tags | Collection | Positive/Negative | Query | Expected Index Advisor Suggestion | Explanation | Comment
Basic | Test 1 | tag1 | users
Valid | Test 2 | tag2 | orders | Positive | db.orders.find({}) | No suggestion | Explanation | Comment`;

            const testCases = parseCSVTestCases(csv);

            expect(testCases).toHaveLength(1);
            expect(testCases[0].testCase).toBe('Test 2');
        });
    });

    describe('formatTestResultsAsCSV', () => {
        it('should format test results correctly', () => {
            const results: CSVTestResult[] = [
                {
                    category: 'Basic',
                    testCase: 'Test 1',
                    tags: 'tag1',
                    collection: 'users',
                    positiveNegative: 'Positive',
                    query: 'db.users.find({email: "test"})' ,
                    expectedSuggestion: 'Create index',
                    explanation: 'Explanation',
                    comment: 'Comment',
                    executionPlan: '{"plan": "details"}',
                    actualSuggestion: 'Create index on email',
                    testPassed: true,
                },
            ];

            const csv = formatTestResultsAsCSV(results);

            expect(csv).toContain('Category | Test Case');
            expect(csv).toContain('Execution Plan | Actual Suggestion | Test Passed');
            expect(csv).toContain('Basic | Test 1');
            expect(csv).toContain('PASS');
        });

        it('should escape pipe characters in fields', () => {
            const results: CSVTestResult[] = [
                {
                    category: 'Basic',
                    testCase: 'Test 1',
                    tags: 'tag1',
                    collection: 'users',
                    positiveNegative: 'Positive',
                    query: 'db.users.find({})',
                    expectedSuggestion: 'Create index',
                    explanation: 'Explanation',
                    comment: 'Comment',
                    executionPlan: '{"plan": "stage1 | stage2"}',
                    actualSuggestion: 'Index on field1 | field2',
                    testPassed: false,
                    error: 'Error | occurred',
                },
            ];

            const csv = formatTestResultsAsCSV(results);

            // Pipe characters should be escaped
            expect(csv).toContain('stage1 \\| stage2');
            expect(csv).toContain('field1 \\| field2');
            expect(csv).toContain('FAIL');
        });

        it('should handle newlines in fields', () => {
            const results: CSVTestResult[] = [
                {
                    category: 'Basic',
                    testCase: 'Test 1',
                    tags: 'tag1',
                    collection: 'users',
                    positiveNegative: 'Positive',
                    query: 'db.users.find({})',
                    expectedSuggestion: 'Create index',
                    explanation: 'Explanation',
                    comment: 'Comment',
                    executionPlan: 'Line 1\nLine 2\nLine 3',
                    actualSuggestion: 'Suggestion\nWith newlines',
                    testPassed: true,
                },
            ];

            const csv = formatTestResultsAsCSV(results);

            // Newlines should be replaced with spaces
            expect(csv).toContain('Line 1 Line 2 Line 3');
            expect(csv).toContain('Suggestion With newlines');
        });
    });
});
