/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useFocusFinders } from '@fluentui/react-components';
import { type EditorProps } from '@monaco-editor/react';
import { MonacoEditor } from './MonacoEditor';

// eslint-disable-next-line import/no-internal-modules
import * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';

import { debounce } from 'es-toolkit';
import { useEffect, useRef, useState } from 'react';
import './monacoAutoHeight.scss';

/**
 * Props for the MonacoAutoHeight component.
 *
 * @typedef {Object} MonacoAutoHeightProps
 *
 * @property {Object} adaptiveHeight - Configuration for adaptive height of the editor.
 * @property {boolean} adaptiveHeight.enabled - Whether adaptive height is enabled.
 * @property {number} adaptiveHeight.minLines - Minimum number of lines for the editor height.
 * @property {number} adaptiveHeight.maxLines - Maximum number of lines for the editor height.
 * @property {number} [adaptiveHeight.lineHeight] - Height of each line in pixels (optional).
 * @property {function} adaptiveHeight.onEditorContentHeightChange - Callback function when the editor content height changes.
 *
 * @property {function} [onEditorMount] - Handler for editor mount. Invoked when the editor is mounted.
 *                                        You can use it to access editor instance and get a reference to a function you need (e.g. to get the editor content)
 * @property {function} [onExecuteRequest] - Optional: Invoked when the user presses Ctrl/Cmd + Enter in the editor.
 */
export type MonacoAutoHeightProps = EditorProps & {
    adaptiveHeight?: {
        // Optional
        enabled: boolean; // Whether adaptive height is enabled
        minLines: number; // Minimum number of lines for the editor height
        maxLines: number; // Maximum number of lines for the editor height
        lineHeight?: number; // Height of each line in pixels (optional)
    };
    onExecuteRequest?: (editorContent: string) => void; // Optional: Invoked when the user presses Ctrl/Cmd + Enter in the editor
    /**
     * When true, Monaco keeps focus on the editor when Tab / Shift+Tab are pressed.
     * When false (default), Tab navigation behaves like a standard input and moves focus to the next/previous focusable element.
     */
    trapTabKey?: boolean;
};

