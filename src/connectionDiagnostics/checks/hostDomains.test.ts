/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    buildReport,
    createDnsCheck,
    DEFAULT_TIMEOUTS,
    renderMarkdown,
    runDiagnostics,
    type Check,
    type CheckOutcome,
    type CheckResult,
    type ProbeTarget,
    type RunContext,
} from '@documentdb-js/connection-diagnostics';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import { describeFinding } from '../findingMessages';
import { diagnosticsIdentifierKeys } from '../identifierKeys';
import { type DiagnosticsSetup } from '../input';
import { buildRowDetails } from '../panelDetails';
import { createExtensionReportText } from '../reportText';
import { offlineIo } from '../test/fixtures';
import { type FindingCode } from '../types';
import { findMixedHostDomains, withMixedHostDomainsWarning } from './hostDomains';

vi.mock('../../extensionVariables', () => ({
    ext: { context: { extensionMode: 1, extension: { packageJSON: { version: '1.2.3' } } } },
}));

const gov = 'a.mongocluster.cosmos.azure.us';
const pub = 'b.mongocluster.cosmos.azure.com';
const china = 'c.mongocluster.cosmos.azure.cn';
const privateName = 'b.documentdb.private.example';

function setup(chosenAuthMethod: AuthMethodId | undefined): () => DiagnosticsSetup {
    return (): DiagnosticsSetup => ({ chosenAuthMethod }) as DiagnosticsSetup;
}

function target(host: string, port = 10260): ProbeTarget {
    return { host, port, source: 'uri' };
}

const passingDns: Check<RunContext, FindingCode> = {
    id: 'dns',
    scope: 'host',
    run: async (): Promise<CheckOutcome<FindingCode>> => ({ status: 'pass', facts: {}, findings: [] }),
};

/** Runs the wrapped check once per target, the way the host phase does. */
async function runPerTarget(
    check: Check<RunContext, FindingCode>,
    connectionString: string,
    targets: readonly ProbeTarget[],
): Promise<CheckOutcome<FindingCode>[]> {
    return Promise.all(
        targets.map(
            (probe): Promise<CheckOutcome<FindingCode>> =>
                check.run(
                    { input: { connectionString }, targets, target: probe } as unknown as RunContext,
                    new AbortController().signal,
                ),
        ),
    );
}

describe('findMixedHostDomains', (): void => {
    it('warns when the hosts span different built-in clouds', (): void => {
        expect(findMixedHostDomains([`${pub}:10260`, `${gov}:10260`, china], undefined)).toMatchObject({
            code: 'dns.mixedHostDomains',
            severity: 'warning',
            data: {
                kind: 'crossCloud',
                clouds: ['AzureChinaCloud', 'AzureCloud', 'AzureUSGovernment'],
                builtInHostCount: 3,
                customHostCount: 0,
                otherHostCount: 0,
                customSuffixConfigured: false,
            },
        });
    });

    it('reports cross-cloud first when unrecognized hosts are mixed in too', (): void => {
        expect(findMixedHostDomains([pub, gov, privateName], undefined)?.data).toMatchObject({
            kind: 'crossCloud',
            otherHostCount: 1,
        });
    });

    it('warns when one built-in cloud is mixed with unrecognized names, in either order', (): void => {
        for (const hosts of [
            [gov, privateName],
            [privateName, gov],
        ]) {
            expect(findMixedHostDomains(hosts, undefined)?.data).toEqual({
                kind: 'unrecognizedHosts',
                clouds: ['AzureUSGovernment'],
                builtInHostCount: 1,
                customHostCount: 0,
                otherHostCount: 1,
                customSuffixConfigured: false,
            });
        }
    });

    it('does not warn for a single cloud, all-unrecognized hosts or no hosts', (): void => {
        expect(findMixedHostDomains([gov, `${gov}:10260`, 'd.mongocluster.cosmos.azure.us'], undefined)).toBe(
            undefined,
        );
        expect(findMixedHostDomains([privateName, '10.0.0.4', '[fd00::1]:10260'], undefined)).toBe(undefined);
        expect(findMixedHostDomains([], undefined)).toBe(undefined);
    });

    it('treats a host under the trusted custom suffix as recognized', (): void => {
        expect(findMixedHostDomains([gov, privateName], '.private.example')).toBe(undefined);
        expect(findMixedHostDomains([gov, privateName, 'other.example'], '.private.example')?.data).toMatchObject({
            kind: 'unrecognizedHosts',
            customHostCount: 1,
            otherHostCount: 1,
            customSuffixConfigured: true,
        });
    });

    it('ignores a custom suffix the shared validation rejects', (): void => {
        expect(findMixedHostDomains([gov, 'db.example.co.uk'], 'co.uk')?.data).toMatchObject({
            customHostCount: 0,
            otherHostCount: 1,
            customSuffixConfigured: false,
        });
    });

    it('counts IPv4 and bracketed or bare IPv6 hosts as unrecognized, even under a custom suffix', (): void => {
        expect(
            findMixedHostDomains([gov, '10.0.0.4:10260', '[fd00::1]:10260', 'fd00::2'], 'private.example')?.data,
        ).toMatchObject({ kind: 'unrecognizedHosts', builtInHostCount: 1, customHostCount: 0, otherHostCount: 3 });
    });

    it('keeps host names out of the finding data and detail', (): void => {
        const hosts = [gov, pub, privateName, '10.0.0.4', '[fd00::1]:10260'];
        const serialized = JSON.stringify(findMixedHostDomains(hosts, 'private.example'));
        for (const host of [...hosts, 'fd00::1', 'mongocluster', 'private.example']) {
            expect(serialized).not.toContain(host);
        }
    });
});

