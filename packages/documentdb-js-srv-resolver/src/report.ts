/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type SrvResolutionPath = 'node' | 'fallback' | 'nodeErrorPassthrough';
export type SrvFallbackMode = 'auto' | 'off' | 'force';
export type SrvFallbackOutcome = 'succeeded' | 'failed' | 'notAttempted' | 'disabled';

export interface SrvResolutionReport {
    /** Local use only; never send the host or DNS server addresses to telemetry. */
    readonly srvHost: string;
    readonly path: SrvResolutionPath;
    readonly outcome: 'succeeded' | 'failed' | 'cancelled';
    readonly nodeErrorCode: string;
    readonly fallbackOutcome: SrvFallbackOutcome;
    readonly fallbackErrorCode?: string;
    readonly fallbackTransport?: 'udp' | 'tcp';
    readonly txtSource?: 'fallback' | 'none';
    readonly dnsServers: readonly string[];
    readonly fallbackServersTried?: number;
    readonly srvTargetCount?: number;
    readonly nodeProbeDurationMs?: number;
    readonly fallbackDurationMs?: number;
    readonly forcedFallback: boolean;
    readonly aresVersion: string;
    readonly nodeRuntimeVersion: string;
}
