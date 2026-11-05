/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TroubleshooterConfigurationError } from './errors.js';

import { type TroubleshooterTimeouts } from './types.js';

export type TimeoutKind = 'preparation' | 'srv' | 'probe' | 'authentication' | 'postConnect';
export type TimeoutProfile = 'default' | 'longer' | 'noDiagnosticTimeouts';
export type TimeoutSource = 'check' | 'run' | 'connection';

export interface EffectiveTimeout {
    readonly timeoutMs: number | null;
    readonly source: TimeoutSource | null;
}

export const DEFAULT_TIMEOUTS: TroubleshooterTimeouts = {
    runTimeoutMs: 300_000,
    preparationTimeoutMs: 15_000,
    srvTimeoutMs: 10_000,
    probeTimeoutMs: 10_000,
    authenticationTimeoutMs: 45_000,
    postConnectTimeoutMs: 5_000,
};

export const SAFETY_LIMITS = {
    maxTargets: 16,
    maxAddressesPerHost: 8,
    maxParallelHostChains: 4,
    maxWireReplyBytes: 1_048_576,
} as const;

export function timeoutsForProfile(profile: TimeoutProfile): TroubleshooterTimeouts {
    switch (profile) {
        case 'default':
            return { ...DEFAULT_TIMEOUTS };
        case 'longer':
            return {
                runTimeoutMs: 600_000,
                preparationTimeoutMs: 30_000,
                srvTimeoutMs: 20_000,
                probeTimeoutMs: 20_000,
                authenticationTimeoutMs: 90_000,
                postConnectTimeoutMs: 10_000,
            };
        case 'noDiagnosticTimeouts':
            return {
                runTimeoutMs: null,
                preparationTimeoutMs: null,
                srvTimeoutMs: null,
                probeTimeoutMs: null,
                authenticationTimeoutMs: null,
                postConnectTimeoutMs: null,
            };
        default:
            throw new TroubleshooterConfigurationError('Unknown timeout profile');
    }
}

export function resolveTimeouts(
    profile: TimeoutProfile,
    overrides?: Partial<TroubleshooterTimeouts>,
): TroubleshooterTimeouts {
    let resolved = timeoutsForProfile(profile);
    for (const field of Object.keys(DEFAULT_TIMEOUTS) as (keyof TroubleshooterTimeouts)[]) {
        if (overrides && Object.hasOwn(overrides, field)) {
            const value = overrides[field];
            if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)) {
                throw new TroubleshooterConfigurationError(`Invalid timeout: ${field}`);
            }
            resolved = { ...resolved, [field]: value };
        }
    }
    return resolved;
}
