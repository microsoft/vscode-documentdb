/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Input, Label, ToggleButton } from '@fluentui/react-components';
import { Collapse } from '@fluentui/react-motion-components-preview';
import * as l10n from '@vscode/l10n';
import { useContext, useEffect, useRef, useState, type JSX } from 'react';
import { InputWithProgress } from '../../../../components/InputWithProgress';
// eslint-disable-next-line import/no-internal-modules
import type * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';
// eslint-disable-next-line import/no-internal-modules
import basicFindQuerySchema from '../../../../../utils/json/mongo/autocomplete/basicMongoFindFilterSchema.json';
import { ENABLE_AI_QUERY_GENERATION } from '../../constants';

import { ArrowResetRegular, SendRegular, SettingsFilled, SettingsRegular } from '@fluentui/react-icons';
// eslint-disable-next-line import/no-internal-modules
import { type editor } from 'monaco-editor/esm/vs/editor/editor.api';
import { useTrpcClient } from '../../../../api/webview-client/useTrpcClient';
import { MonacoAutoHeight } from '../../../../components/MonacoAutoHeight';
import { CollectionViewContext } from '../../collectionViewContext';
import { useHideScrollbarsDuringResize } from '../../hooks/useHideScrollbarsDuringResize';
import './queryEditor.scss';

interface QueryEditorProps {
    onExecuteRequest: () => void;
}

export const QueryEditor = ({ onExecuteRequest }: QueryEditorProps): JSX.Element => {
    const { trpcClient } = useTrpcClient();
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

    const schemaAbortControllerRef = useRef<AbortController | null>(null);
    const aiGenerationAbortControllerRef = useRef<AbortController | null>(null);
    const aiInputRef = useRef<HTMLInputElement | null>(null);

    // Refs for Monaco editors
    const filterEditorRef = useRef<monacoEditor.editor.IStandaloneCodeEditor | null>(null);
    const projectEditorRef = useRef<monacoEditor.editor.IStandaloneCodeEditor | null>(null);
    const sortEditorRef = useRef<monacoEditor.editor.IStandaloneCodeEditor | null>(null);

    const hideScrollbarsTemporarily = useHideScrollbarsDuringResize();

    const handleEditorDidMount = (editor: monacoEditor.editor.IStandaloneCodeEditor, monaco: typeof monacoEditor) => {
        editor.setValue('{  }');

        // Store the filter editor reference
        filterEditorRef.current = editor;

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
                /**
                 * Dynamically sets the JSON schema for the Monaco editor's validation and autocompletion.
                 *
                 * NOTE: This function can encounter network errors if called immediately after the
                 * editor mounts, as the underlying JSON web worker may not have finished loading.
                 * To mitigate this, a delay is introduced before attempting to set the schema.
                 *
                 * A more robust long-term solution should be implemented to programmatically
                 * verify that the JSON worker is initialized before this function proceeds.
                 *
                 * An AbortController is used to prevent race conditions when this function is
                 * called in quick succession (e.g., rapid "refresh" clicks). It ensures that
                 * any pending schema update is cancelled before a new one begins, guaranteeing
                 * a clean, predictable state and allowing the Monaco worker to initialize correctly.
                 */
                setJsonSchema: async (schema) => {
                    // Use the ref to cancel the previous operation
                    if (schemaAbortControllerRef.current) {
                        schemaAbortControllerRef.current.abort();
                    }

                    // Create and store the new AbortController in the ref
                    const abortController = new AbortController();
                    schemaAbortControllerRef.current = abortController;
                    const signal = abortController.signal;

                    try {
                        // Wait for 2 seconds to give the worker time to initialize
                        await new Promise((resolve) => setTimeout(resolve, 2000));

                        // If the operation was cancelled during the delay, abort early
                        if (signal.aborted) {
                            return;
                        }

                        // Check if JSON language features are available and set the schema
                        if (monaco.languages.json?.jsonDefaults) {
                            monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
                                validate: false,
                                schemas: [
                                    {
                                        uri: 'mongodb-filter-query-schema.json',
                                        fileMatch: ['*'],
                                        schema: schema,
                                    },
                                ],
                            });
                        }
                    } catch (error) {
                        // The error is likely an uncaught exception in the worker,
                        // but we catch here just in case.
                        console.warn('Error setting JSON schema:', error);
                    }
                },
            },
        }));

        // initialize the monaco editor with the schema that's basic
        // as we don't know the schema of the collection available
        // this is a fallback for the case when the autocompletion feature fails.
        monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
            validate: true,
            schemas: [
                {
                    uri: 'mongodb-filter-query-schema.json', // Unique identifier
                    fileMatch: ['*'], // Apply to all JSON files or specify as needed

                    schema: basicFindQuerySchema,
                    // schema: generateMongoFindJsonSchema(fieldEntries)
                },
            ],
        });
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

    // Cleanup any pending operations when component unmounts
    useEffect(() => {
        return () => {
            if (schemaAbortControllerRef.current) {
                schemaAbortControllerRef.current.abort();
                schemaAbortControllerRef.current = null;
            }
            if (aiGenerationAbortControllerRef.current) {
                aiGenerationAbortControllerRef.current.abort();
                aiGenerationAbortControllerRef.current = null;
            }
        };
    }, []);

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
        <div className="queryEditor">
            {/* Optional AI prompt row */}
            <Collapse visible={ENABLE_AI_QUERY_GENERATION && currentContext.isAiRowVisible} unmountOnExit>
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
                        language="json"
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
                            // Sync initial value
                            editor.onDidChangeModelContent(() => {
                                setFilterValue(editor.getValue());
                            });
                        }}
                        options={monacoOptions}
                    />
                </div>
                <div className="queryEditorActions">
                    <ToggleButton
                        appearance="subtle"
                        checked={isEnhancedQueryMode}
                        onClick={() => {
                            // Toggle enhanced mode
                            setIsEnhancedQueryMode(!isEnhancedQueryMode);

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

                    <Button
                        appearance="subtle"
                        icon={<ArrowResetRegular />}
                        onClick={() => {
                            // Reset all query-related states
                            setFilterValue('{  }');
                            setProjectValue('{  }');
                            setSortValue('{  }');
                            setSkipValue(0);
                            setLimitValue(0);
                            setAiPromptValue('');
                            setAiPromptHistory([]); // Clear AI prompt history
                        }}
                    />
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
                                language="json"
                                adaptiveHeight={{
                                    enabled: true,
                                    maxLines: 5,
                                    minLines: 1,
                                    lineHeight: 19,
                                }}
                                onMount={(editor) => {
                                    projectEditorRef.current = editor;
                                    editor.setValue(projectValue);
                                    editor.onDidChangeModelContent(() => {
                                        setProjectValue(editor.getValue());
                                    });
                                }}
                                options={monacoOptions}
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
                                language="json"
                                adaptiveHeight={{
                                    enabled: true,
                                    maxLines: 5,
                                    minLines: 1,
                                    lineHeight: 19,
                                }}
                                onMount={(editor) => {
                                    sortEditorRef.current = editor;
                                    editor.setValue(sortValue);
                                    editor.onDidChangeModelContent(() => {
                                        setSortValue(editor.getValue());
                                    });
                                }}
                                options={monacoOptions}
                            />
                        </div>
                        <div className="field fieldNarrow">
                            <Label size="small" weight="semibold">
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
                            />
                        </div>
                        <div className="field fieldNarrow">
                            <Label size="small" weight="semibold">
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
                            />
                        </div>
                    </div>
                </div>
            </Collapse>
        </div>
    );
};
