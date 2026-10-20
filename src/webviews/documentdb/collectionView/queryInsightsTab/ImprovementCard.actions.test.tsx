/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @vitest-environment jsdom
import { SSRProvider } from '@fluentui/react-components';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createImprovementCardConfig } from '../utils/createImprovementCard';
import { ImprovementCard } from './components/optimizationCards/ImprovementCard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ImprovementCard action capabilities', () => {
    let host: HTMLDivElement;
    let root: Root;
    const config = createImprovementCardConfig({
        action: 'create', indexSpec: { status: 1 }, indexName: 'status_1',
        shellCommand: 'db.items.createIndex({status: 1})', justification: 'Avoid a collection scan.', priority: 'high',
    }, 0, { clusterId: 'cluster', databaseName: 'db', collectionName: 'items' });

    beforeEach(() => {
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
    });
    afterEach(async () => {
        await act(async () => root.unmount());
        host.remove();
    });

    it('preserves the connected primary action by default', async () => {
        const action = vi.fn().mockResolvedValue({ success: true });
        await act(async () => root.render(<SSRProvider><ImprovementCard config={config} onPrimaryAction={action} /></SSRProvider>));
        const button = host.querySelector('button');
        expect(button?.textContent).toBe('Create Index…');
        expect(host.textContent).not.toContain('Copy command');
        await act(async () => button?.click());
        expect(action).toHaveBeenCalledWith('createIndex', config.primaryButton?.payload);
    });

    it('shows only Copy command when index actions are disabled', async () => {
        const copy = vi.fn();
        const action = vi.fn();
        await act(async () => root.render(
            <SSRProvider><ImprovementCard config={config} actionsEnabled={false} onCopy={copy} onPrimaryAction={action} /></SSRProvider>,
        ));
        const buttons = host.querySelectorAll('button');
        expect(buttons).toHaveLength(1);
        expect(buttons[0].textContent).toBe('Copy command');
        await act(async () => buttons[0].click());
        expect(copy).toHaveBeenCalledOnce();
        expect(action).not.toHaveBeenCalled();
    });
});
