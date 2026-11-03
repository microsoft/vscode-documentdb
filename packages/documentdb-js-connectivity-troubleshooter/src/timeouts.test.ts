/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';

import {
    DEFAULT_TIMEOUTS,
    resolveTimeouts,
    SAFETY_LIMITS,
    timeoutsForProfile,
    TroubleshooterConfigurationError,
} from './index.js';

import { type TimeoutProfile, type TroubleshooterTimeouts } from './index.js';

const profiles: readonly TimeoutProfile[] = ['default', 'longer', 'noDiagnosticTimeouts'];
const fields = Object.keys(DEFAULT_TIMEOUTS) as (keyof TroubleshooterTimeouts)[];

describe('timeout profiles', (): void => {
    it('uses the specified defaults', (): void => {
        expect(timeoutsForProfile('default')).toEqual({
            runTimeoutMs: 300_000,
            preparationTimeoutMs: 15_000,
            srvTimeoutMs: 10_000,
            probeTimeoutMs: 10_000,
            authenticationTimeoutMs: 45_000,
            postConnectTimeoutMs: 5_000,
        });
    });

    it('doubles every timeout for longer runs', (): void => {
        const longer = timeoutsForProfile('longer');
        for (const field of fields) {
            expect(longer[field]).toBe(Number(DEFAULT_TIMEOUTS[field]) * 2);
        }
    });

    it('removes all six diagnostic timeouts', (): void => {
        expect(Object.values(timeoutsForProfile('noDiagnosticTimeouts'))).toEqual(Array(6).fill(null));
    });

    it.each(profiles)('applies overrides on top of %s without changing defaults', (profile): void => {
        const original = timeoutsForProfile(profile);
        expect(resolveTimeouts(profile)).toEqual(original);
        expect(resolveTimeouts(profile, { probeTimeoutMs: 123, runTimeoutMs: null })).toEqual({
            ...original,
            probeTimeoutMs: 123,
            runTimeoutMs: null,
        });
        expect(timeoutsForProfile(profile)).toEqual(original);
    });

    it('does not copy unknown override fields into resolved timeouts', (): void => {
        const overrides = { probeTimeoutMs: 10, extra: 'private-value' };
        expect(resolveTimeouts('default', overrides)).toEqual({ ...DEFAULT_TIMEOUTS, probeTimeoutMs: 10 });
    });

    it.each(profiles)('never changes safety limits for %s', (profile): void => {
        resolveTimeouts(profile, { runTimeoutMs: null });
        expect(SAFETY_LIMITS).toEqual({
            maxTargets: 16,
            maxAddressesPerHost: 8,
            maxParallelHostChains: 4,
            maxWireReplyBytes: 1_048_576,
        });
    });

    it.each(fields)('rejects invalid overrides naming %s', (field): void => {
        for (const value of [0, -1, NaN, Infinity, '100', undefined, false]) {
            const overrides = { [field]: value } as Partial<TroubleshooterTimeouts>;
            expect((): TroubleshooterTimeouts => resolveTimeouts('default', overrides)).toThrow(
                TroubleshooterConfigurationError,
            );
            expect((): TroubleshooterTimeouts => resolveTimeouts('default', overrides)).toThrow(field);
        }
        expect(resolveTimeouts('default', { [field]: null })[field]).toBeNull();
        expect(resolveTimeouts('default', { [field]: 0.5 })[field]).toBe(0.5);
    });
});
