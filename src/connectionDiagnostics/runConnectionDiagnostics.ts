/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    createBuiltInChecks,
    runDiagnostics,
    DiagnosticsCancelledError,
    type Check,
    type CheckOutcome,
    type CheckResult,
    type RunContext,
    type TimeoutProfile,
    type DiagnosticsEvent,
    type DiagnosticsInput,
    type DiagnosticsIo,
    type DiagnosticsRun,
} from '@documentdb-js/connection-diagnostics';
import {
    callWithTelemetryAndErrorHandling,
    UserCancelledError,
    type ITelemetryContext,
} from '@microsoft/vscode-azext-utils';
import { randomUUID } from 'crypto';
import { CredentialCache } from '../documentdb/CredentialCache';
import { type EphemeralClusterCredentials } from '../tree/documentdb/ClusterItemBase';
import { ConnectionSourceUnavailableError } from '../tree/documentdb/diagnosticCredentialRead';
import { nonNullValue } from '../utils/nonNull';
import { createRunOwnedClient, type RunOwnedClient } from './auth/runOwnedClient';
import { createAuthenticateCheck } from './checks/authenticate';
import { createConnectionAccessCheck } from './checks/connectionAccess';
import { createContextHintsCheck } from './checks/contextHints';
import { createCredentialsCheck } from './checks/credentials';
import { createExtensionEnvironmentCheck, getDiagnosticsRemoteKind } from './checks/extensionEnvironment';
import { withMixedHostDomainsWarning } from './checks/hostDomains';
import { createPrepareCheck } from './checks/prepare';
import { createResolveTargetCheck } from './checks/resolveTarget';
import { createServerFactsCheck } from './checks/serverFacts';
import { buildDiagnosticsSetup, unresolvedDiagnosticsInput, type DiagnosticsSetup } from './input';
import { connectionOutcome, DiagnosticsOutputTrace } from './outputTrace';
import {
    applyCheckTelemetry,
    applyCompletedRunTelemetry,
    applyRunIdentity,
    configureDiagnosticsTelemetry,
    maskDiagnosticsInput,
    reportRunStarted,
} from './telemetry';
import { type FindingCode, type DiagnosticsEntryPoint, type DiagnosticsTarget } from './types';

export interface RunConnectionDiagnosticsOptions {
    readonly runId?: string;
    readonly target: DiagnosticsTarget;
    readonly entryPoint: DiagnosticsEntryPoint;
    readonly runTrigger: 'initial' | 'rerun';
    readonly runIndex: number;
    readonly troubleshooterSessionId: string;
    readonly timeoutProfile: TimeoutProfile;
    readonly signal: AbortSignal;
    readonly onEvent?: (event: DiagnosticsEvent<FindingCode>) => void;
    readonly extraChecks?: readonly Check<RunContext, FindingCode>[];
    /** Offline test seam; normal runs use the package defaults. */
    readonly io?: Partial<DiagnosticsIo>;
    readonly cancelReason?: () => 'cancelButton' | 'panelClosed' | 'rerun' | 'subscriptionClosed';
}

interface DiagnosticsCheckInputs {
    readonly target: DiagnosticsTarget;
    readonly getSetup: () => DiagnosticsSetup;
    readonly peekSetup: () => DiagnosticsSetup | undefined;
    readonly onResolved: (credentials: EphemeralClusterCredentials) => void;
    readonly onResolutionFailed: (error: unknown) => void;
    readonly getResolutionError: () => unknown;
    readonly getTelemetryProperties: () => ITelemetryContext['properties'];
    readonly getRunOwnedClient: () => RunOwnedClient;
}

/**
 * The runner starts before the target is resolved, so checks read the resolved input through this
 * overlay; until `resolveTarget` passes they see the unresolved placeholder.
 */
function withResolvedInput(
    check: Check<RunContext, FindingCode>,
    peekSetup: () => DiagnosticsSetup | undefined,
): Check<RunContext, FindingCode> {
    return {
        ...check,
        run(context, signal): Promise<CheckOutcome<FindingCode>> {
            const resolved = Object.create(context, {
                input: { get: (): DiagnosticsInput => peekSetup()?.input ?? context.input },
            }) as RunContext;
            return check.run(resolved, signal);
        },
    };
}

