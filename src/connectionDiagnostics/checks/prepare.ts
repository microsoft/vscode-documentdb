/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type Check,
    type CheckOutcome,
    type Finding,
    type RunContext,
} from '@documentdb-js/connection-diagnostics';
import {
    ConnectionReachabilityService,
    LocalPortInUseError,
    type ConnectionReachabilityObserver,
    type ConnectionReachabilityResult,
} from '../../services/connectionReachabilityService';
import { type TroubleshooterSetup } from '../input';
import { safeErrorName } from '../outputTrace';
import { type FindingCode, type TroubleshootTarget } from '../types';

function localPortInUse(error: LocalPortInUseError): Finding<FindingCode> {
    return {
        code: 'prepare.localPortInUse',
        severity: 'error',
        data: { localPort: error.localPort, holder: error.holder },
        detail: { language: 'en', text: 'The local port for the port-forward tunnel is already in use.' },
    };
}

function sharedTunnel(outcome: NonNullable<ConnectionReachabilityResult['sharedTunnel']>): Finding<FindingCode> {
    return {
        code: 'prepare.sharedTunnel',
        severity: 'info',
        data: { tunnel: outcome },
        detail: { language: 'en', text: 'The port-forward tunnel is shared and stays open after this run.' },
    };
}

/**
 * The only step that prepares the endpoint (design §4.3): the reachability providers run here, under
 * the preparation timeout, without UI. A tunnel started or reused here is the normal shared tunnel an
 * ordinary connect would use; it is reported and stays open after the run (decision 0017).
 */
export function createPrepareCheck(
    target: TroubleshootTarget,
    getSetup: () => TroubleshooterSetup,
): Check<RunContext, FindingCode> {
    return {
        id: 'prepare',
        scope: 'run',
        dependsOn: ['connectionString'],
        timeout: 'preparation',
        async run(_context, signal): Promise<CheckOutcome<FindingCode>> {
            let providerId: string | undefined;
            let elapsedMs = 0;
            let errorName: string | undefined;
            let failure: unknown;
            let result: ConnectionReachabilityResult | undefined;
            const observer: ConnectionReachabilityObserver = {
                onProviderStarted(id): void {
                    providerId = id;
                },
                onProviderCompleted(id, elapsed, completed): void {
                    providerId = id;
                    elapsedMs = elapsed;
                    result = completed;
                },
                onProviderFailed(id, elapsed, error): void {
                    providerId = id;
                    elapsedMs = elapsed;
                    errorName = safeErrorName(error);
                    failure = error;
                },
            };
            signal.throwIfAborted();
            try {
                await ConnectionReachabilityService.ensureReachable(
                    getSetup().connectionProperties,
                    target.clusterId,
                    observer,
                    { interactive: false, signal },
                );
            } catch (error) {
                errorName = safeErrorName(error);
                failure = error;
            }
            if (errorName !== undefined) {
                return {
                    status: 'fail',
                    facts: { providerId: providerId ?? null, elapsedMs, errorName },
                    findings: failure instanceof LocalPortInUseError ? [localPortInUse(failure)] : [],
                };
            }
            if (providerId === undefined) {
                return { status: 'skipped', skippedBecause: { reason: 'notApplicable' }, facts: {}, findings: [] };
            }
            const tunnel = result?.sharedTunnel;
            return {
                status: 'pass',
                facts: { providerId, elapsedMs, ...(tunnel === undefined ? {} : { tunnel }) },
                findings: tunnel === undefined ? [] : [sharedTunnel(tunnel)],
            };
        },
    };
}
