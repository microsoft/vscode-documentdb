/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    formatTarget,
    type Check,
    type CheckOutcome,
    type CheckStatus,
    type CheckStepResult,
    type Finding,
    type RunContext,
    type SkipReason,
} from '@documentdb-js/connectivity-troubleshooter';
import { appendExtensionUserAgent, type ITelemetryContext } from '@microsoft/vscode-azext-utils';
import {
    MongoClient,
    MongoInvalidArgumentError,
    MongoParseError,
    MongoServerError,
    MongoServerSelectionError,
    type MongoClientOptions,
} from 'mongodb';
import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import {
    AuthInputUnavailableError,
    createAuthHandler,
    type AuthPhaseObserver,
} from '../../documentdb/auth/createAuthHandler';
import { TokenResourceResolutionError } from '../../documentdb/auth/documentdbTokenResource';
import { classifyEntraError } from '../../documentdb/auth/entraErrors/classifyEntraError';
import { getRecentEntraTokenFailure } from '../../documentdb/auth/entraErrors/entraTokenFailures';
import { getCloudForTokenResource } from '../../documentdb/auth/entraScopes';
import { getAzureHostSuffix } from '../../documentdb/auth/oidcAllowedHosts';
import { type CachedClusterCredentials } from '../../documentdb/CredentialCache';
import { prepareDriverConnectionString } from '../../documentdb/srv/prepareDriverConnectionString';
import { ConnectionStartupTimings } from '../../documentdb/utils/ConnectionStartupTimings';
import { getHostsFromConnectionString } from '../../documentdb/utils/connectionStringHelpers';
import { DocumentDBConnectionString } from '../../documentdb/utils/DocumentDBConnectionString';
import { type AuthTraceContext } from '../../utils/authTrace';
import { type RunOwnedClient } from '../auth/runOwnedClient';
import { summarizeTokenClaims, type TokenClaimSummary } from '../auth/tokenClaims';
import { type TroubleshooterSetup } from '../input';
import { type FindingCode, type TroubleshootTarget } from '../types';

export const AUTH_STEP_IDS = ['auth.signInConfiguration', 'auth.token', 'auth.serverAuthentication'] as const;
type AuthStepId = (typeof AUTH_STEP_IDS)[number];

/** Injected for tests; production creates a real, run-owned driver client. */
export interface AuthenticateCheckDeps {
    readonly createClient: (connectionString: string, options: MongoClientOptions) => MongoClient;
    /** Wall-clock milliseconds since the epoch, for step offsets and token expiry. */
    readonly now: () => number;
}

const defaultDeps: AuthenticateCheckDeps = {
    createClient: (connectionString, options): MongoClient => new MongoClient(connectionString, options),
    now: (): number => Date.now(),
};

const SERVER_CODE_AUTHENTICATION_FAILED = 18;
const SERVER_CODE_MECHANISM_UNAVAILABLE = 334;
const MAX_SERVER_ERRORS = 16;
const DEFAULT_PORT = 27017;

// Allowlisted values copied from #1050's resolution details (ported from the prototype's
// `safeResolutionDetails`). Anything else becomes `other`; free text never passes through.
const resolutionDetailValues: Readonly<Record<string, readonly (string | boolean)[]>> = {
    flow: ['interactive', 'managedIdentity', 'copy', 'diagnostics'],
    configuredCloud: ['AzureCloud', 'AzureUSGovernment', 'AzureChinaCloud', 'custom', 'unreadable'],
    authProvider: ['microsoft', 'microsoft-sovereign-cloud', 'unknown'],
    brokerImplementation: ['default', 'msal', 'msal-no-broker', 'other'],
    hostCloud: ['AzureCloud', 'AzureUSGovernment', 'AzureChinaCloud', 'none'],
    cloudCategory: ['public', 'usgov', 'china', 'custom'],
    customOssrdbmsEndpointState: ['absent', 'valid', 'invalid'],
    customOssrdbmsEndpointApplicable: [true, false],
    customHostnameSuffixSet: [true, false],
    customHostnameSuffixSource: ['user', 'workspace', 'none'],
    armMetadata: ['notNeeded', 'cached', 'found', 'missingKey', 'unavailable'],
    imdsAzEnvironment: [
        'notQueried',
        'AZUREPUBLICCLOUD',
        'AzureUSGovernment',
        'AzureChinaCloud',
        'unavailable',
        'other',
    ],
    errorKind: [
        'customCloudUnresolved',
        'customCloudDefinitionInvalid',
        'invalidCustomOverride',
        'cloudMismatch',
        'managedIdentityCloudUnknown',
    ],
};
const tokenResourceReasons: readonly string[] = [
    'setting',
    'customOverride',
    'customLoginHost',
    'armMetadata',
    'host',
    'imds',
    'copyDefault',
];
const knownAllowedHostPatterns: readonly string[] = ['*.azure.com', '*.azure.us', '*.azure.cn'];
const knownMechanisms: readonly string[] = [
    'DEFAULT',
    'SCRAM-SHA-1',
    'SCRAM-SHA-256',
    'PLAIN',
    'MONGODB-X509',
    'GSSAPI',
    'MONGODB-AWS',
    'MONGODB-OIDC',
];
const knownErrorNames: ReadonlySet<string> = new Set([
    'Error',
    'TypeError',
    'RangeError',
    'SyntaxError',
    'AbortError',
    'UserCancelledError',
    'TokenResourceResolutionError',
    'AuthInputUnavailableError',
    'CredentialUnavailableError',
    'AuthenticationRequiredError',
    'AggregateAuthenticationError',
    'AuthenticationError',
    'RestError',
]);
const knownErrorCodes: ReadonlySet<string> = new Set([
    'ENOTFOUND',
    'EAI_AGAIN',
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ENETUNREACH',
    'EHOSTUNREACH',
    'EPIPE',
    'EPROTO',
    'CERT_HAS_EXPIRED',
    'CERT_NOT_YET_VALID',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'ERR_TLS_CERT_ALTNAME_INVALID',
]);

