/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { act, type ReactNode, type Ref } from 'react';
import { createRoot, type Root } from 'react-dom/client'; // eslint-disable-line import/no-internal-modules
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    fieldColumnKey,
    ROOT_ID_COLUMN_KEY,
    type ColumnKey,
    type TablePage,
} from '../../../utils/documentGrid/types';
import { CollectionView } from './CollectionView';
import { Views } from './collectionViewContext';
import type { DataViewPanelTableFocusRequest } from './components/resultsTab/DataViewPanelTable';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface DeferredTableRequest {
    readonly path: readonly string[];
    readonly resolve: (page: TablePage) => void;
    readonly reject: (error: unknown) => void;
}

interface TableHostProps {
    readonly page: TablePage | undefined;
    readonly focusRequest?: DataViewPanelTableFocusRequest;
    readonly onStepIn: (
        rowKey: string,
        columnKey: ColumnKey,
        gesture: 'keyboard' | 'pointer',
    ) => void;
}

const rootPage: TablePage = {
    path: [],
    columns: [
        { key: ROOT_ID_COLUMN_KEY, label: '_id' },
        { key: fieldColumnKey('details'), label: 'details' },
    ],
    rows: [
        {
            rowKey: 'pos:0',
            cells: {
                [fieldColumnKey('details')]: { display: '{...}', type: 'object' },
            },
        },
    ],
};

const nestedPage: TablePage = {
    path: ['details'],
    columns: [
        { key: ROOT_ID_COLUMN_KEY, label: '_id' },
        { key: fieldColumnKey('nestedName'), label: 'nestedName' },
    ],
    rows: [
        {
            rowKey: 'pos:0',
            cells: {
                [fieldColumnKey('nestedName')]: { display: 'nested', type: 'string' },
            },
        },
    ],
};

const boundaries = vi.hoisted(() => ({
    latestTableProps: undefined as TableHostProps | undefined,
}));

const client = vi.hoisted(() => {
    const tableResults: TablePage[] = [];
    const tableRequests: DeferredTableRequest[] = [];
    const mutation = (): { mutate: ReturnType<typeof vi.fn<() => Promise<void>>> } => ({
        mutate: vi.fn(async (): Promise<void> => undefined),
    });
    return {
        tableResults,
        tableRequests,
        trpc: {
            common: {
                displayErrorMessage: mutation(),
                explainOperationFailure: { query: vi.fn(async (): Promise<null> => null) },
                openFeedback: mutation(),
                reportEvent: mutation(),
            },
            mongoClusters: {
                collectionView: {
                    addDocument: mutation(),
                    deleteDocumentsById: { mutate: vi.fn(async (): Promise<boolean> => true) },
                    editDocumentById: mutation(),
                    getCurrentPageAsJson: { query: vi.fn(async (): Promise<string[]> => []) },
                    getCurrentPageAsTable: {
                        query: vi.fn((path: readonly string[]): Promise<TablePage> => {
                            const result = tableResults.shift();
                            if (result !== undefined) {
                                return Promise.resolve(result);
                            }
                            return new Promise<TablePage>((resolve, reject) => {
                                tableRequests.push({ path, resolve, reject });
                            });
                        }),
                    },
                    getCurrentPageAsTree: { query: vi.fn(async (): Promise<[]> => []) },
                    getFieldCompletionData: { query: vi.fn(async (): Promise<[]> => []) },
                    queryInsights: {
                        getQueryInsightsStage1: { query: vi.fn(async (): Promise<never> => Promise.reject()) },
                    },
                    runFindQuery: { query: vi.fn(async (): Promise<{ documentCount: number }> => ({ documentCount: 1 })) },
                    setCollectionDocumentView: mutation(),
                    viewDocumentById: mutation(),
                },
            },
        },
    };
});

