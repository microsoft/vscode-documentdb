/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    formatTarget,
    type Check,
    type CheckOutcome,
    type CheckResult,
    type RunContext,
} from '@documentdb-js/connection-diagnostics';
import * as vscode from 'vscode';
import { DocumentDBConnectionString } from '../../documentdb/utils/DocumentDBConnectionString';
import {
    ErrorExplanationService,
    type ExplanationIdentifier,
    type ExplanationIdentifierKind,
} from '../../services/errorExplanationService';
import { type RunOwnedClient } from '../auth/runOwnedClient';
import { type DiagnosticsSetup } from '../input';
import { type FindingCode, type DiagnosticsTarget } from '../types';

function sanitizeExplanation(message: string, context: RunContext, setup: DiagnosticsSetup | undefined): string {
    const credentials = setup?.transientCredentials;
    const connectionStrings = [
        context.input.connectionString,
        setup?.input.connectionString,
        credentials?.connectionString,
        credentials?.connectionStringWithPassword,
    ];
    const passwords: string[] = [];
    if (credentials?.nativeAuthConfig?.connectionPassword) {
        passwords.push(credentials.nativeAuthConfig.connectionPassword);
    }
    for (const uri of connectionStrings) {
        if (!uri) {
            continue;
        }
        try {
            const password = new DocumentDBConnectionString(uri).password;
            if (password) {
                passwords.push(password, decodeURIComponent(password));
            }
        } catch {
            // Malformed input is still removed verbatim below.
        }
    }
    let clean = message;
    for (const uri of [...connectionStrings].sort((a, b): number => (b?.length ?? 0) - (a?.length ?? 0))) {
        if (uri) {
            clean = clean.split(uri).join('[connection string omitted]');
        }
    }
    // Strip userinfo, not the endpoint: identifiers remain useful until the user hides them.
    clean = clean.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/<>"']*@/gi, '$1');
    const secrets = new Set(passwords.flatMap((password): string[] => [password, encodeURIComponent(password)]));
    for (const secret of [...secrets].sort((a, b): number => b.length - a.length)) {
        if (secret) {
            clean = clean.split(secret).join('[secret omitted]');
        }
    }
    // Bound UTF-8 bytes, not UTF-16 code units, without splitting a character.
    let bytes = 0;
    let bounded = '';
    for (const character of clean) {
        bytes += Buffer.byteLength(character, 'utf8');
        if (bytes > 8192) {
            break;
        }
        bounded += character;
    }
    return bounded;
}

/**
 * Identifiers the provider's explanation names, as classified facts, so "Hide identifiers" collects
 * them and replaces them consistently in the explanation and any summary text that repeats it.
 */
function providerIdentifierFacts(identifiers: readonly ExplanationIdentifier[] | undefined): {
    providerIdentifiers?: Partial<Record<ExplanationIdentifierKind, string[]>>;
} {
    const grouped: Partial<Record<ExplanationIdentifierKind, string[]>> = {};
    for (const { kind, value } of identifiers ?? []) {
        if (value.length > 0 && !grouped[kind]?.includes(value)) {
            (grouped[kind] ??= []).push(value);
        }
    }
    return Object.keys(grouped).length > 0 ? { providerIdentifiers: grouped } : {};
}

const networkErrorCodes: ReadonlySet<unknown> = new Set([
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ENETUNREACH',
    'EHOSTUNREACH',
    'ECONNRESET',
    'EPIPE',
]);

function networkErrorFacts(facts: Readonly<Record<string, unknown>>): boolean {
    return (
        networkErrorCodes.has(facts.errorCode) ||
        (facts.errorCode === undefined &&
            (facts.errorName === 'MongoNetworkError' || facts.errorName === 'MongoNetworkTimeoutError'))
    );
}

function networkFailure(result: CheckResult<string>): boolean {
    if (result.status !== 'fail') {
        return false;
    }
    const findings = [...result.findings, ...(result.steps?.flatMap((step) => step.findings) ?? [])];
    return (
        findings.some(
            (finding): boolean =>
                [
                    'tcp.refused',
                    'tcp.timeout',
                    'tcp.unreachable',
                    'tcp.reset',
                    'hello.noReply',
                    'tls.handshakeRejectedByServer',
                    'auth.serverSelectionTimeout',
                ].includes(finding.code) ||
                (finding.code === 'check.timeout' && ['tcp', 'tls', 'hello', 'authenticate'].includes(result.checkId)),
        ) || [result.facts, ...(result.steps?.map((step) => step.facts) ?? [])].some(networkErrorFacts)
    );
}