type Facts = Record<string, unknown>;

interface StepRecord {
    startedAt?: number;
    finishedAt?: number;
    status?: CheckStatus;
    skippedBecause?: { readonly reason: SkipReason; readonly stepId?: string };
    facts: Facts;
    findings: Finding<FindingCode>[];
}

/**
 * Records the Microsoft Entra ID and managed identity phases in the order they really happen
 * (design 4.9.2). Steps are recorded, never scheduled, timed out or emitted as events.
 */
class AuthSteps {
    private readonly records = new Map<AuthStepId, StepRecord>(
        AUTH_STEP_IDS.map((id): [AuthStepId, StepRecord] => [id, { facts: {}, findings: [] }]),
    );

    constructor(
        private readonly now: () => number,
        private readonly checkStartedAt: number,
    ) {}

    public get(id: AuthStepId): StepRecord {
        const record = this.records.get(id);
        if (!record) {
            throw new Error('Unknown authentication step');
        }
        return record;
    }

    public start(id: AuthStepId): void {
        const record = this.get(id);
        record.startedAt ??= this.now();
    }

    public finish(
        id: AuthStepId,
        status: CheckStatus,
        facts: Facts = {},
        findings: readonly Finding<FindingCode>[] = [],
        skippedBecause?: StepRecord['skippedBecause'],
    ): void {
        const record = this.get(id);
        if (record.status !== undefined) {
            return;
        }
        record.startedAt ??= this.now();
        record.finishedAt = this.now();
        record.status = status;
        record.skippedBecause = skippedBecause;
        Object.assign(record.facts, facts);
        record.findings.push(...findings);
    }

    /** Overrides an already recorded result, for a phase whose failure becomes known later. */
    public replace(id: AuthStepId, status: CheckStatus, findings: readonly Finding<FindingCode>[]): void {
        const record = this.get(id);
        record.startedAt ??= this.now();
        record.finishedAt ??= this.now();
        record.status = status;
        record.findings.push(...findings);
    }

    public skip(id: AuthStepId, reason: SkipReason, stepId?: AuthStepId): void {
        const record = this.get(id);
        record.startedAt = undefined;
        record.finishedAt = undefined;
        record.status = 'skipped';
        record.skippedBecause = { reason, ...(stepId === undefined ? {} : { stepId }) };
    }

    public results(): CheckStepResult<FindingCode>[] {
        const blocker = AUTH_STEP_IDS.find((id): boolean => {
            const status = this.get(id).status;
            return status === 'fail' || status === 'skipped';
        });
        return AUTH_STEP_IDS.map((id): CheckStepResult<FindingCode> => {
            const record = this.get(id);
            if (record.status === undefined && record.startedAt === undefined) {
                const reason: SkipReason =
                    blocker === undefined || blocker === id
                        ? 'notApplicable'
                        : this.get(blocker).status === 'fail'
                          ? 'dependencyFailed'
                          : 'dependencySkipped';
                return {
                    stepId: id,
                    status: 'skipped',
                    skippedBecause: { reason, ...(reason === 'notApplicable' ? {} : { stepId: blocker }) },
                    durationMs: 0,
                    findings: [],
                    facts: {},
                };
            }
            const status = record.status ?? 'fail';
            if (status === 'skipped') {
                return {
                    stepId: id,
                    status,
                    ...(record.skippedBecause ? { skippedBecause: record.skippedBecause } : {}),
                    durationMs: 0,
                    findings: record.findings,
                    facts: record.facts,
                };
            }
            const startedAt = record.startedAt ?? this.checkStartedAt;
            const durationMs = Math.max(0, Math.round((record.finishedAt ?? this.now()) - startedAt));
            return {
                stepId: id,
                status,
                durationMs,
                findings: record.findings,
                facts: {
                    ...record.facts,
                    startOffsetMs: Math.max(0, Math.round(startedAt - this.checkStartedAt)),
                    durationMs,
                },
            };
        });
    }
}

