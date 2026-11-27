/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { act, type ReactNode, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client'; // eslint-disable-line import/no-internal-modules
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentView } from './documentView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
    config: {
        id: 'document',
        clusterId: 'cluster',
        viewId: 'connectionsView',
        databaseName: 'database',
        collectionName: 'collection',
        documentId: 'document',
        mode: 'add',
    },
}));

vi.mock('@microsoft/vscode-ext-webview/react', () => ({
    useConfiguration: () => state.config,
}));
vi.mock('@vscode/l10n', () => ({ t: (message: string): string => message }));
vi.mock('@monaco-editor/react', () => ({ loader: { config: vi.fn() } }));
vi.mock('../../_integration/useViewLoadTelemetry', () => ({
    useViewLoadTelemetry: () => ({ reportFirstData: vi.fn() }),
}));
vi.mock('../../_integration/useTrpcClient', () => ({
    useTrpcClient: () => ({
        mongoClusters: {
            documentView: {
                getDocumentById: { query: vi.fn() },
                saveDocument: { mutate: vi.fn() },
            },
        },
        common: {
            explainOperationFailure: { query: vi.fn() },
            displayErrorMessage: { mutate: vi.fn() },
            reportEvent: { mutate: vi.fn() },
        },
    }),
}));
vi.mock('../../components/useSelectiveContextMenuPrevention', () => ({
    useSelectiveContextMenuPrevention: vi.fn(),
}));
vi.mock('../../components/MonacoEditor', () => ({
    MonacoEditor: ({
        onMount,
    }: {
        onMount: (
            editor: {
                setValue: (value: string) => void;
                getValue: () => string;
                layout: () => void;
                dispose: () => void;
            },
            monaco: unknown,
        ) => void;
    }): ReactNode => {
        useLayoutEffect(() => {
            onMount(
                {
                    setValue: vi.fn(),
                    getValue: vi.fn(() => '{  }'),
                    layout: vi.fn(),
                    dispose: vi.fn(),
                },
                {},
            );
        }, [onMount]);
        return null;
    },
}));

describe('DocumentView initial focus', (): void => {
    let host: HTMLElement;
    let root: Root;

    afterEach((): void => {
        act(() => root?.unmount());
        host?.remove();
    });

    it('does not steal focus from an element the user already focused', async (): Promise<void> => {
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        const ExistingFocus = (): ReactNode => {
            useLayoutEffect(() => {
                host.querySelector<HTMLInputElement>('[data-user-focus]')?.focus();
            }, []);
            return (
                <>
                    <input aria-label="User focus" data-user-focus />
                    <DocumentView />
                </>
            );
        };

        await act(async () => {
            root.render(<ExistingFocus />);
        });

        expect(document.activeElement).toBe(host.querySelector('[data-user-focus]'));
    });
});
