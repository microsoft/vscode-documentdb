/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom
import type * as FluentUI from '@fluentui/react-components';
import { SSRProvider } from '@fluentui/react-components';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client'; // eslint-disable-line import/no-internal-modules -- Public React DOM client entry point.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShareMenu } from './ShareMenu';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no layout engine and Fluent's floating-popup positioning never settles there: render
// the menu surface inline. Opening and keyboard behavior are covered by the L2 browser scenario.
vi.mock('@fluentui/react-components', async (importOriginal) => {
    const actual = await importOriginal<typeof FluentUI>();
    const passThrough = ({ children }: { children: ReactNode }): ReactNode => <>{children}</>;
    return {
        ...actual,
        Menu: passThrough,
        MenuTrigger: passThrough,
        MenuPopover: passThrough,
        MenuList: ({ children }: { children: ReactNode }): ReactNode => <div role="menu">{children}</div>,
    };
});

class FakeClipboardItem {
    constructor(public readonly items: Record<string, Blob>) {}
}

/** jsdom's Blob has no `text()`. */
function readBlob(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (): void => resolve(reader.result as string);
        reader.onerror = (): void => reject(reader.error ?? new Error('Could not read the blob'));
        reader.readAsText(blob);
    });
}

describe('ShareMenu', () => {
    let host: HTMLDivElement;
    let root: Root;
    const copyText = vi.fn<(text: string) => Promise<unknown>>();
    const buildMarkdown = vi.fn((): string => '# Full report');
    const buildRichText = vi.fn(() => ({ html: '<p>Rich</p>', plainText: '# Summary' }));

    beforeEach(async () => {
        copyText.mockReset().mockResolvedValue(true);
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        await act(async () =>
            root.render(
                <SSRProvider>
                    <ShareMenu buildMarkdown={buildMarkdown} buildRichText={buildRichText} copyText={copyText} />
                </SSRProvider>,
            ),
        );
    });
    afterEach(async () => {
        await act(async () => root.unmount());
        host.remove();
        vi.unstubAllGlobals();
        Reflect.deleteProperty(navigator, 'clipboard');
    });

    const shareButton = (): HTMLButtonElement => {
        const button = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Share');
        if (!button) throw new Error('Share button not found');
        return button;
    };

    async function choose(label: string): Promise<void> {
        await act(async () => shareButton().click());
        const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
            (element) => document.getElementById(element.getAttribute('aria-labelledby') ?? '')?.textContent === label,
        );
        if (!item) throw new Error(`Menu item ${label} not found`);
        await act(async () => item.click());
    }

    async function announcement(): Promise<string> {
        // The announcer clears, then sets its message 100 ms later.
        await act(async () => new Promise<void>((resolve) => setTimeout(resolve, 150)));
        return host.querySelector('[role="status"]')?.textContent ?? '';
    }

    it('names each item by its label and describes it with the second line', async () => {
        await act(async () => shareButton().click());
        const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
        expect(items).toHaveLength(2);
        const describe = (item: HTMLElement): [string | null | undefined, string | null | undefined] => [
            document.getElementById(item.getAttribute('aria-labelledby') ?? '')?.textContent,
            document.getElementById(item.getAttribute('aria-describedby') ?? '')?.textContent,
        ];
        expect(describe(items[0])).toEqual([
            'Copy as Markdown',
            'Full report with model inputs, for issues and AI agents',
        ]);
        expect(describe(items[1])).toEqual(['Copy as rich text', 'Formatted with tables, for email, Teams and Word']);
    });

    it('copies the full Markdown report through the host and confirms it', async () => {
        await choose('Copy as Markdown');
        expect(copyText).toHaveBeenCalledExactlyOnceWith('# Full report');
        expect(await announcement()).toBe('Copied the report as Markdown');
        expect(shareButton().textContent).toBe('Share');
    });

    it('writes HTML with a plain-text alternative to the webview clipboard', async () => {
        const write = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('ClipboardItem', FakeClipboardItem);
        Object.defineProperty(navigator, 'clipboard', { value: { write }, configurable: true });
        await choose('Copy as rich text');
        expect(write).toHaveBeenCalledOnce();
        const [[[item]]] = write.mock.calls as [[FakeClipboardItem[]]];
        expect(Object.keys(item.items)).toEqual(['text/html', 'text/plain']);
        expect(item.items['text/html'].type).toBe('text/html');
        expect(await readBlob(item.items['text/html'])).toBe('<p>Rich</p>');
        expect(await readBlob(item.items['text/plain'])).toBe('# Summary');
        expect(copyText).not.toHaveBeenCalled();
        expect(await announcement()).toBe('Copied the report as rich text');
    });

    it('falls back to plain text through the host when rich text cannot be written', async () => {
        vi.stubGlobal('ClipboardItem', FakeClipboardItem);
        Object.defineProperty(navigator, 'clipboard', {
            value: { write: vi.fn().mockRejectedValue(new Error('NotAllowedError')) },
            configurable: true,
        });
        await choose('Copy as rich text');
        expect(copyText).toHaveBeenCalledExactlyOnceWith('# Summary');
        expect(await announcement()).toBe('Rich text is not available here. Copied the report as plain text');
    });

    it('announces a failure when nothing could be copied', async () => {
        vi.stubGlobal('ClipboardItem', undefined);
        copyText.mockResolvedValue(false);
        await choose('Copy as rich text');
        expect(copyText).toHaveBeenCalledExactlyOnceWith('# Summary');
        expect(await announcement()).toBe('Could not copy to the clipboard');
    });
});