/**
 * The extension's Authenticate check (design 4.9): the chosen method and its credentials, through
 * the same auth handler, driver options and SRV preparation a real connect uses, on a new client
 * owned by the run. Never prompts, never reuses `ClustersClient` and never writes `CredentialCache`.
 */
export function createAuthenticateCheck(
    target: TroubleshootTarget,
    getSetup: () => TroubleshooterSetup,
    getTelemetryProperties: () => ITelemetryContext['properties'],
    getRunOwnedClient: () => RunOwnedClient,
    deps: AuthenticateCheckDeps = defaultDeps,
): Check<RunContext, FindingCode> {
    return {
        id: 'authenticate',
        scope: 'run',
        // Required inputs only; the network probe verdicts never suppress the real attempt (3.1).
        dependsOn: ['connectionString', 'prepare'],
        timeout: 'authentication',
        run(context, signal): Promise<CheckOutcome<FindingCode>> {
            return authenticate(context, signal);
        },
    };

    async function authenticate(context: RunContext, signal: AbortSignal): Promise<CheckOutcome<FindingCode>> {
        const setup = getSetup();
        const method = setup.chosenAuthMethod;
        const credentials = setup.transientCredentials;
        if (method === undefined || setup.credentialState === 'noMethod' || credentials === undefined) {
            return skipped('method');
        }
        if (setup.credentialState === 'passwordMissing') {
            return skipped('password', method);
        }

        const oidc = method === AuthMethodId.MicrosoftEntraID || method === AuthMethodId.ManagedIdentity;
        const checkStartedAt = deps.now();
        const steps = oidc ? new AuthSteps(deps.now, checkStartedAt) : undefined;
        const facts: Facts = baseFacts(method, credentials);
        const timings = new ConnectionStartupTimings();
        let requestedResource = '';
        let tokenFailed = false;

        const observer: AuthPhaseObserver = {
            onSignInConfigurationResolved(info): void {
                requestedResource = typeof info.details.tokenResource === 'string' ? info.details.tokenResource : '';
                steps?.finish('auth.signInConfiguration', 'pass', {
                    ...safeResolutionDetails(info.details),
                    tokenResourceReason: selected(info.tokenResourceReason, tokenResourceReasons),
                    allowedHostPatterns: info.allowedHosts.map((pattern): string =>
                        knownAllowedHostPatterns.includes(pattern) ? pattern : 'custom',
                    ),
                    allHostsAllowed: allHostsAllowed(context, credentials, info.allowedHosts),
                });
            },
            onTokenStarted(): void {
                steps?.start('auth.token');
            },
            onTokenAcquired(info): void {
                // The token is summarized here and never stored; only the allowlisted summary remains.
                const claims = summarizeTokenClaims(
                    info.accessToken,
                    { requestedResource, configuredTenantId: info.tenantId },
                    deps.now(),
                );
                if (info.account?.label) {
                    facts.account = info.account.label;
                }
                const findings = claimFindings(claims);
                steps?.finish('auth.token', findings.length > 0 ? 'warning' : 'pass', { claims }, findings);
            },
            onTokenFailed(error): void {
                if (error instanceof AuthInputUnavailableError) {
                    steps?.finish('auth.token', 'skipped', {}, [], { reason: 'inputUnavailable' });
                    return;
                }
                tokenFailed = true;
                const classification = classifyEntraError(errorMessages(error));
                const ruleId = classification?.ruleId ?? 'unclassified';
                const aadstsCode = classification?.code;
                steps?.finish(
                    'auth.token',
                    'fail',
                    { ...errorFacts(error), ruleId, ...(aadstsCode === undefined ? {} : { aadstsCode }) },
                    [entraTokenFailedFinding(ruleId, aadstsCode)],
                );
            },
        };

        const traceContext: AuthTraceContext = {
            startupCorrelationId: context.runId,
            surface: 'troubleshooter',
            startupProperties: getTelemetryProperties(),
        };

        // The failure that ended the attempt, kept only to choose a safe fallback finding (design 4.13).
        let failure: { readonly error: unknown; readonly phase: 'configure' | 'construct' | 'connect' } | undefined;

        const finish = (outcome: {
            status: CheckStatus;
            findings?: Finding<FindingCode>[];
        }): CheckOutcome<FindingCode> => {
            const costs = timings.finish();
            if (costs.tokenAcquireDurationMs !== undefined) {
                facts.tokenMs = Math.round(costs.tokenAcquireDurationMs);
            }
            if (costs.databaseConnectDurationMs !== undefined) {
                facts.connectMs = Math.round(costs.databaseConnectDurationMs);
            }
            const stepResults = steps?.results();
            let findings = outcome.findings ?? [];
            const explained = [...findings, ...(stepResults ?? []).flatMap((step) => step.findings)].some(
                (finding): boolean => finding.severity === 'error',
            );
            if (outcome.status === 'fail' && !explained && !signal.aborted) {
                findings = [...findings, unexplainedFailureFinding(failure)];
            }
            let status = outcome.status;
            if (stepResults && status !== 'skipped') {
                const blocking = stepResults.find((step): boolean => step.status === 'fail');
                if (blocking) {
                    status = 'fail';
                } else if (status === 'pass' && stepResults.some((step): boolean => step.status === 'warning')) {
                    status = 'warning';
                }
            }
            return {
                status,
                ...(status === 'skipped' ? { skippedBecause: { reason: 'inputUnavailable' } } : {}),
                facts,
                findings,
                ...(stepResults ? { steps: stepResults } : {}),
            };
        };

        steps?.start('auth.signInConfiguration');
        let configured: Awaited<ReturnType<ReturnType<typeof createAuthHandler>['configureAuth']>>;
        try {
            const handler = createAuthHandler(method, credentials, { interactive: false, observer });
            configured = await handler.configureAuth(timings, traceContext);
        } catch (error) {
            if (error instanceof AuthInputUnavailableError) {
                return finish(inputUnavailable(error.missing, method, steps, facts));
            }
            getRunOwnedClient().authError = error;
            if (error instanceof TokenResourceResolutionError) {
                steps?.finish('auth.signInConfiguration', 'fail', {
                    ...safeResolutionDetails(error.details),
                    errorKind: selected(error.kind, resolutionDetailValues.errorKind),
                });
                const finding = resolutionFinding(error);
                if (steps) {
                    steps.get('auth.signInConfiguration').findings.push(finding);
                    return finish({ status: 'fail' });
                }
                return finish({ status: 'fail', findings: [finding] });
            }
            if (tokenFailed) {
                return finish({ status: 'fail' });
            }
            failure = { error, phase: 'configure' };
            Object.assign(facts, errorFacts(error));
            failOpenStep(steps, error);
            return finish({ status: 'fail' });
        }
        if (signal.aborted) {
            return finish({ status: 'fail' });
        }

        const { connectionString, options } = configured;
        steps?.start('auth.serverAuthentication');
        let client: MongoClient | undefined;
        let driverConnectionString = connectionString;
        try {
            const hosts = getHostsFromConnectionString(connectionString);
            if (hosts.some((host): boolean => !!getAzureHostSuffix(host))) {
                options.appName = appendExtensionUserAgent();
            }
            const prepared = await prepareDriverConnectionString({
                connectionString,
                options,
                surface: 'troubleshooter',
                correlation: {
                    startupCorrelationId: context.runId,
                    troubleshooterRunCorrelationId: context.runId,
                },
                abortSignal: signal,
            });
            driverConnectionString = prepared.connectionString;
            if (signal.aborted) {
                return finish({ status: 'fail' });
            }

            let ownedClient: MongoClient;
            try {
                ownedClient = deps.createClient(prepared.connectionString, prepared.options);
            } catch (error) {
                failure = { error, phase: 'construct' };
                throw error;
            }
            client = ownedClient;
            // Registered before connecting, so a timed-out, cancelled or abandoned attempt is closed,
            // including a client that finishes connecting after the run ended (3.3).
            context.addCleanup((): Promise<void> => ownedClient.close());
            const onAbort = (): void => {
                void ownedClient.close().catch((): void => undefined);
            };
            signal.addEventListener('abort', onAbort, { once: true });
            const stopDatabaseConnect = timings.startDatabaseConnect();
            try {
                await ownedClient.connect();
            } finally {
                stopDatabaseConnect();
                signal.removeEventListener('abort', onAbort);
            }
        } catch (error) {
            if (!(error instanceof AuthInputUnavailableError)) getRunOwnedClient().authError = error;
            failure ??= { error, phase: 'connect' };
            return finish(connectFailure(error, client, options, seedAddresses(context, driverConnectionString)));
        }

        if (signal.aborted) {
            // The run already ended; the late client is closed and never published.
            await client.close().catch((): void => undefined);
            return finish({ status: 'fail' });
        }
        getRunOwnedClient().client = client;
        steps?.finish('auth.serverAuthentication', 'pass');
        facts.authenticated = method !== AuthMethodId.NoAuth;
        return finish({ status: 'pass' });

        function connectFailure(
            error: unknown,
            failedClient: MongoClient | undefined,
            driverOptions: MongoClientOptions,
            seeds: ReadonlySet<string>,
        ): { status: CheckStatus; findings?: Finding<FindingCode>[] } {
            const serverFacts = serverErrorFacts(error);
            if (tokenFailed) {
                steps?.finish('auth.serverAuthentication', 'fail', serverFacts);
                return { status: 'fail' };
            }
            if (
                error instanceof MongoInvalidArgumentError &&
                classifyEntraError(error.message)?.ruleId === 'oidcHostNotAllowed'
            ) {
                const finding = makeFinding(
                    'auth.oidcHostNotAllowed',
                    'error',
                    {},
                    'The driver does not allow this cluster host for Microsoft Entra ID authentication, so no token was sent.',
                );
                if (steps) {
                    steps.replace('auth.signInConfiguration', 'fail', [finding]);
                    steps.get('auth.signInConfiguration').facts.allHostsAllowed = false;
                    steps.skip('auth.serverAuthentication', 'dependencyFailed', 'auth.signInConfiguration');
                    return { status: 'fail' };
                }
                return { status: 'fail', findings: [finding] };
            }

            const findings: Finding<FindingCode>[] = [];
            const extraFacts: Facts = {};
            if (error instanceof MongoServerError && error.code === SERVER_CODE_AUTHENTICATION_FAILED) {
                const serverCodeName = safeCodeName(error.codeName);
                findings.push(
                    makeFinding(
                        'auth.failed',
                        'error',
                        {
                            authMethod: method ?? 'unknown',
                            serverCode: SERVER_CODE_AUTHENTICATION_FAILED,
                            ...(serverCodeName === undefined ? {} : { serverCodeName }),
                        },
                        'The server rejected authentication (code 18).',
                    ),
                );
            } else if (
                error instanceof MongoServerError &&
                (error.code === SERVER_CODE_MECHANISM_UNAVAILABLE || error.codeName === 'MechanismUnavailable')
            ) {
                const requested =
                    typeof facts.mechanism === 'string' && facts.mechanism !== 'DEFAULT' ? facts.mechanism : undefined;
                findings.push(
                    makeFinding(
                        'auth.mechanismMismatch',
                        'error',
                        requested === undefined ? {} : { requested },
                        requested === undefined
                            ? 'The server does not offer the requested authentication mechanism.'
                            : `The server does not offer the requested authentication mechanism ${requested}.`,
                    ),
                );
            } else if (error instanceof MongoServerSelectionError) {
                const serverErrors = topologyServerErrors(error);
                const timeoutMs = selectionTimeoutMs(failedClient, driverOptions);
                const timeoutSource = selectionTimeoutSource(driverOptions, driverConnectionString);
                extraFacts.serverErrors = serverErrors;
                findings.push(
                    makeFinding(
                        'auth.serverSelectionTimeout',
                        'error',
                        {
                            ...(timeoutMs === undefined ? {} : { timeoutMs }),
                            timeoutSource,
                            serverErrorCount: serverErrors.length,
                        },
                        `The driver could not select a server before its time limit; ${serverErrors.length} servers reported errors. This does not show that credentials were rejected.`,
                    ),
                );
                const unreachableCount = serverErrors.filter(
                    (entry): boolean => !seeds.has(entry.address.toLowerCase()),
                ).length;
                if (unreachableCount > 0) {
                    findings.push(
                        makeFinding(
                            'hello.advertisedMembersUnreachable',
                            'warning',
                            { unreachableCount },
                            `The driver reported ${unreachableCount} advertised members, not listed in the connection string, that could not be reached.`,
                        ),
                    );
                }
            }

            if (steps) {
                steps.finish('auth.serverAuthentication', 'fail', { ...serverFacts, ...extraFacts }, findings);
                return { status: 'fail' };
            }
            Object.assign(facts, serverFacts, extraFacts);
            return { status: 'fail', findings };
        }
    }

    function skipped(missing: 'method' | 'password', method?: AuthMethodId): CheckOutcome<FindingCode> {
        return {
            status: 'skipped',
            skippedBecause: { reason: 'inputUnavailable' },
            facts: { ...(method === undefined ? {} : { authMethod: method }), authenticated: false },
            findings: [credentialsUnavailableFinding(missing, method)],
        };
    }

    function inputUnavailable(
        missing: AuthInputUnavailableError['missing'],
        method: AuthMethodId,
        steps: AuthSteps | undefined,
        facts: Facts,
    ): { status: CheckStatus; findings: Finding<FindingCode>[] } {
        if (missing === 'entraSession') {
            // The silent lookup cannot tell "not signed in" from a consent or preauthorization
            // failure; an earlier recorded failure is evidence only and never changes the outcome.
            facts.signInLimitation = 'silentLookupCannotDistinguishConsent';
            const earlier = getRecentEntraTokenFailure(target.clusterId);
            if (earlier) {
                facts.earlierInSession = {
                    ageSeconds: Math.max(0, Math.round((Date.now() - earlier.timestamp) / 1000)),
                    cloudCategory: selected(earlier.cloudCategory, resolutionDetailValues.cloudCategory),
                    ...(earlier.ruleId === undefined ? {} : { ruleId: earlier.ruleId }),
                };
            }
            steps?.finish('auth.token', 'skipped', {}, [], { reason: 'inputUnavailable' });
            steps?.skip('auth.serverAuthentication', 'dependencySkipped', 'auth.token');
        }
        facts.authenticated = false;
        return { status: 'skipped', findings: [credentialsUnavailableFinding(missing, method)] };
    }
}

