/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DocumentDBEntraCloud } from '../documentdb/auth/entraScopes';

export interface EnvRemoteExtensionHostData {
    readonly remoteKind: string;
}

export interface TargetNotFoundData {
    readonly source: 'savedConnection' | 'azure' | 'kubernetes' | 'atlas' | 'other';
    readonly errorName?: string;
    readonly statusCode?: number;
}

export interface TargetInputCancelledData {
    readonly input: 'port';
}

export interface TargetSourceInaccessibleData {
    readonly source: 'savedConnection' | 'azure' | 'kubernetes' | 'atlas' | 'other';
    readonly reason: 'signInRequired' | 'accessDenied' | 'unreachable' | 'notConnectable' | 'other';
    readonly errorName?: string;
    readonly statusCode?: number;
}

export interface TargetEndpointMissingData {
    readonly source: 'savedConnection' | 'azure' | 'kubernetes' | 'atlas' | 'other';
    readonly reason: 'notProvided' | 'pending' | 'unreachable';
}

export interface PrepareLocalPortInUseData {
    readonly localPort: number;
    readonly holder: 'otherProgram' | 'otherTunnel';
}

export interface PrepareSharedTunnelData {
    readonly tunnel: 'started' | 'reused' | 'externalAssumed';
}

export interface CsCredentialsMissingData {
    readonly missing: 'method' | 'password';
    readonly authMethod?: string;
}

/** Counts and cloud enums only: host names never enter finding data. */
export interface DnsMixedHostDomainsData {
    readonly kind: 'crossCloud' | 'unrecognizedHosts';
    readonly clouds: readonly DocumentDBEntraCloud[];
    readonly builtInHostCount: number;
    readonly customHostCount: number;
    readonly otherHostCount: number;
    readonly customSuffixConfigured: boolean;
}

export interface HelloAdvertisedMembersUnreachableData {
    readonly unreachableCount: number;
}

export interface AuthFailedData {
    readonly authMethod: string;
    readonly serverCode?: number;
    readonly serverCodeName?: string;
}

export interface AuthMechanismMismatchData {
    readonly requested?: string;
    readonly offered?: readonly string[];
}

export interface AuthCredentialsUnavailableData {
    readonly missing: 'method' | 'password' | 'entraSession';
    readonly authMethod?: string;
}

export interface AuthServerSelectionTimeoutData {
    readonly timeoutMs?: number;
    readonly timeoutSource?: 'extensionPolicy' | 'connection' | 'driverDefault';
    readonly serverErrorCount: number;
}

export interface AuthDriverOptionsRejectedData {
    readonly errorName: string;
}

export interface AuthConnectFailedData {
    readonly errorName: string;
    readonly phase?: 'configure' | 'construct' | 'connect';
}

export interface AuthCloudMismatchData {
    readonly configuredCloud: string;
    readonly hostCloud: string;
}

export interface AuthTokenResourceUnresolvedData {
    readonly kind: string;
}

export type AuthOidcHostNotAllowedData = Readonly<Record<string, never>>;

export interface AuthEntraTokenFailedData {
    readonly ruleId: string;
    readonly aadstsCode?: string;
}

export type AuthEntraAudienceMismatchData = Readonly<Record<string, never>>;

export type AuthEntraTenantMismatchData = Readonly<Record<string, never>>;

export interface AccessListDatabasesDeniedData {
    readonly codeName?: string;
}

/** The connection uses No authentication and the server refused this command until sign-in. */
export interface AccessSignInRequiredData {
    readonly command: 'listDatabases';
}

export type AccessNoDatabasesVisibleData = Readonly<Record<string, never>>;

export interface AccessReadRoleReportedData {
    readonly role: string;
    readonly database: string;
}
