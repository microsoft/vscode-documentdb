/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { builtInFindingCodes, DEFAULT_TIMEOUTS, skipReasons } from './index.js';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

function section(heading: string): string {
    const content = readme.split(`\n## ${heading}\n`)[1];
    expect(content, `Missing README section: ${heading}`).toBeDefined();
    return content?.split('\n## ')[0] ?? '';
}

function firstColumnCodes(content: string): string[] {
    return [...content.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)].map((match): string => match[1] ?? '');
}

describe('package README catalogue', (): void => {
    it('documents every built-in finding code exactly once in catalogue order with no extra codes', (): void => {
        expect(firstColumnCodes(section('Finding codes'))).toEqual([...builtInFindingCodes]);
    });

    it.each(['dns.privateEndpoint', 'dns.privateEndpointPublicAddress'])(
        'documents %s as informational, regardless of table padding',
        (code): void => {
            const row = section('Finding codes')
                .split('\n')
                .find((line): boolean => line.includes(`\`${code}\``));
            expect(row?.split('|')[2]?.trim()).toBe('info');
        },
    );

    it('documents every skip reason exactly once without extra reasons', (): void => {
        expect(firstColumnCodes(section('Skip reasons'))).toEqual([...skipReasons]);
    });

    it('documents each default timeout in the timeouts table', (): void => {
        const table = section('Timeouts and retry profiles')
            .split('\n')
            .filter((line): boolean => line.startsWith('| '));
        for (const [field, value] of Object.entries(DEFAULT_TIMEOUTS)) {
            const rows = table.filter((row): boolean => row.includes(`\`${field}\``));
            expect(rows).toHaveLength(1);
            expect(rows[0]?.split('|')[2]?.trim()).toBe(String(value));
        }
    });
});
