// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MonacoEditorProps } from '../../components/MonacoEditor';
import { JsonPlanEditor } from './JsonPlanEditor';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let props: MonacoEditorProps;
vi.mock('../../components/MonacoEditor', () => ({
    MonacoEditor: (value: MonacoEditorProps): null => { props = value; return null; },
}));

describe('Query Insights JSON editor', () => {
    let host: HTMLDivElement;
    let root: Root;
    const model = {
        getLineCount: (): number => 3, getLineMaxColumn: (): number => 10,
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

    it('sets and clears positioned parse markers, preserves lines and offers an Escape exit', async () => {
        const onChange = vi.fn();
        await act(async () => root.render(
            <JsonPlanEditor value={'{\n  bad\n}'} ariaLabel="Explain output" onChange={onChange}
                issue={{ line: 2, column: 3, message: 'Invalid JSON' }} />,
        ));
        expect(props.language).toBe('json');
        expect(props.options).toMatchObject({
            ariaLabel: 'Explain output', wordWrap: 'off', lineNumbers: 'on',
            minimap: { enabled: false }, folding: true, automaticLayout: true,
        });
        const editor = { getModel: () => model } as unknown as Parameters<NonNullable<MonacoEditorProps['onMount']>>[0];
        const monaco = { editor: { setModelMarkers }, MarkerSeverity: { Error: 8 } } as unknown as Parameters<NonNullable<MonacoEditorProps['onMount']>>[1];
        await act(async () => props.onMount?.(editor, monaco));
        expect(setModelMarkers).toHaveBeenLastCalledWith(model, 'query-insights-input', [{
            severity: 8, message: 'Invalid JSON',
            startLineNumber: 2, endLineNumber: 2, startColumn: 3, endColumn: 4,
        }]);
        await act(async () => props.onEscapeEditor?.());
        expect(document.activeElement?.getAttribute('aria-label')).toBe('Outside Explain output editor');

        await act(async () => root.render(
            <JsonPlanEditor value="{}" compact ariaLabel="Explain output" onChange={onChange} />,
        ));
        expect(setModelMarkers).toHaveBeenLastCalledWith(model, 'query-insights-input', []);
        expect(host.querySelector('.query-insights-json-editor-compact')).not.toBeNull();
    });
});
