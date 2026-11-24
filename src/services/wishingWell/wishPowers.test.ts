/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EJSON } from 'bson';
import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

vi.mock('@vscode/l10n', () => ({
    t: vi.fn((message: string, ...args: unknown[]) =>
        args.reduce<string>((result, value, index) => result.replace(`{${String(index)}}`, String(value)), message),
    ),
}));

import { createWishPowers, documentsText, grantConfirmation } from './wishPowers';

describe('documentsText', () => {
    const documents = Array.from({ length: 10 }, (_, index) => ({ _id: index, note: 'x'.repeat(40) }));

    it('formats like EJSON.stringify when everything fits', () => {
        expect(documentsText(documents)).toEqual({
            text: EJSON.stringify(documents, undefined, 2, { relaxed: true }),
            shown: 10,
        });
        expect(documentsText([])).toEqual({ text: '[]', shown: 0 });
    });

    it('cuts on a document boundary within the cap, so the text still parses', () => {
        const { text, shown } = documentsText(documents, 300);
        expect(text.length).toBeLessThanOrEqual(300);
        expect(shown).toBeGreaterThan(0);
        expect(shown).toBeLessThan(10);
        expect(JSON.parse(text)).toEqual(documents.slice(0, shown));
    });

    it('shows nothing rather than half a document', () => {
        expect(documentsText([{ big: 'y'.repeat(500) }], 100)).toEqual({ text: '[]', shown: 0 });
    });
});

describe('grantConfirmation', () => {
    it('names the exact link, not what the agent says about it', () => {
        expect(
            grantConfirmation({ kind: 'link', url: 'https://example.com/x', title: 'Docs', message: 'Read the docs' }),
        ).toEqual({
            message: 'An agent wants to open a web page in your browser: https://example.com/x',
            detail: 'The agent says: Read the docs',
            label: 'Open link',
        });
    });

    it('shows the prompt handed to Copilot and the command an agent runs', () => {
        expect(grantConfirmation({ kind: 'agent', prompt: 'rm the repo', title: 't', message: 'm' })).toMatchObject({
            detail: 'rm the repo',
            label: 'Hand to Copilot',
        });
        expect(
            grantConfirmation({
                kind: 'command',
                commandId: 'workbench.extensions.search',
                argument: 'Prettier',
                title: 't',
                message: 'm',
            }).message,
        ).toBe('An agent wants to run "Search extensions" with "Prettier" in VS Code.');
    });
});

describe('confirmGrant', () => {
    const link = { kind: 'link', url: 'https://example.com', title: 't', message: 'm' } as const;

    it('asks with a modal and grants only on its own button', async () => {
        const ask = vi.mocked(vscode.window.showWarningMessage);
        ask.mockResolvedValueOnce('Open link' as never);
        await expect(createWishPowers().confirmGrant(link)).resolves.toBe(true);
        expect(ask).toHaveBeenLastCalledWith(
            'An agent wants to open a web page in your browser: https://example.com',
            { modal: true, detail: 'The agent says: m' },
            'Open link',
        );

        ask.mockResolvedValueOnce(undefined);
        await expect(createWishPowers().confirmGrant(link)).resolves.toBe(false);
    });
});
