/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Input, type InputProps } from '@fluentui/react-components';
import { useRef, useState, type JSX } from 'react';

export interface InputWithHistoryProps extends InputProps {
    /**
     * History entries for the input.
     * - If provided WITHOUT `onHistoryChange`: Used as initial history, component manages updates internally
     * - If provided WITH `onHistoryChange`: Fully controlled mode, parent must handle updates
     * - If omitted: Component starts with empty history and manages it internally
     */
    history?: string[];

    /**
     * Maximum number of history entries to maintain. Defaults to 50.
     * Oldest entries are removed when the limit is exceeded.
     */
    maxHistorySize?: number;

    /**
     * Optional callback invoked whenever the history array should be updated.
     * - If provided: Component operates in fully controlled mode
     * - If omitted: Component manages history internally (even if `history` prop is provided for initial state)
     */
    onHistoryChange?: (history: string[]) => void;

    /**
     * Ref to forward to the underlying input element
     */
    ref?: React.Ref<HTMLInputElement>;
}

/**
 * InputWithHistory Component
 *
 * A wrapper around Fluent UI's `Input` component that adds command-line style history navigation.
 *
 * Features:
 * - **Arrow Up/Down Navigation**: Browse through previously entered values
 * - **Draft Preservation**: Current input is saved when navigating away and restored when returning
 * - **History Management**: Entries are added on Enter key press
 * - **Deduplication**: Consecutive identical entries are automatically filtered out
 * - **Configurable Limits**: Set maximum history size to prevent unbounded growth
 *
 * Behavior:
 * - Arrow Up: Navigate to previous history entry (older)
 * - Arrow Down: Navigate to next history entry (newer), eventually returning to empty/draft
 * - Enter: Adds current value to history (without swallowing the event)
 * - Editing: Any modification creates a new draft that becomes the next history entry
 *
 * Usage Modes:
 *
 * 1. **Uncontrolled** (no history management needed):
 * ```tsx
 * <InputWithHistory placeholder="Type a command..." />
 * ```
 *
 * 2. **Semi-controlled** (pre-seeded history, auto-managed):
 * ```tsx
 * <InputWithHistory
 *   placeholder="Type a command..."
 *   history={['command 1', 'command 2']}
 * />
 * ```
 *
 * 3. **Fully controlled** (history survives unmount):
 * ```tsx
 * const [history, setHistory] = useState(['command 1']);
 * <InputWithHistory
 *   placeholder="Type a command..."
 *   history={history}
 *   onHistoryChange={setHistory}
 * />
 * ```
 */
