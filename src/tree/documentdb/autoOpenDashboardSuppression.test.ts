/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { isAutoOpenDashboardSuppressed, suppressAutoOpenDashboard } from './autoOpenDashboardSuppression';

describe('automatic dashboard suppression', (): void => {
    it('does not suppress a cluster by default', (): void => {
        expect(isAutoOpenDashboardSuppressed('unsuppressed-cluster')).toBe(false);
    });

    it('suppresses a cluster until released', (): void => {
        const release = suppressAutoOpenDashboard('cluster');
        try {
            expect(isAutoOpenDashboardSuppressed('cluster')).toBe(true);
        } finally {
            release();
        }
        expect(isAutoOpenDashboardSuppressed('cluster')).toBe(false);
    });

    it('keeps suppression independent for different cluster ids', (): void => {
        const releaseFirst = suppressAutoOpenDashboard('first-cluster');
        const releaseSecond = suppressAutoOpenDashboard('second-cluster');
        try {
            expect(isAutoOpenDashboardSuppressed('first-cluster')).toBe(true);
            expect(isAutoOpenDashboardSuppressed('second-cluster')).toBe(true);
            releaseFirst();
            expect(isAutoOpenDashboardSuppressed('first-cluster')).toBe(false);
            expect(isAutoOpenDashboardSuppressed('second-cluster')).toBe(true);
        } finally {
            releaseFirst();
            releaseSecond();
        }
        expect(isAutoOpenDashboardSuppressed('second-cluster')).toBe(false);
    });
});
