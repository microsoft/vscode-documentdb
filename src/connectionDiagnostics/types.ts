/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type BuiltInFindingCode } from '@documentdb-js/connection-diagnostics';
import {
    type DiagnosticClusterCredentials,
    type DiagnosticCredentialRead,
} from '../tree/documentdb/diagnosticCredentialRead';

export const extensionFindingCodes = [
    'env.remoteExtensionHost',
    'target.notFound',
    'target.inputCancelled',
    'target.sourceInaccessible',
    'target.endpointMissing',
    'cs.credentialsMissing',
    'prepare.localPortInUse',
    'prepare.failed',
    'prepare.sharedTunnel',
    'dns.mixedHostDomains',
    'hello.advertisedMembersUnreachable',
    'auth.failed',
    'auth.mechanismMismatch',
    'auth.credentialsUnavailable',
    'auth.serverSelectionTimeout',
    'auth.driverOptionsRejected',
    'auth.connectFailed',
    'auth.cloudMismatch',
    'auth.tokenResourceUnresolved',
    'auth.oidcHostNotAllowed',
    'auth.entraTokenFailed',
    'auth.entraAudienceMismatch',
    'auth.entraTenantMismatch',
    'access.listDatabasesDenied',
    'access.signInRequired',
    'access.noDatabasesVisible',
    'access.readRoleReported',
] as const;

export type ExtensionFindingCode = (typeof extensionFindingCodes)[number];
export type FindingCode = BuiltInFindingCode | ExtensionFindingCode;
export type DiagnosticsEntryPoint = 'errorNode' | 'contextMenu' | 'commandPalette';

/**
 * Existing telemetry IDs present when the panel opened, carried on every run event so a diagnosis
 * can be joined to the journey, the connected client, or the failed connection it follows up on.
 */
export interface DiagnosticsCorrelation {
    readonly journeyCorrelationId?: string;
    /** The connected extension client's ID (`connect.startup`, `connect.getmetadata`). */
    readonly connectionCorrelationId?: string;
    /** The `startupCorrelationId` of this cluster's last failed `connect.startup`. */
    readonly failedStartupCorrelationId?: string;
}

export interface DiagnosticsTarget {
    readonly clusterId: string;
    readonly displayName: string;
    readonly sourceView: string;
    readonly correlation?: DiagnosticsCorrelation;
    /**
     * The node's diagnostic read: silent, no tunnel, typed failures. Runs inside the `resolveTarget`
     * check, under the whole-run timeout and the run's cancellation. `undefined` means the connection
     * no longer exists.
     */
    getCredentials(read: DiagnosticCredentialRead): Promise<DiagnosticClusterCredentials | undefined>;
}
