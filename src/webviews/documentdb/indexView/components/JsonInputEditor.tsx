/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line import/no-internal-modules
import type * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';
import { useEffect, useId, useRef, type JSX } from 'react';
import { MonacoAutoHeight } from '../../../components/MonacoAutoHeight';
import {
    buildEditorUri,
    EditorType,
    LANGUAGE_ID,
    registerDocumentDBQueryLanguage,
} from '../../../query-language-support';

interface JsonInputEditorProps {
    /** Current text content of the editor. */
    value: string;
    /** Called with the new text whenever the content changes. */
    onChange: (value: string) => void;
    /** Accessible label announced to screen readers. */
    ariaLabel: string;
    /** Prevent edits while the form is waiting on an extension-host action. */
    readOnly?: boolean;
}

const monacoOptions: monacoEditor.editor.IStandaloneEditorConstructionOptions = {
    contextmenu: false,
    fontSize: 14,
    lineHeight: 19,
    hideCursorInOverviewRuler: true,
    overviewRulerBorder: false,
    overviewRulerLanes: 0,
    glyphMargin: false,
    folding: false,
    renderLineHighlight: 'none',
    minimap: { enabled: false },
    lineNumbers: 'off',
    scrollbar: { vertical: 'auto', horizontal: 'auto' },
    readOnly: false,
    scrollBeyondLastLine: false,
    automaticLayout: false,
};

/**
 * A compact, plain-JSON editor for the Create Index drawer's advanced fields.
 *
 * It reuses the shared `documentdb-query` language purely for relaxed-JSON
 * highlighting and bracket handling. Completions, hover docs, and validation
 * are all suppressed for the {@link EditorType.Json} model URI, so the editor
 * makes no false promise of smartness — it simply accepts JSON-like input,
 * which the extension side parses (loosely) when the index is created.
 */
export const JsonInputEditor = ({
    value,
    onChange,
    ariaLabel,
    readOnly = false,
}: JsonInputEditorProps): JSX.Element => {
    const sessionId = useId();
    const onChangeRef = useRef(onChange);
    const disposeRef = useRef<(() => void) | null>(null);

    useEffect(() => {
        onChangeRef.current = onChange;
    }, [onChange]);

    useEffect(() => {
        return () => {
            disposeRef.current?.();
        };
    }, []);

    return (
        <MonacoAutoHeight
            height={'100%'}
            width={'100%'}
            language={LANGUAGE_ID}
            adaptiveHeight={{ enabled: true, minLines: 2, maxLines: 8, lineHeight: 19 }}
            options={{ ...monacoOptions, ariaLabel, readOnly }}
            onMount={(editor, monaco) => {
                // Register the shared language (idempotent). No completion/hover
                // callbacks are wired — this editor type serves none.
                void registerDocumentDBQueryLanguage(monaco);

                const uri = monaco.Uri.parse(buildEditorUri(EditorType.Json, sessionId));
                let model = monaco.editor.getModel(uri);
                if (!model) {
                    model = monaco.editor.createModel(value, LANGUAGE_ID, uri);
                }
                editor.setModel(model);

                const disposable = editor.onDidChangeModelContent(() => {
                    onChangeRef.current(editor.getValue());
                });
                disposeRef.current = () => {
                    disposable.dispose();
                    model.dispose();
                };
            }}
        />
    );
};
