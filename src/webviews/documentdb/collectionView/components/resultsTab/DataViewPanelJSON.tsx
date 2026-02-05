/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useFocusFinders } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { debounce } from 'es-toolkit';
import * as React from 'react';
import { MonacoEditor } from '../../../../components/MonacoEditor';

// eslint-disable-next-line import/no-internal-modules
import type * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';

interface Props {
    value: string[];
}

const monacoOptions = {
    ariaLabel: l10n.t('JSON results view: Read-only display of query results in JSON format'),
    minimap: {
        enabled: true,
    },
    scrollBeyondLastLine: false,
    readOnly: true,
    automaticLayout: false,
};

export const DataViewPanelJSON = ({ value }: Props): React.JSX.Element => {
    const editorRef = React.useRef<monacoEditor.editor.IStandaloneCodeEditor | null>(null);
    const { findNextFocusable } = useFocusFinders();

    React.useEffect(() => {
        // Add ResizeObserver to watch parent container size changes
        // This detects all resize events: window resize, QueryEditor Collapse animation, etc.
        // Debouncing prevents "ResizeObserver loop completed with undelivered notifications" warning
        const container = document.querySelector('.resultsDisplayArea');
        let resizeObserver: ResizeObserver | null = null;

        if (container) {
            const debouncedResizeHandler = debounce(handleResize, 100);
            resizeObserver = new ResizeObserver(debouncedResizeHandler);
            resizeObserver.observe(container);
        }

        // Initial layout adjustment
        handleResize();

        // Clean up on component unmount
        return () => {
            if (editorRef.current) {
                editorRef.current.dispose();
            }
            if (resizeObserver) {
                resizeObserver.disconnect();
            }
        };
    }, []);

    const handleResize = () => {
        if (editorRef.current) {
            editorRef.current.layout();
        }
    };

    // Handle Escape key: move focus to next focusable element
    const handleEscapeEditor = React.useCallback(() => {
        const editorDomNode = editorRef.current?.getDomNode();
        if (!editorDomNode) {
            return;
        }

        const activeElement = document.activeElement as HTMLElement | null;
        const startElement = activeElement ?? (editorDomNode as HTMLElement);
        const nextElement = findNextFocusable(startElement);

        if (nextElement) {
            nextElement.focus();
        } else {
            activeElement?.blur();
        }
    }, [findNextFocusable]);

    return (
        <MonacoEditor
            height={'100%'}
            width={'100%'}
            language="json"
            options={monacoOptions}
            onMount={(editor) => {
                // Store the editor instance in ref
                editorRef.current = editor;
                handleResize();
            }}
            onEscapeEditor={handleEscapeEditor}
            value={value.join('\n\n')}
        />
    );
};
