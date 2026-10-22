/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// eslint-disable-next-line import/no-internal-modules
import * as l10n from '@vscode/l10n';
import type * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { MonacoEditor } from '../../components/MonacoEditor';
import './JsonPlanEditor.scss';
import type { InputIssue } from './queryInsightsStandaloneInput';

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

/** The editor grows with its content between these heights (px), then scrolls. */
const heightLimits = { full: { min: 120, max: 400 }, compact: { min: 96, max: 240 } } as const;

export function JsonPlanEditor({
    value,
    onChange,
    ariaLabel,
    issue,
    compact = false,
}: JsonPlanEditorProps): JSX.Element {
    const [mounted, setMounted] = useState<MountedEditor>();
    const limits = compact ? heightLimits.compact : heightLimits.full;
    const [height, setHeight] = useState<number>(limits.min);
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
                startLineNumber: line,
                endLineNumber: line,
                startColumn: column,
                endColumn: column + 1,
            });
        }
        mounted.monaco.editor.setModelMarkers(model, markerOwner, markers);
        return () => {
            if (!model.isDisposed()) mounted.monaco.editor.setModelMarkers(model, markerOwner, []);
        };
    }, [mounted, issue, value]);

    useEffect(() => {
        if (!mounted) return undefined;
        const { editor } = mounted;
        const fit = (): void => setHeight(Math.min(limits.max, Math.max(limits.min, editor.getContentHeight())));
        fit();
        const subscription = editor.onDidContentSizeChange(fit);
        return () => subscription.dispose();
    }, [mounted, limits.min, limits.max]);

    return (
        <div
            className={`query-insights-json-editor${compact ? ' query-insights-json-editor-compact' : ''}`}
            style={{ height }}
        >
            <MonacoEditor
                language="json"
                height="100%"
                width="100%"
                value={value}
                onChange={(text) => onChange(text ?? '')}
                onMount={onMount}
                onEscapeEditor={() => exitRef.current?.focus()}
                options={{
                    ariaLabel,
                    lineNumbers: 'on',
                    minimap: { enabled: false },
                    wordWrap: 'on',
                    folding: false,
                    automaticLayout: true,
                    fontSize: 13,
                    lineHeight: 19,
                    glyphMargin: false,
                    // Narrow gutter: line numbers stay (parse errors cite them); markers render as squiggles.
                    lineNumbersMinChars: 3,
                    lineDecorationsWidth: 6,
                    scrollBeyondLastLine: false,
                    scrollbar: { alwaysConsumeMouseWheel: false },
                    renderValidationDecorations: 'on',
                }}
            />
            <div ref={exitRef} tabIndex={-1} role="group" aria-label={l10n.t('Outside {0} editor', ariaLabel)} />
        </div>
    );
}