vi.mock('@vscode/l10n', () => ({
    t: (message: string, ...args: unknown[]): string =>
        args.reduce<string>((result, value, index) => result.replace(`{${index}}`, String(value)), message),
}));
vi.mock('@microsoft/vscode-ext-webview/react', () => ({
    useConfiguration: () => ({
        sessionId: 'session',
        clusterId: 'cluster',
        clusterDisplayName: 'cluster',
        viewId: 'view',
        databaseName: 'database',
        collectionName: 'collection',
        initialDocumentView: Views.TABLE,
        defaultPageSize: 50,
        enableAIQueryGeneration: false,
    }),
}));
vi.mock('../../_integration/useTrpcClient', () => ({ useTrpcClient: () => client.trpc }));
vi.mock('../../_integration/useViewLoadTelemetry', () => ({
    useViewLoadTelemetry: () => ({ reportFirstData: vi.fn() }),
}));
vi.mock('../../components/accessibility', () => ({
    Announcer: (): null => null,
}));
vi.mock('../../components/useSelectiveContextMenuPrevention', () => ({
    useSelectiveContextMenuPrevention: (): void => undefined,
}));
vi.mock('../../query-language-support', () => ({ setCompletionContext: vi.fn() }));
vi.mock('@fluentui/react-icons', () => ({ EmojiRegular: (): null => null }));
vi.mock('@fluentui/react-components', () => ({
    Button: ({ children }: { readonly children?: ReactNode }): React.JSX.Element => <button>{children}</button>,
    ProgressBar: (): React.JSX.Element => <div role="progressbar" />,
    Tab: ({ children }: { readonly children?: ReactNode }): React.JSX.Element => <button>{children}</button>,
    TabList: ({ children }: { readonly children?: ReactNode }): React.JSX.Element => <div>{children}</div>,
}));
vi.mock('./components/queryEditor/QueryEditor', () => ({
    QueryEditor: ({ onExecuteRequest }: { readonly onExecuteRequest: () => void }): React.JSX.Element => (
        <button type="button" onClick={onExecuteRequest}>Execute query</button>
    ),
}));
vi.mock('./components/resultsTab/DataViewPanelTable', async () => {
    const { useContext } = await import('react');
    const { CollectionViewContext: ActualContext } = await import('./collectionViewContext');
    return {
        DataViewPanelTable: (props: TableHostProps): React.JSX.Element => {
            boundaries.latestTableProps = props;
            const [, setContext] = useContext(ActualContext);
            return (
                <div role="grid" data-focus-row={props.focusRequest?.rowKey}>
                    <button
                        type="button"
                        role="gridcell"
                        onClick={(event): void => {
                            event.currentTarget.focus();
                            props.onStepIn('pos:0', fieldColumnKey('details'), 'keyboard');
                        }}
                    >
                        {'{...}'}
                    </button>
                    <button
                        type="button"
                        onClick={(): void => props.onStepIn('pos:0', fieldColumnKey('details'), 'pointer')}
                    >
                        Pointer step-in
                    </button>
                    <button
                        type="button"
                        onClick={(): void =>
                            setContext((previous) => ({
                                ...previous,
                                currentViewState: { currentPath: [] },
                            }))
                        }
                    >
                        Root
                    </button>
                </div>
            );
        },
    };
});
vi.mock('./components/resultsTab/DataViewPanelTree', () => ({
    DataViewPanelTree: (): React.JSX.Element => <div />,
}));
vi.mock('./components/resultsTab/DataViewPanelJSON', () => ({
    DataViewPanelJSON: (): React.JSX.Element => <div />,
}));
vi.mock('./components/toolbar/CollectionQueryActionBar', () => ({
    CollectionQueryActionBar: (): React.JSX.Element => <div />,
}));
vi.mock('./components/toolbar/ToolbarDocumentManipulation', () => ({
    ToolbarDocumentManipulation: (): React.JSX.Element => <div />,
}));
vi.mock('./components/toolbar/ToolbarTableNavigation', () => ({
    ToolbarTableNavigation: (): React.JSX.Element => <div />,
}));
vi.mock('./components/toolbar/ToolbarViewNavigation', () => ({
    ToolbarViewNavigation: (): React.JSX.Element => <div />,
}));
vi.mock('./components/toolbar/ViewSwitcher', () => ({
    ViewSwitcher: ({
        focusTargetRef,
    }: {
        readonly focusTargetRef?: Ref<HTMLButtonElement>;
    }): React.JSX.Element => (
        <button ref={focusTargetRef} type="button" aria-label="Select view type">
            Table View
        </button>
    ),
}));
vi.mock('./indexesTab/IndexesTab', () => ({ IndexesTab: (): React.JSX.Element => <div /> }));
vi.mock('./queryInsightsTab/QueryInsightsTab', () => ({ QueryInsightsMain: (): React.JSX.Element => <div /> }));

let host: HTMLDivElement;
let root: Root;
let mounted: boolean;

async function flush(): Promise<void> {
    await act(async () => {
        for (let index = 0; index < 5; index += 1) {
            await Promise.resolve();
        }
    });
}

async function render(): Promise<void> {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    mounted = true;
    client.tableResults.push(rootPage);
    await act(async () => root.render(<CollectionView />));
    await flush();
}

function button(name: string): HTMLButtonElement {
    const element = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
        (candidate): boolean => candidate.textContent?.includes(name) ?? false,
    );
    if (!element) {
        throw new Error(`Missing button: ${name}`);
    }
    return element;
}

async function click(element: HTMLElement): Promise<void> {
    await act(async () => element.click());
    await flush();
}

async function keyboardStepIn(): Promise<DeferredTableRequest> {
    await click(button('{...}'));
    const request = client.tableRequests.shift();
    if (!request) {
        throw new Error('No table request was started');
    }
    return request;
}

