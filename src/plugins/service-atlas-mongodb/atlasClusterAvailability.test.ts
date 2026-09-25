/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    getAtlasClusterStateLabel,
    getAtlasPausedExplanation,
    isAtlasClusterConnectable,
    isAtlasClusterPaused,
    type AtlasClusterAvailability,
} from './atlasClusterAvailability';

jest.mock('@vscode/l10n', () => ({
    t: jest.fn((message: string) => message),
}));

function availability(overrides: Partial<AtlasClusterAvailability> = {}): AtlasClusterAvailability {
    return {
        stateName: 'IDLE',
        connectionString: 'mongodb+srv://cluster.example.invalid',
        ...overrides,
    };
}

describe('isAtlasClusterPaused', () => {
    it('only treats an explicit true as paused', () => {
        expect(isAtlasClusterPaused(availability({ paused: true }))).toBe(true);
        expect(isAtlasClusterPaused(availability({ paused: false }))).toBe(false);
        expect(isAtlasClusterPaused(availability())).toBe(false);
    });
});

describe('isAtlasClusterConnectable', () => {
    it('accepts a running IDLE cluster that published a connection string', () => {
        expect(isAtlasClusterConnectable(availability())).toBe(true);
    });

    it('rejects a paused cluster even though Atlas still reports it as IDLE', () => {
        expect(isAtlasClusterConnectable(availability({ paused: true }))).toBe(false);
    });

    it('rejects a cluster that has not published a connection string yet', () => {
        expect(isAtlasClusterConnectable(availability({ connectionString: undefined }))).toBe(false);
    });

    it('rejects every non-IDLE state', () => {
        for (const stateName of ['CREATING', 'UPDATING', 'REPAIRING', 'DELETING', 'UNKNOWN'] as const) {
            expect(isAtlasClusterConnectable(availability({ stateName }))).toBe(false);
        }
    });
});

describe('getAtlasClusterStateLabel', () => {
    it('annotates a paused cluster instead of its control-plane state', () => {
        expect(getAtlasClusterStateLabel(availability({ paused: true }))).toBe('Paused');
    });

    it('leaves a plain IDLE cluster unannotated', () => {
        expect(getAtlasClusterStateLabel(availability())).toBeUndefined();
    });

    it('labels the transient states', () => {
        expect(getAtlasClusterStateLabel(availability({ stateName: 'CREATING' }))).toBe('Creating…');
        expect(getAtlasClusterStateLabel(availability({ stateName: 'UNKNOWN' }))).toBe('Unknown state');
    });
});

describe('getAtlasPausedExplanation', () => {
    it('tells the user where to resume the cluster', () => {
        expect(getAtlasPausedExplanation()).toContain('Resume it in MongoDB Atlas before connecting');
    });
});
