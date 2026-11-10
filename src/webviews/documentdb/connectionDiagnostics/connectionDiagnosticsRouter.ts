/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    buildReport,
    redactReport,
    renderJson,
    renderMarkdown,
    type CheckResult,
    type DiagnosticsReport,
    type DiagnosticsRun,
    type ReportSummary,
} from '@documentdb-js/connection-diagnostics';
import { UserCancelledError } from '@microsoft/vscode-azext-utils';
import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import { z } from 'zod';
import { getDiagnosticsRemoteKind } from '../../../connectionDiagnostics/checks/extensionEnvironment';
import { describeFinding } from '../../../connectionDiagnostics/findingMessages';
import { diagnosticsIdentifierKeys } from '../../../connectionDiagnostics/identifierKeys';
import { withRowDetails } from '../../../connectionDiagnostics/panelDetails';
import { PanelRowProjector } from '../../../connectionDiagnostics/panelRows';
import {
    createExtensionReportAttribution,
    createExtensionReportText,
    renderExtensionReportFooter,
} from '../../../connectionDiagnostics/reportText';
import { deriveResult, type DiagnosticsResult } from '../../../connectionDiagnostics/result';
import {
    getPlannedDiagnosticsChecks,
    runConnectionDiagnostics,
} from '../../../connectionDiagnostics/runConnectionDiagnostics';
import { type FindingCode } from '../../../connectionDiagnostics/types';
import { readOnlyJsonDocumentProvider } from '../../../utils/readOnlyJsonDocumentProvider';
import { type BaseRouterContext } from '../../_integration/appRouter';
import { publicProcedure, publicProcedureWithTelemetry, router, type WithTelemetry } from '../../_integration/trpc';
import { type PanelEvent, type ResultCardData, type RunUpdate } from './connectionDiagnosticsTypes';
import { type DiagnosticsPanelSession } from './diagnosticsPanelSession';
import { type PanelRow } from './panelTypes';

export type RouterContext = BaseRouterContext & {
    session: DiagnosticsPanelSession;
};

const reportInput = z.object({ runId: z.string(), hideIdentifiers: z.boolean() });
/**
 * Copy and Save also carry the outcome of the webview's share warning (decision 0040), which it shows
 * through `common.confirm` before sharing a report with identifiers. Absent when it was not shown.
 * `cancelled` only records the outcome: the procedure then shares nothing.
 */
const shareInput = reportInput.extend({ shareWarningOutcome: z.enum(['continued', 'cancelled']).optional() });
/** Identifies the view's run subscription, so a Cancel can name the run it was meant for. */
const requestId = z.string().min(1);

function telemetryContext(ctx: unknown, runId?: string, correlateCurrentRun = true): WithTelemetry<RouterContext> {
    const myCtx = ctx as WithTelemetry<RouterContext>;
    myCtx.actionContext.telemetry.maskEntireErrorMessage = true;
    myCtx.actionContext.telemetry.properties.diagnosticsSessionId = myCtx.session.diagnosticsSessionId;
    const correlationId = runId ?? (correlateCurrentRun ? myCtx.session.runId : undefined);
    if (correlationId !== undefined) {
        myCtx.actionContext.telemetry.properties.diagnosticsRunCorrelationId = correlationId;
    }
    return myCtx;
}

function reportContext(ctx: unknown, input: z.infer<typeof reportInput>): WithTelemetry<RouterContext> {
    const myCtx = telemetryContext(ctx, input.runId);
    myCtx.actionContext.telemetry.properties.reportFormat = 'markdown';
    myCtx.actionContext.telemetry.properties.reportRedacted = input.hideIdentifiers ? 'true' : 'false';
    return myCtx;
}

/** Records the share warning; returns `true` when the user cancelled, so nothing may be shared. */
function shareCancelled(myCtx: WithTelemetry<RouterContext>, input: z.infer<typeof shareInput>): boolean {
    const telemetry = myCtx.actionContext.telemetry;
    telemetry.properties.shareWarning = input.shareWarningOutcome === undefined ? 'notShown' : 'shown';
    if (input.shareWarningOutcome !== undefined) {
        telemetry.properties.shareWarningOutcome = input.shareWarningOutcome;
    }
    if (input.shareWarningOutcome === 'cancelled') {
        // A choice, not a failure; nothing throws, so the wrapper would otherwise record success.
        telemetry.properties.result = 'Canceled';
        return true;
    }
    return false;
}

