/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The diagnostic-intent read of a cluster node's connection details, used by connection
 * diagnostics (design §4.3, §5.3).
 *
 * A diagnostic read:
 *
 * - never shows a notification, warning, error dialog or "Report issue" prompt;
 * - never starts, reuses or repairs anything (no port-forward tunnel; the diagnostics `prepare`
 *   check owns that);
 * - never prompts, except where a node documents an accepted exception (the Azure VM port), and then
 *   only with a prompt the read's signal can dismiss;
 * - lets failures propagate as the typed errors below, so connection diagnostics can tell a deleted
 *   connection from a source it cannot reach.
 *
 * Ordinary connect, copy and save flows keep using `getCredentials()` and are unchanged.
 *
 * This module has no runtime dependencies so service helpers can throw its errors cheaply; the read
 * helper lives in `readCredentialsForDiagnostics.ts`.
 */

export interface DiagnosticCredentialRead {
    /**
     * Aborted when the diagnosis run is cancelled or its whole-run timeout expires. A read that
     * cannot stop its I/O is abandoned; it must check this signal before any side effect.
     */
    readonly signal: AbortSignal;
}

/** Where a node reads its connection details from. Bounded; safe for reports and telemetry. */
export type ConnectionDetailsSource = 'savedConnection' | 'azure' | 'kubernetes' | 'atlas' | 'other';

/** The source holding the connection details (Azure, the Kubernetes API, Atlas) could not be read. */
export class ConnectionSourceUnavailableError extends Error {
    constructor(
        public readonly source: ConnectionDetailsSource,
        /** The underlying failure. Never shown or reported verbatim; classified by its shape. */
        public readonly sourceError: unknown,
        /** Set when the source answered, but reported that the target cannot accept connections. */
        public readonly reason?: 'notConnectable',
    ) {
        super('Connection details source unavailable');
        this.name = 'ConnectionSourceUnavailableError';
    }
}

/** The source answered, but it has no endpoint the extension can connect to. */
export class ConnectionEndpointUnavailableError extends Error {
    constructor(
        public readonly source: ConnectionDetailsSource,
        public readonly reason: 'notProvided' | 'pending' | 'unreachable',
        message = 'Connection endpoint unavailable',
    ) {
        super(message);
        this.name = 'ConnectionEndpointUnavailableError';
    }
}

/** The user dismissed an accepted diagnostic prompt (the Azure VM port) without a value. */
export class ConnectionInputCancelledError extends Error {
    constructor(public readonly input: 'port') {
        super('Connection input cancelled');
        this.name = 'ConnectionInputCancelledError';
    }
}