export const MonacoAutoHeight = (props: MonacoAutoHeightProps) => {
    const editorRef = useRef<monacoEditor.editor.IStandaloneCodeEditor | null>(null);
    const tabKeyDisposerRef = useRef<monacoEditor.IDisposable | null>(null);
    const focusFindersRef = useRef<ReturnType<typeof useFocusFinders> | null>(null);

    const [editorHeight, setEditorHeight] = useState<number>(1 * 19); // Initial height
    const [lastLineCount, setLastLineCount] = useState<number>(0);

    // IMPORTANT: Store refs to solve React "stale closure" problems
    // Monaco editor attaches event handlers during initialization that
    // won't automatically update when state changes
    const lastLineCountRef = useRef(lastLineCount);
    const propsRef = useRef(props);
    const focusFinders = useFocusFinders();

    // Keep refs updated with the latest values
    useEffect(() => {
        lastLineCountRef.current = lastLineCount;
    }, [lastLineCount]);

    useEffect(() => {
        propsRef.current = props;
    }, [props]);

    useEffect(() => {
        focusFindersRef.current = focusFinders;
    }, [focusFinders]);

    // Exclude adaptiveHeight prop and onExecuteRequest prop from being passed to the Monaco editor
    // also, let's exclude onMount as we're adding our own handler and will invoke the provided one
    // once we're done with our setup

    // These props are intentionally destructured but not used directly - they're handled specially
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { adaptiveHeight, onExecuteRequest, onMount, trapTabKey, ...editorProps } = props;

    const handleMonacoEditorMount = (
        editor: monacoEditor.editor.IStandaloneCodeEditor,
        monaco: typeof monacoEditor,
    ) => {
        // Store the editor instance in ref
        editorRef.current = editor;

        handleResize();

        if (propsRef.current.adaptiveHeight?.enabled) {
            setupAdaptiveHeight(editor);
        }

        configureTabKeyMode(editor, propsRef.current.trapTabKey ?? false);

        // Register a command for Ctrl + Enter / Cmd + Enter
        if (propsRef.current.onExecuteRequest) {
            editor.addCommand(monacoEditor.KeyMod.CtrlCmd | monacoEditor.KeyCode.Enter, () => {
                // Use the ref to get the latest onExecuteRequest handler
                propsRef.current.onExecuteRequest?.(editor.getValue());
            });
        }

        // If the parent has provided the onMount handler, call it now
        if (propsRef.current.onMount) {
            propsRef.current.onMount(editor, monaco); // Pass the editor instance to the parent
        }
    };

    useEffect(() => {
        // Add the debounced resize event listener
        const debouncedResizeHandler = debounce(handleResize, 100);
        window.addEventListener('resize', debouncedResizeHandler);

        // Initial layout adjustment
        handleResize();

        // Clean up on component unmount
        return () => {
            if (tabKeyDisposerRef.current) {
                tabKeyDisposerRef.current.dispose();
                tabKeyDisposerRef.current = null;
            }
            if (editorRef.current) {
                editorRef.current.dispose();
            }
            window.removeEventListener('resize', debouncedResizeHandler);
        };
    }, []);

    useEffect(() => {
        if (editorRef.current) {
            configureTabKeyMode(editorRef.current, trapTabKey ?? false);
        }
    }, [trapTabKey]);

    const handleResize = () => {
        if (editorRef.current) {
            editorRef.current.layout();
        }
    };

    //Helper function to set up adaptive height behavior
    const setupAdaptiveHeight = (editor: monacoEditor.editor.IStandaloneCodeEditor) => {
        // Update the height initially and on content changes
        // const updateHeight = debounce(() => updateEditorHeight(editor), 300); // doesn't really look good, but let's revisit it later
        const updateHeight = () => updateEditorHeight(editor);

        updateHeight();

        // Attach event listener for content changes
        editor.onDidChangeModelContent(updateHeight);
    };

    // Update the editor height based on the number of lines in the document
    const updateEditorHeight = (editor: monacoEditor.editor.IStandaloneCodeEditor) => {
        // Safely access adaptiveHeight properties with defaults
        const lineHeight = propsRef.current.adaptiveHeight?.lineHeight ?? 19;
        const minLines = propsRef.current.adaptiveHeight?.minLines ?? 1;
        const maxLines = propsRef.current.adaptiveHeight?.maxLines ?? 10;

        const lineCount = editor.getModel()?.getLineCount() || 1;

        // Only update if the number of lines changes
        if (lineCount !== lastLineCountRef.current) {
            const lines = Math.min(lineCount, maxLines);
            const finalLines = Math.max(lines, minLines);

            const finalHeight = finalLines * lineHeight;

            // Call the callback if provided
            setEditorHeight(finalHeight);

            // TODO: once allotment is implemented, we can remove this hack:

            // this is a hack to fix the issue with the editor not updating the layout properly
            // the first run computes the correct width. The second run applies the height we need
            editor.layout();
            // Update the editor layout with the new height
            editor.layout({ width: editor.getLayoutInfo().width, height: finalHeight });

            // Save the last line count to avoid unnecessary updates
            setLastLineCount(lineCount);
        }
    };

    /**
     * Configures the Tab key behavior for the Monaco editor.
     *
     * When called, this function sets up or removes a keydown handler for the Tab key.
     * If `shouldTrap` is true, Tab/Shift+Tab are trapped within the editor (focus remains in editor).
     * If `shouldTrap` is false, Tab/Shift+Tab move focus to the next/previous focusable element outside the editor.
     *
     * @param {monacoEditor.editor.IStandaloneCodeEditor} editor - The Monaco editor instance.
     * @param {boolean} shouldTrap - Whether to trap Tab key in the editor.
     *   - true: Tab/Shift+Tab are trapped in the editor.
     *   - false: Tab/Shift+Tab move focus to next/previous element.
     */
    const configureTabKeyMode = (editor: monacoEditor.editor.IStandaloneCodeEditor, shouldTrap: boolean) => {
        if (tabKeyDisposerRef.current) {
            tabKeyDisposerRef.current.dispose();
            tabKeyDisposerRef.current = null;
        }

        if (shouldTrap) {
            return;
        }

        tabKeyDisposerRef.current = editor.onKeyDown((event) => {
            if (event.keyCode !== monacoEditor.KeyCode.Tab) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();

            const direction = event.browserEvent.shiftKey ? 'previous' : 'next';
            moveFocus(editor, direction);
        });
    };

    /**
     * Moves keyboard focus to the next or previous focusable element relative to the editor.
     *
     * @param {monacoEditor.editor.IStandaloneCodeEditor} editor - The Monaco editor instance.
     * @param {'next' | 'previous'} direction - The direction to move focus:
     *        'next' moves to the next focusable element, 'previous' moves to the previous one.
     *        Typically determined by whether Shift is held during Tab key press.
     *
     * If no focusable element is found in the given direction, the currently active element
     * or the editor DOM node will be blurred as a fallback.
     */
    const moveFocus = (editor: monacoEditor.editor.IStandaloneCodeEditor, direction: 'next' | 'previous') => {
        const focusFinders = focusFindersRef.current;
        const editorDomNode = editor.getDomNode();

        if (!focusFinders || !editorDomNode) {
            return;
        }

        const activeElement = document.activeElement as HTMLElement | null;
        const startElement = activeElement ?? (editorDomNode as HTMLElement);

        const targetElement =
            direction === 'next'
                ? focusFinders.findNextFocusable(startElement)
                : focusFinders.findPrevFocusable(startElement);

        if (targetElement) {
            targetElement.focus();
            return;
        }

        if (activeElement) {
            activeElement.blur();
        } else if (editorDomNode instanceof HTMLElement) {
            editorDomNode.blur();
        }
    };

    return (
        <div className="monacoAutoHeightContainer" style={{ height: editorHeight }}>
            <MonacoEditor {...editorProps} onMount={handleMonacoEditorMount} />
        </div>
    );
};
