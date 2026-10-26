/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError } from '@microsoft/vscode-azext-utils';
import { type MongoClient } from 'mongodb';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { ConnectionDiagnosticsService } from '../../../services/connectionDiagnosticsService';
import { type AuthTraceContext } from '../../../utils/authTrace';
import { type CachedClusterCredentials } from '../../CredentialCache';
import { type ResolvedTokenResource } from '../documentdbTokenResource';
import {
    formatPreviewReport,
    previewBody,
    previewTitle,
    type PreviewProbe,
    type PreviewReport,
    type PreviewSurface,
} from './report';

export const PREVIEW_DIAGNOSTICS_ENABLED = true;

interface Attempt {
    readonly resolved: ResolvedTokenResource;
    tokenSucceeded: boolean;
}

const shown = new Set<string>();
const attempts = new Map<string, Attempt>();

function attemptKey(clusterId: string, surface: PreviewSurface, context?: AuthTraceContext): string {
    return JSON.stringify([clusterId, surface, context?.startupCorrelationId]);
}

function logPreviewFailure(): void {
    try {
        ext.outputChannel.error(
            vscode.l10n.t('[Preview diagnostics] Diagnostic UI or probe failed; connection behavior is unchanged.'),
        );
    } catch {
        // Logging itself must not affect authentication.
    }
}

function reportContext(surface: PreviewSurface, context?: AuthTraceContext): Omit<PreviewReport, 'step'> {
    const packageJSON: unknown = ext.context?.extension?.packageJSON;
    const extensionVersion =
        packageJSON && typeof packageJSON === 'object' && 'version' in packageJSON ? packageJSON.version : undefined;
    return {
        surface,
        extensionVersion,
        vscodeVersion: vscode.version,
        platform: process.platform,
        arch: process.arch,
        timestamp: new Date().toISOString(),
        startupCorrelationId: context?.startupCorrelationId,
    };
}

export async function showPreviewDialog(
    clusterId: string,
    report: PreviewReport,
    blocking: boolean,
    cancellable = false,
): Promise<void> {
    if (!PREVIEW_DIAGNOSTICS_ENABLED) {
        return;
    }
    const key = JSON.stringify([clusterId, report.surface, report.step]);
    if (shown.has(key)) {
        return;
    }
    shown.add(key);
    const run = async (): Promise<boolean> => {
        try {
            const proceed = report.step === 3 ? vscode.l10n.t('Done') : vscode.l10n.t('Continue');
            const copy = vscode.l10n.t('Copy report');
            for (;;) {
                const choice = await vscode.window.showInformationMessage(
                    vscode.l10n.t('Preview build: connection check {0} of 3: {1}', report.step, previewTitle(report)),
                    { modal: true, detail: previewBody(report) },
                    proceed,
                    copy,
                );
                if (choice !== copy) {
                    return blocking && cancellable && choice !== proceed;
                }
                try {
                    await vscode.env.clipboard.writeText(formatPreviewReport(report));
                    void Promise.resolve(vscode.window.showInformationMessage(vscode.l10n.t('Report copied.'))).catch(
                        logPreviewFailure,
                    );
                } catch {
                    logPreviewFailure();
                }
            }
        } catch {
            logPreviewFailure();
            return false;
        }
    };
    const pending = run();
    if (!blocking) {
        void pending.catch(logPreviewFailure);
        return;
    }
    if (await pending) {
        throw new UserCancelledError('previewDiagnostics');
    }
}

export async function previewResolve(
    credentials: CachedClusterCredentials,
    surface: PreviewSurface,
    context: AuthTraceContext | undefined,
    resolve: () => Promise<ResolvedTokenResource>,
    managedIdentity = false,
): Promise<ResolvedTokenResource> {
    if (!PREVIEW_DIAGNOSTICS_ENABLED) {
        return resolve();
    }
    const key = attemptKey(credentials.clusterId, surface, context);
    attempts.delete(key);
    let resolved: ResolvedTokenResource;
    try {
        resolved = await resolve();
    } catch (error) {
        try {
            const dialog = showPreviewDialog(
                credentials.clusterId,
                {
                    ...reportContext(surface, context),
                    step: 1,
                    error,
                    managedIdentity,
                    userAssigned: !!credentials.managedIdentityConfig?.clientId,
                },
                surface === 'extension',
            );
            if (surface === 'extension') {
                await dialog;
            } else {
                void dialog.catch(logPreviewFailure);
            }
        } catch {
            logPreviewFailure();
        }
        throw error;
    }
    attempts.set(key, { resolved, tokenSucceeded: false });
    try {
        const dialog = showPreviewDialog(
            credentials.clusterId,
            {
                ...reportContext(surface, context),
                step: 1,
                resolved,
                managedIdentity,
                userAssigned: !!credentials.managedIdentityConfig?.clientId,
            },
            surface === 'extension',
            true,
        );
        if (surface === 'extension') {
            await dialog;
        } else {
            void dialog.catch(logPreviewFailure);
        }
    } catch (error) {
        if (error instanceof UserCancelledError) {
            attempts.delete(key);
            throw error;
        }
        logPreviewFailure();
    }
    return resolved;
}

