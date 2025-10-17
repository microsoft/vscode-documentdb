/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Input, Label, ProgressBar, ToggleButton } from '@fluentui/react-components';
import { Collapse } from '@fluentui/react-motion-components-preview';
import * as l10n from '@vscode/l10n';
import { useContext, useEffect, useRef, useState, type JSX } from 'react';
// eslint-disable-next-line import/no-internal-modules
import type * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';
// eslint-disable-next-line import/no-internal-modules
import basicFindQuerySchema from '../../../../../utils/json/mongo/autocomplete/basicMongoFindFilterSchema.json';

import { PlaySettingsFilled, PlaySettingsRegular, SendRegular } from '@fluentui/react-icons';
// eslint-disable-next-line import/no-internal-modules
import { type editor } from 'monaco-editor/esm/vs/editor/editor.api';
import { CollectionViewContext } from '../../collectionViewContext';
import { useHideScrollbarsDuringResize } from '../../hooks/useHideScrollbarsDuringResize';
import { MonacoAutoHeight } from '../MonacoAutoHeight';
import './queryEditor.scss';

interface QueryEditorProps {
    onExecuteRequest: (query: string) => void;
}

export const QueryEditor = ({ onExecuteRequest }: QueryEditorProps): JSX.Element => {
    const [currentContext, setCurrentContext] = useContext(CollectionViewContext);
    const [isEnhancedQueryMode, setIsEnhancedQueryMode] = useState(false);
    const [isAiActive, setIsAiActive] = useState(false);

    const schemaAbortControllerRef = useRef<AbortController | null>(null);
    const aiInputRef = useRef<HTMLInputElement | null>(null);
    const hideScrollbarsTemporarily = useHideScrollbarsDuringResize();

    const handleEditorDidMount = (editor: monacoEditor.editor.IStandaloneCodeEditor, monaco: typeof monacoEditor) => {
        editor.setValue('{  }');

        const getCurrentContentFunction = () => editor.getValue();
        // adding the function to the context for use outside of the editor
        setCurrentContext((prev) => ({
            ...prev,
            queryEditor: {
                getCurrentContent: getCurrentContentFunction,
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
        };
    }, []);

    // Focus AI input when AI row becomes visible
    useEffect(() => {
        if (currentContext.isAiRowVisible && aiInputRef.current) {
            // Use setTimeout to ensure the Collapse animation has started
            setTimeout(() => {
                aiInputRef.current?.focus();
            }, 200);
        }
    }, [currentContext.isAiRowVisible]);

    // Helper button component for the AI input's contentAfter slot
    const SendButton: React.FC = () => {
        return <Button appearance="transparent" icon={<SendRegular />} size="small" aria-label={l10n.t('Submit')} />;
    };

    return (
        <div className="queryEditor">
            {/* Optional AI prompt row */}
            <Collapse visible={currentContext.isAiRowVisible} unmountOnExit>
                <div className={`aiRow${isAiActive ? ' ai-active' : ''}`}>
                    <div style={{ position: 'relative', width: '100%' }}>
                        <Input
                            ref={aiInputRef}
                            contentAfter={<SendButton />}
                            appearance="underline"
                            style={{ width: '100%' }}
                            placeholder={l10n.t('Ask Copilot to generate the query for you...')}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    // Toggle the ai-active state for testing
                                    setIsAiActive((prev) => !prev);
                                }
                            }}
                        />
                        {isAiActive ? (
                            <ProgressBar
                                thickness="large"
                                shape="rounded"
                                className="progressBar"
                                style={{
                                    position: 'absolute',
                                    left: 0,
                                    right: 0,
                                    bottom: 0,
                                    top: 'auto',
                                    pointerEvents: 'none',
                                }}
                                aria-hidden={true}
                            />
                        ) : null}
                    </div>
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
                        onExecuteRequest={(input) => {
                            onExecuteRequest(input);
                        }}
                        onMount={handleEditorDidMount}
                        options={monacoOptions}
                    />
                </div>
                <div className="enhancedToggle">
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
                        icon={isEnhancedQueryMode ? <PlaySettingsFilled /> : <PlaySettingsRegular />}
                    ></ToggleButton>
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
                                options={monacoOptions}
                            />
                        </div>
                        <div className="field fieldNarrow">
                            <Label size="small" weight="semibold">
                                {l10n.t('Skip')}
                            </Label>
                            <Input type="number" className="queryEditorInput" />
                        </div>
                        <div className="field fieldNarrow">
                            <Label size="small" weight="semibold">
                                {l10n.t('Limit')}
                            </Label>
                            <Input type="number" className="queryEditorInput" />
                        </div>
                    </div>
                </div>
            </Collapse>
        </div>
    );
};
