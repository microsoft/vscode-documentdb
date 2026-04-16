/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Input, Label, ToggleButton, Tooltip } from '@fluentui/react-components';
import { Collapse } from '@fluentui/react-motion-components-preview';
import * as l10n from '@vscode/l10n';
import { useContext, useEffect, useRef, useState, type JSX } from 'react';
import { InputWithProgress } from '../../../../components/InputWithProgress';
// eslint-disable-next-line import/no-internal-modules
import type * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';
import { useConfiguration } from '../../../../api/webview-client/useConfiguration';
import {
    buildEditorUri,
    clearCompletionContext,
    EditorType,
    LANGUAGE_ID,
    registerDocumentDBQueryLanguage,
    validateExpression,
    type Diagnostic,
} from '../../../../query-language-support';
import { type CollectionViewWebviewConfigurationType } from '../../collectionViewController';

import { ArrowResetRegular, SendRegular, SettingsFilled, SettingsRegular } from '@fluentui/react-icons';
// eslint-disable-next-line import/no-internal-modules
import { type editor } from 'monaco-editor/esm/vs/editor/editor.api';
import { useTrpcClient } from '../../../../api/webview-client/useTrpcClient';
import { MonacoAutoHeight } from '../../../../components/MonacoAutoHeight';
import { CollectionViewContext } from '../../collectionViewContext';
import { useHideScrollbarsDuringResize } from '../../hooks/useHideScrollbarsDuringResize';
import './queryEditor.scss';