describe('withMixedHostDomainsWarning', (): void => {
    const mixed = `mongodb://${gov}:10260,${privateName}:10260/`;
    const targets = [target(gov), target(privateName)];

    it('adds one warning, on the first resolved host, for Microsoft Entra ID and managed identity', async (): Promise<void> => {
        for (const method of [AuthMethodId.MicrosoftEntraID, AuthMethodId.ManagedIdentity]) {
            const outcomes = await runPerTarget(
                withMixedHostDomainsWarning(passingDns, setup(method), () => undefined),
                mixed,
                targets,
            );
            expect(outcomes.map((outcome): string => outcome.status)).toEqual(['warning', 'pass']);
            expect(outcomes[0].findings.map((finding): string => finding.code)).toEqual(['dns.mixedHostDomains']);
            expect(outcomes[1].findings).toEqual([]);
        }
    });

    it('does not warn for native authentication, No authentication or an unresolved setup', async (): Promise<void> => {
        for (const method of [AuthMethodId.NativeAuth, AuthMethodId.NoAuth, undefined]) {
            const outcomes = await runPerTarget(
                withMixedHostDomainsWarning(passingDns, setup(method), () => undefined),
                mixed,
                targets,
            );
            expect(
                outcomes.every((outcome): boolean => outcome.status === 'pass' && outcome.findings.length === 0),
            ).toBe(true);
        }
        const unresolved = withMixedHostDomainsWarning(
            passingDns,
            () => undefined,
            () => undefined,
        );
        expect((await runPerTarget(unresolved, mixed, targets))[0].status).toBe('pass');
    });

    it('reads the trusted custom suffix through its getter', async (): Promise<void> => {
        const outcomes = await runPerTarget(
            withMixedHostDomainsWarning(passingDns, setup(AuthMethodId.MicrosoftEntraID), () => 'private.example'),
            mixed,
            targets,
        );
        expect(outcomes.map((outcome): string => outcome.status)).toEqual(['pass', 'pass']);
    });

    it('includes the resolved targets of a mongodb+srv:// connection', async (): Promise<void> => {
        const srv = `mongodb+srv://cluster.mongocluster.cosmos.azure.us/`;
        const check = withMixedHostDomainsWarning(passingDns, setup(AuthMethodId.MicrosoftEntraID), () => undefined);
        const unrecognized = await runPerTarget(check, srv, [target(gov), target('fc-1.private.example')]);
        expect(unrecognized[0].findings[0]?.data).toMatchObject({ kind: 'unrecognizedHosts', otherHostCount: 1 });
        const crossCloud = await runPerTarget(check, srv, [target(gov), target(pub)]);
        expect(crossCloud[0].findings[0]?.data).toMatchObject({
            kind: 'crossCloud',
            clouds: ['AzureCloud', 'AzureUSGovernment'],
        });
        const sameCloud = await runPerTarget(check, srv, [target(gov), target('d.mongocluster.cosmos.azure.us')]);
        expect(sameCloud.every((outcome): boolean => outcome.findings.length === 0)).toBe(true);
    });

    it('keeps a failure a failure and does not resurrect a skipped check', async (): Promise<void> => {
        const failing: Check<RunContext, FindingCode> = {
            ...passingDns,
            run: async (): Promise<CheckOutcome<FindingCode>> => ({
                status: 'fail',
                facts: {},
                findings: [{ code: 'dns.notFound', severity: 'error', detail: { language: 'en', text: '' } }],
            }),
        };
        const [failed] = await runPerTarget(
            withMixedHostDomainsWarning(failing, setup(AuthMethodId.MicrosoftEntraID), () => undefined),
            mixed,
            targets,
        );
        expect(failed.status).toBe('fail');
        expect(failed.findings.map((finding): string => finding.code)).toEqual([
            'dns.notFound',
            'dns.mixedHostDomains',
        ]);

        const skipping: Check<RunContext, FindingCode> = {
            ...passingDns,
            run: async (): Promise<CheckOutcome<FindingCode>> => ({
                status: 'skipped',
                skippedBecause: { reason: 'notApplicable' },
                facts: {},
                findings: [],
            }),
        };
        const [skipped] = await runPerTarget(
            withMixedHostDomainsWarning(skipping, setup(AuthMethodId.MicrosoftEntraID), () => undefined),
            mixed,
            targets,
        );
        expect(skipped).toMatchObject({ status: 'skipped', findings: [] });
    });

    describe('with the package runner and DNS check', (): void => {
        let fixture: ReturnType<typeof offlineIo> | undefined;
        afterEach((): void => {
            fixture?.dispose();
            fixture = undefined;
        });

        it('attaches the warning once, to the first host DNS resolves, skipping IP literals', async (): Promise<void> => {
            fixture = offlineIo();
            const hosts = [target('10.0.0.4'), target(gov), target(privateName), target('fd00::1')];
            const resolvedTargets: Check<RunContext, FindingCode> = {
                id: 'srv',
                scope: 'run',
                run: async (context): Promise<CheckOutcome<FindingCode>> => {
                    context.setTargets(hosts.map((probe): ProbeTarget => ({ ...probe, source: 'srv' })));
                    return { status: 'pass', facts: {}, findings: [] };
                },
            };
            const run = await runDiagnostics<FindingCode>({
                runId: 'host-domains',
                input: { connectionString: 'mongodb+srv://cluster.mongocluster.cosmos.azure.us/' },
                checks: [
                    resolvedTargets,
                    withMixedHostDomainsWarning(
                        createDnsCheck() as Check<RunContext, FindingCode>,
                        setup(AuthMethodId.ManagedIdentity),
                        () => undefined,
                    ),
                ],
                io: fixture.io,
                timeoutProfile: 'default',
            });
            const dns = run.results.filter((result): boolean => result.checkId === 'dns');
            expect(dns.map((result): string => `${result.target}=${result.status}`)).toEqual([
                '10.0.0.4:10260=skipped',
                `${gov}:10260=warning`,
                `${privateName}:10260=pass`,
                '[fd00::1]:10260=skipped',
            ]);
            const warnings = dns.flatMap((result) => result.findings);
            expect(warnings).toHaveLength(1);
            expect(warnings[0].data).toEqual({
                kind: 'unrecognizedHosts',
                clouds: ['AzureUSGovernment'],
                builtInHostCount: 2,
                customHostCount: 0,
                otherHostCount: 3,
                customSuffixConfigured: false,
            });
        });
    });
});