function buildDiagnosticsChecks(
    {
        target,
        getSetup,
        peekSetup,
        onResolved,
        onResolutionFailed,
        getResolutionError,
        getTelemetryProperties,
        getRunOwnedClient,
    }: DiagnosticsCheckInputs,
    extraChecks: readonly Check<RunContext, FindingCode>[] = [],
): readonly Check<RunContext, FindingCode>[] {
    const checks: Check<RunContext, FindingCode>[] = [];
    for (const check of createBuiltInChecks()) {
        if (check.id === 'connectionString') {
            // The target is read inside the run, before the connection string it supplies is checked.
            checks.push(createResolveTargetCheck(target, onResolved, onResolutionFailed));
        }
        // Probes require the prepared endpoint, even though the package has no preparation check.
        let dependsOn = check.dependsOn;
        if (check.id === 'srv' || check.id === 'dns') {
            dependsOn = [...(check.dependsOn ?? []), 'prepare'];
        } else if (check.id === 'connectionString') {
            dependsOn = [...(check.dependsOn ?? []), 'resolveTarget'];
        }
        const ordered = dependsOn === check.dependsOn ? check : { ...check, dependsOn };
        checks.push(check.id === 'dns' ? withMixedHostDomainsWarning(ordered, peekSetup) : ordered);
        if (check.id === 'environment') {
            checks.push(createExtensionEnvironmentCheck());
        }
        if (check.id === 'connectionString') {
            checks.push(createCredentialsCheck(getSetup), createPrepareCheck(target, getSetup));
        }
        if (check.id === 'hello') {
            checks.push(createAuthenticateCheck(target, getSetup, getTelemetryProperties, getRunOwnedClient));
        }
    }
    checks.push(createConnectionAccessCheck(getRunOwnedClient), createServerFactsCheck(getSetup, getRunOwnedClient));
    checks.push(createContextHintsCheck(target, peekSetup, getRunOwnedClient, [...checks], getResolutionError));
    checks.push(...extraChecks);
    return checks.map((check): Check<RunContext, FindingCode> => withResolvedInput(check, peekSetup));
}

export function getPlannedDiagnosticsChecks(
    extraChecks?: readonly Check<RunContext, FindingCode>[],
): readonly { id: string; scope: 'run' | 'host' }[] {
    // Check factories are offline; planning never resolves credentials or executes a check.
    const unavailable = (): never => {
        throw new Error('Planned checks cannot be executed');
    };
    const target: DiagnosticsTarget = {
        get clusterId(): string {
            return unavailable();
        },
        get displayName(): string {
            return unavailable();
        },
        get sourceView(): string {
            return unavailable();
        },
        getCredentials: unavailable,
    };
    return buildDiagnosticsChecks(
        {
            target,
            getSetup: unavailable,
            peekSetup: unavailable,
            onResolved: unavailable,
            onResolutionFailed: unavailable,
            getResolutionError: unavailable,
            getTelemetryProperties: unavailable,
            getRunOwnedClient: unavailable,
        },
        extraChecks,
    ).map(({ id, scope }): { id: string; scope: 'run' | 'host' } => ({ id, scope }));
}

