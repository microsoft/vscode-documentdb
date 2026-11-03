/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { act, type JSX, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client'; // eslint-disable-line import/no-internal-modules

import { type ResultCardData } from './connectivityTroubleshooterTypes';
import { TroubleshooterResultCard, type RunResult } from './TroubleshooterResultCard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@vscode/l10n', () => ({
    t: (message: string, ...args: unknown[]): string =>
        args.reduce<string>((result, value, index) => result.replace(`{${index}}`, String(value)), message),
}));

// Fluent's MessageBar shows its intent only through generated styles; record it where the card sets it.
vi.mock('../../components/MessageBlock', () => ({
    MessageBlock: ({ intent, children }: { intent?: string; children: ReactNode }): JSX.Element => (
        <div data-intent={intent}>{children}</div>
    ),
}));

const coverage = { limited: false, retryWouldHelp: false, connectionTimeoutLimited: false };

function finished(outcome: ResultCardData['outcome'], extra: Partial<ResultCardData> = {}): RunResult {
    return {
        kind: 'finished',
        outcome,
        coverage,
        card: {
            outcome,
            firewallHint: false,
            earlierSignInFailure: false,
            runTimeoutBeforeAttempt: false,
            authenticated: false,
            ...extra,
        },
    };
}

const mounted: { host: HTMLElement; root: Root }[] = [];

async function intentOf(result: RunResult): Promise<string | null | undefined> {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    mounted.push({ host, root });
    await act(async () => {
        root.render(<TroubleshooterResultCard result={result} rows={[]} onRetry={vi.fn()} />);
    });
    return host.querySelector('[data-intent]')?.getAttribute('data-intent');
}

afterEach(async () => {
    for (const { host, root } of mounted.splice(0)) {
        await act(async () => root.unmount());
        host.remove();
    }
});

describe('TroubleshooterResultCard intent', () => {
    it('WI-27: a connection that needs sign-in is a warning, neither success nor failure (decision 0048)', async () => {
        const headline = {
            title: 'Sign-in required to use this connection',
            explanation: 'The server answered, but it requires sign-in to list or read databases.',
        };
        expect(await intentOf(finished('connected', { signInRequired: true, headline }))).toBe('warning');
        expect(await intentOf(finished('connected'))).toBe('success');
        expect(await intentOf(finished('failed'))).toBe('error');
        expect(await intentOf(finished('notTested'))).toBe('warning');
    });
});