describe('dns.mixedHostDomains in the panel and the report', (): void => {
    const warning = findMixedHostDomains([gov, privateName], undefined);
    if (!warning) {
        throw new Error('Expected the fixture to warn');
    }
    const results: CheckResult<FindingCode>[] = [
        { checkId: 'dns', target: `${gov}:10260`, status: 'warning', durationMs: 1, facts: {}, findings: [warning] },
        { checkId: 'dns', target: `${privateName}:10260`, status: 'pass', durationMs: 1, facts: {}, findings: [] },
    ];

    it('explains the Server address warning without attributing it to one host', (): void => {
        expect(buildRowDetails('serverAddress', 'warning', results, describeFinding)?.findings).toEqual([
            {
                severity: 'warning',
                title: 'Host names outside the Azure domains',
                explanation: expect.stringContaining('Some host names are in Azure US Government'),
                nextStep: expect.stringContaining('documentDB.customEnvironment.hostnameSuffix'),
            },
        ]);
    });

    it('lists the warning in the report under Name resolution, with hosts redacted when asked', (): void => {
        const report = buildReport<FindingCode>(
            {
                runId: 'run',
                startedAt: 0,
                finishedAt: 1,
                durationMs: 1,
                timeoutProfile: 'default',
                timeouts: DEFAULT_TIMEOUTS,
                targets: [target(gov), target(privateName)],
                results,
                coverage: {
                    limited: false,
                    timedOut: [],
                    notStartedCount: 0,
                    omittedTargetCount: 0,
                    retryWouldHelp: false,
                },
            },
            { identifierKeys: diagnosticsIdentifierKeys },
        );
        const markdown = renderMarkdown(report, { text: createExtensionReportText(), redact: true });
        const nameResolution = markdown.slice(markdown.indexOf('## Name resolution'), markdown.indexOf('## Transport'));
        expect(nameResolution).toContain('Warning');
        expect(markdown).toContain('Host names outside the Azure domains');
        for (const name of [gov, privateName, gov.replace(/[.\-]/g, '\\$&')]) {
            expect(markdown).not.toContain(name);
        }
    });
});
