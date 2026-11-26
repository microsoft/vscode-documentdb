/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ProgressBar } from '@fluentui/react-components';
import { useConfiguration } from '@microsoft/vscode-ext-webview/react';
import { loader } from '@monaco-editor/react';
import * as l10n from '@vscode/l10n';
import { debounce } from 'es-toolkit';
import * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api'; // eslint-disable-line import/no-internal-modules
import { type JSX, useCallback, useEffect, useRef, useState } from 'react';
import {
    isConnectionUnavailableMessage,
    isConnectionUnavailableResponse,
} from '../../_integration/connectionUnavailable';
import { useTrpcClient } from '../../_integration/useTrpcClient';
import { useViewLoadTelemetry } from '../../_integration/useViewLoadTelemetry';
import { Announcer } from '../../components/accessibility';
import { DisconnectedOverlay } from '../../components/DisconnectedOverlay';
import { MonacoEditor } from '../../components/MonacoEditor';
import { useSelectiveContextMenuPrevention } from '../../components/useSelectiveContextMenuPrevention';
import { explainRecoveryFailure, useBoundViewRecovery } from '../useBoundViewRecovery';
import { ToolbarDocuments } from './components/toolbarDocuments';
import { type DocumentsViewWebviewConfigurationType } from './documentsViewController';
import './documentView.scss';

loader.config({ monaco: monacoEditor });

// ===========================================
// ACCESSIBILITY: Programmatic Names for Monaco Editors
// ===========================================
// Monaco Editor natively supports the `ariaLabel` property in its
// IStandaloneEditorConstructionOptions interface. This sets the aria-label
// attribute on the editor's internal textarea, allowing screen readers to
// announce a meaningful description of the editor's purpose.
// ===========================================
const monacoOptions = {
    minimap: {
        enabled: true,
    },
    scrollBeyondLastLine: false,

    readOnly: false,
    automaticLayout: false,
    // Accessibility: aria-label for screen readers
    ariaLabel: l10n.t('Document Editor: Edit the document in JSON format'),
};

function createObjectId(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
    return JSON.stringify({ $oid: hex });
}