/**
 * Convert a Diagnostic from the documentdb-query validator to a Monaco marker.
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

interface QueryEditorProps {
    onExecuteRequest: () => void;
}

export const QueryEditor = ({ onExecuteRequest }: QueryEditorProps): JSX.Element => {
    const { trpcClient } = useTrpcClient();
    const configuration = useConfiguration<CollectionViewWebviewConfigurationType>();
    const [currentContext, setCurrentContext] = useContext(CollectionViewContext);
    const [isEnhancedQueryMode, setIsEnhancedQueryMode] = useState(false);
    const [isAiActive, setIsAiActive] = useState(false);

    // Local state for query fields (survives show/hide of enhanced query section)
    const [filterValue, setFilterValue] = useState('{  }');
    const [projectValue, setProjectValue] = useState('{  }');
    const [sortValue, setSortValue] = useState('{  }');
    const [skipValue, setSkipValue] = useState(0);
    const [limitValue, setLimitValue] = useState(0);
    const [aiPromptValue, setAiPromptValue] = useState('');

    // AI prompt history (survives hide/show of AI input)
    const [aiPromptHistory, setAiPromptHistory] = useState<string[]>([]);

    const aiGenerationAbortControllerRef = useRef<AbortController | null>(null);
    const aiInputRef = useRef<HTMLInputElement | null>(null);

    // Refs for Monaco editors
    const filterEditorRef = useRef<monacoEditor.editor.IStandaloneCodeEditor | null>(null);
    const projectEditorRef = useRef<monacoEditor.editor.IStandaloneCodeEditor | null>(null);
    const sortEditorRef = useRef<monacoEditor.editor.IStandaloneCodeEditor | null>(null);

    const hideScrollbarsTemporarily = useHideScrollbarsDuringResize();

    /**
     * Creates a Monaco model with a URI scheme for the given editor type.
     * This enables the completion provider to identify which editor the request is for.
     */
    const createEditorModel = (
        editor: monacoEditor.editor.IStandaloneCodeEditor,
        monaco: typeof monacoEditor,
        editorType: EditorType,
        initialValue: string,
    ): monacoEditor.editor.ITextModel => {
        const uri = monaco.Uri.parse(buildEditorUri(editorType, configuration.sessionId));
        let model = monaco.editor.getModel(uri);
        if (!model) {
            model = monaco.editor.createModel(initialValue, LANGUAGE_ID, uri);
        }
        editor.setModel(model);
        return model;
    };

    /**
     * Sets up debounced validation on editor content changes.
     * Returns a cleanup function to clear any pending timeout.
     */
    const setupValidation = (
        editor: monacoEditor.editor.IStandaloneCodeEditor,
        monaco: typeof monacoEditor,
        model: monacoEditor.editor.ITextModel,
    ): (() => void) => {
        let validationTimeout: ReturnType<typeof setTimeout>;
        const disposable = editor.onDidChangeModelContent(() => {
            clearTimeout(validationTimeout);
            validationTimeout = setTimeout(() => {
                const diagnostics = validateExpression(editor.getValue());
                const markers = diagnostics.map((d) => toMonacoMarker(d, model, monaco));
                monaco.editor.setModelMarkers(model, 'documentdb-query', markers);
            }, 300);
        });
        return () => {
            clearTimeout(validationTimeout);
            disposable.dispose();
        };
    };

    /**
     * Cancels any active snippet session on the given editor.
     *
     * After a snippet completion (e.g., `fieldName: $1`), Monaco keeps the
     * snippet session alive and highlights the tab-stop placeholder. If the
     * user continues typing, the highlight grows — the "ghost selection"
     * bug. Calling this function ends the snippet session cleanly.
     */
    const cancelSnippetSession = (editor: monacoEditor.editor.IStandaloneCodeEditor): void => {
        const controller = editor.getContribution('snippetController2') as { cancel: () => void } | null | undefined;
        controller?.cancel();
    };

    /** Characters that signal the end of a field-value pair and should exit snippet mode. */
    const SNIPPET_EXIT_CHARS = new Set([',', '}', ']']);

    /**
     * Sets up pattern-based auto-trigger of completions.
     * When a content change results in a trigger character followed by a
     * space (`: `, `, `, `{ `, `[ `) at the end of the inserted text,
     * completions are triggered automatically after a short delay. This
     * handles both manual typing and completion acceptance.
     *
     * Also cancels any active snippet session when a delimiter character
     * (`,`, `}`, `]`) is typed, preventing the "ghost selection" bug
     * where the tab-stop highlight expands as the user continues typing.
     *
     * Returns a cleanup function.
     */
    const setupSmartTrigger = (editor: monacoEditor.editor.IStandaloneCodeEditor): (() => void) => {
        let triggerTimeout: ReturnType<typeof setTimeout>;
        const contentDisposable = editor.onDidChangeModelContent((e) => {
            clearTimeout(triggerTimeout);

            const change = e.changes[0];
            if (!change || change.text.length === 0) return;

            // Cancel snippet session when the user *types* a delimiter character.
            // Only applies to single-character edits (user keystrokes), not to
            // multi-character completion insertions which may legitimately
            // contain commas or braces as part of the snippet text.
            if (change.text.length === 1 && SNIPPET_EXIT_CHARS.has(change.text)) {
                cancelSnippetSession(editor);
            }

            const model = editor.getModel();
            if (!model) return;

            // Calculate the offset at the end of the inserted text in the new model
            const endOffset = change.rangeOffset + change.text.length;

            // We need at least 2 chars to check for ": " or ", "
            if (endOffset < 2) return;

            const fullText = model.getValue();
            const lastTwo = fullText.substring(endOffset - 2, endOffset);
            if (lastTwo === ': ' || lastTwo === ', ' || lastTwo === '{ ' || lastTwo === '[ ') {
                triggerTimeout = setTimeout(() => {
                    editor.trigger('smart-trigger', 'editor.action.triggerSuggest', {});
                }, 50);
            }
        });

        // Cancel snippet session when the editor loses focus (Option D).
        // If the user clicks away while a tab-stop is highlighted, the
        // highlight should not persist when they return.
        const blurDisposable = editor.onDidBlurEditorText(() => {
            cancelSnippetSession(editor);
        });

        // Cancel snippet session on Enter or Ctrl+Enter / Cmd+Enter.
        // Enter commits the current line and should exit snippet mode.
        // Ctrl+Enter triggers query execution and should also exit snippet mode
        // so the tab-stop highlight doesn't persist after running a query.
        const keyDownDisposable = editor.onKeyDown((e) => {
            if (e.browserEvent.key === 'Enter') {
                cancelSnippetSession(editor);
            }
        });

        return () => {
            clearTimeout(triggerTimeout);
            contentDisposable.dispose();
            blurDisposable.dispose();
            keyDownDisposable.dispose();
        };
    };

    // Track validation cleanup functions
    const filterValidationCleanupRef = useRef<(() => void) | null>(null);
    const projectValidationCleanupRef = useRef<(() => void) | null>(null);
    const sortValidationCleanupRef = useRef<(() => void) | null>(null);
    const filterSmartTriggerCleanupRef = useRef<(() => void) | null>(null);
    const projectSmartTriggerCleanupRef = useRef<(() => void) | null>(null);
    const sortSmartTriggerCleanupRef = useRef<(() => void) | null>(null);
    const handleEditorDidMount = (editor: monacoEditor.editor.IStandaloneCodeEditor, monaco: typeof monacoEditor) => {
        // Store the filter editor reference
        filterEditorRef.current = editor;

        // Register the documentdb-query language (idempotent — safe to call on every mount).
        // Pass the tRPC openUrl handler so hover links can be opened via the extension host,
        // bypassing the webview sandbox's popup restrictions.
        void registerDocumentDBQueryLanguage(monaco, (url) => void trpcClient.common.openUrl.mutate({ url }));

        // Create model with URI scheme for contextual completions
        const model = createEditorModel(editor, monaco, EditorType.Filter, '{  }');

        // Set up debounced validation
        filterValidationCleanupRef.current = setupValidation(editor, monaco, model);

        // Set up smart-trigger for completions after ": " and ", "
        filterSmartTriggerCleanupRef.current = setupSmartTrigger(editor);

        const getCurrentQueryFunction = () => ({
            filter: filterValue,
            project: projectValue,
            sort: sortValue,
            skip: skipValue,
            limit: limitValue,
        });

        // adding the functions to the context for use outside of the editor
        setCurrentContext((prev) => ({
            ...prev,
            queryEditor: {
                getCurrentQuery: getCurrentQueryFunction,
            },
        }));
    };

    const monacoOptions: editor.IStandaloneEditorConstructionOptions = {
        contextmenu: false,
        fontSize: 14,
        lineHeight: 19,
        hideCursorInOverviewRuler: true,
        overviewRulerBorder: false,
        overviewRulerLanes: 0,
        glyphMargin: false,
        folding: false,
        renderLineHighlight: 'none',
        minimap: {
            enabled: false,
        },
        lineNumbers: 'off',
        scrollbar: {
            vertical: 'auto',
            horizontal: 'auto',
        },
        readOnly: false,
        scrollBeyondLastLine: false,
        automaticLayout: false,
    };

    // Intercept link clicks in Monaco hover tooltips.
    // Monaco renders hover markdown links as <a> tags, but the webview CSP
    // blocks direct navigation. Capture clicks and route through tRPC.
    const editorContainerRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        const container = editorContainerRef.current;
        if (!container) return;

        const handleLinkClick = (e: MouseEvent): void => {
            const target = e.target as HTMLElement;
            const anchor = target.closest('a');
            if (!anchor) return;

            const href = anchor.getAttribute('href');
            if (href && (href.startsWith('https://') || href.startsWith('http://'))) {
                e.preventDefault();
                e.stopPropagation();
                void trpcClient.common.openUrl.mutate({ url: href });
            }
        };

        container.addEventListener('click', handleLinkClick, true);
        return () => container.removeEventListener('click', handleLinkClick, true);
    }, [trpcClient]);

    // Cleanup any pending operations when component unmounts
    useEffect(() => {
        return () => {
            if (aiGenerationAbortControllerRef.current) {
                aiGenerationAbortControllerRef.current.abort();
                aiGenerationAbortControllerRef.current = null;
            }

            // Clean up validation timeouts
            filterValidationCleanupRef.current?.();
            projectValidationCleanupRef.current?.();
            sortValidationCleanupRef.current?.();

            // Clean up smart-trigger listeners
            filterSmartTriggerCleanupRef.current?.();
            projectSmartTriggerCleanupRef.current?.();
            sortSmartTriggerCleanupRef.current?.();

            // Dispose Monaco models
            filterEditorRef.current?.getModel()?.dispose();
            projectEditorRef.current?.getModel()?.dispose();
            sortEditorRef.current?.getModel()?.dispose();

            // Clear completion store for this session
            clearCompletionContext(configuration.sessionId);
        };
    }, [configuration.sessionId]);

    // Update getCurrentQuery function whenever state changes
    useEffect(() => {
        setCurrentContext((prev) => ({
            ...prev,
            queryEditor: prev.queryEditor
                ? {
                      ...prev.queryEditor,
                      getCurrentQuery: () => ({
                          filter: filterValue,
                          project: projectValue,
                          sort: sortValue,
                          skip: skipValue,
                          limit: limitValue,
                      }),
                  }
                : prev.queryEditor,
        }));
    }, [filterValue, projectValue, sortValue, skipValue, limitValue, setCurrentContext]);

    // Apply pasted query values to the editors when pendingPaste is set
    useEffect(() => {
        const paste = currentContext.pendingPaste;
        if (!paste) {
            return;
        }

        if (paste.filter) {
            setFilterValue(paste.filter);
            filterEditorRef.current?.setValue(paste.filter);
        }
        if (paste.project) {
            setProjectValue(paste.project);
            projectEditorRef.current?.setValue(paste.project);
            // Expand enhanced query mode to show the project/sort editors
            if (!isEnhancedQueryMode) {
                setIsEnhancedQueryMode(true);
            }
        }
        if (paste.sort) {
            setSortValue(paste.sort);
            sortEditorRef.current?.setValue(paste.sort);
            if (!isEnhancedQueryMode) {
                setIsEnhancedQueryMode(true);
            }
        }
        if (paste.skip !== undefined) {
            setSkipValue(paste.skip);
            if (!isEnhancedQueryMode) {
                setIsEnhancedQueryMode(true);
            }
        }
        if (paste.limit !== undefined) {
            setLimitValue(paste.limit);
            if (!isEnhancedQueryMode) {
                setIsEnhancedQueryMode(true);
            }
        }

        // Clear the pending paste
        setCurrentContext((prev) => ({
            ...prev,
            pendingPaste: undefined,
        }));
    }, [currentContext.pendingPaste, setCurrentContext, isEnhancedQueryMode]);

    // Focus AI input when AI row becomes visible
    useEffect(() => {
        if (currentContext.isAiRowVisible && aiInputRef.current) {
            // Use setTimeout to ensure the Collapse animation has started
            setTimeout(() => {
                aiInputRef.current?.focus();
            }, 200);
        }
    }, [currentContext.isAiRowVisible]);

    // Sync state changes to Monaco editors (for AI-generated updates)
    useEffect(() => {
        if (filterEditorRef.current && filterEditorRef.current.getValue() !== filterValue) {
            filterEditorRef.current.setValue(filterValue);
        }
    }, [filterValue]);

    useEffect(() => {
        if (projectEditorRef.current && projectEditorRef.current.getValue() !== projectValue) {
            projectEditorRef.current.setValue(projectValue);
        }
    }, [projectValue]);

    useEffect(() => {
        if (sortEditorRef.current && sortEditorRef.current.getValue() !== sortValue) {
            sortEditorRef.current.setValue(sortValue);
        }
    }, [sortValue]);

    // Add keydown event listeners to detect Ctrl+Enter for skip and limit inputs
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                onExecuteRequest();
            }
        };

        const skipInput = document.querySelector('.queryEditorInput.skip');
        const limitInput = document.querySelector('.queryEditorInput.limit');

        skipInput?.addEventListener('keydown', handleKeyDown);
        limitInput?.addEventListener('keydown', handleKeyDown);

        return () => {
            skipInput?.removeEventListener('keydown', handleKeyDown);
            limitInput?.removeEventListener('keydown', handleKeyDown);
        };
    }, [onExecuteRequest]);

    // Handler for AI query generation
    const handleGenerateQuery = async () => {
        if (!aiPromptValue.trim()) {
            return; // Don't generate if prompt is empty
        }

        // Cancel any previous AI generation request by marking it as aborted
        if (aiGenerationAbortControllerRef.current) {
            aiGenerationAbortControllerRef.current.abort();
        }

        // Create new AbortController for this request (used for client-side cancellation only)
        const abortController = new AbortController();
        aiGenerationAbortControllerRef.current = abortController;

        setIsAiActive(true);

        try {
            const result = await trpcClient.mongoClusters.collectionView.generateQuery.query({
                currentQuery: {
                    filter: filterValue,
                    project: projectValue,
                    sort: sortValue,
                    skip: skipValue,
                    limit: limitValue,
                },
                prompt: aiPromptValue,
            });

            // Check if this request was aborted while waiting for response
            if (abortController.signal.aborted) {
                return; // Ignore the response if we aborted
            }

            // Update state with generated query
            setFilterValue(result.filter);
            setProjectValue(result.project);
            setSortValue(result.sort);
            setSkipValue(result.skip);
            setLimitValue(result.limit);

            // Check if we need to expand enhanced query mode
            const hasNonDefaultValues =
                result.project !== '{  }' || result.sort !== '{  }' || result.skip !== 0 || result.limit !== 0;

            if (hasNonDefaultValues && !isEnhancedQueryMode) {
                setIsEnhancedQueryMode(true);
            }

            // Clear the AI prompt after successful generation
            setAiPromptValue('');
        } catch (error) {
            // Check if this request was aborted
            if (abortController.signal.aborted) {
                return; // Ignore errors from aborted requests
            }

            void trpcClient.common.displayErrorMessage.mutate({
                message: l10n.t('Error generating query'),
                modal: false,
                cause: error instanceof Error ? error.message : String(error),
            });
        } finally {
            // Only clear active state if this request wasn't aborted
            if (!abortController.signal.aborted) {
                setIsAiActive(false);
                aiGenerationAbortControllerRef.current = null;
            }
        }
    };

    // Helper button component for the AI input's contentAfter slot
    const SendButton: React.FC = () => {
        return (
            <Button
                appearance="transparent"
                icon={<SendRegular />}
                size="small"
                aria-label={l10n.t('Submit')}
                onClick={() => {
                    void handleGenerateQuery();
                }}
            />
        );
    };

    return (
        <div className="queryEditor" ref={editorContainerRef}>
            {/* Optional AI prompt row */}
            <Collapse visible={configuration.enableAIQueryGeneration && currentContext.isAiRowVisible} unmountOnExit>
                <div className={`aiRow${isAiActive ? ' ai-active' : ''}`}>
                    <InputWithProgress
                        ref={aiInputRef}
                        value={aiPromptValue}
                        onChange={(_e, data) => setAiPromptValue(data?.value ?? '')}
                        history={aiPromptHistory}
                        onHistoryChange={setAiPromptHistory}
                        maxHistorySize={100}
                        contentAfter={<SendButton />}
                        appearance="underline"
                        placeholder={l10n.t('Ask Copilot to generate the query for you')}
                        aria-label={l10n.t('Ask Copilot to generate the query for you')}
                        indeterminateProgress={isAiActive}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey) {
                                // Generate query on Enter (without Ctrl/Cmd)
                                void handleGenerateQuery();
                            } else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                                // Execute query on Ctrl+Enter / Cmd+Enter
                                onExecuteRequest();
                            } else if (event.key === 'Escape') {
                                // ESC key behavior:
                                // - If AI is active (generation in progress): cancel the request
                                // - If AI is not active: hide AI row and clear prompt
                                if (isAiActive) {
                                    // Cancel the ongoing AI generation
                                    if (aiGenerationAbortControllerRef.current) {
                                        aiGenerationAbortControllerRef.current.abort();
                                        aiGenerationAbortControllerRef.current = null;
                                    }
                                    setIsAiActive(false);
                                } else {
                                    // Hide AI area and clear prompt
                                    setAiPromptValue('');
                                    setCurrentContext((prev) => ({
                                        ...prev,
                                        isAiRowVisible: false,
                                    }));
                                    // Give focus to the filter editor
                                    filterEditorRef.current?.focus();
                                }
                            }
                        }}
                    />
                </div>
            </Collapse>

            <div className="filterRow">
                <div className="filterField">
                    <MonacoAutoHeight
                        height={'100%'}
                        width={'100%'}
                        language={LANGUAGE_ID}
                        adaptiveHeight={{
                            enabled: true,
                            maxLines: 10,
                            minLines: 1,
                            lineHeight: 19,
                        }}
                        onExecuteRequest={() => {
                            onExecuteRequest();
                        }}
                        onMount={(editor, monaco) => {
                            handleEditorDidMount(editor, monaco);
                            // Sync editor content to state
                            editor.onDidChangeModelContent(() => {
                                setFilterValue(editor.getValue());
                            });
                        }}
                        options={{
                            ...monacoOptions,
                            ariaLabel: l10n.t('Filter: Enter the DocumentDB query filter'),
                        }}
                    />
                </div>
                <div className="queryEditorActions">
                    <Tooltip
                        content={l10n.t('Enhanced Query Configuration\n(Projection, Sort, Skip, Limit)')}
                        relationship="description"
                        withArrow
                    >
                        <ToggleButton
                            appearance="subtle"
                            checked={isEnhancedQueryMode}
                            onClick={() => {
                                const enhancedModeEnabled = !isEnhancedQueryMode;

                                // Report enhanced query mode toggle telemetry
                                trpcClient.common.reportEvent
                                    .mutate({
                                        eventName: 'queryEditor.enhancedModeToggled',
                                        properties: {
                                            newMode: enhancedModeEnabled ? 'enabled' : 'disabled',
                                            previousMode: isEnhancedQueryMode ? 'enabled' : 'disabled',
                                        },
                                    })
                                    .catch((error) => {
                                        console.debug('Failed to report enhanced mode toggle:', error);
                                    });

                                // Toggle enhanced mode
                                setIsEnhancedQueryMode(enhancedModeEnabled);

                                // Temporarily hide scrollbars during the transition to improve UX responsiveness.
                                // Note: The window-level scrollbar flickering (caused by cumulative fractional
                                // pixel rounding) is now fixed by a media query on .collectionView. However,
                                // this logic remains useful for making the transition feel snappier by hiding
                                // intermediate scrollbar states in SlickGrid (Table/Tree views) during the
                                // ~100ms debounce period before resize handlers complete and grids re-render.
                                hideScrollbarsTemporarily();
                            }}
                            icon={isEnhancedQueryMode ? <SettingsFilled /> : <SettingsRegular />}
                        ></ToggleButton>
                    </Tooltip>

                    <Tooltip content={l10n.t('Clear Query')} relationship="description" withArrow>
                        <Button
                            appearance="subtle"
                            icon={<ArrowResetRegular />}
                            onClick={() => {
                                // Report clear query telemetry
                                trpcClient.common.reportEvent
                                    .mutate({
                                        eventName: 'queryEditor.clearQuery',
                                        properties: {
                                            enhancedMode: isEnhancedQueryMode ? 'enabled' : 'disabled',
                                        },
                                        measurements: {
                                            filterLength: filterValue.length,
                                            projectionLength: projectValue.length,
                                            sortLength: sortValue.length,
                                            skipValue,
                                            limitValue,
                                        },
                                    })
                                    .catch((error) => {
                                        console.debug('Failed to report clear query:', error);
                                    });

                                // Reset all query-related states
                                setFilterValue('{  }');
                                setProjectValue('{  }');
                                setSortValue('{  }');
                                setSkipValue(0);
                                setLimitValue(0);
                                setAiPromptValue('');
                            }}
                        />
                    </Tooltip>
                </div>
            </div>

            <Collapse visible={isEnhancedQueryMode} unmountOnExit>
                <div className="enhancedInputArea">
                    {/* Row 1: Project field (full width) */}
                    <div className="fieldRow">
                        <div className="field fieldWide">
                            <Label size="small" weight="semibold">
                                {l10n.t('Project')}
                            </Label>
                            <MonacoAutoHeight
                                height={'100%'}
                                width={'100%'}
                                language={LANGUAGE_ID}
                                adaptiveHeight={{
                                    enabled: true,
                                    maxLines: 5,
                                    minLines: 1,
                                    lineHeight: 19,
                                }}
                                onMount={(editor, monaco) => {
                                    // Register language (idempotent)
                                    void registerDocumentDBQueryLanguage(
                                        monaco,
                                        (url) => void trpcClient.common.openUrl.mutate({ url }),
                                    );

                                    projectEditorRef.current = editor;

                                    // Create model with URI scheme for project completions
                                    const model = createEditorModel(editor, monaco, EditorType.Project, projectValue);

                                    // Set up validation
                                    projectValidationCleanupRef.current = setupValidation(editor, monaco, model);

                                    // Set up smart-trigger
                                    projectSmartTriggerCleanupRef.current = setupSmartTrigger(editor);

                                    editor.onDidChangeModelContent(() => {
                                        setProjectValue(editor.getValue());
                                    });
                                }}
                                options={{
                                    ...monacoOptions,
                                    ariaLabel: l10n.t('Project: Specify which fields to include or exclude'),
                                }}
                            />
                        </div>
                    </div>

                    {/* Row 2: Sort (flexible) + Skip (fixed) + Limit (fixed) */}
                    <div className="fieldRow">
                        <div className="field fieldWide">
                            <Label size="small" weight="semibold">
                                {l10n.t('Sort')}
                            </Label>
                            <MonacoAutoHeight
                                height={'100%'}
                                width={'100%'}
                                language={LANGUAGE_ID}
                                adaptiveHeight={{
                                    enabled: true,
                                    maxLines: 5,
                                    minLines: 1,
                                    lineHeight: 19,
                                }}
                                onMount={(editor, monaco) => {
                                    // Register language (idempotent)
                                    void registerDocumentDBQueryLanguage(
                                        monaco,
                                        (url) => void trpcClient.common.openUrl.mutate({ url }),
                                    );

                                    sortEditorRef.current = editor;

                                    // Create model with URI scheme for sort completions
                                    const model = createEditorModel(editor, monaco, EditorType.Sort, sortValue);

                                    // Set up validation
                                    sortValidationCleanupRef.current = setupValidation(editor, monaco, model);

                                    // Set up smart-trigger
                                    sortSmartTriggerCleanupRef.current = setupSmartTrigger(editor);

                                    editor.onDidChangeModelContent(() => {
                                        setSortValue(editor.getValue());
                                    });
                                }}
                                options={{
                                    ...monacoOptions,
                                    ariaLabel: l10n.t('Sort: Specify sort order for query results'),
                                }}
                            />
                        </div>
                        <div className="field fieldNarrow">
                            <Label size="small" weight="semibold" id="skip-label">
                                {l10n.t('Skip')}
                            </Label>
                            <Input
                                type="number"
                                className="queryEditorInput skip"
                                value={skipValue.toString()}
                                onChange={(_e, data) => {
                                    const value = parseInt(data.value, 10);
                                    setSkipValue(value >= 0 ? value : 0);
                                }}
                                aria-labelledby="skip-label"
                            />
                        </div>
                        <div className="field fieldNarrow">
                            <Label size="small" weight="semibold" id="limit-label">
                                {l10n.t('Limit')}
                            </Label>
                            <Input
                                type="number"
                                className="queryEditorInput limit"
                                value={limitValue.toString()}
                                onChange={(_e, data) => {
                                    const value = parseInt(data.value, 10);
                                    setLimitValue(value >= 0 ? value : 0);
                                }}
                                aria-labelledby="limit-label"
                            />
                        </div>
                    </div>
                </div>
            </Collapse>
        </div>
    );
};
