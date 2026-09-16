/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

jest.mock('../../extensionVariables', () => ({
    ext: {
        outputChannel: { trace: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), appendLine: jest.fn() },
    },
}));

import { formatMs, monotonicNow } from './atlasTrace';

describe('formatMs', () => {
    it('never reports a negative duration when the wall clock steps backwards', () => {
        // Observed live: an NTP correction landed mid-request and the log filled with lines like
        // "GET /orgs -> 200 in -157ms", which discredits every other number on the line.
        const startedAt = monotonicNow();
        const wallClock = jest.spyOn(Date, 'now').mockReturnValue(0);
        try {
            expect(formatMs(startedAt)).toMatch(/^\d+ms$/);
        } finally {
            wallClock.mockRestore();
        }
    });

    it('measures elapsed time from a monotonic reading', () => {
        const realNow = performance.now.bind(performance);
        const startedAt = realNow();
        const advanced = jest.spyOn(performance, 'now').mockImplementation(() => startedAt + 250);
        try {
            expect(formatMs(startedAt)).toBe('250ms');
        } finally {
            advanced.mockRestore();
        }
    });
});