/** The driver's seed list: the probed URI or SRV targets and the hosts of the driver's connection string. */
function seedAddresses(context: RunContext, connectionString: string): ReadonlySet<string> {
    const seeds = new Set<string>(
        context.targets.map((probeTarget): string => formatTarget(probeTarget).toLowerCase()),
    );
    try {
        if (connectionString.startsWith('mongodb://')) {
            for (const host of getHostsFromConnectionString(connectionString)) {
                seeds.add(withPort(host).toLowerCase());
            }
        }
    } catch {
        // The driver rejects an unparseable string itself; the probe targets remain the seeds.
    }
    return seeds;
}

function withPort(host: string): string {
    return /:\d+$/.test(host) ? host : `${host}:${DEFAULT_PORT}`;
}

function baseFacts(method: AuthMethodId, credentials: CachedClusterCredentials): Facts {
    const facts: Facts = { authMethod: method, mechanism: mechanismFor(method, credentials), authenticated: false };
    if (method === AuthMethodId.NativeAuth && credentials.nativeAuthConfig?.connectionUser) {
        facts.userName = credentials.nativeAuthConfig.connectionUser;
    }
    if (method === AuthMethodId.MicrosoftEntraID) {
        facts.tenantConfigured = !!credentials.entraIdConfig?.tenantId;
    }
    if (method === AuthMethodId.ManagedIdentity) {
        facts.managedIdentityKind = credentials.managedIdentityConfig?.clientId ? 'userAssigned' : 'systemAssigned';
        facts.tenantConfigured = !!credentials.managedIdentityConfig?.tenantId;
    }
    return facts;
}

