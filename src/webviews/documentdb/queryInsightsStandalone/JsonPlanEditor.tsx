/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// eslint-disable-next-line import/no-internal-modules
import type * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';
import * as l10n from '@vscode/l10n';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { MonacoEditor } from '../../components/MonacoEditor';
import type { InputIssue } from './queryInsightsStandaloneInput';
import './JsonPlanEditor.scss';

interface JsonPlanEditorProps {
    value: string;
    onChange: (value: string) => void;
    ariaLabel: string;
    issue?: InputIssue;
    compact?: boolean;
}

interface MountedEditor {
    editor: monacoEditor.editor.IStandaloneCodeEditor;
    monaco: typeof monacoEditor;
}

const markerOwner = 'query-insights-input';

export function JsonPlanEditor({ value, onChange, ariaLabel, issue, compact = false }: JsonPlanEditorProps): JSX.Element {
    const [mounted, setMounted] = useState<MountedEditor>();
    const exitRef = useRef<HTMLDivElement>(null);
    const onMount = useCallback((editor: MountedEditor['editor'], monaco: MountedEditor['monaco']): void => {
        setMounted({ editor, monaco });
    }, []);

    useEffect(() => {
        const model = mounted?.editor.getModel();
        if (!mounted || !model || model.isDisposed()) return;
        const markers: monacoEditor.editor.IMarkerData[] = [];
        if (issue?.line !== undefined && issue.column !== undefined) {
            const line = Math.max(1, Math.min(issue.line, model.getLineCount()));
            const column = Math.max(1, Math.min(issue.column, model.getLineMaxColumn(line)));
            markers.push({
                severity: mounted.monaco.MarkerSeverity.Error,
                message: issue.message,
                startLineNumber: line, endLineNumber: line,
                startColumn: column, endColumn: column + 1,
            });
        }
        mounted.monaco.editor.setModelMarkers(model, markerOwner, markers);
        return () => {
            if (!model.isDisposed()) mounted.monaco.editor.setModelMarkers(model, markerOwner, []);
        };
    }, [mounted, issue, value]);

    return (
        <div className={`query-insights-json-editor${compact ? ' query-insights-json-editor-compact' : ''}`}>
            <MonacoEditor
                language="json"
                height="100%"
                width="100%"
                value={value}
                onChange={(text) => onChange(text ?? '')}
                onMount={onMount}
                onEscapeEditor={() => exitRef.current?.focus()}
                options={{
                    ariaLabel, lineNumbers: 'on', minimap: { enabled: false },
                    wordWrap: 'off', folding: true, automaticLayout: true,
                    fontSize: 13, lineHeight: 19, glyphMargin: true,
                    scrollBeyondLastLine: false,
                    scrollbar: { alwaysConsumeMouseWheel: false },
                    renderValidationDecorations: 'on',
                }}
            />
            <div ref={exitRef} tabIndex={-1} role="group"
                aria-label={l10n.t('Outside {0} editor', ariaLabel)} />
        </div>
    );
}
