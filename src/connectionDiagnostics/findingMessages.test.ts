/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { builtInFindingCodes, type Finding } from '@documentdb-js/connection-diagnostics';
import { describe, expect, it, vi } from 'vitest';
import { AuthMethodId } from '../documentdb/auth/AuthMethod';
import { describeFinding, findingMessages, hasSpecificTimeoutWording, type FindingMessage } from './findingMessages';
import { extensionFindingCodes, type FindingCode } from './types';

const codes = [...builtInFindingCodes, ...extensionFindingCodes];
const sentinel = 'ENGLISH_DETAIL_MUST_NOT_BE_USED';
const firewall =
    'A firewall or IP allowlist may be blocking this connection. Check access from the computer or remote host where these checks ran, including VPN and network rules.';
const representativeData: Readonly<Record<FindingCode, Readonly<Record<string, unknown>>>> = {
    'check.timeout': { operation: 'tcp', timeoutMs: 10000, source: 'check', target: 'cluster.example:27017' },
    'env.proxyConfigured': { variables: ['HTTPS_PROXY'] },
    'env.caresRejectsCompressedSrv': { aresVersion: '1.34.6' },
    'cs.unparseable': { reason: 'invalidScheme' },
    'cs.srvWithPort': {},
    'cs.srvMultipleHosts': {},
    'cs.unknownOption': { option: 'tlss', suggestion: 'tls' },
    'cs.optionIgnoredByDriver': { option: 'sslvalidate', replacement: 'tlsAllowInvalidCertificates' },
    'cs.conflictingTlsOptions': {},
    'cs.tlsVerificationDisabled': { options: ['tlsInsecure'] },
    'cs.directConnectionWithMultipleHosts': {},
    'cs.unencodedReservedCharacter': { part: 'username', character: '@' },
    'cs.authSourceUnusual': { authSource: 'accounts' },
    'cs.compressorUnavailable': { compressor: 'snappy', available: ['zlib'] },
    'srv.notFound': {},
    'srv.compressedReplyRejected': { nodeErrorCode: 'EBADRESP', fallbackOutcome: 'succeeded' },
    'srv.txtUnsupportedOption': {},
    'srv.targetOutsideDomain': {},
    'dns.notFound': {},
    'dns.temporaryFailure': {},
    'dns.resolversDisagree': { osAddressCount: 2, caresAddressCount: 0, caresErrorCode: 'ENOTFOUND' },
    'dns.privateEndpoint': {},
    'dns.privateEndpointPublicAddress': {},
    'dns.loopback': {},
    'tcp.refused': { errorCode: 'ECONNREFUSED' },
    'tcp.timeout': { errorCode: 'ETIMEDOUT', source: 'connection' },
    'tcp.unreachable': { errorCode: 'EHOSTUNREACH' },
    'tcp.reset': { errorCode: 'ECONNRESET' },
    'tls.notTlsServer': { errorCode: 'ERR_SSL_WRONG_VERSION_NUMBER' },
    'tls.handshakeRejectedByServer': { errorCode: 'ECONNRESET' },
    'tls.selfSigned': { errorCode: 'DEPTH_ZERO_SELF_SIGNED_CERT' },
    'tls.untrustedIssuer': { errorCode: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' },
    'tls.hostnameMismatch': { errorCode: 'ERR_TLS_CERT_ALTNAME_INVALID' },
    'tls.expired': { errorCode: 'CERT_HAS_EXPIRED' },
    'tls.notYetValid': { errorCode: 'CERT_NOT_YET_VALID', localTime: '2026-10-29T12:00:00Z' },
    'tls.verificationBypassed': {},
    'hello.noReply': { waitedMs: 9750 },
    'hello.notWireProtocol': {},
    'hello.closedWithoutReply': { tls: false },
    'hello.inconclusive': { reason: 'commandFailed', code: 59, codeName: 'CommandNotFound' },
    'hello.mechanismNotOffered': { mechanism: 'SCRAM-SHA-256', offered: ['SCRAM-SHA-1'] },
    'hello.compressorUnavailable': { compressor: 'zstd' },
    'hello.clockOffset': { offsetMs: 420000, uncertaintyMs: 10 },
    'env.remoteExtensionHost': { remoteKind: 'ssh' },
    'target.notFound': { source: 'azure', errorName: 'RestError', statusCode: 404 },
    'target.inputCancelled': { input: 'port' },
    'target.sourceInaccessible': { source: 'kubernetes', reason: 'unreachable', errorName: 'Error' },
    'target.endpointMissing': { source: 'kubernetes', reason: 'pending' },
    'cs.credentialsMissing': { missing: 'password', authMethod: 'NativeAuth' },
    'prepare.localPortInUse': { localPort: 27017, holder: 'otherProgram' },
    'prepare.sharedTunnel': { tunnel: 'started' },
    'dns.mixedHostDomains': {
        kind: 'crossCloud',
        clouds: ['AzureCloud', 'AzureUSGovernment'],
        builtInHostCount: 2,
        customHostCount: 0,
        otherHostCount: 0,
        customSuffixConfigured: false,
    },
    'hello.advertisedMembersUnreachable': { unreachableCount: 2 },
    'auth.failed': { authMethod: 'MicrosoftEntraID', serverCode: 18, serverCodeName: 'AuthenticationFailed' },
    'auth.mechanismMismatch': { requested: 'SCRAM-SHA-256', offered: ['SCRAM-SHA-1'] },
    'auth.credentialsUnavailable': { missing: 'entraSession', authMethod: 'MicrosoftEntraID' },
    'auth.serverSelectionTimeout': { timeoutMs: 45000, serverErrorCount: 2 },
    'auth.driverOptionsRejected': { errorName: 'MongoParseError' },
    'auth.connectFailed': { errorName: 'MongoNetworkError', phase: 'connect' },
    'auth.cloudMismatch': { configuredCloud: 'AzureCloud', hostCloud: 'AzureUSGovernment' },
    'auth.tokenResourceUnresolved': { kind: 'customCloudUnresolved' },
    'auth.oidcHostNotAllowed': {},
    'auth.entraTokenFailed': { ruleId: 'conditionalAccess', aadstsCode: '53003' },
    'auth.entraAudienceMismatch': {},
    'auth.entraTenantMismatch': {},
    'access.listDatabasesDenied': { codeName: 'Unauthorized' },
    'access.signInRequired': { command: 'listDatabases' },
    'access.noDatabasesVisible': {},
    'access.readRoleReported': { role: 'read', database: 'sample' },
};

function assertPlainMessage(message: FindingMessage): void {
    expect(message.title.trim()).not.toBe('');
    expect(message.explanation.trim()).not.toBe('');
    for (const text of [message.title, message.explanation, message.nextStep ?? '']) {
        expect(text).not.toMatch(/AADSTS|https?:\/\/|\d+\s*ms\b|undefined|NaN|\[object Object\]/);
        for (const code of codes) {
            expect(text).not.toContain(code);
        }
        expect(text).not.toContain(sentinel);
    }
}

describe('localized finding messages', () => {
    it('covers exactly the built-in and extension finding codes', () => {
        expect(Object.keys(findingMessages).sort()).toEqual([...codes].sort());
    });

    it('points disallowed sign-in hosts to the current hostname suffix setting', (): void => {
        expect(
            describeFinding({
                code: 'auth.oidcHostNotAllowed',
                severity: 'error',
                detail: { language: 'en', text: sentinel },
            }).nextStep,
        ).toBe(
            'Verify the trusted service domain with your cloud administrator and set documentDB.customEnvironment.hostnameSuffix in user settings. Only trust your service domain.',
        );
    });

    it('names the clouds of mixed host names and points to the hostname suffix setting', (): void => {
        expect(
            findingMessages['dns.mixedHostDomains']({
                kind: 'crossCloud',
                clouds: ['AzureCloud', 'AzureUSGovernment'],
            }),
        ).toEqual({
            title: 'Host names in different Azure clouds',
            explanation:
                "The host names belong to different Azure clouds (Azure (public cloud), Azure US Government). One connection can't use more than one cloud.",
            nextStep: 'Check the host names in the connection string.',
        });
        expect(
            findingMessages['dns.mixedHostDomains']({ kind: 'unrecognizedHosts', clouds: ['AzureUSGovernment'] }),
        ).toEqual({
            title: 'Host names outside the Azure domains',
            explanation:
                "Some host names are in Azure US Government, others are outside the built-in Azure domains. Microsoft Entra ID sends tokens only to recognized or trusted hosts, and the cloud check can't use the other names.",
            nextStep:
                'If they are private names for this cluster, set documentDB.customEnvironment.hostnameSuffix to their trusted suffix.',
        });
    });

    it.each(codes)('describes %s with representative, empty, absent and wrong-typed data', (code) => {
        const sample = representativeData[code];
        const wrongTypes = Object.fromEntries(
            Object.keys(sample).map((key): [string, unknown] => [key, { unexpected: true }]),
        );
        for (const data of [sample, {}, undefined, wrongTypes]) {
            assertPlainMessage(
                describeFinding({ code, severity: 'error', data, detail: { language: 'en', text: sentinel } }),
            );
        }
    });

    it.each(codes)('never reads the convenience English detail for %s', (code) => {
        const finding: Finding<FindingCode> = {
            code,
            severity: 'info',
            data: representativeData[code],
            detail: {
                language: 'en',
                get text(): string {
                    return sentinel;
                },
            },
        };
        const detailSpy = vi.spyOn(finding.detail, 'text', 'get');
        const message = describeFinding(finding);
        expect(message).toEqual(
            describeFinding({ ...finding, detail: { language: 'en', text: 'Completely different English' } }),
        );
        expect(detailSpy).not.toHaveBeenCalled();
        assertPlainMessage(message);
    });

    it('describes a public Azure alias without a warning or a standalone next step', (): void => {
        expect(findingMessages['dns.privateEndpointPublicAddress']({})).toEqual({
            title: 'Public address for this Azure host name',
            explanation:
                "The name goes through Azure's private-link alias and resolves to a public address. That is normal outside the cluster's private network.",
        });
        expect(findingMessages['dns.privateEndpoint']({}).title).toBe('Private address for this Azure host name');
    });

    it.each([
        'tcp.refused',
        'tcp.timeout',
        'tcp.unreachable',
        'tcp.reset',
        'hello.noReply',
        'tls.handshakeRejectedByServer',
        'auth.serverSelectionTimeout',
    ] as const)('includes possible-firewall guidance for %s', (code) => {
        expect(findingMessages[code]({}).nextStep).toContain(firewall);
    });

    it.each(['srv', 'dns', 'tls', 'authenticate'])(
        'includes possible-firewall guidance for a timed-out %s check',
        (operation) => {
            const message = findingMessages['check.timeout']({ operation, timeoutMs: 10000 });
            expect(message.nextStep).toContain(firewall);
            expect(message.explanation).toContain('did not finish within the time limit');
            expect(message.explanation).toContain('This alone does not show that the server is unreachable');
        },
    );

    it.each([
        ['connection', 'Increase the timeout configured on this connection, then run the diagnosis again.'],
        [
            'check',
            'Choose Retry with longer timeouts, or Retry without diagnostic timeouts, which may wait until cancelled.',
        ],
        [
            'run',
            'Choose Retry with longer timeouts, or Retry without diagnostic timeouts, which may wait until cancelled.',
        ],
        [
            undefined,
            'Choose Retry with longer timeouts, or Retry without diagnostic timeouts, which may wait until cancelled. If a connection timeout limited this step, change that connection setting first.',
        ],
        [
            'future',
            'Choose Retry with longer timeouts, or Retry without diagnostic timeouts, which may wait until cancelled. If a connection timeout limited this step, change that connection setting first.',
        ],
    ] as const)('uses the next step for timeout source %s', (source, nextStep) => {
        expect(findingMessages['check.timeout']({ operation: 'prepare', source }).nextStep).toBe(nextStep);
        if (source === undefined) {
            expect(findingMessages['check.timeout']({}).nextStep).toBe(nextStep);
        }
        for (const operation of ['srv', 'dns', 'tls', 'authenticate']) {
            expect(findingMessages['check.timeout']({ operation, source }).nextStep).toBe(`${nextStep} ${firewall}`);
        }
        for (const operation of ['tcp', 'hello']) {
            const code = operation === 'tcp' ? 'tcp.timeout' : 'hello.noReply';
            const expected = source === 'connection' || source === 'run'
                ? `${nextStep} ${firewall}`
                : findingMessages[code]({}).nextStep;
            expect(findingMessages['check.timeout']({ operation, source }).nextStep).toBe(expected);
        }
    });

    it.each([
        ['tcp', 'tcp.timeout'],
        ['hello', 'hello.noReply'],
    ] as const)('WI-27: a timed-out %s check keeps the %s title and explanation', (operation, code) => {
        const specific = findingMessages[code]({});
        for (const source of ['connection', 'check', undefined, 'future']) {
            const message = findingMessages['check.timeout']({ operation, timeoutMs: 10000, source });
            expect(message.title).toBe(specific.title);
            expect(message.explanation).toBe(specific.explanation);
            if (source !== 'connection') {
                expect(message.nextStep).toBe(specific.nextStep);
            }
            expect(hasSpecificTimeoutWording({ code: 'check.timeout', data: { operation, source } })).toBe(true);
        }
        // The whole-run limit ended the step, not the probe: generic wording.
        const run = findingMessages['check.timeout']({ operation, timeoutMs: 10000, source: 'run' });
        expect(run.title).toBe('Step timed out');
        expect(run.explanation).toBe(
            findingMessages['check.timeout']({ operation: 'prepare', source: 'run' }).explanation,
        );
        expect(hasSpecificTimeoutWording({ code: 'check.timeout', data: { operation, source: 'run' } })).toBe(false);
    });

    it('WI-27: only tcp and hello timeouts have specific wording', () => {
        for (const operation of ['srv', 'dns', 'tls', 'authenticate', 'connectionAccess', undefined]) {
            expect(hasSpecificTimeoutWording({ code: 'check.timeout', data: { operation } })).toBe(false);
        }
        expect(hasSpecificTimeoutWording({ code: 'tcp.timeout', data: { operation: 'tcp' } })).toBe(false);
    });

    it('WI-27: sign-in required names the Update Credentials command and No authentication', () => {
        expect(findingMessages['access.signInRequired']({ command: 'listDatabases' })).toEqual({
            title: 'Sign-in required to use this connection',
            explanation:
                'The server answered, but it requires sign-in to list or read databases. This connection is set to No authentication.',
            nextStep:
                'Choose an authentication method for this connection (Update Credentials…), then run the diagnosis again.',
        });
    });

    it.each(['prepare', 'credentials', 'connectionString', 'connectionAccess', 'serverFacts', undefined])(
        'does not imply a firewall for a timed-out %s check',
        (operation) => {
            expect(findingMessages['check.timeout']({ operation }).nextStep).not.toContain(firewall);
        },
    );

    it.each(['cs.unparseable', 'tls.expired', 'tls.selfSigned', 'auth.failed'] as const)(
        'does not imply a firewall for %s',
        (code) => {
            expect(findingMessages[code](representativeData[code]).nextStep).not.toContain(firewall);
        },
    );

    it('throws an explicit contract error for unknown codes, including inherited property names', () => {
        for (const code of ['future.unknown', 'toString', '__proto__']) {
            const finding = {
                code,
                severity: 'error',
                detail: { language: 'en', text: sentinel },
            } as Finding<FindingCode>;
            expect(() => describeFinding(finding)).toThrow('Unknown finding code');
        }
    });

    it.each(['cs.compressorUnavailable', 'hello.compressorUnavailable'] as const)(
        'names the compressor and correction for %s',
        (code) => {
            const message = findingMessages[code]({ compressor: 'snappy' });
            expect(message.explanation).toContain('snappy');
            expect(message.nextStep).toContain('remove it from the compressors option, or put zlib first');
            expect(findingMessages[code]({ compressor: 123 }).explanation).not.toContain('123');
        },
    );

    it('names loopback resolution without assuming where the checks run', () => {
        expect(findingMessages['dns.loopback']({}).title).toBe('Host name resolves to localhost');
    });

    it('uses the server-minus-local offset with the correct clock direction', () => {
        expect(findingMessages['hello.clockOffset']({}).explanation).toBe(
            'The clock where these checks ran differs from the server clock. The measurement is an estimate.',
        );
        expect(findingMessages['hello.clockOffset']({ offsetMs: 420000 }).explanation).toBe(
            'The clock where these checks ran is 7 min behind the server. The measurement is an estimate.',
        );
        expect(findingMessages['hello.clockOffset']({ offsetMs: -480000 }).explanation).toBe(
            'The clock where these checks ran is 8 min ahead of the server. The measurement is an estimate.',
        );
        for (const offsetMs of ['420000', null, NaN, Infinity]) {
            const message = findingMessages['hello.clockOffset']({ offsetMs });
            expect(message.explanation).not.toMatch(/ahead|behind/);
            assertPlainMessage(message);
        }
    });

    it('explains unavailable credentials without opening sign-in', () => {
        expect(findingMessages['auth.credentialsUnavailable']({ missing: 'entraSession' }).nextStep).toBe(
            "Connection diagnosis doesn't open sign-in. Connect to the cluster once, then run the check again.",
        );
        for (const missing of ['method', 'password']) {
            expect(findingMessages['cs.credentialsMissing']({ missing })).toEqual(
                findingMessages['auth.credentialsUnavailable']({ missing }),
            );
        }
    });

    it('R3: labels the extension fail-fast selection limit as policy, never as a connection setting', () => {
        const policy = findingMessages['auth.serverSelectionTimeout']({
            timeoutMs: 4000,
            timeoutSource: 'extensionPolicy',
            serverErrorCount: 1,
        });
        expect(policy.explanation).toContain('the extension uses for emulator and local connections');
        expect(policy.nextStep).not.toMatch(/connection setting/);
        expect(policy.nextStep).toContain(firewall);
        expect(
            findingMessages['auth.serverSelectionTimeout']({ timeoutSource: 'connection', serverErrorCount: 1 })
                .nextStep,
        ).toContain('change that connection setting');
    });

    it('distinguishes identity rejection from native credential rejection', () => {
        for (const authMethod of ['MicrosoftEntraID', 'ManagedIdentity']) {
            expect(findingMessages['auth.failed']({ authMethod }).nextStep).toBe(
                'Check that this identity is added as a user on the cluster.',
            );
        }
        expect(findingMessages['auth.failed']({ authMethod: 'NativeAuth' }).nextStep).toContain(
            'Check the username and password',
        );
    });

    it('recommends managed identity cloud checks for a resource not in the tenant', () => {
        expect(
            findingMessages['auth.entraTokenFailed']({
                ruleId: 'resourceNotInTenant',
                authMethod: AuthMethodId.ManagedIdentity,
            }),
        ).toEqual({
            title: 'Microsoft Entra ID sign-in failed',
            explanation: 'The managed identity token may target a different Azure cloud than the cluster.',
            nextStep:
                'If documentDB.customEnvironment.ossrdbmsEndpoint is set, check or clear it. Then check that the virtual machine and the cluster are in the same Azure cloud.',
        });
    });

    it.each(['applicationNotInDirectory', 'tenantNotFound', 'accountNotInTenant'])(
        'uses the default sign-in message for managed identity and %s',
        (ruleId) => {
            expect(
                findingMessages['auth.entraTokenFailed']({ ruleId, authMethod: AuthMethodId.ManagedIdentity }),
            ).toEqual({
                title: 'Microsoft Entra ID sign-in failed',
                explanation: 'Microsoft Entra ID could not provide a sign-in token.',
                nextStep:
                    'Review the sign-in details in the diagnostic report with your tenant administrator or IT help desk.',
            });
        },
    );

    it('keeps interactive cloud guidance for a resource not in the tenant', () => {
        expect(
            findingMessages['auth.entraTokenFailed']({
                ruleId: 'resourceNotInTenant',
                authMethod: AuthMethodId.MicrosoftEntraID,
            }),
        ).toEqual({
            title: 'Microsoft Entra ID sign-in failed',
            explanation:
                'The selected Azure cloud may not match the cluster, or the sign-in resource may be unavailable in this tenant.',
            nextStep:
                'Check microsoft-sovereign-cloud.environment. If it matches the cluster, ask your tenant administrator to check resource availability.',
        });
    });

    it.each(['applicationNotInDirectory', 'tenantNotFound', 'accountNotInTenant'])(
        'keeps interactive guidance unchanged for %s',
        (ruleId) => {
            expect(
                findingMessages['auth.entraTokenFailed']({ ruleId, authMethod: AuthMethodId.MicrosoftEntraID }),
            ).toEqual(findingMessages['auth.entraTokenFailed']({ ruleId }));
        },
    );

    it.each([
        'firstPartyPreauthorization',
        'invalidResource',
        'crossCloudNotAllowed',
        'conditionalAccess',
        'additionalVerification',
        'brokerOpaque',
        'oidcHostNotAllowed',
        'unknownAadsts',
        'futureRule',
    ])('keeps other token failure messages unchanged for managed identity: %s', (ruleId) => {
        expect(findingMessages['auth.entraTokenFailed']({ ruleId, authMethod: AuthMethodId.ManagedIdentity })).toEqual(
            findingMessages['auth.entraTokenFailed']({ ruleId }),
        );
    });

    it.each([
        'firstPartyPreauthorization',
        'resourceNotInTenant',
        'invalidResource',
        'accountNotInTenant',
        'applicationNotInDirectory',
        'tenantNotFound',
        'crossCloudNotAllowed',
        'conditionalAccess',
        'additionalVerification',
        'brokerOpaque',
        'oidcHostNotAllowed',
        'unknownAadsts',
        'futureRule',
    ])('keeps technical sign-in evidence out of the prose for rule %s', (ruleId) => {
        const message = findingMessages['auth.entraTokenFailed']({ ruleId, aadstsCode: 'AADSTS53003' });
        assertPlainMessage(message);
        expect(JSON.stringify(message)).not.toContain(ruleId);
    });

    it.each([
        'customCloudUnresolved',
        'customCloudDefinitionInvalid',
        'invalidCustomOverride',
        'managedIdentityCloudUnknown',
    ])('offers a setting correction without displaying resolver kind %s', (kind) => {
        const message = findingMessages['auth.tokenResourceUnresolved']({ kind });
        assertPlainMessage(message);
        expect(message.nextStep).toContain('Environment');
        expect(JSON.stringify(message)).not.toContain(kind);
    });
});
