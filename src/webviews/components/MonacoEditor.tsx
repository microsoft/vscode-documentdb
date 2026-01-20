/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import Editor, { loader, useMonaco, type EditorProps, type OnMount } from '@monaco-editor/react';
// eslint-disable-next-line import/no-internal-modules
import * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';

import { useUncontrolledFocus } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Announcer } from '../api/webview-client/accessibility';
import { useThemeState } from '../theme/state/ThemeContext';

loader.config({ monaco: monacoEditor });

export interface MonacoEditorProps extends EditorProps {
    /**
     * Callback invoked when the user presses Escape key to exit the editor.
     * Use this to move focus to a known element outside the editor.
     */
    onEscapeEditor?: () => void;
}

/**
 * Monaco Editor wrapper with accessibility enhancements.
 *
 * ## Focus Trap Behavior
 *
 * Monaco Editor captures Tab/Shift-Tab for code indentation, creating a "tab trap"
 * that can make keyboard navigation difficult. This component implements:
 *
 * 1. **Uncontrolled Focus Zone**: Uses Fluent UI's `useUncontrolledFocus` with
 *    `data-is-focus-trap-zone-bumper` attribute to tell Tabster that focus inside
 *    this zone is managed externally (by Monaco, not by Tabster's tab navigation).
 *    See: https://github.com/microsoft/fluentui/blob/0f490a4fea60df6b2ad0f5a6e088017df7ce1d54/packages/react-components/react-tabster/src/hooks/useTabster.ts#L34
 *
 * 2. **Escape Key Exit**: When `onEscapeEditor` is provided, pressing Escape
 *    allows keyboard users to exit the editor and move focus elsewhere.
 *
 * 3. **Screen Reader Announcement**: Announces "Press Escape to exit editor"
 *    once when the editor receives focus (only announced once per focus session).
 */
export const MonacoEditor = ({ onEscapeEditor, onMount, ...props }: MonacoEditorProps) => {
    const monaco = useMonaco();
    const themeState = useThemeState();
    const uncontrolledFocus = useUncontrolledFocus();

    // Track whether we should announce the escape hint (once per focus session)
    const [shouldAnnounce, setShouldAnnounce] = useState(false);
    const hasAnnouncedRef = useRef(false);

    useEffect(() => {
        if (monaco && themeState.monaco.theme) {
            monaco.editor.defineTheme(themeState.monaco.themeName, themeState.monaco.theme);
            monaco.editor.setTheme(themeState.monaco.themeName);
        }
    }, [monaco, themeState]);

    const handleMount: OnMount = useCallback(
        (editor, monacoInstance) => {
            // Register Escape key handler to exit the editor
            if (onEscapeEditor) {
                editor.addCommand(monacoInstance.KeyCode.Escape, () => {
                    onEscapeEditor();
                });
            }

            // Announce escape hint once when editor gains focus
            editor.onDidFocusEditorText(() => {
                if (!hasAnnouncedRef.current && onEscapeEditor) {
                    setShouldAnnounce(true);
                    hasAnnouncedRef.current = true;
                }
            });

            // Reset announcement tracking when editor loses focus
            editor.onDidBlurEditorText(() => {
                setShouldAnnounce(false);
                hasAnnouncedRef.current = false;
            });

            // Call the original onMount if provided
            onMount?.(editor, monacoInstance);
        },
        [onEscapeEditor, onMount],
    );

    return (
        <section {...uncontrolledFocus} style={{ width: '100%', height: '100%' }}>
            <i
                // Focus trap bumper element for Fluent UI Tabster integration.
                // Tabster's checkUncontrolledTrappingFocus checks for this attribute
                // to identify zones where tab navigation is managed externally.
                // IMPORTANT: This MUST be the first child element - the check uses
                // element.firstElementChild?.hasAttribute('data-is-focus-trap-zone-bumper')
                data-is-focus-trap-zone-bumper={true}
                style={{
                    position: 'fixed',
                    height: '1px',
                    width: '1px',
                    opacity: '0.001',
                    zIndex: '-1',
                    contentVisibility: 'hidden',
                    top: '0px',
                    left: '0px',
                }}
            ></i>
            {/* Screen reader announcement for escape key hint */}
            <Announcer when={shouldAnnounce} message={l10n.t('Press Escape to exit editor')} />
            <Editor
                {...props}
                data-is-focus-trap-zone-bumper={'true'}
                onMount={handleMount}
                theme={themeState.monaco.themeName}
            />
        </section>
    );
};
