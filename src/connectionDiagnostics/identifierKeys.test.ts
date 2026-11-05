/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { buildReport, renderJson, type TroubleshooterRun } from '@documentdb-js/connection-diagnostics';
import { describe, expect, it } from 'vitest';
import { troubleshooterIdentifierKeys } from './identifierKeys';

function runWith(facts: readonly Readonly<Record<string, unknown>>[]): TroubleshooterRun<string> {
    return {
        runId: 'run-1',
        startedAt: 0,
        finishedAt: 10,
        durationMs: 10,
        timeoutProfile: 'default',
        timeouts: {
            runTimeoutMs: 300_000,
            preparationTimeoutMs: 15_000,
            srvTimeoutMs: 10_000,
            probeTimeoutMs: 10_000,
            authenticationTimeoutMs: 45_000,
            postConnectTimeoutMs: 5_000,
        },
        targets: [],
        results: facts.map((fact, index) => ({
            checkId: index === 0 ? 'connectionAccess' : index === 1 ? 'serverFacts' : 'authenticate',
            status: 'pass',
            durationMs: 1,
            findings: [],
            facts: fact,
        })),
        coverage: { limited: false, timedOut: [], notStartedCount: 0, omittedTargetCount: 0, retryWouldHelp: false },
    };
}

describe('troubleshooterIdentifierKeys', () => {
    it('redacts custom roles, their databases, the answering server, seed hosts and Entra identities', (): void => {
        const run = runWith([
            { roles: [{ role: 'billingAnalyst', db: 'contosoProd' }], databaseCount: 3 },
            { seedHosts: ['seedhost.example:27017'], answeredBy: 'member2.example:27017', serverVersion: '7.0.12' },
            { account: 'alice@contoso.com', tenantId: '72f988bf-0000-0000-0000-000000000000' },
        ]);
        const report = buildReport(run, {
            connectionName: 'Prod cluster',
            identifierKeys: troubleshooterIdentifierKeys,
        });

        const redacted = renderJson(report, { redact: true });
        for (const value of [
            'billingAnalyst',
            'contosoProd',
            'seedhost.example',
            'member2.example',
            'alice@contoso.com',
            '72f988bf-0000-0000-0000-000000000000',
            'Prod cluster',
        ]) {
            expect(redacted).not.toContain(value);
        }
        expect(redacted).toContain('7.0.12');
        expect(redacted).toContain('"databaseCount": 3');

        const visible = renderJson(report, { redact: false });
        expect(visible).toContain('billingAnalyst');
        expect(visible).toContain('member2.example');
    });
});