function completedReport(ctx: RouterContext, runId: string): DiagnosticsReport<FindingCode> {
    const snapshot = ctx.session.completedRun;
    if (!snapshot || snapshot.runId !== runId) {
        throw new Error(vscode.l10n.t('This report is no longer available. Run the diagnosis again.'));
    }
    return snapshot.report;
}

function markdown(report: DiagnosticsReport<FindingCode>, hideIdentifiers: boolean): string {
    const snapshot = hideIdentifiers ? redactReport(report) : report;
    const text = createExtensionReportText();
    const reportMarkdown = renderMarkdown(snapshot, {
        redact: false,
        text: {
            ...text,
            title: snapshot.connectionName
                ? vscode.l10n.t('Connection diagnostics – {0}', snapshot.connectionName)
                : text.title,
        },
    });
    return `${reportMarkdown.trimEnd()}\n\n${renderExtensionReportFooter()}\n`;
}

/** Refreshes in place without focusing the preview or reopening a closed tab (R11). */
function refreshReport(session: DiagnosticsPanelSession): boolean {
    const preview = session.reportPreview;
    return (
        preview?.uri !== undefined &&
        readOnlyJsonDocumentProvider.updateMarkdownDocument(
            preview.uri,
            markdown(preview.report, preview.hideIdentifiers),
        )
    );
}

function executionLocation(run: DiagnosticsRun<FindingCode>): string {
    const recordedKind = run.results.find((result): boolean => result.checkId === 'extensionEnvironment')?.facts
        .remoteKind;
    // A whole-run timeout can skip the environment check; the same offline detector still knows the host.
    const remoteKind = typeof recordedKind === 'string' ? recordedKind : getDiagnosticsRemoteKind();
    return remoteKind === 'local'
        ? vscode.l10n.t('Checks ran on this computer.')
        : vscode.l10n.t('Checks ran on the remote host ({0}), not this computer.', remoteKind);
}

function resultCardData(result: DiagnosticsResult): ResultCardData {
    const { headline, ...card } = result;
    if (!headline) {
        return card;
    }
    const { title, explanation, nextStep, target } = headline;
    return { ...card, headline: { title, explanation, nextStep, target } };
}

function cloudName(cloud: unknown): string {
    switch (cloud) {
        case 'AzureUSGovernment':
            return vscode.l10n.t('Azure US Government');
        case 'AzureChinaCloud':
            return vscode.l10n.t('Azure China');
        case 'custom':
            return vscode.l10n.t('Custom cloud');
        default:
            return vscode.l10n.t('Azure');
    }
}

function topologyName(topology: unknown): string | undefined {
    switch (topology) {
        case 'documentdbGateway':
            return vscode.l10n.t('DocumentDB gateway');
        case 'replicaSet':
            return vscode.l10n.t('Replica set');
        case 'shardedRouter':
            return vscode.l10n.t('Sharded cluster router');
        case 'loadBalanced':
            return vscode.l10n.t('Load balanced');
        case 'standalone':
            return vscode.l10n.t('Standalone server');
        default:
            return undefined;
    }
}

