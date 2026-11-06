/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type TimeoutProfile } from '../timeouts.js';
import { type CheckResult, type DiagnosticsRun, type DiagnosticsTimeouts } from '../types.js';

export type ReportOutcome = 'connected' | 'failed' | 'notTested';

export interface ReportSummary {
    readonly outcome: ReportOutcome;
    readonly headline?: { readonly checkId: string; readonly target?: string; readonly code?: string };
    readonly serverRows?: readonly { readonly label: string; readonly value: string }[];
    readonly omittedServerRowCount?: number;
    readonly nextSteps?: readonly string[];
    readonly location?: string;
    readonly notes?: readonly string[];
}

export type IdentifierKind =
    | 'host'
    | 'address'
    | 'user'
    | 'tenant'
    | 'account'
    | 'clientId'
    | 'endpoint'
    | 'replicaSet'
    | 'certificateName'
    | 'database'
    | 'role'
    | 'connectionName'
    | 'proxyHost'
    | 'service'
    | 'namespace';

export interface ClockOffsetSummary {
    readonly target: string;
    readonly offsetMs: number;
    readonly uncertaintyMs: number;
}

export interface DiagnosticsReport<TCode extends string> {
    readonly schemaVersion: 1;
    readonly runId: string;
    readonly startedAt: string;
    readonly finishedAt: string;
    readonly durationMs: number;
    readonly timeoutProfile: TimeoutProfile;
    readonly timeouts: DiagnosticsTimeouts;
    readonly coverage: DiagnosticsRun<TCode>['coverage'];
    readonly targets: readonly string[];
    readonly results: readonly CheckResult<TCode>[];
    readonly summary?: ReportSummary;
    readonly clockOffset: ClockOffsetSummary | null;
    readonly connectionName?: string;
    readonly identifierKeys: Readonly<Record<string, IdentifierKind>>;
}
