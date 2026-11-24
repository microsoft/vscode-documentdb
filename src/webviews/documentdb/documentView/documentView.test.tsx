/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { act, useEffect, useRef, useState, type Ref } from 'react';
import { createRoot, type Root } from 'react-dom/client'; // eslint-disable-line import/no-internal-modules
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { type DocumentsViewWebviewConfigurationType } from './documentsViewController';
import { DocumentView } from './documentView';

const mocks = vi.hoisted(() => ({
    configuration: undefined as DocumentsViewWebviewConfigurationType | undefined,
    getDocumentById: vi.fn(),
    saveDocument: vi.fn(),
    recoverUnavailable: vi.fn(),
    explainOperationFailure: vi.fn(),
    displayErrorMessage: vi.fn(),
    reportEvent: vi.fn(),
}));

vi.mock('@microsoft/vscode-ext-webview/react', () => ({
    useConfiguration: () => mocks.configuration,
}));
vi.mock('../../_integration/useTrpcClient', () => ({
    useTrpcClient: () => ({
        mongoClusters: {
            documentView: {
                getDocumentById: { query: mocks.getDocumentById },
                saveDocument: { mutate: mocks.saveDocument },
                recoverUnavailable: { mutate: mocks.recoverUnavailable },
            },
        },
        common: {
            explainOperationFailure: { query: mocks.explainOperationFailure },
            displayErrorMessage: { mutate: mocks.displayErrorMessage },
            reportEvent: { mutate: mocks.reportEvent },
        },
    }),
}));
vi.mock('../../_integration/useViewLoadTelemetry', () => ({
    useViewLoadTelemetry: () => ({ reportFirstData: vi.fn() }),
}));
vi.mock('@monaco-editor/react', () => ({ loader: { config: vi.fn() } }));
vi.mock('monaco-editor/esm/vs/editor/editor.api', () => ({ editor: {} }));
vi.mock('../../components/useSelectiveContextMenuPrevention', () => ({
    useSelectiveContextMenuPrevention: vi.fn(),
}));
vi.mock('./components/toolbarDocuments', () => ({
    ToolbarDocuments: ({
        disableSaveButton,
        onSaveRequest,
        saveButtonRef,
    }: {
        disableSaveButton: boolean;
        onSaveRequest: () => void;
        saveButtonRef: Ref<HTMLButtonElement>;
    }) => (
        <button ref={saveButtonRef} disabled={disableSaveButton} onClick={onSaveRequest}>
            Save
        </button>
    ),
}));
vi.mock('../../components/MonacoEditor', () => ({
    MonacoEditor: ({
        value,
        onChange,
        onMount,
    }: {
        value: string;
        onChange: (value: string) => void;
        onMount: (editor: {
            getValue(): string;
            setValue(value: string): void;
            layout(): void;
            dispose(): void;
        }) => void;
    }) => {
        const [text, setText] = useState(value);
        const textRef = useRef(value);
        const changeRef = useRef(onChange);
        changeRef.current = onChange;
        useEffect(() => {
            onMount({
                getValue: () => textRef.current,
                setValue: (next): void => {
                    textRef.current = next;
                    setText(next);
                    changeRef.current(next);
                },
                layout: vi.fn(),
                dispose: vi.fn(),
            });
        }, []);
        return (
            <textarea
                aria-label="Document"
                value={text}
                onChange={(event) => {
                    textRef.current = event.target.value;
                    setText(event.target.value);
                    onChange(event.target.value);
                }}
            />
        );
    },
}));

interface Deferred<T> {
    readonly promise: Promise<T>;
    resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((complete) => {
        resolve = complete;
    });
    return { promise, resolve };
}

const host = document.createElement('div');
let root: Root;

async function render(config: DocumentsViewWebviewConfigurationType): Promise<void> {
    mocks.configuration = config;
    await act(async () => root.render(<DocumentView />));
}

function config(mode: 'add' | 'edit'): DocumentsViewWebviewConfigurationType {
    return {
        id: 'document',
        clusterId: 'cluster',
        viewId: 'connectionsView',
        databaseName: 'database',
        collectionName: 'collection',
        documentId: mode === 'edit' ? '{"$oid":"000000000000000000000001"}' : '',
        mode,
    };
}

async function edit(value: string): Promise<void> {
    const editor = host.querySelector('textarea');
    expect(editor).not.toBeNull();
    await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        setter?.call(editor, value);
        editor?.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

async function save(): Promise<void> {
    const button = [...host.querySelectorAll('button')].find((candidate) => candidate.textContent === 'Save');
    expect(button?.disabled).toBe(false);
    await act(async () => button?.click());
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach((): void => {
    vi.clearAllMocks();
    document.body.appendChild(host);
    root = createRoot(host);
    mocks.explainOperationFailure.mockResolvedValue(undefined);
    mocks.displayErrorMessage.mockResolvedValue(undefined);
    mocks.reportEvent.mockResolvedValue(undefined);
});

afterEach(async (): Promise<void> => {
    await act(async () => root.unmount());
    host.replaceChildren();
    host.remove();
});

it('keeps a newer edit and reuses the preallocated insert identity after an older save reply', async (): Promise<void> => {
    const firstSave = deferred<{ documentId: string; documentStringified: string }>();
    mocks.saveDocument.mockReturnValueOnce(firstSave.promise);
    mocks.saveDocument.mockResolvedValueOnce({
        documentId: '{"$oid":"000000000000000000000002"}',
        documentStringified: '{"field":"third"}',
    });
    await render(config('add'));
    await edit('{"field":"first"}');
    await save();
    await edit('{"field":"second"}');
    const firstIdentity = mocks.saveDocument.mock.calls[0][0].documentId as string;
    expect(firstIdentity).toMatch(/^\{"\$oid":"[a-f0-9]{24}"\}$/);

    await act(async () =>
        firstSave.resolve({
            documentId: firstIdentity,
            documentStringified: '{"field":"first"}',
        }),
    );
    expect(host.querySelector('textarea')?.value).toBe('{"field":"second"}');
    expect([...host.querySelectorAll('button')].some((button) => button.textContent === 'Save' && !button.disabled)).toBe(
        true,
    );

    await save();
    expect(mocks.saveDocument).toHaveBeenCalledTimes(2);
    expect(mocks.saveDocument.mock.calls[1][0].documentId).toBe(firstIdentity);
});

it('ignores a load reply after disable and leaves an edit-mode placeholder unsavable', async (): Promise<void> => {
    const load = deferred<string>();
    mocks.getDocumentById.mockReturnValueOnce(load.promise);
    await render(config('edit'));
    await edit('{"field":"preserved"}');

    await act(async () => {
        window.dispatchEvent(
            new MessageEvent('message', {
                data: {
                    type: 'documentView.connectionUnavailable',
                    unavailable: {
                        reason: 'userDisconnected',
                        text: 'Connection is disconnected.',
                        action: 'reconnect',
                    },
                },
            }),
        );
        load.resolve('{"field":"old reply"}');
    });

    expect(host.querySelector('textarea')?.value).toBe('{"field":"preserved"}');
    expect([...host.querySelectorAll('button')].find((button) => button.textContent === 'Save')?.disabled).toBe(true);
    expect(host.textContent).toContain('Connection is disconnected.');
});