function mechanismFor(method: AuthMethodId, credentials: CachedClusterCredentials): string {
    switch (method) {
        case AuthMethodId.MicrosoftEntraID:
        case AuthMethodId.ManagedIdentity:
            return 'MONGODB-OIDC';
        case AuthMethodId.NoAuth:
            return 'none';
        default: {
            let explicit: string | null = null;
            try {
                explicit = new DocumentDBConnectionString(credentials.connectionString).searchParams.get(
                    'authMechanism',
                );
            } catch {
                // The connection-string check reports an unparseable string.
            }
            // `DEFAULT` is the driver's name for a mechanism negotiated from the server's offer.
            return explicit === null ? 'DEFAULT' : selected(explicit, knownMechanisms);
        }
    }
}

function allHostsAllowed(
    context: RunContext,
    credentials: CachedClusterCredentials,
    allowedHosts: readonly string[],
): boolean | null {
    let hosts = context.targets.map((probeTarget): string => probeTarget.host);
    if (hosts.length === 0 && credentials.connectionString.startsWith('mongodb://')) {
        try {
            hosts = getHostsFromConnectionString(credentials.connectionString).map((host): string =>
                host.replace(/:\d+$/, ''),
            );
        } catch {
            return null;
        }
    }
    if (hosts.length === 0) {
        return null;
    }
    return hosts.every((host): boolean =>
        hostMatchesAllowlist(host.replace(/^\[|\]$/g, '').toLowerCase(), allowedHosts),
    );
}