function reportSummary(run: DiagnosticsRun<FindingCode>, result: DiagnosticsResult): ReportSummary {
    const auth = run.results.find((check): boolean => check.checkId === 'authenticate');
    const configuration = auth?.steps?.find((step): boolean => step.stepId === 'auth.signInConfiguration')?.facts ?? {};
    const server = run.results.find((check): boolean => check.checkId === 'serverFacts')?.facts ?? {};
    const serverRows: { label: string; value: string }[] = [];
    const nextSteps: string[] = [];
    const notes: string[] = [];
    if (result.outcome === 'connected') {
        const line = result.serverLine;
        if (line?.engineVersion) {
            serverRows.push({ label: vscode.l10n.t('DocumentDB engine'), value: line.engineVersion });
        }
        if (line?.apiVersion) {
            serverRows.push({ label: vscode.l10n.t('API version'), value: line.apiVersion });
        }
        if (line?.serverVersion) {
            serverRows.push({ label: vscode.l10n.t('Server version'), value: line.serverVersion });
        }
        if (line?.host) {
            serverRows.push({ label: vscode.l10n.t('Server'), value: line.host });
        }
        const topology = topologyName(server.topology);
        if (topology) {
            serverRows.push({ label: vscode.l10n.t('Topology'), value: topology });
        }
        if (line?.pingMs !== undefined) {
            serverRows.push({ label: vscode.l10n.t('Ping round trip'), value: vscode.l10n.t('{0} ms', line.pingMs) });
        }
        let method: string | undefined;
        switch (auth?.facts.authMethod) {
            case 'NativeAuth':
                method = vscode.l10n.t('Username and password');
                break;
            case 'MicrosoftEntraID':
                method = vscode.l10n.t('Microsoft Entra ID · {0}', cloudName(configuration.configuredCloud));
                break;
            case 'ManagedIdentity':
                method = vscode.l10n.t(
                    'Managed identity · {0}',
                    cloudName(configuration.tokenResource ?? configuration.configuredCloud),
                );
                break;
            case 'NoAuth':
                method = vscode.l10n.t('No authentication');
                break;
        }
        if (method) {
            serverRows.push({ label: vscode.l10n.t('Authentication method'), value: method });
        }
        if (result.signInRequired && result.headline?.nextStep) {
            nextSteps.push(result.headline.nextStep);
        }
    } else {
        if (result.headline?.nextStep) {
            nextSteps.push(result.headline.nextStep);
        }
        if (result.providerHint) {
            nextSteps.push(result.providerHint);
        }
        const firewall = vscode.l10n.t(
            'A firewall or IP allowlist may be blocking this connection. Check access from the computer or remote host where these checks ran, including VPN and network rules.',
        );
        if (result.firewallHint && !nextSteps.some((step): boolean => step.includes(firewall))) {
            nextSteps.push(firewall);
        }
        if (result.runTimeoutBeforeAttempt) {
            nextSteps.push(
                vscode.l10n.t(
                    'The time limit for the whole run expired before the connection was attempted. Run the diagnosis again with longer or no diagnostic timeouts.',
                ),
            );
        }
        nextSteps.push(
            vscode.l10n.t(
                'When contacting support, share this report (use Hide identifiers in the report to replace host and identity details).',
            ),
        );
    }
    if (result.earlierSignInFailure) {
        const earlier = auth?.facts.earlierInSession;
        if (typeof earlier === 'object' && earlier !== null) {
            const evidence = earlier as Readonly<Record<string, unknown>>;
            const minutes = typeof evidence.ageSeconds === 'number' ? Math.round(evidence.ageSeconds / 60) : 0;
            notes.push(
                typeof evidence.ruleId === 'string'
                    ? vscode.l10n.t(
                          'Earlier in this session: a sign-in for this connection failed (rule {0}, {1} minutes ago).',
                          evidence.ruleId,
                          minutes,
                      )
                    : vscode.l10n.t(
                          'Earlier in this session: a sign-in for this connection failed ({0} minutes ago).',
                          minutes,
                      ),
            );
        }
    }
    if (auth?.facts.signInLimitation === 'silentLookupCannotDistinguishConsent') {
        const authenticationLog =
            configuration.cloudCategory && configuration.cloudCategory !== 'public'
                ? 'Microsoft Sovereign Cloud Authentication'
                : 'Microsoft Authentication';
        notes.push(
            vscode.l10n.t(
                'The silent sign-in lookup cannot distinguish not being signed in from a consent or preauthorization failure. Open Developer: Show Logs… → {0} to check the sign-in error.',
                authenticationLog,
            ),
        );
    }
    return {
        outcome: result.outcome,
        ...(result.headline
            ? {
                  headline: {
                      checkId: result.headline.checkId,
                      target: result.headline.target,
                      code: result.headline.code,
                  },
              }
            : {}),
        serverRows,
        nextSteps,
        location: executionLocation(run),
        notes,
    };
}

function defaultReportName(): string {
    const now = new Date();
    const pad = (value: number): string => String(value).padStart(2, '0');
    return `connection-diagnostics-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.md`;
}

