/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    clearEntraTokenFailure,
    getRecentEntraTokenFailure,
    recordEntraTokenFailure,
    resetEntraTokenFailuresForTests,
} from './entraTokenFailures';

describe('Entra token failure registry', () => {
    beforeEach((): void => {
        resetEntraTokenFailuresForTests();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    });

    afterEach((): void => {
        resetEntraTokenFailuresForTests();
        vi.useRealTimers();
    });

    it('records only the cloud, auth method and timestamp for the stable cluster key', (): void => {
        recordEntraTokenFailure('cluster-1', { cloudCategory: 'usgov', authMethod: 'interactive' });

        expect(getRecentEntraTokenFailure('cluster-1')).toEqual({
            cloudCategory: 'usgov',
            authMethod: 'interactive',
            timestamp: Date.now(),
        });
        expect(getRecentEntraTokenFailure('another-cluster')).toBeUndefined();
    });

    it('reads a failure when the cluster ID casing differs', (): void => {
        recordEntraTokenFailure('AzureResource', { cloudCategory: 'usgov', authMethod: 'interactive' });

        expect(getRecentEntraTokenFailure('azureresource')).toEqual({
            cloudCategory: 'usgov',
            authMethod: 'interactive',
            timestamp: Date.now(),
        });
    });

    it('clears a failure when the cluster ID casing differs', (): void => {
        recordEntraTokenFailure('AzureResource', { cloudCategory: 'usgov', authMethod: 'interactive' });

        clearEntraTokenFailure('azureresource');

        expect(getRecentEntraTokenFailure('AzureResource')).toBeUndefined();
    });

    it('replaces a failure recorded with different cluster ID casing', (): void => {
        recordEntraTokenFailure('AzureResource', { cloudCategory: 'usgov', authMethod: 'interactive' });
        vi.advanceTimersByTime(60_000);
        recordEntraTokenFailure('azureresource', { cloudCategory: 'china', authMethod: 'managedIdentity' });

        const latestFailure = {
            cloudCategory: 'china',
            authMethod: 'managedIdentity',
            timestamp: Date.now(),
        };
        expect(getRecentEntraTokenFailure('AzureResource')).toEqual(latestFailure);
        expect(getRecentEntraTokenFailure('azureresource')).toEqual(latestFailure);
    });

    it('keeps the optional classifier rule and drops it when a later failure has no classification', (): void => {
        recordEntraTokenFailure('cluster-1', {
            cloudCategory: 'usgov',
            authMethod: 'interactive',
            ruleId: 'firstPartyPreauthorization',
        });
        expect(getRecentEntraTokenFailure('cluster-1')).toEqual({
            cloudCategory: 'usgov',
            authMethod: 'interactive',
            ruleId: 'firstPartyPreauthorization',
            timestamp: Date.now(),
        });
        recordEntraTokenFailure('cluster-1', { cloudCategory: 'public', authMethod: 'interactive' });
        expect(getRecentEntraTokenFailure('cluster-1')).not.toHaveProperty('ruleId');
    });

    it('expires a failure after ten minutes by default', (): void => {
        recordEntraTokenFailure('cluster-1', { cloudCategory: 'china', authMethod: 'managedIdentity' });
        vi.advanceTimersByTime(10 * 60_000);
        expect(getRecentEntraTokenFailure('cluster-1')).toBeDefined();
        vi.advanceTimersByTime(1);
        expect(getRecentEntraTokenFailure('cluster-1')).toBeUndefined();
    });

    it('accepts a custom maximum age and removes expired entries', (): void => {
        recordEntraTokenFailure('cluster-1', { cloudCategory: 'public', authMethod: 'interactive' });
        vi.advanceTimersByTime(101);
        expect(getRecentEntraTokenFailure('cluster-1', 100)).toBeUndefined();
        expect(getRecentEntraTokenFailure('cluster-1', 1_000)).toBeUndefined();
    });

    it('replaces an earlier failure and refreshes its timestamp', (): void => {
        recordEntraTokenFailure('cluster-1', { cloudCategory: 'public', authMethod: 'interactive' });
        vi.advanceTimersByTime(60_000);
        recordEntraTokenFailure('cluster-1', { cloudCategory: 'custom', authMethod: 'managedIdentity' });

        expect(getRecentEntraTokenFailure('cluster-1')).toEqual({
            cloudCategory: 'custom',
            authMethod: 'managedIdentity',
            timestamp: Date.now(),
        });
    });

    it('clears only the successful cluster and safely accepts a missing entry', (): void => {
        recordEntraTokenFailure('cluster-1', { cloudCategory: 'usgov', authMethod: 'interactive' });
        recordEntraTokenFailure('cluster-2', { cloudCategory: 'china', authMethod: 'managedIdentity' });

        clearEntraTokenFailure('cluster-1');
        clearEntraTokenFailure('cluster-1');
        expect(getRecentEntraTokenFailure('cluster-1')).toBeUndefined();
        expect(getRecentEntraTokenFailure('cluster-2')).toMatchObject({
            cloudCategory: 'china',
            authMethod: 'managedIdentity',
        });
    });

    it('resets all entries for tests', (): void => {
        recordEntraTokenFailure('cluster-1', { cloudCategory: 'usgov', authMethod: 'interactive' });
        recordEntraTokenFailure('cluster-2', { cloudCategory: 'china', authMethod: 'managedIdentity' });
        resetEntraTokenFailuresForTests();
        expect(getRecentEntraTokenFailure('cluster-1')).toBeUndefined();
        expect(getRecentEntraTokenFailure('cluster-2')).toBeUndefined();
    });
});