/** The driver's `ALLOWED_HOSTS` matching: an exact host, or `*.suffix` for the suffix and its subdomains. */
function hostMatchesAllowlist(host: string, allowedHosts: readonly string[]): boolean {
    return allowedHosts.some((pattern): boolean => {
        const normalized = pattern.toLowerCase();
        if (host === normalized) {
            return true;
        }
        if (normalized.startsWith('*.')) {
            const suffix = normalized.slice(2);
            return host === suffix || host.endsWith(`.${suffix}`);
        }
        return false;
    });
}

function selected(value: unknown, allowed: readonly unknown[], fallback = 'other'): string {
    return allowed.includes(value) ? String(value) : fallback;
}

/** Ported from the prototype: only allowlisted resolution details, and the resource by cloud name. */
function safeResolutionDetails(details: Readonly<Record<string, string | boolean>>): Facts {
    const result: Facts = {};
    for (const [key, allowed] of Object.entries(resolutionDetailValues)) {
        if (Object.hasOwn(details, key)) {
            const value = details[key];
            result[key] = typeof value === 'boolean' && allowed.includes(value) ? value : selected(value, allowed);
        }
    }
    if (Object.hasOwn(details, 'reason')) {
        result.tokenResourceReason = selected(details.reason, tokenResourceReasons);
    }
    if (Object.hasOwn(details, 'tokenResource')) {
        const resource = details.tokenResource;
        result.tokenResource =
            (typeof resource === 'string' ? getCloudForTokenResource(resource) : undefined) ?? 'custom';
    }
    return result;
}

