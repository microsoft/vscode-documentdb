/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type resolveSrvFallback, type resolveTxtFallback, type SrvFallbackMode } from '@documentdb-js/srv-resolver';
import { type SrvRecord } from 'node:dns';
import type * as net from 'node:net';
import type * as tls from 'node:tls';

import { type SkipReason } from './findingCodes.js';
import { type EffectiveTimeout, type TimeoutKind, type TimeoutProfile, type TimeoutSource } from './timeouts.js';

export type { SkipReason } from './findingCodes.js';

export type CheckStatus = 'pass' | 'warning' | 'fail' | 'skipped';

export type FindingSeverity = 'info' | 'warning' | 'error';

export type WireCompressor = 'zlib' | 'snappy' | 'zstd';

export interface FindingDetail {
    readonly language: 'en';
    readonly text: string;
}

export interface Finding<TCode extends string> {
    readonly code: TCode;
    readonly severity: FindingSeverity;
    readonly data?: Readonly<Record<string, unknown>>;
    readonly detail: FindingDetail;
}

export interface CheckStepResult<TCode extends string> {
    readonly stepId: string;
    readonly status: CheckStatus;
    readonly skippedBecause?: { readonly reason: SkipReason; readonly stepId?: string };
    readonly durationMs: number;
    readonly findings: readonly Finding<TCode>[];
    readonly facts: Readonly<Record<string, unknown>>;
}

export interface CheckResult<TCode extends string> {
    readonly checkId: string;
    readonly target?: string;
    readonly status: CheckStatus;
    readonly skippedBecause?: { readonly reason: SkipReason; readonly checkId?: string };
    readonly durationMs: number;
    readonly findings: readonly Finding<TCode>[];
    readonly facts: Readonly<Record<string, unknown>>;
    readonly steps?: readonly CheckStepResult<TCode>[];
}

export type CheckOutcome<TCode extends string> = Omit<CheckResult<TCode>, 'checkId' | 'durationMs'>;

export interface Check<TContext, TCode extends string> {
    readonly id: string;
    readonly scope: 'run' | 'host';
    readonly dependsOn?: readonly string[];
    readonly timeout?: TimeoutKind;
    run(context: TContext, signal: AbortSignal): Promise<CheckOutcome<TCode>>;
}

export interface TroubleshooterTimeouts {
    readonly runTimeoutMs: number | null;
    readonly preparationTimeoutMs: number | null;
    readonly srvTimeoutMs: number | null;
    readonly probeTimeoutMs: number | null;
    readonly authenticationTimeoutMs: number | null;
    readonly postConnectTimeoutMs: number | null;
}

export interface ProbeTarget {
    readonly host: string;
    readonly port: number;
    readonly source: 'uri' | 'srv';
}

export interface TroubleshooterClock {
    now(): number;
    setTimeout(callback: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
}

export interface EnvironmentSource {
    readonly versions: Readonly<Record<string, string | undefined>>;
    readonly platform: string;
    readonly release: string;
    readonly arch: string;
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly timeZone: string | undefined;
}

export interface DnsIo {
    lookup(host: string): Promise<readonly { address: string; family: 4 | 6 }[]>;
    resolve4(host: string, signal: AbortSignal): Promise<string[]>;
    resolve6(host: string, signal: AbortSignal): Promise<string[]>;
    resolveCname(host: string, signal: AbortSignal): Promise<string[]>;
    resolveSrv(name: string, signal: AbortSignal): Promise<SrvRecord[]>;
    resolveTxt(name: string, signal: AbortSignal): Promise<string[][]>;
    getServers(): string[];
    readonly resolveSrvFallback: typeof resolveSrvFallback;
    readonly resolveTxtFallback: typeof resolveTxtFallback;
}

export interface NetworkOptions {
    readonly tls?: boolean;
    readonly tlsAllowInvalidCertificates?: boolean;
    readonly tlsAllowInvalidHostnames?: boolean;
    readonly tlsInsecure?: boolean;
    readonly tlsCAFile?: string;
    readonly tlsCertificateKeyFile?: string;
    readonly tlsCertificateKeyFilePassword?: string; // Secret: used privately, never output.
    readonly connectTimeoutMS?: number;
    readonly loadBalanced?: boolean;
    readonly serverApiVersion?: string;
    readonly compressors?: readonly string[];
    readonly authMechanism?: string;
    readonly authSource?: string;
    readonly proxyHost?: string;
}

export type NetworkOptionOrigin = 'uri' | 'txt' | 'srvDefault' | 'authHandler' | 'setting';

export interface NetworkOptionLayer {
    readonly origin: 'authHandler' | 'setting';
    readonly options: NetworkOptions;
}

export interface NetIo {
    connect(options: { host: string; port: number; family: 4 | 6; signal: AbortSignal }): Promise<net.Socket>;
    connectTls(options: tls.ConnectionOptions & { signal: AbortSignal }): Promise<tls.TLSSocket>;
}

export interface TroubleshooterIo {
    readonly clock: TroubleshooterClock;
    readonly environment?: EnvironmentSource;
    readonly dns?: DnsIo;
    readonly net?: NetIo;
    readonly readFile?: (path: string) => Promise<Uint8Array>;
}

export interface TroubleshooterInput {
    readonly connectionString: string;
    readonly networkOptionLayers?: readonly NetworkOptionLayer[];
    readonly srvFallbackMode?: SrvFallbackMode;
    readonly availableCompressors?: readonly WireCompressor[];
    readonly connectionTimeouts?: Readonly<Partial<Record<TimeoutKind, number>>>;
}

export interface RunContext {
    readonly runId: string;
    readonly input: TroubleshooterInput;
    readonly io: TroubleshooterIo;
    readonly target?: ProbeTarget;
    readonly targets: readonly ProbeTarget[];
    setTargets(targets: readonly ProbeTarget[]): void;
    getResult(checkId: string, target?: ProbeTarget): CheckResult<string> | undefined;
    effectiveTimeout(kind: TimeoutKind): EffectiveTimeout;
    addCleanup(cleanup: () => void | Promise<void>): void;
}

export type TroubleshooterEvent<TCode extends string> =
    | {
          readonly type: 'hostPhaseStarted';
          readonly runId: string;
          readonly checkIds: readonly string[];
          readonly targets: readonly string[];
          readonly at: number;
      }
    | {
          readonly type: 'checkStarted';
          readonly runId: string;
          readonly checkId: string;
          readonly target?: string;
          readonly at: number;
      }
    | {
          readonly type: 'checkFinished';
          readonly runId: string;
          readonly result: CheckResult<TCode>;
          readonly at: number;
      }
    | {
          readonly type: 'runFinished';
          readonly runId: string;
          readonly run: TroubleshooterRun<TCode>;
          readonly at: number;
      };

export interface TimedOutOperation {
    readonly checkId: string;
    readonly target?: string;
    readonly timeoutMs: number;
    readonly source: TimeoutSource;
}

export interface TroubleshooterRun<TCode extends string> {
    readonly runId: string;
    readonly startedAt: number;
    readonly finishedAt: number;
    readonly durationMs: number;
    readonly timeoutProfile: TimeoutProfile;
    readonly timeouts: TroubleshooterTimeouts;
    readonly targets: readonly ProbeTarget[];
    readonly results: readonly CheckResult<TCode>[];
    readonly coverage: {
        readonly limited: boolean;
        readonly timedOut: readonly TimedOutOperation[];
        readonly notStartedCount: number;
        readonly omittedTargetCount: number;
        readonly retryWouldHelp: boolean;
    };
}
