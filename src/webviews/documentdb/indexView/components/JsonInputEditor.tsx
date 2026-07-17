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
    validateExpression,
    type Diagnostic,
} from '../../../query-language-support';

/**
 * Converts a validator {@link Diagnostic} into a Monaco marker so syntax
 * problems surface as squiggles in the editor.
 */
function toMonacoMarker(
    diagnostic: Diagnostic,
    model: monacoEditor.editor.ITextModel,
    monaco: typeof monacoEditor,
): monacoEditor.editor.IMarkerData {
    const startPos = model.getPositionAt(diagnostic.startOffset);
    const endPos = model.getPositionAt(diagnostic.endOffset);
    return {
        severity:
            diagnostic.severity === 'error'
                ? monaco.MarkerSeverity.Error
                : diagnostic.severity === 'warning'
                  ? monaco.MarkerSeverity.Warning
                  : monaco.MarkerSeverity.Info,
        message: diagnostic.message,
        startLineNumber: startPos.lineNumber,
        startColumn: startPos.column,
        endLineNumber: endPos.lineNumber,
        endColumn: endPos.column,
    };
}

interface JsonInputEditorProps {
    /** Current text content of the editor. */
    value: string;
    /** Called with the new text whenever the content changes. */
    onChange: (value: string) => void;
    /** Placeholder shown while the editor is empty. */
    placeholder?: string;
    /** Accessible label announced to screen readers. */
    ariaLabel: string;
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
 * highlighting and bracket handling. Completions and hover docs are suppressed
 * for the {@link EditorType.Json} model URI, so the editor makes no false
 * promise of smartness — it only accepts and syntax-checks JSON-like input.
 */
export const JsonInputEditor = ({ value, onChange, placeholder, ariaLabel }: JsonInputEditorProps): JSX.Element => {
    const sessionId = useId();
    const onChangeRef = useRef(onChange);
    const validationCleanupRef = useRef<(() => void) | null>(null);

    useEffect(() => {
        onChangeRef.current = onChange;
    }, [onChange]);

    useEffect(() => {
        return () => {
            validationCleanupRef.current?.();
        };
    }, []);

    return (
        <MonacoAutoHeight
            height={'100%'}
            width={'100%'}
            language={LANGUAGE_ID}
            adaptiveHeight={{ enabled: true, minLines: 2, maxLines: 8, lineHeight: 19 }}
            options={{ ...monacoOptions, placeholder, ariaLabel }}
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

                // Debounced syntax validation → Monaco markers.
                let validationTimeout: ReturnType<typeof setTimeout>;
                const disposable = editor.onDidChangeModelContent(() => {
                    const currentValue = editor.getValue();
                    onChangeRef.current(currentValue);
                    clearTimeout(validationTimeout);
                    validationTimeout = setTimeout(() => {
                        const diagnostics = validateExpression(currentValue);
                        const markers = diagnostics.map((d) => toMonacoMarker(d, model, monaco));
                        monaco.editor.setModelMarkers(model, 'documentdb-query', markers);
                    }, 300);
                });
                validationCleanupRef.current = () => {
                    clearTimeout(validationTimeout);
                    disposable.dispose();
                    model.dispose();
                };
            }}
        />
    );
};