export const connectionDiagnosticsRouter = router({
    run: publicProcedure
        .input(
            z.object({
                timeoutProfile: z.enum(['default', 'longer', 'noDiagnosticTimeouts']),
                trigger: z.enum(['initial', 'rerun']),
                requestId,
            }),
        )
        .subscription(async function* ({ ctx, input }): AsyncGenerator<RunUpdate, void, void> {
            const myCtx = ctx as RouterContext;
            const { session } = myCtx;
            const active = session.startRun(randomUUID(), input.requestId);
            const { runId, abortController, subject } = active;
            const startedAt = Date.now();
            const projector = new PanelRowProjector(describeFinding, getPlannedDiagnosticsChecks());
            const initialRows = projector.rows();
            // Every settled result so far: settled rows carry details built from them (WI-18 prototype).
            const results: CheckResult<FindingCode>[] = [];
            const liveRows = (): PanelRow[] => withRowDetails(projector.rows(), results, describeFinding);
            let publishedRows = JSON.stringify(initialRows);
            const updates: RunUpdate[] = [];
            let wake: (() => void) | undefined;
            let terminal = false;
            const publish = (update: RunUpdate): void => {
                updates.push(update);
                wake?.();
            };
            const isCurrent = (): boolean => session.currentRun === active;
            const onAbort = (): void => {
                if (terminal) {
                    return;
                }
                terminal = true;
                projector.cancel();
                updates.length = 0;
                publish({ type: 'cancelled', runId, rows: liveRows() });
            };
            const onSubscriptionClosed = (): void => active.abort('subscriptionClosed');
            abortController.signal.addEventListener('abort', onAbort, { once: true });
            myCtx.signal?.addEventListener('abort', onSubscriptionClosed, { once: true });
            if (myCtx.signal?.aborted) {
                onSubscriptionClosed();
            }
            if (abortController.signal.aborted) {
                onAbort();
            }

            const execute = async (): Promise<void> => {
                try {
                    const run = await runConnectionDiagnostics({
                        target: subject.target,
                        entryPoint: subject.entryPoint,
                        runId,
                        runTrigger: input.trigger,
                        runIndex: active.runIndex,
                        diagnosticsSessionId: session.diagnosticsSessionId,
                        timeoutProfile: input.timeoutProfile,
                        signal: abortController.signal,
                        cancelReason: (): typeof active.cancelReason => active.cancelReason,
                        onEvent(event): void {
                            if (terminal || !isCurrent() || event.runId !== runId) {
                                return;
                            }
                            if (event.type === 'checkFinished') {
                                results.push(event.result);
                            }
                            projector.apply(event);
                            const rows = liveRows();
                            const serialized = JSON.stringify(rows);
                            if (serialized !== publishedRows) {
                                publishedRows = serialized;
                                publish({ type: 'rows', runId, rows });
                            }
                        },
                    });
                    if (terminal || !isCurrent()) {
                        return;
                    }
                    projector.finish();
                    const result = deriveResult(run.results, describeFinding);
                    const { outcome } = result;
                    const report = buildReport(run, {
                        summary: reportSummary(run, result),
                        connectionName: subject.target.displayName,
                        identifierKeys: diagnosticsIdentifierKeys,
                    });
                    session.completedRun = { runId, report };
                    if (session.reportPreview) {
                        session.reportPreview.report = report;
                        refreshReport(session);
                    }
                    terminal = true;
                    publish({
                        type: 'finished',
                        runId,
                        finishedAt: run.finishedAt,
                        // The finished report's placeholders, so the panel and the shared report agree.
                        rows: withRowDetails(projector.rows(), report, describeFinding),
                        outcome,
                        result: resultCardData(result),
                        coverage: {
                            limited: run.coverage.limited,
                            retryWouldHelp: run.coverage.retryWouldHelp,
                            connectionTimeoutLimited: run.coverage.timedOut.some(
                                (operation): boolean => operation.source === 'connection',
                            ),
                        },
                    });
                } catch {
                    if (terminal || !isCurrent()) {
                        return;
                    }
                    terminal = true;
                    // A target that cannot be read is a finished run with a typed finding, not a failure.
                    publish({ type: 'failed', runId, reason: 'unexpected' });
                }
            };

            try {
                // The promise consumes late settlements even when cancellation ends this subscription first.
                void execute();
                yield { type: 'started', runId, startedAt, rows: initialRows };
                while (isCurrent()) {
                    const update = updates.shift();
                    if (update) {
                        yield update;
                    } else if (terminal) {
                        return;
                    } else {
                        await new Promise<void>((resolve): void => {
                            wake = resolve;
                        });
                        wake = undefined;
                    }
                }
            } finally {
                myCtx.signal?.removeEventListener('abort', onSubscriptionClosed);
                abortController.signal.removeEventListener('abort', onAbort);
                if (!terminal) {
                    active.abort('subscriptionClosed');
                }
                if (isCurrent()) {
                    session.currentRun = undefined;
                }
            }
        }),

    cancel: publicProcedureWithTelemetry.input(z.object({ requestId })).mutation(({ ctx, input }): void => {
        const cancelled = (ctx as RouterContext).session.cancel(input.requestId);
        // A stale or early Cancel belongs to no current run; do not correlate it with one.
        telemetryContext(ctx, cancelled?.runId, false);
    }),

    // A concrete acknowledgement avoids completing the webview transport without a result.
    showDiagnostics: publicProcedureWithTelemetry
        .input(reportInput)
        .mutation(async ({ ctx, input }): Promise<boolean> => {
            const myCtx = reportContext(ctx, input);
            const report = completedReport(myCtx, input.runId);
            const { session } = myCtx;
            let preview = session.reportPreview;
            while (preview) {
                preview.report = report;
                preview.hideIdentifiers = input.hideIdentifiers;
                await preview.opening;
                // Revalidate after an asynchronous open: a re-run may have replaced this snapshot.
                completedReport(myCtx, input.runId);
                if (session.reportPreview !== preview) {
                    preview = session.reportPreview;
                    continue;
                }
                if (refreshReport(session) && preview.uri) {
                    await readOnlyJsonDocumentProvider.revealMarkdownDocument(preview.uri);
                    return true;
                }
                break;
            }
            const title =
                session.reportNumber === 1
                    ? vscode.l10n.t('Connection diagnostics')
                    : vscode.l10n.t('Connection diagnostics ({0})', session.reportNumber);
            preview = {
                report,
                hideIdentifiers: input.hideIdentifiers,
                opening: readOnlyJsonDocumentProvider.openMarkdownDocument(
                    title,
                    markdown(report, input.hideIdentifiers),
                ),
            };
            session.reportPreview = preview;
            try {
                preview.uri = await preview.opening;
                // Toggles and completed runs can arrive while the preview command is opening.
                refreshReport(session);
                return true;
            } catch (error) {
                if (session.reportPreview === preview) {
                    session.reportPreview = undefined;
                }
                throw error;
            }
        }),

    setReportIdentifiers: publicProcedureWithTelemetry
        .input(reportInput)
        .mutation(async ({ ctx, input }): Promise<boolean> => {
            const myCtx = reportContext(ctx, input);
            if (myCtx.session.runId !== input.runId) {
                throw new Error(vscode.l10n.t('This report is no longer available. Run the diagnosis again.'));
            }
            const preview = myCtx.session.reportPreview;
            if (preview) {
                preview.hideIdentifiers = input.hideIdentifiers;
            }
            const refreshed = refreshReport(myCtx.session);
            myCtx.actionContext.telemetry.properties.reportLiveRefresh = refreshed ? 'true' : 'false';
            // Update in place without revealing: the user is still in the panel, on the toggle.
            return refreshed;
        }),

    copyReport: publicProcedureWithTelemetry.input(shareInput).mutation(async ({ ctx, input }): Promise<void> => {
        const myCtx = reportContext(ctx, input);
        if (shareCancelled(myCtx, input)) {
            return;
        }
        const report = completedReport(myCtx, input.runId);
        await vscode.env.clipboard.writeText(markdown(report, input.hideIdentifiers));
        void vscode.window.showInformationMessage(vscode.l10n.t('The report was copied to the clipboard.'));
    }),

    saveReport: publicProcedureWithTelemetry.input(shareInput).mutation(async ({ ctx, input }): Promise<void> => {
        const myCtx = reportContext(ctx, input);
        if (shareCancelled(myCtx, input)) {
            return;
        }
        const report = completedReport(myCtx, input.runId);
        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(defaultReportName()),
            filters: { [vscode.l10n.t('Markdown')]: ['md'], [vscode.l10n.t('JSON')]: ['json'] },
        });
        if (!uri) {
            throw new UserCancelledError();
        }
        const json = uri.path.toLowerCase().endsWith('.json');
        myCtx.actionContext.telemetry.properties.reportFormat = json ? 'json' : 'markdown';
        const content = json
            ? renderJson(report, {
                  redact: input.hideIdentifiers,
                  generatedBy: { ...createExtensionReportAttribution() },
              })
            : markdown(report, input.hideIdentifiers);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
    }),

    panelEvents: publicProcedure.subscription(async function* ({ ctx }): AsyncGenerator<PanelEvent, void, void> {
        const myCtx = ctx as RouterContext;
        yield* myCtx.session.events(myCtx.signal);
    }),
});
