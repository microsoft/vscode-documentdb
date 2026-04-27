/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Unit tests for the parseOperatorReference helper.
 */

import { parseOperatorReference } from './parseOperatorReference';

describe('parseOperatorReference', () => {
    test('parses a minimal dump with one category and one operator', () => {
        const content = `# DocumentDB Operator Reference

## Summary

| Category | Listed | Total |
| --- | --- | --- |
| Test Category | 1 | 1 |

## Test Category

### $testOp

- **Description:** A test operator
- **Doc Link:** https://example.com/test

## Not Listed

- **$excluded** (Test Category) — Not supported
`;
        const result = parseOperatorReference(content);
        expect(result.operators).toHaveLength(1);
        expect(result.operators[0]).toEqual({
            operator: '$testOp',
            category: 'Test Category',
            description: 'A test operator',
            docLink: 'https://example.com/test',
        });
        expect(result.notListed).toHaveLength(1);
        expect(result.notListed[0]).toEqual({
            operator: '$excluded',
            category: 'Test Category',
            reason: 'Not supported',
        });
    });

    test('handles operators with empty description and doc link', () => {
        const content = `## Variables

### $$NOW

### $$ROOT
`;
        const result = parseOperatorReference(content);
        expect(result.operators).toHaveLength(2);
        expect(result.operators[0]).toEqual({
            operator: '$$NOW',
            category: 'Variables',
            description: '',
            docLink: '',
        });
        expect(result.operators[1]).toEqual({
            operator: '$$ROOT',
            category: 'Variables',
            description: '',
            docLink: '',
        });
    });

    test('handles operators with syntax blocks (ignores syntax)', () => {
        const content = `## Comparison Query Operators

### $eq

- **Description:** Matches values equal to a specified value
- **Syntax:**

\`\`\`javascript
{ field: { $eq: value } }
\`\`\`

- **Doc Link:** https://example.com/$eq

### $gt

- **Description:** Matches values greater than a specified value
- **Doc Link:** https://example.com/$gt
`;
        const result = parseOperatorReference(content);
        expect(result.operators).toHaveLength(2);
        expect(result.operators[0].operator).toBe('$eq');
        expect(result.operators[0].description).toBe('Matches values equal to a specified value');
        expect(result.operators[1].operator).toBe('$gt');
    });

    test('skips operators in the Summary section', () => {
        const content = `## Summary

| Category | Listed | Total |
| --- | --- | --- |
| Test | 2 | 3 |

## Test Category

### $realOp

- **Description:** I am real
`;
        const result = parseOperatorReference(content);
        expect(result.operators).toHaveLength(1);
        expect(result.operators[0].operator).toBe('$realOp');
    });

    test('multiple not-listed entries are parsed correctly', () => {
        const content = `## Not Listed

Operators below are not in scope.

- **$where** (Evaluation Query) — Deprecated in Mongo version 8.0
- **$meta** (Projection) — Not in scope
- **$accumulator** (Custom Aggregation) — Deprecated in Mongo version 8.0
`;
        const result = parseOperatorReference(content);
        expect(result.notListed).toHaveLength(3);
        expect(result.notListed[0].operator).toBe('$where');
        expect(result.notListed[0].reason).toBe('Deprecated in Mongo version 8.0');
        expect(result.notListed[1].operator).toBe('$meta');
        expect(result.notListed[2].operator).toBe('$accumulator');
    });

    test('handles multiple categories', () => {
        const content = `## Cat A

### $a1

- **Description:** Operator a1

### $a2

- **Description:** Operator a2

## Cat B

### $b1

- **Description:** Operator b1
`;
        const result = parseOperatorReference(content);
        expect(result.operators).toHaveLength(3);
        expect(result.operators[0].category).toBe('Cat A');
        expect(result.operators[1].category).toBe('Cat A');
        expect(result.operators[2].category).toBe('Cat B');
    });
});
