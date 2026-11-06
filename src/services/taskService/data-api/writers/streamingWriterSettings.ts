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

function definedOnly<T extends object>(value: T | undefined): Partial<T> {
    return Object.fromEntries(Object.entries(value ?? {}).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

/** Resolves package defaults < adapter defaults < caller overrides, field by field. */
export function resolveStreamingWriterSettings(
    adapterDefaults?: StreamingWriterSettings,
    overrides?: StreamingWriterSettings,
): ResolvedStreamingWriterSettings {
    const settings: ResolvedStreamingWriterSettings = {
        batching: {
            ...DEFAULT_SETTINGS.batching,
            ...definedOnly(adapterDefaults?.batching),
            ...definedOnly(overrides?.batching),
            fast: {
                ...DEFAULT_SETTINGS.batching.fast,
                ...definedOnly(adapterDefaults?.batching?.fast),
                ...definedOnly(overrides?.batching?.fast),
            },
            ruLimited: {
                ...DEFAULT_SETTINGS.batching.ruLimited,
                ...definedOnly(adapterDefaults?.batching?.ruLimited),
                ...definedOnly(overrides?.batching?.ruLimited),
            },
        },
        retry: { ...DEFAULT_SETTINGS.retry, ...definedOnly(adapterDefaults?.retry), ...definedOnly(overrides?.retry) },
        estimateDocumentSize:
            overrides?.estimateDocumentSize ??
            adapterDefaults?.estimateDocumentSize ??
            DEFAULT_SETTINGS.estimateDocumentSize,
    };

    const positiveIntegers = [
        ['batching.fast.initialBatchSize', settings.batching.fast.initialBatchSize],
        ['batching.fast.maxBatchSize', settings.batching.fast.maxBatchSize],
        ['batching.ruLimited.initialBatchSize', settings.batching.ruLimited.initialBatchSize],
        ['batching.ruLimited.maxBatchSize', settings.batching.ruLimited.maxBatchSize],
        ['batching.minBatchSize', settings.batching.minBatchSize],
        ['retry.maxAttemptsWithoutProgress', settings.retry.maxAttemptsWithoutProgress],
    ] as const;
    for (const [path, value] of positiveIntegers) {
        if (!Number.isInteger(value) || value < 1) {
            throw new Error(`Invalid streaming writer setting ${path}: ${String(value)} (expected an integer of at least 1).`);
        }
    }
    if (settings.batching.startMode !== 'fast' && settings.batching.startMode !== 'ru-limited') {
        throw new Error(
            `Invalid streaming writer setting batching.startMode: ${String(settings.batching.startMode)} (expected fast or ru-limited).`,
        );
    }
    return settings;
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
