/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type PanelRow, type PanelRowId } from './panelTypes';

export type TimeoutProfile = 'default' | 'longer' | 'noDiagnosticTimeouts';

export interface ResultCardData {
    readonly outcome: 'connected' | 'failed' | 'notTested';
    readonly stoppedAtRow?: PanelRowId;
    readonly headline?: {
        readonly title: string;
        readonly explanation: string;
        readonly nextStep?: string;
        readonly target?: string;
    };
    readonly supporting?: {
        readonly title: string;
        readonly target?: string;
        /** The driver's attempt agrees with the headline (decision 0047); the card words it as corroboration. */
        readonly corroboration?: 'serverSelection' | 'timedOut';
    };
    readonly providerHint?: string;
    /** Documentation for a provider paragraph that was left out because it repeats the headline. */
    readonly learnMore?: { readonly topic: 'sovereignClouds' | 'srvDns'; readonly url: string };
    readonly firewallHint: boolean;
    readonly earlierSignInFailure: boolean;
    readonly runTimeoutBeforeAttempt: boolean;
    /** For the report summary; the card leaves these to the rows' Details (decision 0041). */
    readonly serverLine?: {
        readonly engineVersion?: string;
        readonly apiVersion?: string;
        readonly serverVersion?: string;
        readonly host?: string;
        readonly pingMs?: number;
    };
    readonly authenticated: boolean;
    /** Connected with No authentication, but listing databases needs sign-in; the headline says why (decision 0048). */
    readonly signInRequired?: true;
}

export type RunUpdate =
    | {
          readonly type: 'started';
          readonly runId: string;
          readonly startedAt: number;
          readonly rows: readonly PanelRow[];
      }
    | { readonly type: 'rows'; readonly runId: string; readonly rows: readonly PanelRow[] }
    | {
          readonly type: 'finished';
          readonly runId: string;
          readonly finishedAt: number;
          readonly rows: readonly PanelRow[];
          readonly outcome: 'connected' | 'failed' | 'notTested';
          readonly result: ResultCardData;
          readonly coverage: {
              readonly limited: boolean;
              readonly retryWouldHelp: boolean;
              readonly connectionTimeoutLimited: boolean;
          };
      }
    | { readonly type: 'cancelled'; readonly runId: string; readonly rows: readonly PanelRow[] }
    | { readonly type: 'failed'; readonly runId: string; readonly reason: 'unexpected' };

export interface PanelEvent {
    readonly type: 'offerRerun';
}

export interface ConnectionDiagnosticsConfiguration {
    readonly connectionName: string;
    readonly diagnosticsSessionId: string;
    /** Read when the panel opens; the host checks again when Give Feedback is clicked. */
    readonly feedbackPermitted?: boolean;
    /**
     * How the panel paces settled rows (decision 0043). The extension never sets it, so the panel's
     * default applies; the view's tests and the static L2-dev fixtures turn pacing off with zeros.
     */
    readonly stepPacing?: { readonly stepMs: number; readonly jitterMs: number };
}