export function InputWithHistory({
    history: controlledHistory,
    maxHistorySize = 50,
    onHistoryChange,
    value: controlledValue,
    onChange,
    onKeyDown,
    ref,
    ...inputProps
}: InputWithHistoryProps): JSX.Element {
    // Determine if history is fully controlled (both history AND onHistoryChange provided)
    const isHistoryControlled = controlledHistory !== undefined && onHistoryChange !== undefined;

    // Internal history state
    // Initialize with controlledHistory (if provided) or empty array
    const [internalHistory, setInternalHistory] = useState<string[]>(controlledHistory ?? []);

    // Use controlled history if fully controlled, otherwise use internal state
    const history = isHistoryControlled ? controlledHistory : internalHistory;

    // Current position in history (-1 means not navigating, showing current/draft)
    const [historyIndex, setHistoryIndex] = useState<number>(-1);

    // Draft input (what user is currently typing, before adding to history)
    const [draft, setDraft] = useState<string>('');

    // Track if we're using controlled or uncontrolled value
    const isControlled = controlledValue !== undefined;
    const [internalValue, setInternalValue] = useState<string>('');

    // Current effective value
    const currentValue = isControlled ? String(controlledValue ?? '') : internalValue;

    // Ref to track if we're in the middle of history navigation
    const isNavigatingRef = useRef<boolean>(false);

    // Add entry to history (with deduplication and size management)
    const addToHistory = (entry: string) => {
        if (!entry.trim()) {
            return; // Don't add empty entries
        }

        const updateHistory = (prev: string[]) => {
            // Don't add if it's identical to the last entry (deduplication)
            if (prev.length > 0 && prev[prev.length - 1] === entry) {
                return prev;
            }

            const newHistory = [...prev, entry];

            // Enforce max size (remove oldest entries)
            if (newHistory.length > maxHistorySize) {
                return newHistory.slice(newHistory.length - maxHistorySize);
            }

            return newHistory;
        };

        if (isHistoryControlled) {
            // Fully controlled mode: notify parent to update history
            onHistoryChange(updateHistory(history));
        } else {
            // Uncontrolled or semi-controlled mode: update internal state
            setInternalHistory(updateHistory);
        }
    };

    // Handle value changes
    const handleChange: InputProps['onChange'] = (event, data) => {
        const newValue = data.value;

        // If we're navigating history and user edits, save as draft and exit navigation
        if (isNavigatingRef.current) {
            setDraft(newValue);
            setHistoryIndex(-1);
            isNavigatingRef.current = false;
        } else {
            setDraft(newValue);
        }

        // Update internal value if uncontrolled
        if (!isControlled) {
            setInternalValue(newValue);
        }

        // Call parent onChange if provided
        if (onChange) {
            onChange(event, data);
        }
    };

    // Handle keyboard navigation
    const handleKeyDown: InputProps['onKeyDown'] = (event) => {
        if (event.key === 'ArrowUp') {
            event.preventDefault(); // Prevent cursor movement
            navigateHistory('up');
        } else if (event.key === 'ArrowDown') {
            event.preventDefault(); // Prevent cursor movement
            navigateHistory('down');
        } else if (event.key === 'Enter') {
            // Add to history (don't prevent default - let parent handle Enter)
            addToHistory(currentValue);
            setHistoryIndex(-1); // Reset navigation
            setDraft(''); // Clear draft after adding to history
            isNavigatingRef.current = false;
        }

        // Call parent onKeyDown if provided
        if (onKeyDown) {
            onKeyDown(event);
        }
    };

    // Navigate through history
    const navigateHistory = (direction: 'up' | 'down') => {
        if (history.length === 0) {
            return; // No history to navigate
        }

        isNavigatingRef.current = true;

        if (direction === 'up') {
            // Going back in history (to older entries)
            if (historyIndex === -1) {
                // First time navigating up - save current draft and go to last entry
                setDraft(currentValue);
                setHistoryIndex(history.length - 1);
                updateValueFromHistory(history.length - 1);
            } else if (historyIndex > 0) {
                // Navigate to previous entry
                const newIndex = historyIndex - 1;
                setHistoryIndex(newIndex);
                updateValueFromHistory(newIndex);
            }
            // If already at oldest (index 0), do nothing (stop at beginning)
        } else {
            // Going forward in history (to newer entries)
            if (historyIndex === -1) {
                return; // Already at the latest (draft)
            }

            if (historyIndex < history.length - 1) {
                // Navigate to next entry
                const newIndex = historyIndex + 1;
                setHistoryIndex(newIndex);
                updateValueFromHistory(newIndex);
            } else {
                // Reached the end - show draft
                setHistoryIndex(-1);
                updateValueFromHistory(-1);
                isNavigatingRef.current = false;
            }
        }
    };

    // Update input value from history or draft
    const updateValueFromHistory = (index: number) => {
        const newValue = index === -1 ? draft : history[index];

        if (!isControlled) {
            setInternalValue(newValue);
        }

        // If controlled, we need to notify parent to update the value
        if (isControlled && onChange) {
            // Create a synthetic event to update controlled value
            const syntheticEvent = {
                target: { value: newValue },
                currentTarget: { value: newValue },
            } as React.ChangeEvent<HTMLInputElement>;

            onChange(syntheticEvent, { value: newValue });
        }
    };

    return <Input ref={ref} {...inputProps} value={currentValue} onChange={handleChange} onKeyDown={handleKeyDown} />;
}
