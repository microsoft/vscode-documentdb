/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { debounce } from 'es-toolkit';
import * as React from 'react';
import { MonacoEditor } from '../../../components/MonacoEditor';

// eslint-disable-next-line import/no-internal-modules
import type * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';

interface Props {
    value: string[];
}

const monacoOptions = {
    minimap: {
        enabled: true,
    },
    scrollBeyondLastLine: false,
    readOnly: true,
    automaticLayout: false,
};

export const DataViewPanelJSON = ({ value }: Props): React.JSX.Element => {
    const editorRef = React.useRef<monacoEditor.editor.IStandaloneCodeEditor | null>(null);

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
            value={value.join('\n\n')}
        />
    );
};