function focusRequests(): readonly DataViewPanelTableFocusRequest[] {
    return boundaries.latestTableProps?.focusRequest ? [boundaries.latestTableProps.focusRequest] : [];
}

beforeEach(() => {
    client.tableResults.length = 0;
    client.tableRequests.length = 0;
    boundaries.latestTableProps = undefined;
    vi.clearAllMocks();
});

afterEach(async () => {
    if (mounted) {
        await act(async () => root.unmount());
        mounted = false;
    }
    host?.remove();
});

describe('TDD: CollectionView keyboard step-in focus intent', (): void => {
    it('sets focus only for the matching successful claimed request and cleans its listener', async (): Promise<void> => {
        const add = vi.spyOn(document, 'addEventListener');
        const remove = vi.spyOn(document, 'removeEventListener');
        await render();
        const request = await keyboardStepIn();
        const listenerCall = add.mock.calls.find((call) => call[0] === 'focusin');
        expect(listenerCall?.[2]).toBe(true);

        await act(async () => request.resolve(nestedPage));
        await flush();

        expect(focusRequests()).toEqual([{ page: nestedPage, rowKey: 'pos:0' }]);
        expect(remove).toHaveBeenCalledWith('focusin', listenerCall?.[1], true);
        add.mockRestore();
        remove.mockRestore();
    });

    it('does not revive an intent when a failed request is followed by retry', async (): Promise<void> => {
        await render();
        const failed = await keyboardStepIn();
        await act(async () => failed.reject(new Error('table failed')));
        await flush();

        await click(button('Execute query'));
        const retry = client.tableRequests.shift();
        if (!retry) {
            throw new Error('Missing retry request');
        }
        await act(async () => retry.resolve(nestedPage));
        await flush();

        expect(focusRequests()).toEqual([]);
    });

    it('cancels an old intent when a newer query claims the same destination path', async (): Promise<void> => {
        await render();
        const old = await keyboardStepIn();
        await click(button('Execute query'));
        const newer = client.tableRequests.shift();
        if (!newer) {
            throw new Error('Missing newer same-path request');
        }
        expect(newer.path).toEqual(old.path);

        await act(async () => old.resolve(nestedPage));
        await flush();
        const newerPage = { ...nestedPage, rows: nestedPage.rows.map((row) => ({ ...row })) };
        await act(async () => newer.resolve(newerPage));
        await flush();

        expect(focusRequests()).toEqual([]);
    });

    it('cancels the intent when navigation changes away from its destination', async (): Promise<void> => {
        await render();
        const intended = await keyboardStepIn();
        await click(button('Root'));
        const rootRequest = client.tableRequests.shift();
        if (!rootRequest) {
            throw new Error('Missing root navigation request');
        }
        await act(async () => {
            intended.resolve(nestedPage);
            rootRequest.resolve(rootPage);
        });
        await flush();

        expect(focusRequests()).toEqual([]);
    });

    it('permanently cancels on outside focus even if focus later returns', async (): Promise<void> => {
        const add = vi.spyOn(document, 'addEventListener');
        const remove = vi.spyOn(document, 'removeEventListener');
        await render();
        const request = await keyboardStepIn();
        const picker = host.querySelector<HTMLButtonElement>('[aria-label="Select view type"]');
        const objectCell = button('{...}');
        if (!picker) {
            throw new Error('Missing view picker');
        }

        await act(async () => {
            picker.focus();
            objectCell.focus();
            request.resolve(nestedPage);
        });
        await flush();

        const listenerCall = add.mock.calls.find((call) => call[0] === 'focusin');
        expect(remove).toHaveBeenCalledWith('focusin', listenerCall?.[1], true);
        expect(focusRequests()).toEqual([]);
        add.mockRestore();
        remove.mockRestore();
    });

    it('does not create a focus intent for pointer step-in', async (): Promise<void> => {
        const add = vi.spyOn(document, 'addEventListener');
        await render();
        await click(button('Pointer step-in'));
        const request = client.tableRequests.shift();
        if (!request) {
            throw new Error('Missing pointer step-in request');
        }
        await act(async () => request.resolve(nestedPage));
        await flush();

        expect(add.mock.calls.filter((call) => call[0] === 'focusin')).toEqual([]);
        expect(focusRequests()).toEqual([]);
        add.mockRestore();
    });

    it('removes a pending focus listener on unmount', async (): Promise<void> => {
        const add = vi.spyOn(document, 'addEventListener');
        const remove = vi.spyOn(document, 'removeEventListener');
        await render();
        await keyboardStepIn();
        const listenerCall = add.mock.calls.find((call) => call[0] === 'focusin');

        await act(async () => root.unmount());
        mounted = false;

        expect(remove).toHaveBeenCalledWith('focusin', listenerCall?.[1], true);
        add.mockRestore();
        remove.mockRestore();
    });
});
