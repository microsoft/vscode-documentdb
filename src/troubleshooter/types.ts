/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type BuiltInFindingCode } from '@documentdb-js/connectivity-troubleshooter';
import { type EphemeralClusterCredentials } from '../tree/documentdb/ClusterItemBase';
import { type DiagnosticCredentialRead } from '../tree/documentdb/diagnosticCredentialRead';

export const extensionFindingCodes = [
    'env.remoteExtensionHost',
    'target.notFound',
    'target.inputCancelled',
    'target.sourceInaccessible',
    'target.endpointMissing',
    'cs.credentialsMissing',
    'prepare.localPortInUse',
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
export type TroubleshooterEntryPoint = 'errorNode' | 'contextMenu' | 'commandPalette';

export interface TroubleshootTarget {
    readonly clusterId: string;
    readonly displayName: string;
    readonly sourceView: string;
    /**
     * The node's diagnostic read: silent, no tunnel, typed failures. Runs inside the `resolveTarget`
     * check, under the whole-run timeout and the run's cancellation. `undefined` means the connection
     * no longer exists.
     */
    getCredentials(read: DiagnosticCredentialRead): Promise<EphemeralClusterCredentials | undefined>;
}
