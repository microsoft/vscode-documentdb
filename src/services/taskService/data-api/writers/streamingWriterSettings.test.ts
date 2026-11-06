/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { type DocumentDetails, type StreamingWriterSettings } from '../types';
import { BatchSizeAdapter } from './BatchSizeAdapter';
import { computeRetryDelay, resolveStreamingWriterSettings } from './streamingWriterSettings';

describe('resolveStreamingWriterSettings', () => {
    it('preserves the shipped batching, retry and document size defaults', () => {
        const settings = resolveStreamingWriterSettings();

        expect(settings.batching).toEqual({
            startMode: 'fast',
            fast: { initialBatchSize: 500, maxBatchSize: 2000, growthFactor: 1.2 },
            ruLimited: { initialBatchSize: 100, maxBatchSize: 1000, growthFactor: 1.1 },
            minBatchSize: 1,
            bufferMemoryLimitMB: 24,
        });
        expect(settings.retry).toEqual({
            maxAttemptsWithoutProgress: 10,
            baseDelayMs: 100,
            multiplier: 2,
            maxDelayMs: 5000,
            jitterFraction: 0.3,
        });
        const document: DocumentDetails = { id: '1', documentContent: { value: 'hello' } };
        expect(settings.estimateDocumentSize(document)).toBe(JSON.stringify(document.documentContent).length * 2);
        expect(settings.estimateDocumentSize({ id: '2', documentContent: 1n })).toBe(1024);
        expect(settings.estimateDocumentSize({ id: '3', documentContent: undefined })).toBe(1024);
    });

    it('merges package, adapter and caller settings field by field', () => {
        const adapterEstimator = (): number => 20;
        const callerEstimator = (): number => 30;
        const adapterDefaults: StreamingWriterSettings = {
            batching: {
                startMode: 'ru-limited',
                fast: { initialBatchSize: 20, maxBatchSize: 80 },
                ruLimited: { initialBatchSize: 10, growthFactor: 1.3 },
                minBatchSize: 2,
                bufferMemoryLimitMB: 8,
            },
            retry: { maxAttemptsWithoutProgress: 4, baseDelayMs: 50, multiplier: 3 },
            estimateDocumentSize: adapterEstimator,
        };
        const overrides: StreamingWriterSettings = {
            batching: {
                startMode: 'fast',
                fast: { initialBatchSize: 30 },
                ruLimited: { maxBatchSize: 90 },
                bufferMemoryLimitMB: 4,
            },
            retry: { baseDelayMs: 25, maxDelayMs: 200, jitterFraction: 0.1 },
            estimateDocumentSize: callerEstimator,
        };

        expect(resolveStreamingWriterSettings(adapterDefaults, overrides)).toEqual({
            batching: {
                startMode: 'fast',
                fast: { initialBatchSize: 30, maxBatchSize: 80, growthFactor: 1.2 },
                ruLimited: { initialBatchSize: 10, maxBatchSize: 90, growthFactor: 1.3 },
                minBatchSize: 2,
                bufferMemoryLimitMB: 4,
            },
            retry: {
                maxAttemptsWithoutProgress: 4,
                baseDelayMs: 25,
                multiplier: 3,
                maxDelayMs: 200,
                jitterFraction: 0.1,
            },
            estimateDocumentSize: callerEstimator,
        });
        const adapterSettings = resolveStreamingWriterSettings(adapterDefaults);
        expect(adapterSettings.batching.startMode).toBe('ru-limited');
        expect(adapterSettings.estimateDocumentSize).toBe(adapterEstimator);
        expect(resolveStreamingWriterSettings(adapterDefaults, { retry: {} }).estimateDocumentSize).toBe(
            adapterEstimator,
        );
    });

    const undefinedSettings: StreamingWriterSettings = {
        batching: {
            startMode: undefined,
            fast: { initialBatchSize: undefined, maxBatchSize: undefined, growthFactor: undefined },
            ruLimited: { initialBatchSize: undefined, maxBatchSize: undefined, growthFactor: undefined },
            minBatchSize: undefined,
            bufferMemoryLimitMB: undefined,
        },
        retry: {
            maxAttemptsWithoutProgress: undefined,
            baseDelayMs: undefined,
            multiplier: undefined,
            maxDelayMs: undefined,
            jitterFraction: undefined,
        },
    };

    it('inherits package defaults for undefined adapter settings', () => {
        expect(resolveStreamingWriterSettings(undefinedSettings)).toEqual(resolveStreamingWriterSettings());
    });

    it('inherits adapter defaults for undefined caller settings', () => {
        const adapterDefaults: StreamingWriterSettings = {
            batching: {
                startMode: 'ru-limited',
                fast: { initialBatchSize: 12, maxBatchSize: 20, growthFactor: 1.4 },
                ruLimited: { initialBatchSize: 4, maxBatchSize: 8, growthFactor: 1.5 },
                minBatchSize: 2,
                bufferMemoryLimitMB: 16,
            },
            retry: {
                maxAttemptsWithoutProgress: 3,
                baseDelayMs: 20,
                multiplier: 4,
                maxDelayMs: 200,
                jitterFraction: 0.2,
            },
        };
        expect(resolveStreamingWriterSettings(adapterDefaults, undefinedSettings)).toEqual(
            resolveStreamingWriterSettings(adapterDefaults),
        );
    });

    it('inherits whole undefined batching, mode and retry objects', () => {
        const adapterDefaults: StreamingWriterSettings = {
            batching: { fast: { initialBatchSize: 12 } },
            retry: { baseDelayMs: 20 },
        };
        expect(resolveStreamingWriterSettings(adapterDefaults, { batching: undefined, retry: undefined })).toEqual(
            resolveStreamingWriterSettings(adapterDefaults),
        );
        expect(
            resolveStreamingWriterSettings(adapterDefaults, { batching: { fast: undefined, ruLimited: undefined } }),
        ).toEqual(resolveStreamingWriterSettings(adapterDefaults));
        expect(resolveStreamingWriterSettings({ batching: undefined, retry: undefined })).toEqual(
            resolveStreamingWriterSettings(),
        );
    });

    const integerSettings: Array<[string, (value: number) => StreamingWriterSettings]> = [
        ['batching.fast.initialBatchSize', (value) => ({ batching: { fast: { initialBatchSize: value } } })],
        ['batching.fast.maxBatchSize', (value) => ({ batching: { fast: { maxBatchSize: value } } })],
        ['batching.ruLimited.initialBatchSize', (value) => ({ batching: { ruLimited: { initialBatchSize: value } } })],
        ['batching.ruLimited.maxBatchSize', (value) => ({ batching: { ruLimited: { maxBatchSize: value } } })],
        ['batching.minBatchSize', (value) => ({ batching: { minBatchSize: value } })],
        ['retry.maxAttemptsWithoutProgress', (value) => ({ retry: { maxAttemptsWithoutProgress: value } })],
    ];
    it.each(
        integerSettings.flatMap(([path, makeSettings]) =>
            [0, 1.5, NaN, -1, Infinity].map((value) => ({ path, value, overrides: makeSettings(value) })),
        ),
    )('rejects invalid $path value $value', ({ path, value, overrides }) => {
        expect(() => resolveStreamingWriterSettings(undefined, overrides)).toThrow(
            `Invalid streaming writer setting ${path}: ${String(value)} (expected an integer of at least 1).`,
        );
    });

    it('rejects an unknown start mode', () => {
        const startMode = 'unknown' as NonNullable<StreamingWriterSettings['batching']>['startMode'];
        expect(() => resolveStreamingWriterSettings(undefined, { batching: { startMode } })).toThrow(
            'Invalid streaming writer setting batching.startMode: unknown (expected fast or ru-limited).',
        );
    });

    it('rejects invalid batch size while constructing the adapter, before any write', () => {
        expect(() => new BatchSizeAdapter({ fast: { initialBatchSize: 0 } })).toThrow(
            'Invalid streaming writer setting batching.fast.initialBatchSize: 0 (expected an integer of at least 1).',
        );
    });
});

describe('computeRetryDelay', () => {
    it.each([
        { random: 0, expected: [70, 140, 280, 560, 1120, 2240, 3500, 3500] },
        { random: 0.5, expected: [100, 200, 400, 800, 1600, 3200, 5000, 5000] },
        { random: 0.999999, expected: [130, 260, 520, 1040, 2080, 4160, 6500, 6500] },
    ])('preserves exponential backoff and the pre-jitter cap with random=$random', ({ random, expected }) => {
        const { retry } = resolveStreamingWriterSettings();

        const delays = expected.map((_, attempt): number => computeRetryDelay(attempt, retry, (): number => random));

        expect(delays).toEqual(expected);
    });

    it('uses the configured base, multiplier, cap and jitter', () => {
        const { retry } = resolveStreamingWriterSettings(undefined, {
            retry: { baseDelayMs: 7, multiplier: 3, maxDelayMs: 100, jitterFraction: 0.2 },
        });

        expect([0, 1, 2, 3].map((attempt): number => computeRetryDelay(attempt, retry, (): number => 0))).toEqual([
            6, 17, 50, 80,
        ]);
    });
});
