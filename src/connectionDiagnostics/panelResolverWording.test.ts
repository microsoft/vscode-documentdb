/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { builtInFindingCodes, type CheckResult } from '@documentdb-js/connection-diagnostics';
import { readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { formatEvidence } from '../webviews/documentdb/connectionDiagnostics/formatEvidence';
import { describeFinding, describeFindingForReport } from './findingMessages';
import { withRowDetails } from './panelDetails';
import { checkResult, finding, fixtureRun, host, outputs, representativeData } from './test/fixtures';
import { extensionFindingCodes, type FindingCode } from './types';

vi.mock('@vscode/l10n', () => ({
    t: (message: string, ...args: unknown[]): string =>
        args.reduce<string>((result, value, index): string => result.replace(`{${index}}`, String(value)), message),
}));

/**
 * Decision 0041: the panel never names the DNS libraries Node.js uses. Which library failed is a
 * support detail; the user needs to know whether two lookups disagreed or the extension worked
 * around a known issue. The report may name them.
 */
const libraryNames = /c[-_]?ares|getaddrinfo/i;

const codes = [...builtInFindingCodes, ...extensionFindingCodes];

/** The DNS findings, with every data shape that changes their wording. */
const dnsVariants: readonly [FindingCode, Readonly<Record<string, unknown>>][] = [
    ['env.caresRejectsCompressedSrv', { aresVersion: '1.34.6' }],
    ['srv.compressedReplyRejected', { nodeErrorCode: 'EBADRESP', fallbackOutcome: 'succeeded' }],
    ['srv.compressedReplyRejected', { nodeErrorCode: 'EBADRESP', fallbackOutcome: 'failed' }],
    ['srv.compressedReplyRejected', { nodeErrorCode: 'EBADRESP', fallbackOutcome: 'disabled' }],
    ['dns.resolversDisagree', { osAddressCount: 2, caresAddressCount: 1 }],
    ['dns.resolversDisagree', { osAddressCount: 2, caresAddressCount: 0, caresErrorCode: 'ENOTFOUND' }],
];

const panelSources = [
    'src/connectionDiagnostics/panelDetails.ts',
    'src/connectionDiagnostics/panelRows.ts',
    ...readdirSync('src/webviews/documentdb/connectionDiagnostics')
        .filter((file): boolean => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
        .map((file): string => path.join('src/webviews/documentdb/connectionDiagnostics', file)),
];

/** Every string literal passed to `l10n.t` or `vscode.l10n.t` in a file. */
function localizedStrings(file: string): string[] {
    const source = readFileSync(file, 'utf8');
    return [...source.matchAll(/l10n\.t\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)].map((match): string => match[2]);
}

function dnsRun(dns: Partial<CheckResult<FindingCode>>): CheckResult<FindingCode>[] {
    return [
        checkResult('environment', {
            facts: { platform: 'linux', arch: 'x64' },
            findings: [finding('env.caresRejectsCompressedSrv', { aresVersion: '1.34.6' })],
        }),
        checkResult('connectionString', { facts: { scheme: 'mongodb+srv', options: [] } }),
        checkResult('srv', {
            status: 'warning',
            facts: { srvQueryName: `_mongodb._tcp.${host}`, records: [], resolutionPath: 'fallback' },
            findings: [finding('srv.compressedReplyRejected', { fallbackOutcome: 'succeeded' })],
        }),
        checkResult('dns', { target: `${host}:10260`, ...dns }),
        checkResult('authenticate', { facts: { authenticated: true } }),
    ];
}

describe('panel text never names DNS libraries (decision 0041)', () => {
    it.each(codes)('describes %s for the panel without library names', (code): void => {
        const message = describeFinding(finding(code, representativeData[code]));
        expect(Object.values(message).join(' ')).not.toMatch(libraryNames);
    });

    it.each(dnsVariants)('describes %s with %j for the panel without library names', (code, data): void => {
        const message = describeFinding(finding(code, data));
        expect(Object.values(message).join(' ')).not.toMatch(libraryNames);
    });

    it.each(dnsVariants)(
        'keeps the technical cause of %s with %j in the report, under the panel title',
        (code, data): void => {
            const report = describeFindingForReport(finding(code, data));
            expect(report.title).toBe(describeFinding(finding(code, data)).title);
            expect(report.explanation).toMatch(/c-ares \(Node\.js's DNS resolver/);
        },
    );

    it('finds the localized strings it scans', (): void => {
        expect(
            localizedStrings('src/webviews/documentdb/connectionDiagnostics/DiagnosticsRowDetails.tsx'),
        ).toEqual(expect.arrayContaining(["Your system's lookup", 'Direct DNS query']));
    });

    it.each(panelSources)('has no library name in any localized string in %s', (file): void => {
        for (const text of localizedStrings(file)) {
            expect(text).not.toMatch(libraryNames);
        }
    });

    it.each([
        ['agree', { osAddresses: [{ address: '203.0.113.4', family: 4 }], caresAddresses: [] }],
        [
            'disagree',
            {
                osAddresses: [{ address: '10.0.0.4', family: 4 }],
                caresAddresses: [{ address: '203.0.113.4', family: 4 }],
            },
        ],
        ['fail', { osAddresses: [], caresAddresses: [], osErrorCode: 'ENOTFOUND', caresErrorCode: 'ENOTFOUND' }],
    ])('sends row lines, details and the card without library names when lookups %s', (_name, facts): void => {
        const results = dnsRun({
            facts,
            status: 'warning',
            findings: [finding('dns.resolversDisagree', { osAddressCount: 1, caresAddressCount: 1 })],
        });
        const view = outputs(fixtureRun(results));
        const rows = withRowDetails(view.projector.rows(), results, describeFinding);
        for (const row of rows) {
            expect(formatEvidence(row.segments) ?? '').not.toMatch(libraryNames);
        }
        // Field names too: the panel's types speak of the system lookup and a direct DNS query.
        expect(JSON.stringify(rows)).not.toMatch(libraryNames);
        expect(JSON.stringify(view.result)).not.toMatch(libraryNames);
        expect(view.markdown.replace(/\\/g, '')).toContain("c-ares (Node.js's DNS resolver)");
    });
});
