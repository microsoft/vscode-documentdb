/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client'; // eslint-disable-line import/no-internal-modules
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type ImprovementCard as ImprovementCardConfig } from '../../../types/queryInsights';
import { ImprovementCard } from './ImprovementCard';

vi.mock('@vscode/l10n', () => ({
    t: (message: string, ...args: unknown[]): string =>
        args.reduce<string>((result, arg, index) => result.replace(`{${index}}`, String(arg)), message),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface ActionResult {
    success: boolean;
    message?: string;
}

interface Deferred {
    promise: Promise<ActionResult>;
    resolve: (result: ActionResult) => void;
}

const mounted: { host: HTMLElement; root: Root }[] = [];

function deferred(): Deferred {
    let resolve: (result: ActionResult) => void = () => undefined;
    const promise = new Promise<ActionResult>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

async function renderCard(
    primaryAction?: (actionId: string, payload: unknown) => Promise<ActionResult>,
    secondaryAction?: (actionId: string, payload: unknown) => Promise<ActionResult>,
): Promise<HTMLElement> {
    const config: ImprovementCardConfig = {
        type: 'improvement',
        cardId: 'card-1',
        title: 'Create an index',
        priority: 'high',
        description: 'An index can improve this query.',
        recommendedIndex: '{ field: 1 }',
        indexName: 'field_1',
        recommendedIndexDetails: 'Indexes the field in ascending order.',
        details: 'Check the index build cost.',
        shellCommand: 'db.collection.createIndex({ field: 1 })',
        primaryButton: {
            label: 'Primary action',
            actionId: 'primaryAction',
            payload: { source: 'primary' },
        },
        secondaryButton: {
            label: 'Secondary action',
            actionId: 'secondaryAction',
            payload: { source: 'secondary' },
        },
    };
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    mounted.push({ host, root });
    await act(async () => {
        root.render(
            <ImprovementCard config={config} onPrimaryAction={primaryAction} onSecondaryAction={secondaryAction} />,
        );
    });
    return host;
}

function buttonWithLabel(host: HTMLElement, label: string): HTMLButtonElement {
    const button = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
        (candidate) => candidate.textContent?.trim() === label,
    );
    if (!button) {
        throw new Error(`Missing button: ${label}`);
    }
    return button;
}

afterEach(async () => {
    for (const { host, root } of mounted.splice(0)) {
        await act(async () => root.unmount());
        host.remove();
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('ImprovementCard action announcements', () => {
    it.each(['primary', 'secondary'] as const)(
        'keeps focus and announces %s success without allowing duplicate clicks',
        async (actionKind) => {
            vi.useFakeTimers();
            const pending = deferred();
            const action = vi.fn((_actionId: string, _payload: unknown) => pending.promise);
            const host = actionKind === 'primary' ? await renderCard(action) : await renderCard(undefined, action);
            const regions = Array.from(host.querySelectorAll<HTMLElement>('[role="status"]'));
            const politeRegions = Array.from(host.querySelectorAll<HTMLElement>('[aria-live="polite"]'));
            const successRegion = politeRegions[actionKind === 'primary' ? 0 : 1];
            const button = buttonWithLabel(host, actionKind === 'primary' ? 'Primary action' : 'Secondary action');

            expect(regions).toHaveLength(4);
            expect(regions.every((region) => region.textContent === '')).toBe(true);
            button.focus();

            await act(async () => button.click());
            expect(button.getAttribute('aria-disabled')).toBe('true');
            expect(button.hasAttribute('disabled')).toBe(false);
            expect(document.activeElement).toBe(button);

            await act(async () => button.click());
            expect(action).toHaveBeenCalledTimes(1);

            await act(async () => {
                pending.resolve({ success: true, message: `${actionKind} completed` });
                await pending.promise;
            });
            expect(document.activeElement).toBe(button);

            await act(async () => vi.advanceTimersByTimeAsync(100));
            const currentSuccessRegion = Array.from(host.querySelectorAll<HTMLElement>('[aria-live="polite"]'))[
                actionKind === 'primary' ? 0 : 1
            ];
            expect(currentSuccessRegion).toBe(successRegion);
            expect(successRegion.textContent).toBe(`${actionKind} completed`);
            expect(document.activeElement).toBe(button);

            await act(async () => button.click());
            expect(action).toHaveBeenCalledTimes(1);
        },
    );

    it.each(['primary', 'secondary'] as const)(
        'announces repeated %s failures as assertive retry messages',
        async (actionKind) => {
            vi.useFakeTimers();
            const first = deferred();
            const second = deferred();
            const action = vi
                .fn((_actionId: string, _payload: unknown) => first.promise)
                .mockReturnValueOnce(first.promise)
                .mockReturnValueOnce(second.promise);
            const host = actionKind === 'primary' ? await renderCard(action) : await renderCard(undefined, action);
            const errorRegion = Array.from(host.querySelectorAll<HTMLElement>('[aria-live="assertive"]'))[
                actionKind === 'primary' ? 0 : 1
            ];
            const button = buttonWithLabel(host, actionKind === 'primary' ? 'Primary action' : 'Secondary action');

            await act(async () => button.click());
            await act(async () => {
                first.resolve({ success: false, message: 'Try again' });
                await first.promise;
            });
            await act(async () => vi.advanceTimersByTimeAsync(100));
            expect(errorRegion.textContent).toBe('Error: Try again');
            expect(button.textContent?.trim()).toBe('Retry');

            await act(async () => button.click());
            await act(async () => vi.advanceTimersByTimeAsync(0));
            expect(errorRegion.textContent).toBe('');

            await act(async () => {
                second.resolve({ success: false, message: 'Try again' });
                await second.promise;
            });
            await act(async () => vi.advanceTimersByTimeAsync(100));
            expect(errorRegion.textContent).toBe('Error: Try again');
            expect(action).toHaveBeenCalledTimes(2);
        },
    );
});