export async function previewAcquireToken<T>(
    clusterId: string,
    surface: PreviewSurface,
    context: AuthTraceContext | undefined,
    acquire: () => Promise<T>,
    tokenFromResult: (result: T) => string | undefined,
    tenantId?: string,
    managedIdentity = false,
): Promise<T> {
    if (!PREVIEW_DIAGNOSTICS_ENABLED) {
        return acquire();
    }
    const attempt = attempts.get(attemptKey(clusterId, surface, context));
    const started = Date.now();
    let result: T;
    try {
        result = await acquire();
    } catch (error) {
        if (attempt) {
            attempt.tokenSucceeded = false;
            try {
                const dialog = showPreviewDialog(
                    clusterId,
                    {
                        ...reportContext(surface, context),
                        step: 2,
                        resolved: attempt.resolved,
                        error,
                        elapsedMs: Date.now() - started,
                    },
                    surface === 'extension' && !managedIdentity,
                );
                if (surface === 'extension' && !managedIdentity) {
                    await dialog;
                } else {
                    void dialog.catch(logPreviewFailure);
                }
            } catch {
                logPreviewFailure();
            }
        }
        throw error;
    }
    if (attempt) {
        try {
            const token = tokenFromResult(result);
            attempt.tokenSucceeded = !!token;
            const dialog = showPreviewDialog(
                clusterId,
                {
                    ...reportContext(surface, context),
                    step: 2,
                    resolved: attempt.resolved,
                    token,
                    tenantId,
                    managedIdentity,
                    elapsedMs: Date.now() - started,
                    error: token ? undefined : new Error(),
                },
                surface === 'extension' && !managedIdentity,
            );
            if (surface === 'extension' && !managedIdentity) {
                await dialog;
            } else {
                void dialog.catch(logPreviewFailure);
            }
        } catch {
            logPreviewFailure();
        }
    }
    return result;
}

export async function runPostConnectProbes(client: Pick<MongoClient, 'db'>): Promise<readonly PreviewProbe[]> {
    const rows: PreviewProbe[] = [];
    const probes = [
        { probe: 'ping', command: { ping: 1, maxTimeMS: 5_000 } },
        { probe: 'listDatabases', command: { listDatabases: 1, nameOnly: true, maxTimeMS: 5_000 } },
        { probe: 'connectionStatus', command: { connectionStatus: 1, maxTimeMS: 5_000 } },
    ] as const;
    for (const [index, probe] of probes.entries()) {
        try {
            const result = await client.db('admin').command(probe.command, { timeoutMS: 5_000 });
            let count: number | undefined;
            if (index === 1 && Array.isArray(result.databases)) {
                count = result.databases.length;
            }
            if (index === 2) {
                const authInfo: unknown = result.authInfo;
                if (
                    authInfo &&
                    typeof authInfo === 'object' &&
                    'authenticatedUserRoles' in authInfo &&
                    Array.isArray(authInfo.authenticatedUserRoles)
                ) {
                    count = authInfo.authenticatedUserRoles.length;
                }
            }
            rows.push({ probe: probe.probe, ok: true, count });
        } catch (error) {
            rows.push({ probe: probe.probe, ok: false, error });
        }
    }
    return rows;
}

export async function previewConnectionResult(
    clusterId: string,
    context: AuthTraceContext,
    client: MongoClient,
    elapsedMs: number,
    error?: unknown,
): Promise<void> {
    if (!PREVIEW_DIAGNOSTICS_ENABLED) {
        return;
    }
    try {
        const attempt = attempts.get(attemptKey(clusterId, 'extension', context));
        const key = JSON.stringify([clusterId, 'extension', 3]);
        if (!attempt?.tokenSucceeded || shown.has(key)) {
            return;
        }
        const probes = error ? undefined : await runPostConnectProbes(client);
        const diagnosis = error ? await ConnectionDiagnosticsService.explain({ clusterId, error }) : undefined;
        await showPreviewDialog(
            clusterId,
            {
                ...reportContext('extension', context),
                step: 3,
                resolved: attempt.resolved,
                elapsedMs,
                error,
                probes,
                diagnosis,
            },
            true,
        );
    } catch {
        logPreviewFailure();
    }
}

export function resetPreviewDiagnosticsForTests(): void {
    shown.clear();
    attempts.clear();
}