/** Correlate the alias with the failing host, not another member that happened to resolve publicly. */
function privateAccessHint(context: RunContext, results: readonly CheckResult<string>[]): string | undefined {
    const authentication = results.find((result): boolean => result.checkId === 'authenticate');
    if (authentication?.status === 'pass' || authentication?.status === 'warning') {
        return undefined;
    }
    const relevant = context.targets.some((target): boolean => {
        const dns = context.getResult('dns', target);
        if (!dns?.findings.some((finding): boolean => finding.code === 'dns.privateEndpointPublicAddress')) {
            return false;
        }
        const address = formatTarget(target).toLowerCase();
        return results.some((result): boolean => {
            if (!networkFailure(result)) {
                return false;
            }
            if (result.target !== undefined) {
                return result.target.toLowerCase() === address;
            }
            const facts = [result.facts, ...(result.steps?.map((step) => step.facts) ?? [])];
            const serverErrors = facts.flatMap((fact): unknown[] =>
                Array.isArray(fact.serverErrors) ? fact.serverErrors : [],
            );
            if (serverErrors.length > 0) {
                return serverErrors.some((entry): boolean => {
                    if (typeof entry !== 'object' || entry === null || !('address' in entry)) {
                        return false;
                    }
                    return (
                        typeof entry.address === 'string' &&
                        entry.address.toLowerCase() === address &&
                        networkErrorFacts(entry as Readonly<Record<string, unknown>>)
                    );
                });
            }
            // A run-wide error without per-server evidence cannot be assigned to one of several hosts.
            return context.targets.length === 1;
        });
    });
    return relevant
        ? vscode.l10n.t(
              'This name resolved to a public address. If the cluster allows only private access, connect from its virtual network or a network that resolves the private endpoint (VPN, peering or a private DNS zone).',
          )
        : undefined;
}

export function createContextHintsCheck(
    target: DiagnosticsTarget,
    /** `undefined` when the target could not be resolved. */
    getSetup: () => DiagnosticsSetup | undefined,
    getRunOwnedClient: () => RunOwnedClient,
    earlierChecks: readonly Pick<Check<RunContext, FindingCode>, 'id' | 'scope'>[],
    /** The target read's failure, when resolution failed; providers translate it like a connect error. */
    getResolutionError: () => unknown = (): unknown => undefined,
): Check<RunContext, FindingCode> {
    return {
        id: 'contextHints',
        scope: 'run',
        async run(context, signal): Promise<CheckOutcome<FindingCode>> {
            const earlierResults = earlierChecks.flatMap((check): CheckResult<string>[] => {
                if (check.scope === 'host' && context.targets.length > 0) {
                    return context.targets.flatMap((host): CheckResult<string>[] => {
                        const result = context.getResult(check.id, host);
                        return result ? [result] : [];
                    });
                }
                const result = context.getResult(check.id);
                return result ? [result] : [];
            });
            const firstFailure = earlierResults.find((result): boolean => result.status === 'fail');
            if (!firstFailure) {
                return { status: 'skipped', skippedBecause: { reason: 'notApplicable' }, facts: {}, findings: [] };
            }
            signal.throwIfAborted();
            const providerExplanation = await ErrorExplanationService.explain({
                clusterId: target.clusterId,
                error:
                    getResolutionError() ??
                    getRunOwnedClient().authError ??
                    new Error(firstFailure.findings[0]?.code ?? 'check.failed'),
                source: 'connectionDiagnostics',
            });
            signal.throwIfAborted();
            const explanation = [
                providerExplanation ? sanitizeExplanation(providerExplanation.message, context, getSetup()) : undefined,
                privateAccessHint(context, earlierResults),
            ]
                .filter((message): message is string => message !== undefined)
                .join(' ');
            return {
                status: 'pass',
                findings: [],
                facts: providerExplanation
                    ? {
                          providerId: providerExplanation.providerId,
                          explanation,
                          ...providerIdentifierFacts(providerExplanation.identifiers),
                      }
                    : { providerId: null, ...(explanation ? { explanation } : {}) },
            };
        },
    };
}
