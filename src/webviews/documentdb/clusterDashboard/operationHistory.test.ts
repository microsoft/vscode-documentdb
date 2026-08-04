/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CurrentOpEntry } from '../../../documentdb/utils/getClusterHealth';
import { clearObservedOperations, getObservedOperations, recordObservedOperations } from './operationHistory';

const CLUSTER = 'cluster-under-test';

function operation(overrides: Partial<CurrentOpEntry> = {}): CurrentOpEntry {
    return {
        opid: 'op-1',
        opidIsNumeric: false,
        type: 'query',
        namespace: 'sales.orders',
        secsRunning: 1,
        active: true,
        clientDescription: '127.0.0.1:1234',
        commandPreview: '{"find":"orders"}',
        ...overrides,
    };
}

afterEach(() => {
    // Module-level state deliberately outlives a webview; it must not outlive a test.
    clearObservedOperations(CLUSTER);
});

describe('recordObservedOperations', () => {
    it('merges repeat sightings into one entry rather than duplicating it', () => {
        recordObservedOperations(CLUSTER, [operation({ secsRunning: 1 })], 1_000);
        recordObservedOperations(CLUSTER, [operation({ secsRunning: 4 })], 6_000);

        const history = getObservedOperations(CLUSTER);

        expect(history).toHaveLength(1);
        expect(history[0].observations).toBe(2);
        expect(history[0].firstSeenMs).toBe(1_000);
        expect(history[0].lastSeenMs).toBe(6_000);
        expect(history[0].ended).toBe(false);
    });

    it('keeps the longest running time the server reported', () => {
        // Not `lastSeen - firstSeen`, which only measures how long polling overlapped the
        // operation and understates anything that began before the dashboard opened.
        recordObservedOperations(CLUSTER, [operation({ secsRunning: 30 })], 1_000);
        recordObservedOperations(CLUSTER, [operation({ secsRunning: 35 })], 6_000);

        expect(getObservedOperations(CLUSTER)[0].longestSecsRunning).toBe(35);
    });

    it('marks an operation ended once a later poll stops reporting it', () => {
        recordObservedOperations(CLUSTER, [operation()], 1_000);
        recordObservedOperations(CLUSTER, [], 6_000);

        const history = getObservedOperations(CLUSTER);

        expect(history).toHaveLength(1);
        expect(history[0].ended).toBe(true);
    });

    it('treats a recycled opid seen much later as a new operation', () => {
        // Servers reissue operation ids. Merging across a long gap would invent one
        // long-running operation out of two unrelated short ones.
        recordObservedOperations(CLUSTER, [operation()], 1_000);
        recordObservedOperations(CLUSTER, [operation()], 1_000 + 120_000);

        const history = getObservedOperations(CLUSTER);

        expect(history).toHaveLength(2);
        expect(history.every((entry) => entry.observations === 1)).toBe(true);
    });

    it('keeps the same opid under different namespaces apart', () => {
        recordObservedOperations(
            CLUSTER,
            [operation({ namespace: 'sales.orders' }), operation({ namespace: 'analytics.events' })],
            1_000,
        );

        expect(
            getObservedOperations(CLUSTER)
                .map((entry) => entry.namespace)
                .sort(),
        ).toEqual(['analytics.events', 'sales.orders']);
    });

    it('ignores operations the server could not identify', () => {
        // An empty opid cannot be followed across polls: every sighting would look either
        // like the same entry or like a new one, arbitrarily. vCore reports its internal
        // parallel workers this way.
        recordObservedOperations(CLUSTER, [operation({ opid: '' })], 1_000);

        expect(getObservedOperations(CLUSTER)).toEqual([]);
    });

    it('backfills a command that the first sighting did not carry', () => {
        recordObservedOperations(CLUSTER, [operation({ commandPreview: '' })], 1_000);
        recordObservedOperations(CLUSTER, [operation({ commandPreview: '{"find":"orders"}' })], 2_000);

        expect(getObservedOperations(CLUSTER)[0].commandPreview).toBe('{"find":"orders"}');
    });

    it('evicts the least recently seen entries past the cap', () => {
        for (let index = 0; index < 250; index++) {
            recordObservedOperations(CLUSTER, [operation({ opid: `op-${index}` })], 1_000 + index);
        }

        const history = getObservedOperations(CLUSTER);

        expect(history).toHaveLength(200);
        // Newest first, and the earliest 50 are gone.
        expect(history[0].opid).toBe('op-249');
        expect(history.some((entry) => entry.opid === 'op-0')).toBe(false);
    });

    it('returns the most recently seen operation first', () => {
        recordObservedOperations(CLUSTER, [operation({ opid: 'older' })], 1_000);
        recordObservedOperations(CLUSTER, [operation({ opid: 'newer' })], 2_000);

        expect(getObservedOperations(CLUSTER).map((entry) => entry.opid)).toEqual(['newer', 'older']);
    });

    it('keeps clusters separate', () => {
        recordObservedOperations(CLUSTER, [operation({ opid: 'mine' })], 1_000);
        recordObservedOperations('other-cluster', [operation({ opid: 'theirs' })], 1_000);

        expect(getObservedOperations(CLUSTER).map((entry) => entry.opid)).toEqual(['mine']);

        clearObservedOperations('other-cluster');
    });
});
