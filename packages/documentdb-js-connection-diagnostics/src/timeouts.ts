/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DiagnosticsConfigurationError } from './errors.js';

import { type DiagnosticsTimeouts } from './types.js';

export type TimeoutKind = 'preparation' | 'srv' | 'probe' | 'authentication' | 'postConnect';
export type TimeoutProfile = 'default' | 'longer' | 'noDiagnosticTimeouts';
export type TimeoutSource = 'check' | 'run' | 'connection';

export interface EffectiveTimeout {
    readonly timeoutMs: number | null;
    readonly source: TimeoutSource | null;
}

export const MAX_TIMEOUT_MS = 2_147_483_647;

export const DEFAULT_TIMEOUTS: DiagnosticsTimeouts = {
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

export function validateTimeoutMs(
    name: string,
    value: unknown,
    options: { readonly allowNull: boolean },
): number | null {
    if (value === null && options.allowNull) {
        return null;
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > MAX_TIMEOUT_MS) {
        throw new DiagnosticsConfigurationError(
            `Invalid timeout: ${name}. Expected a positive finite number no greater than ${MAX_TIMEOUT_MS} ms${
                options.allowNull ? ', or null to disable this diagnostic timeout' : ''
            }.`,
        );
    }
    return value;
}

export function timeoutsForProfile(profile: TimeoutProfile): DiagnosticsTimeouts {
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
            throw new DiagnosticsConfigurationError('Unknown timeout profile');
    }
}

export function resolveTimeouts(
    profile: TimeoutProfile,
    overrides?: Partial<DiagnosticsTimeouts>,
): DiagnosticsTimeouts {
    let resolved = timeoutsForProfile(profile);
    for (const field of Object.keys(DEFAULT_TIMEOUTS) as (keyof DiagnosticsTimeouts)[]) {
        if (overrides && Object.hasOwn(overrides, field)) {
            const value = validateTimeoutMs(field, overrides[field], { allowNull: true });
            resolved = { ...resolved, [field]: value };
        }
    }
    return resolved;
}