function failOpenStep(steps: AuthSteps | undefined, error: unknown): void {
    if (!steps) {
        return;
    }
    for (const id of AUTH_STEP_IDS) {
        const record = steps.get(id);
        if (record.startedAt !== undefined && record.status === undefined) {
            steps.finish(id, 'fail', errorFacts(error));
            return;
        }
    }
}

function claimFindings(claims: TokenClaimSummary): Finding<FindingCode>[] {
    if (!claims.available) {
        return [];
    }
    const findings: Finding<FindingCode>[] = [];
    if (claims.audience === 'different') {
        findings.push(
            makeFinding(
                'auth.entraAudienceMismatch',
                'warning',
                {},
                'The token audience differs from the requested sign-in resource. This is an unverified hint from the token claims.',
            ),
        );
    }
    if (claims.tenantMatch === 'different') {
        findings.push(
            makeFinding(
                'auth.entraTenantMismatch',
                'warning',
                {},
                'The token tenant differs from the tenant configured for the connection. This is an unverified hint from the token claims.',
            ),
        );
    }
    return findings;
}

function resolutionFinding(error: TokenResourceResolutionError): Finding<FindingCode> {
    if (error.kind === 'cloudMismatch') {
        const configuredCloud = selected(error.details.configuredCloud, resolutionDetailValues.configuredCloud);
        const hostCloud = selected(error.details.hostCloud, resolutionDetailValues.hostCloud);
        return makeFinding(
            'auth.cloudMismatch',
            'error',
            { configuredCloud, hostCloud },
            `The cluster is in ${hostCloud}, but sign-in is configured for ${configuredCloud}. No token was requested.`,
        );
    }
    const kind = selected(error.kind, resolutionDetailValues.errorKind);
    return makeFinding(
        'auth.tokenResourceUnresolved',
        'error',
        { kind },
        `The sign-in resource could not be determined from the cloud configuration (${kind}). No token was requested.`,
    );
}

function entraTokenFailedFinding(ruleId: string, aadstsCode: string | undefined): Finding<FindingCode> {
    return makeFinding(
        'auth.entraTokenFailed',
        'error',
        { ruleId, ...(aadstsCode === undefined ? {} : { aadstsCode }) },
        aadstsCode === undefined
            ? `The sign-in token request failed (classifier rule ${ruleId}).`
            : `The sign-in token request failed with AADSTS${aadstsCode} (classifier rule ${ruleId}).`,
    );
}

function credentialsUnavailableFinding(
    missing: 'method' | 'password' | 'entraSession',
    method: AuthMethodId | undefined,
): Finding<FindingCode> {
    const text = {
        method: 'No authentication method has been chosen, so authentication was not tested.',
        password: 'No stored password is available, so authentication was not tested.',
        entraSession:
            'No Microsoft Entra ID sign-in is available without a prompt, so authentication was not tested. A consent or preauthorization failure cannot be told apart from not being signed in without prompting.',
    }[missing];
    return makeFinding(
        'auth.credentialsUnavailable',
        'info',
        { missing, ...(method === undefined ? {} : { authMethod: method }) },
        text,
    );
}

function makeFinding(
    code: FindingCode,
    severity: Finding<FindingCode>['severity'],
    data: Readonly<Record<string, unknown>>,
    text: string,
): Finding<FindingCode> {
    return { code, severity, data, detail: { language: 'en', text } };
}

/**
 * A safe explanation for a failed attempt no specific finding covers. Never quotes the driver's message,
 * which can repeat the connection string or option values.
 */