export async function runConnectionDiagnostics(
    options: RunConnectionDiagnosticsOptions,
): Promise<DiagnosticsRun<FindingCode>> {
    const runId = options.runId ?? randomUUID();
    await reportRunStarted(options, runId);
    const trace = new DiagnosticsOutputTrace(runId);
    trace.started(options.entryPoint, options.runTrigger, options.timeoutProfile);
    const result = await callWithTelemetryAndErrorHandling(
        'connectivityTroubleshooter.run',
        async (context): Promise<DiagnosticsRun<FindingCode>> => {
            configureDiagnosticsTelemetry(context);
            applyRunIdentity(context, options, runId);
            const activeChecks = new Map<string, string>();
            const completed: CheckResult<FindingCode>[] = [];
            const hosts = new Set<string>();
            let setup: DiagnosticsSetup | null = null;
            let resolutionError: unknown;
            // Host-only, per run; dropped with the setup. The runner's cleanup closes its client.
            let runOwnedClient: RunOwnedClient | null = null;
            let terminal = false;
            const getSetup = (): DiagnosticsSetup => {
                if (!setup) {
                    throw new Error('Diagnosis setup unavailable');
                }
                return setup;
            };
            const getRunOwnedClient = (): RunOwnedClient => {
                if (!runOwnedClient) {
                    throw new Error('Diagnosis run client unavailable');
                }
                return runOwnedClient;
            };
            try {
                context.telemetry.properties.remoteKind = getDiagnosticsRemoteKind();
                if (options.signal.aborted) {
                    throw new UserCancelledError();
                }
                const target: DiagnosticsTarget = {
                    clusterId: options.target.clusterId,
                    displayName: options.target.displayName,
                    sourceView: options.target.sourceView,
                    async getCredentials(read): Promise<EphemeralClusterCredentials | undefined> {
                        const credentials = await options.target.getCredentials(read);
                        const cached = CredentialCache.getCredentials(options.target.clusterId);
                        if (credentials) {
                            maskDiagnosticsInput(
                                context,
                                credentials.connectionString,
                                credentials.nativeAuthConfig?.connectionPassword,
                            );
                        }
                        if (cached) {
                            maskDiagnosticsInput(
                                context,
                                cached.connectionString,
                                cached.nativeAuthConfig?.connectionPassword,
                            );
                        }
                        return credentials;
                    },
                };
                context.telemetry.properties.authMethod = 'none';
                runOwnedClient = createRunOwnedClient();
                const checks = buildDiagnosticsChecks(
                    {
                        target,
                        getSetup,
                        peekSetup: (): DiagnosticsSetup | undefined => setup ?? undefined,
                        onResolved(credentials): void {
                            // A read that settles after the run ended or was cancelled is discarded.
                            if (terminal || options.signal.aborted) {
                                return;
                            }
                            setup = buildDiagnosticsSetup(options.target.clusterId, credentials);
                            maskDiagnosticsInput(
                                context,
                                setup.input.connectionString,
                                setup.transientCredentials?.nativeAuthConfig?.connectionPassword,
                            );
                            context.telemetry.properties.authMethod = setup.chosenAuthMethod ?? 'none';
                        },
                        onResolutionFailed(error): void {
                            resolutionError =
                                error instanceof ConnectionSourceUnavailableError && error.sourceError !== undefined
                                    ? error.sourceError
                                    : error;
                        },
                        getResolutionError: (): unknown => resolutionError,
                        getTelemetryProperties: (): ITelemetryContext['properties'] => context.telemetry.properties,
                        getRunOwnedClient,
                    },
                    options.extraChecks,
                );
                const run = await runDiagnostics<FindingCode>({
                    runId,
                    input: unresolvedDiagnosticsInput(),
                    checks,
                    io: options.io,
                    timeoutProfile: options.timeoutProfile,
                    signal: options.signal,
                    onEvent(event): void {
                        if (terminal || options.signal.aborted) {
                            return;
                        }
                        if (event.type === 'checkStarted') {
                            activeChecks.set(JSON.stringify([event.checkId, event.target]), event.checkId);
                            if (event.target !== undefined) {
                                hosts.add(event.target);
                            }
                        } else if (event.type === 'checkFinished') {
                            activeChecks.delete(JSON.stringify([event.result.checkId, event.result.target]));
                            completed.push(event.result);
                        }
                        trace.onEvent(event);
                        try {
                            options.onEvent?.(event);
                        } catch {
                            // Observers cannot interrupt the run.
                        }
                    },
                });
                if (options.signal.aborted) {
                    throw new UserCancelledError();
                }
                applyCompletedRunTelemetry(context, run);
                trace.finished(connectionOutcome(run));
                return run;
            } catch (error) {
                applyCheckTelemetry(context, completed, hosts.size);
                if (
                    options.signal.aborted ||
                    error instanceof DiagnosticsCancelledError ||
                    error instanceof UserCancelledError
                ) {
                    context.telemetry.properties.cancelReason = options.cancelReason?.() ?? 'subscriptionClosed';
                    context.telemetry.properties.activeChecks = [...new Set(activeChecks.values())].sort().join(',');
                    trace.cancelled();
                    throw new UserCancelledError();
                }
                trace.failed(error);
                throw error;
            } finally {
                terminal = true;
                setup = null;
                resolutionError = undefined;
                runOwnedClient = null;
            }
        },
    );
    return nonNullValue(result, 'run', 'runConnectionDiagnostics.ts');
}
