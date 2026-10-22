/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client'; // eslint-disable-line import/no-internal-modules -- Public React DOM client entry point.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type MonacoEditorProps } from '../../components/MonacoEditor';
import { JsonPlanEditor } from './JsonPlanEditor';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let props: MonacoEditorProps;
vi.mock('../../components/MonacoEditor', () => ({
    MonacoEditor: (value: MonacoEditorProps): null => {
        props = value;
        return null;
    },
}));

describe('Query Insights JSON editor', () => {
    let host: HTMLDivElement;
    let root: Root;
    const model = {
        getLineCount: (): number => 3,
        getLineMaxColumn: (): number => 10,
        isDisposed: (): boolean => false,
    };
    const setModelMarkers = vi.fn();

    beforeEach(() => {
        setModelMarkers.mockClear();
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
    });
    afterEach(async () => {
        await act(async () => root.unmount());
        host.remove();
    });

    let contentHeight = 0;
    let resize: () => void = () => undefined;
    const editorHeight = (): string | undefined =>
        host.querySelector<HTMLElement>('.query-insights-json-editor')?.style.height;

    it('sets and clears positioned parse markers, preserves lines and offers an Escape exit', async () => {
        const onChange = vi.fn();
        await act(async () =>
            root.render(
                <JsonPlanEditor
                    value={'{\n  bad\n}'}
                    ariaLabel="Explain output"
                    onChange={onChange}
                    issue={{ line: 2, column: 3, message: 'Invalid JSON' }}
                />,
            ),
        );
        expect(props.language).toBe('json');
        expect(props.options).toMatchObject({
            ariaLabel: 'Explain output',
            wordWrap: 'on',
            lineNumbers: 'on',
            minimap: { enabled: false },
            folding: false,
            automaticLayout: true,
            glyphMargin: false,
            lineNumbersMinChars: 3,
            lineDecorationsWidth: 6,
        });
        const editor = {
            getModel: () => model,
            getContentHeight: () => contentHeight,
            onDidContentSizeChange: (listener: () => void) => {
                resize = listener;
                return { dispose: vi.fn() };
            },
        } as unknown as Parameters<NonNullable<MonacoEditorProps['onMount']>>[0];
        const monaco = { editor: { setModelMarkers }, MarkerSeverity: { Error: 8 } } as unknown as Parameters<
            NonNullable<MonacoEditorProps['onMount']>
        >[1];
        await act(async () => props.onMount?.(editor, monaco));
        // Grows with the content between its limits, then scrolls.
        expect(editorHeight()).toBe('120px');
        contentHeight = 250;
        await act(async () => resize());
        expect(editorHeight()).toBe('250px');
        contentHeight = 5000;
        await act(async () => resize());
        expect(editorHeight()).toBe('400px');
        expect(setModelMarkers).toHaveBeenLastCalledWith(model, 'query-insights-input', [
            {
                severity: 8,
                message: 'Invalid JSON',
                startLineNumber: 2,
                endLineNumber: 2,
                startColumn: 3,
                endColumn: 4,
            },
        ]);
        await act(async () => props.onEscapeEditor?.());
        expect(document.activeElement?.getAttribute('aria-label')).toBe('Outside Explain output editor');

        await act(async () =>
            root.render(<JsonPlanEditor value="{}" compact ariaLabel="Explain output" onChange={onChange} />),
        );
        expect(setModelMarkers).toHaveBeenLastCalledWith(model, 'query-insights-input', []);
        expect(host.querySelector('.query-insights-json-editor-compact')).not.toBeNull();
        expect(editorHeight()).toBe('240px');
    });
});
