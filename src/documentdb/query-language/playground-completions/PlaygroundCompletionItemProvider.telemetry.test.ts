/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({}));
vi.mock('../../playground/PlaygroundService', () => ({ PlaygroundService: { getInstance: vi.fn() } }));
vi.mock('../../SchemaStore', () => ({ SchemaStore: { getInstance: vi.fn() } }));
vi.mock('./CollectionNameCache', () => ({ CollectionNameCache: { getInstance: vi.fn() } }));
vi.mock('../../../utils/accumulatingTelemetry', () => ({ accumulateTelemetry: vi.fn() }));

import type * as vscode from 'vscode';
import { COMPLETION_OFFERED_EVENT, COMPLETION_TELEMETRY_OPTIONS } from '../../../telemetry/completionCategories';
import { accumulateTelemetry } from '../../../utils/accumulatingTelemetry';
import { PlaygroundCompletionItemProvider } from './PlaygroundCompletionItemProvider';

type Compute = (...args: unknown[]) => vscode.CompletionItem[] | undefined;

function provide(result: vscode.CompletionItem[] | undefined): vscode.CompletionItem[] | undefined {
    const provider = new PlaygroundCompletionItemProvider();
    vi.spyOn(provider as unknown as { computeCompletionItems: Compute }, 'computeCompletionItems').mockReturnValue(
        result,
    );
    return provider.provideCompletionItems(
        {} as vscode.TextDocument,
        {} as vscode.Position,
        {} as vscode.CancellationToken,
        {} as vscode.CompletionContext,
    );
}

describe('PlaygroundCompletionItemProvider offered telemetry', () => {
    beforeEach(() => {
        vi.mocked(accumulateTelemetry).mockClear();
    });

    it('counts an offer when the provider returns items, with first-use batching', () => {
        const items = [{ label: 'name' } as vscode.CompletionItem];

        expect(provide(items)).toBe(items);

        expect(accumulateTelemetry).toHaveBeenCalledWith(
            COMPLETION_OFFERED_EVENT,
            expect.any(Function),
            COMPLETION_TELEMETRY_OPTIONS,
        );
        const sample = { measurements: {} as Record<string, number> };
        (vi.mocked(accumulateTelemetry).mock.calls[0][1] as (s: typeof sample) => void)(sample);
        expect(sample.measurements).toEqual({ src_playground: 1 });
    });

    it('does not count an offer when the provider defers to the TypeScript service', () => {
        expect(provide(undefined)).toBeUndefined();
        expect(provide([])).toEqual([]);
        expect(accumulateTelemetry).not.toHaveBeenCalled();
    });
});
