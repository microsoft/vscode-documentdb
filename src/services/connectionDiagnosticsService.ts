/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Translates a failed database operation into an explanation the user can act on, when the cause
 * is infrastructure that a provider owns: a container that is no longer running, a port-forward
 * tunnel that is no longer up, a TLS handshake the service closed.
 *
 * ## What this is NOT
 *
 * This is a TRANSLATION layer, not a recovery layer. Providers registered here must never:
 *
 * - show a dialog, notification, progress indicator, or any other UI;
 * - start, stop, restart, or repair anything;
 * - retry the operation that failed, or ask the caller to retry it;
 * - prompt the user for input.
 *
 * They receive an error and return text. Nothing else.
 *
 * The reason is that one user action often runs several database commands, several actions can
 * fail at once, and many of these calls happen on background paths. A provider that shows UI or
 * repairs state would produce duplicate dialogs, dialogs the user never asked for, and errors that
 * are already obsolete by the time they are displayed. Keeping providers text-only makes all of
 * those failure modes impossible by construction.
 *
 * Anything with a side effect belongs at the CALL SITE, because only the call site knows whether
 * the user is watching, whether the operation was a read or a write, and which surface (modal,
 * toast, tree node, terminal line) is appropriate.
 *
 * ## The error is never touched
 *
 * {@link ConnectionDiagnosticsServiceImpl.explain} returns text and nothing more. It never mutates
 * the error, never replaces it, and never attaches properties to it. That is deliberate: a lot of
 * code in this repository inspects errors by IDENTITY rather than by text, and all of it would
 * break in ways that are hard to notice.
 *
 * - `instanceof UserCancelledError` decides whether an outcome is a failure or a cancellation;
 * - `instanceof QueryError`, `MongoBulkWriteError` and `SettingsHintError` change how a failure is
 *   handled;
 * - `error.code` is read for server codes (115, 235) and socket codes (ECONNRESET, ENOTFOUND);
 * - `errorCodeExtractor.ts` reads `error.cause.cause.code` at a FIXED depth, so an extra wrapper
 *   level would silently break Collection view error-code detection;
 * - `extractErrorCode()` parses a `[CODE-12345]` prefix from the START of a message, so prepending
 *   text would break the shell and the playground;
 * - the tRPC boundary rebuilds errors as `{ code, name, message, stack, cause }`, so a custom
 *   property would not reach a webview anyway.
 *
 * Leaving the error alone means there is exactly one rule to remember, and it is not a protocol
 * about error objects: if you render a database failure, ask {@link explain} first.
 *
 * ## Relationship to ConnectionReachabilityService
 *
 * {@link import('./connectionReachabilityService').ConnectionReachabilityService} PREPARES a
 * connection before we connect. This service EXPLAINS a failure afterwards. They are deliberately
 * separate: `ensureReachable` runs on every connect attempt and must stay silent and cheap, while
 * `explain` runs only on failure paths and is allowed a small amount of I/O.
 *
 * @see .github/skills/error-translation/SKILL.md
 */

import { callWithTelemetryAndErrorHandling, UserCancelledError } from '@microsoft/vscode-azext-utils';
import { ext } from '../extensionVariables';

export interface ConnectionDiagnosticsRequest {
    /**
     * The stable cluster identifier, never a `treeId`. This is the only identity that reaches
     * every call site (tree items, webviews, the shell, the playground), which is why it is the
     * sole key providers get to work with.
     */
    readonly clusterId: string;

    /**
     * The error the database operation failed with.
     *
     * Usually an `Error`, but a webview can only send the MESSAGE across the tRPC boundary, so this
     * is a plain `string` on that path. A provider that needs an error's class or `code` therefore
     * cannot be served from a webview.
     */
    readonly error: unknown;
}

/**
 * Turns an infrastructure-caused failure into an explanation.
 *
 * Implementations MUST NOT show UI, recover, or retry. See the file header: this interface exists
 * only to translate errors so users understand what went wrong.
 */
export interface ConnectionDiagnosticsProvider {
    /** Stable identifier. Internal only; used for telemetry and de-duplicated registration. */
    readonly id: string;