function unexplainedFailureFinding(
    failure: { readonly error: unknown; readonly phase: 'configure' | 'construct' | 'connect' } | undefined,
): Finding<FindingCode> {
    const errorName = safeErrorName(failure?.error);
    if (
        failure?.phase === 'construct' &&
        (failure.error instanceof MongoParseError || failure.error instanceof MongoInvalidArgumentError)
    ) {
        return makeFinding(
            'auth.driverOptionsRejected',
            'error',
            { errorName },
            'The driver rejected the connection options before connecting; check option values in the connection string.',
        );
    }
    return makeFinding(
        'auth.connectFailed',
        'error',
        { errorName, ...(failure === undefined ? {} : { phase: failure.phase }) },
        'The connection attempt failed without a more specific finding.',
    );
}

function safeErrorName(error: unknown): string {
    if (!(error instanceof Error)) {
        return 'unknown';
    }
    // Driver error class names are a fixed vocabulary; they never carry user data.
    return knownErrorNames.has(error.name) || /^Mongo[A-Za-z]{1,60}Error$/.test(error.name) ? error.name : 'unknown';
}

function safeErrorCode(error: unknown): number | string | undefined {
    let current: unknown = error;
    for (let depth = 0; depth < 2 && typeof current === 'object' && current !== null; depth++) {
        const code: unknown = (current as { code?: unknown }).code;
        if (typeof code === 'number' && Number.isInteger(code)) {
            return code;
        }
        if (typeof code === 'string' && knownErrorCodes.has(code)) {
            return code;
        }
        current = (current as { cause?: unknown }).cause;
    }
    return undefined;
}

function safeCodeName(value: unknown): string | undefined {
    return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(value) ? value : undefined;
}

function errorFacts(error: unknown): Facts {
    const errorCode = safeErrorCode(error);
    return { errorName: safeErrorName(error), ...(errorCode === undefined ? {} : { errorCode }) };
}

function serverErrorFacts(error: unknown): Facts {
    const serverCodeName = error instanceof MongoServerError ? safeCodeName(error.codeName) : undefined;
    return { ...errorFacts(error), ...(serverCodeName === undefined ? {} : { serverCodeName }) };
}

interface ServerErrorEntry {
    readonly address: string;
    readonly errorName: string;
    readonly errorCode?: number | string;
}

/** The driver's per-server errors: addresses are identifiers (redacted by the report), never messages. */
function topologyServerErrors(error: MongoServerSelectionError): ServerErrorEntry[] {
    const entries: ServerErrorEntry[] = [];
    const servers = error.reason?.servers;
    if (!(servers instanceof Map)) {
        return entries;
    }
    for (const [key, description] of servers) {
        if (entries.length >= MAX_SERVER_ERRORS) {
            break;
        }
        const serverError: unknown = description?.error;
        if (!serverError) {
            continue;
        }
        const address = typeof description.address === 'string' ? description.address : String(key);
        const errorCode = safeErrorCode(serverError);
        entries.push({
            address,
            errorName: safeErrorName(serverError),
            ...(errorCode === undefined ? {} : { errorCode }),
        });
    }
    return entries;
}

function selectionTimeoutMs(client: MongoClient | undefined, options: MongoClientOptions): number | undefined {
    const effective: unknown = (client as { options?: { serverSelectionTimeoutMS?: unknown } } | undefined)?.options
        ?.serverSelectionTimeoutMS;
    if (typeof effective === 'number' && Number.isFinite(effective) && effective > 0) {
        return effective;
    }
    const configured = options.serverSelectionTimeoutMS;
    return typeof configured === 'number' && Number.isFinite(configured) && configured > 0 ? configured : undefined;
}

/**
 * Where the driver's server-selection limit came from. The auth handler's options layer only sets it
 * as the extension's emulator/local fail-fast policy, and it overrides a URI value.
 */
function selectionTimeoutSource(
    options: MongoClientOptions,
    connectionString: string,
): 'extensionPolicy' | 'connection' | 'driverDefault' {
    if (options.serverSelectionTimeoutMS !== undefined) {
        return 'extensionPolicy';
    }
    return /[?&]serverselectiontimeoutms=/i.test(connectionString) ? 'connection' : 'driverDefault';
}

/** Message text for the classifier only; it never enters facts, findings, events or logs. */
function errorMessages(error: unknown): string {
    const messages: string[] = [];
    let current: unknown = error;
    for (let depth = 0; depth <= 3; depth++) {
        if (typeof current === 'string') {
            messages.push(current);
            break;
        }
        if (!(current instanceof Error)) {
            break;
        }
        messages.push(current.message);
        current = current.cause;
    }
    return messages.join('\n');
}
