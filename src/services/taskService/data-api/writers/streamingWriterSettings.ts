/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DocumentDetails, type ModeConfig, type StreamingWriterSettings } from '../types';

export interface ResolvedStreamingWriterSettings {
    batching: {
        startMode: 'fast' | 'ru-limited';
        fast: ModeConfig;
        ruLimited: ModeConfig;
        minBatchSize: number;
        bufferMemoryLimitMB: number;
    };
    retry: Required<NonNullable<StreamingWriterSettings['retry']>>;
    estimateDocumentSize: (doc: DocumentDetails) => number;
}

const DEFAULT_SETTINGS: ResolvedStreamingWriterSettings = {
    batching: {
        startMode: 'fast',
        fast: { initialBatchSize: 500, maxBatchSize: 2000, growthFactor: 1.2 },
        ruLimited: { initialBatchSize: 100, maxBatchSize: 1000, growthFactor: 1.1 },
        minBatchSize: 1,
        bufferMemoryLimitMB: 24,
    },
    retry: {
        maxAttemptsWithoutProgress: 10,
        baseDelayMs: 100,
        multiplier: 2,
        maxDelayMs: 5000,
        jitterFraction: 0.3,
    },
    estimateDocumentSize: (document: DocumentDetails): number => {
        try {
            const jsonString = JSON.stringify(document.documentContent);
            return jsonString.length * 2; // UTF-16 encoding
        } catch {
            return 1024; // 1KB fallback
        }
    },
};

/** Resolves package defaults < adapter defaults < caller overrides, field by field. */
export function resolveStreamingWriterSettings(
    adapterDefaults?: StreamingWriterSettings,
    overrides?: StreamingWriterSettings,
): ResolvedStreamingWriterSettings {
    return {
        batching: {
            ...DEFAULT_SETTINGS.batching,
            ...adapterDefaults?.batching,
            ...overrides?.batching,
            fast: {
                ...DEFAULT_SETTINGS.batching.fast,
                ...adapterDefaults?.batching?.fast,
                ...overrides?.batching?.fast,
            },
            ruLimited: {
                ...DEFAULT_SETTINGS.batching.ruLimited,
                ...adapterDefaults?.batching?.ruLimited,
                ...overrides?.batching?.ruLimited,
            },
        },
        retry: { ...DEFAULT_SETTINGS.retry, ...adapterDefaults?.retry, ...overrides?.retry },
        estimateDocumentSize:
            overrides?.estimateDocumentSize ??
            adapterDefaults?.estimateDocumentSize ??
            DEFAULT_SETTINGS.estimateDocumentSize,
    };
}

/** Computes capped exponential backoff, then applies jitter and rounds to milliseconds. */
export function computeRetryDelay(
    attempt: number,
    retry: ResolvedStreamingWriterSettings['retry'],
    random: () => number = Math.random,
): number {
    return Math.round(
        Math.min(retry.baseDelayMs * Math.pow(retry.multiplier, attempt), retry.maxDelayMs) *
            (1 + (random() * 2 - 1) * retry.jitterFraction),
    );
}