export const DocumentView = (): JSX.Element => {
    /**
     * Use the configuration object to access the data passed to the webview at its creation.
     * Feel free to update the content of the object. It won't be synced back to the extension though.
     */
    const configuration = useConfiguration<DocumentsViewWebviewConfigurationType>();

    /**
     * Use the `useTrpcClient` hook to get the tRPC client
     */
    const trpcClient = useTrpcClient();
    const viewLoad = useViewLoadTelemetry();

    const initialContent = configuration.mode === 'add' ? '{  }' : '{ "loading…": true }';
    const [editorContent] = useState(initialContent);
    const [isLoading, setIsLoading] = useState(configuration.mode !== 'add');
    const [isDirty, setIsDirty] = useState(configuration.mode === 'add');
    const dirtyRef = useRef(configuration.mode === 'add');
    const [documentLoaded, setDocumentLoaded] = useState(configuration.mode === 'add');

    // Ref for the Save button to manage focus
    const saveButtonRef = useRef<HTMLButtonElement>(null);

    const editorRef = useRef<monacoEditor.editor.IStandaloneCodeEditor | null>(null);
    // Monaco can mount after the initial document fetch resolves (e.g. fast local emulator
    // responses beat Monaco's async module load), so we stash the value here and flush it
    // in handleMonacoEditorMount instead of silently dropping it.
    const pendingContentRef = useRef<string | null>(null);
    const settingContentRef = useRef(false);
    const editorRevisionRef = useRef(0);
    const onShowUnavailable = useCallback((): void => {
        setIsLoading(false);
    }, []);
    const {
        unavailable,
        setUnavailable,
        unavailableRef,
        revisionRef: operationRevisionRef,
        disposedRef,
        recovering,
        recoveryAnnouncement,
        showUnavailable,
        isOperationCurrent: isCurrentOperation,
        handleUnavailableAction,
    } = useBoundViewRecovery({
        recovery: trpcClient.mongoClusters.documentView.recoverUnavailable,
        common: trpcClient.common,
        onShowUnavailable,
    });
    const pendingDocumentIdRef = useRef(configuration.documentId || undefined);
    const updateDirty = (dirty: boolean): void => {
        if (dirtyRef.current === dirty) {
            return;
        }
        dirtyRef.current = dirty;
        setIsDirty(dirty);
        // Only report transitions, without editor contents or connection material.
        void trpcClient.mongoClusters.documentView.reportDirty.mutate(dirty).catch(() => {
            // The panel may have closed before the host received the report.
        });
    };
    // Falls back to pending/initial content if called before Monaco has mounted,
    // so callers (e.g. Save) never operate on an empty string.
    const getCurrentContent = () => editorRef.current?.getValue() ?? pendingContentRef.current ?? editorContent;
    const setContent = (newValue: string) => {
        settingContentRef.current = true;
        if (editorRef.current) {
            editorRef.current.setValue(newValue);
        } else {
            pendingContentRef.current = newValue;
        }
        settingContentRef.current = false;
    };
    const startOperation = (): number | undefined => {
        if (unavailableRef.current) {
            setUnavailable(unavailableRef.current);
            return undefined;
        }
        operationRevisionRef.current += 1;
        setIsLoading(true);
        return operationRevisionRef.current;
    };

    useSelectiveContextMenuPrevention();

    useEffect(() => {
        const handleMessage = (event: MessageEvent<unknown>): void => {
            if (isConnectionUnavailableMessage(event.data)) {
                showUnavailable(event.data.unavailable);
            }
        };
        window.addEventListener('message', handleMessage);
        return () => {
            window.removeEventListener('message', handleMessage);
            disposedRef.current = true;
        };
    }, [showUnavailable]);

    // a useEffect without a dependency runs only once after the first render only
    useEffect(() => {
        if (configuration.mode !== 'add') {
            const documentId = configuration.documentId;
            if (documentId === undefined) {
                return;
            }
            const revision = ++operationRevisionRef.current;
            const editorRevision = editorRevisionRef.current;

            // eslint-disable-next-line react-hooks/set-state-in-effect -- Setting loading state before async document fetch
            setIsLoading(true);

            const loadStartedAt = performance.now();
            void trpcClient.mongoClusters.documentView.getDocumentById
                .query(documentId)
                .then((response) => {
                    if (!isCurrentOperation(revision)) {
                        return;
                    }
                    if (isConnectionUnavailableResponse(response)) {
                        showUnavailable(response.unavailable);
                        return;
                    }
                    if (editorRevision === editorRevisionRef.current) {
                        setContent(response);
                        updateDirty(false);
                    }
                    setDocumentLoaded(true);
                    // A document deleted since it was listed reads back as `null`.
                    viewLoad.reportFirstData(
                        response === 'null' ? 'empty' : 'dataShown',
                        performance.now() - loadStartedAt,
                    );
                })
                .catch(async (error) => {
                    if (!isCurrentOperation(revision)) {
                        return;
                    }
                    viewLoad.reportFirstData('failed', performance.now() - loadStartedAt);
                    const cause = error instanceof Error ? error.message : String(error);
                    const explained = await trpcClient.common.explainOperationFailure.query({ message: cause });
                    if (!isCurrentOperation(revision)) {
                        return;
                    }
                    void trpcClient.common.displayErrorMessage.mutate({
                        message: explained ?? l10n.t('Error while loading the document'),
                        modal: false,
                        cause,
                    });
                })
                .finally(() => {
                    if (isCurrentOperation(revision)) {
                        setIsLoading(false);
                    }
                });
        }
    }, []);

    const handleResize = () => {
        if (editorRef.current) {
            editorRef.current.layout();
        }
    };

    const handleMonacoEditorMount = (
        editor: monacoEditor.editor.IStandaloneCodeEditor,
        _monaco: typeof monacoEditor,
    ) => {
        // Store the editor instance in ref
        editorRef.current = editor;

        // Flush any content that arrived before the editor finished mounting
        if (pendingContentRef.current !== null) {
            settingContentRef.current = true;
            editor.setValue(pendingContentRef.current);
            pendingContentRef.current = null;
            settingContentRef.current = false;
        }

        handleResize();

        // Accessibility: Focus the Save button instead of the editor
        // Monaco editor captures Tab/Shift-Tab for document editing, making it difficult
        // for keyboard users to navigate away. Setting focus on the toolbar button
        // provides better keyboard navigation until Tab navigation from editor is improved.
        // Addresses WCAG 2.4.3 Focus Order requirement.
        saveButtonRef.current?.focus();
    };

    useEffect(() => {
        // Add the debounced resize event listener
        const debouncedResizeHandler = debounce(handleResize, 200);
        window.addEventListener('resize', debouncedResizeHandler);

        // Initial layout adjustment
        handleResize();

        // Clean up on component unmount
        return () => {
            if (editorRef.current) {
                editorRef.current.dispose();
            }
            window.removeEventListener('resize', debouncedResizeHandler);
        };
    }, []);

    // function onMonacoMount(_editor: monacoEditor.editor.IStandaloneCodeEditor, _monaco: typeof monacoEditor) {
    //     editor.current = _editor;

    //     /**
    //      * The code below is an experimetnal code to show how to use monaco editor with JSON schema validation.
    //      * We'll be using something along this line in the future to validate documents.
    //      */

    //     // const modelUri = 'foo://myapp/custom.json1';
    //     // const model = _monaco.editor.createModel(`{ "type":  }`, 'json', _monaco.Uri.parse(modelUri));
    //     // // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    //     // editor.current.setModel(model);
    //     // _monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
    //     //     ..._monaco.languages.json.jsonDefaults.diagnosticsOptions,
    //     //     allowComments: true,
    //     //     schemas: [
    //     //         {
    //     //             uri: 'foo://myapp/segment/type',
    //     //             fileMatch: ['*.json1'],
    //     //             schema: {
    //     //                 type: 'object',
    //     //                 properties: {
    //     //                     type: {
    //     //                         enum: ['v1', 'v2'],
    //     //                         description: 'comment extracted from schema',
    //     //                         markupDescription: 'comment *extracted* from schema',
    //     //                     },
    //     //                 },
    //     //             },
    //     //         },
    //     //     ],
    //     //     validate: true,
    //     // });
    // }

    function handleOnRefreshRequest(): void {
        if (configuration.documentId === undefined) {
            return;
        }

        const revision = startOperation();
        if (revision === undefined) {
            return;
        }
        const editorRevision = editorRevisionRef.current;

        let documentLength = 0;

        void trpcClient.mongoClusters.documentView.getDocumentById
            .query(configuration.documentId)
            .then((response) => {
                if (!isCurrentOperation(revision)) {
                    return;
                }
                if (isConnectionUnavailableResponse(response)) {
                    showUnavailable(response.unavailable);
                    return;
                }
                documentLength = response.length ?? 0;
                if (editorRevision === editorRevisionRef.current) {
                    setContent(response);
                    updateDirty(false);
                }
                setDocumentLoaded(true);
            })
            .catch(async (error) => {
                if (!isCurrentOperation(revision)) {
                    return;
                }
                const cause = error instanceof Error ? error.message : String(error);
                const explained = await trpcClient.common.explainOperationFailure.query({ message: cause });
                if (!isCurrentOperation(revision)) {
                    return;
                }
                void trpcClient.common.displayErrorMessage.mutate({
                    message: explained ?? l10n.t('Error while refreshing the document'),
                    modal: false,
                    cause,
                });
            })
            .finally(() => {
                if (isCurrentOperation(revision)) {
                    setIsLoading(false);
                }
            });

        trpcClient.common.reportEvent
            .mutate({
                eventName: 'refreshDocument',
                properties: {
                    ui: 'button',
                },
                measurements: {
                    documentLength: documentLength,
                },
            })
            .catch((error) => {
                console.debug('Failed to report an event:', error);
            });
    }

    function handleOnSaveRequest(): void {
        const editorContent = getCurrentContent();

        if (editorContent === undefined || !documentLoaded || isLoading) {
            return;
        }

        const revision = startOperation();
        if (revision === undefined) {
            return;
        }
        const editorRevision = editorRevisionRef.current;
        pendingDocumentIdRef.current ??= createObjectId();
        const documentId = pendingDocumentIdRef.current;

        // A new document keeps one preallocated ID across retries, so a reply lost after an
        // acknowledged upsert cannot turn an explicit later save into a second insert.
        void trpcClient.mongoClusters.documentView.saveDocument
            .mutate({ documentContent: editorContent, documentId })
            .then((response) => {
                if (!isCurrentOperation(revision)) {
                    return;
                }
                if (isConnectionUnavailableResponse(response)) {
                    showUnavailable(response.unavailable);
                    return;
                }
                configuration.documentId = response.documentId;
                pendingDocumentIdRef.current = response.documentId;
                if (editorRevision !== editorRevisionRef.current) {
                    return;
                }
                setContent(response.documentStringified);
                setIsLoading(false);
                updateDirty(false);
            })
            .catch(async (error) => {
                if (!isCurrentOperation(revision)) {
                    return;
                }
                const cause = error instanceof Error ? error.message : String(error);
                const explained = await explainRecoveryFailure(trpcClient.common, cause);
                if (!isCurrentOperation(revision)) {
                    return;
                }
                void trpcClient.common.displayErrorMessage.mutate({
                    message: explained ?? l10n.t('Error saving the document'),
                    modal: true, // we want to show the error in a modal dialog as it's an important one, failed to save the document
                    cause,
                });
            })
            .finally(() => {
                if (isCurrentOperation(revision)) {
                    setIsLoading(false);
                }
            });

        trpcClient.common.reportEvent
            .mutate({
                eventName: 'saveDocument',
                properties: {
                    ui: 'button',
                },
                measurements: {
                    documentLength: editorContent.length,
                },
            })
            .catch((error) => {
                console.debug('Failed to report an event:', error);
            });
    }

    function handleOnValidateRequest(): void {}

    // Accessibility: Handle Escape key to exit Monaco editor
    const handleEscapeEditor = useCallback(() => {
        saveButtonRef.current?.focus();
    }, []);

    return (
        <DisconnectedOverlay
            warnOnClose={isDirty}
            unavailable={unavailable}
            onDismiss={() => setUnavailable(undefined)}
            onAction={handleUnavailableAction}
            recovering={recovering}
        >
            <div className="documentView">
                <div className="toolbarContainer">
                    {isLoading && <ProgressBar thickness="large" shape="square" className="progressBar" />}
                    <ToolbarDocuments
                        disableSaveButton={
                            configuration.mode === 'view' ||
                            !isDirty ||
                            isLoading ||
                            !documentLoaded ||
                            unavailable !== undefined
                        }
                        disableRefreshButton={isLoading || unavailable !== undefined}
                        onSaveRequest={handleOnSaveRequest}
                        onValidateRequest={handleOnValidateRequest}
                        onRefreshRequest={handleOnRefreshRequest}
                        saveButtonRef={saveButtonRef}
                    />
                </div>
                <div className="monacoContainer">
                    <MonacoEditor
                        height={'100%'}
                        width={'100%'}
                        language="json"
                        options={{ ...monacoOptions, readOnly: configuration.mode === 'view' }}
                        value={editorContent}
                        onMount={handleMonacoEditorMount}
                        onEscapeEditor={handleEscapeEditor}
                        onChange={() => {
                            if (!settingContentRef.current) {
                                editorRevisionRef.current += 1;
                                updateDirty(true);
                            }
                        }}
                    />
                </div>
                <Announcer when={recoveryAnnouncement !== undefined} message={recoveryAnnouncement ?? ''} />
            </div>
        </DisconnectedOverlay>
    );
};
