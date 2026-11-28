/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client'; // eslint-disable-line import/no-internal-modules
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TypedValueCell } from './TypedValueCell';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@vscode/l10n', () => ({
    t: (message: string): string => message,
}));

const mounted: { host: HTMLElement; root: Root }[] = [];

async function render(node: ReactNode): Promise<HTMLElement> {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    mounted.push({ host, root });
    await act(async () => {
        root.render(node);
    });
    return host;
}

afterEach(async () => {
    for (const { host, root } of mounted.splice(0)) {
        await act(async () => {
            root.unmount();
        });
        host.remove();
    }
    document.body.replaceChildren();
});

describe('TypedValueCell', () => {
    it('renders the formatted value with its existing type glyph and accessible full type name', async () => {
        const host = await render(<TypedValueCell value={{ display: '12.50', type: 'decimal128' }} />);
        const cell = host.firstElementChild;
        const typeName = cell?.firstElementChild;
        const value = typeName?.nextElementSibling;
        const glyph = cell?.lastElementChild;

        expect(host.textContent).toBe('Decimal128 12.50d128');
        expect(cell?.hasAttribute('tabindex')).toBe(false);
        expect(cell?.getAttribute('aria-describedby')).toBeNull();
        expect(cell?.getAttribute('aria-label')).toBeNull();
        expect(typeName?.textContent).toBe('Decimal128');
        expect(typeName?.nextSibling?.textContent).toBe(' ');
        expect(typeName?.nextElementSibling).toBe(value);
        expect(value?.textContent).toBe('12.50');
        expect(glyph?.textContent).toBe('d128');
        expect(glyph?.getAttribute('aria-hidden')).toBe('true');
    });

    it('keeps missing and explicit null as distinct accessible cell states', async () => {
        const missingHost = await render(<TypedValueCell value={undefined} />);
        const missing = missingHost.firstElementChild;
        const nullHost = await render(<TypedValueCell value={{ display: 'null', type: 'null' }} />);
        const explicitNull = nullHost.firstElementChild;
        const emptyHost = await render(<TypedValueCell value={{ display: '', type: 'string' }} />);

        expect(missingHost.textContent).toBe('');
        expect(missing?.hasAttribute('tabindex')).toBe(false);
        expect(missing?.getAttribute('role')).toBe('group');
        expect(missing?.getAttribute('aria-label')).toBe('This field is not set');
        expect(nullHost.textContent).toBe('Null nullØ');
        expect(explicitNull?.getAttribute('aria-describedby')).toBeNull();
        expect(emptyHost.textContent).toBe('String Ab');
    });

    it('renders untrusted display strings only as React text', async () => {
        const value = '<strong>display-only text</strong> <img src=x onerror=alert(1)>';
        const host = await render(<TypedValueCell value={{ display: value, type: 'string' }} />);

        expect(host.textContent).toBe(`String ${value}Ab`);
        expect(host.querySelector('strong, img, script')).toBeNull();
    });
});