    /**
     * Returns a localized explanation, or `undefined` when this provider does not own the cluster,
     * or owns it and sees nothing wrong. `undefined` means "the caller should show the original
     * error unchanged", so returning it is always the safe answer.
     *
     * Implementations should answer the cheap question first (do I own this cluster? does the
     * error even look like mine?) so the common case costs close to nothing.
     */
    explain(request: ConnectionDiagnosticsRequest): Promise<string | undefined>;
}

export interface ConnectionDiagnosis {
    readonly providerId: string;
    readonly message: string;
}

/**
 * Budget for one {@link ConnectionDiagnosticsServiceImpl.explain} call, not per provider: the user
 * is already waiting for an error, so the wait must not grow with the number of registered sources.
 * On expiry we fall back to the original error, which is always a valid outcome.
 */
const EXPLAIN_DEADLINE_MS = 5_000;

/**
 * Registry of {@link ConnectionDiagnosticsProvider}s.
 *
 * Mirrors the singleton-registry pattern used by `ConnectionReachabilityService`, `DiscoveryService`
 * and `MigrationService`: providers are registered once at activation, and call sites simply ask
 * "can anyone explain this failure?" without knowing which sources exist.
 *
 * This class cannot be instantiated directly; use the exported {@link ConnectionDiagnosticsService}
 * singleton instead.
 */
class ConnectionDiagnosticsServiceImpl {
    private readonly providers: ConnectionDiagnosticsProvider[] = [];

    /**
     * Registers a diagnostics provider. A provider with an id that is already registered replaces
     * the existing one (last registration wins), which keeps re-activation idempotent.
     */
    public registerProvider(provider: ConnectionDiagnosticsProvider): void {
        const existingIndex = this.providers.findIndex((candidate) => candidate.id === provider.id);
        if (existingIndex >= 0) {
            this.providers[existingIndex] = provider;
        } else {
            this.providers.push(provider);
        }
    }

    /**
     * Asks every registered provider, in registration order, until one returns an explanation.
     *
     * Never throws and never rejects: a provider that fails or stalls is skipped so the caller can
     * still report the original error. Callers are expected to invoke this only from foreground
     * paths; background work (tree count badges, prefetches) shows nothing, so translating there
     * would cost I/O for no user-visible benefit.
     */
    public async explain(request: ConnectionDiagnosticsRequest): Promise<ConnectionDiagnosis | undefined> {
        // Guarded centrally rather than per provider: a provider is allowed to answer without
        // inspecting the error at all, so without this a cancelled wizard on a stopped container
        // would be reported as an infrastructure failure.
        if (request.error instanceof UserCancelledError) {
            return undefined;
        }

        return withDeadline(this.askProviders(request));
    }

    private async askProviders(request: ConnectionDiagnosticsRequest): Promise<ConnectionDiagnosis | undefined> {
        for (const provider of this.providers) {
            let message: string | undefined;

            try {
                message = await provider.explain(request);
            } catch (error) {
                const detail = error instanceof Error ? error.message : String(error);
                ext.outputChannel?.debug(`[ConnectionDiagnostics] Provider "${provider.id}" failed: ${detail}`);
                continue;
            }

            if (message) {
                void callWithTelemetryAndErrorHandling('connectionDiagnostics.explained', (context) => {
                    context.telemetry.properties.diagnosisProviderId = provider.id;
                });
                return { providerId: provider.id, message };
            }
        }

        return undefined;
    }

    /**
     * Test-only: clears all registered providers so suites start from a known state.
     */
    public resetForTests(): void {
        this.providers.length = 0;
    }
}

async function withDeadline<T>(work: Promise<T>): Promise<T | undefined> {
    let timer: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([
            work,
            new Promise<undefined>((resolve) => {
                timer = setTimeout(() => resolve(undefined), EXPLAIN_DEADLINE_MS);
            }),
        ]);
    } finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
}

export const ConnectionDiagnosticsService = new ConnectionDiagnosticsServiceImpl();
