/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ProgressBar } from '@fluentui/react-components';
import { type JSX } from 'react';
import { InputWithHistory, type InputWithHistoryProps } from './InputWithHistory';
import './inputWithProgress.scss';

interface InputWithProgressProps extends InputWithHistoryProps {
    /**
     * When `true`, displays an indeterminate progress bar overlaid at the bottom of the input
     * and hides Fluent UI's default underline border to prevent visual conflicts.
     */
    indeterminateProgress?: boolean;
}

/**
 * InputWithProgress Component
 *
 * A wrapper around `InputWithHistory` that adds optional indeterminate progress indication.
 * Combines history navigation features with visual progress feedback.
 *
 * Features:
 * - All features from `InputWithHistory` (arrow up/down navigation, draft preservation, etc.)
 * - When `indeterminateProgress` is `true`:
 *   - Renders a rounded progress bar overlaid at the bottom of the input
 *   - Automatically hides Fluent UI's default underline and borders to prevent visual overlap
 *   - Maintains layout stability (no shifts when toggling progress on/off)
 * - Supports `ref` forwarding for direct access to the underlying `<input>` element
 *
 * Use Cases:
 * - AI query input with history and loading state
 * - Command input with async operation feedback
 * - Search bars with autocomplete and history
 *
 * @example
 * ```tsx
 * <InputWithProgress
 *   ref={inputRef}
 *   placeholder="Ask Copilot..."
 *   appearance="underline"
 *   indeterminateProgress={isLoading}
 *   initialHistory={previousQueries}
 *   onKeyDown={(e) => handleKeyPress(e)}
 * />
 * ```
 */
export function InputWithProgress({ indeterminateProgress, ref, ...inputProps }: InputWithProgressProps): JSX.Element {
    return (
        <div className={`inputWithProgress${indeterminateProgress ? ' progress-active' : ''}`}>
            <InputWithHistory ref={ref} {...inputProps} style={{ ...inputProps.style, width: '100%' }} />
            {indeterminateProgress ? (
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
    );
}
