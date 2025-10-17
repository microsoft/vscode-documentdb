/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Input, ProgressBar, type InputProps } from '@fluentui/react-components';
import { forwardRef, type JSX } from 'react';
import './inputWithProgress.scss';

interface InputWithProgressProps extends InputProps {
    /**
     * When `true`, displays an indeterminate progress bar overlaid at the bottom of the input
     * and hides Fluent UI's default underline border to prevent visual conflicts.
     */
    indeterminateProgress?: boolean;
}

/**
 * InputWithProgress Component
 *
 * A wrapper around Fluent UI's `Input` component that adds optional indeterminate progress indication.
 *
 * Features:
 * - Transparently passes through all standard `InputProps` (placeholder, appearance, event handlers, etc.)
 * - When `indeterminateProgress` is `true`:
 *   - Renders a rounded progress bar overlaid at the bottom of the input
 *   - Automatically hides Fluent UI's default underline and borders to prevent visual overlap
 *   - Maintains layout stability (no shifts when toggling progress on/off)
 * - Supports `ref` forwarding for direct access to the underlying `<input>` element
 *
 * Use Cases:
 * - Showing async operation feedback (e.g., AI query processing, autocomplete loading)
 * - Indicating in-progress states without blocking user input
 *
 * @example
 * ```tsx
 * <InputWithProgress
 *   ref={inputRef}
 *   placeholder="Type something..."
 *   appearance="underline"
 *   indeterminateProgress={isLoading}
 *   onKeyDown={(e) => handleKeyPress(e)}
 * />
 * ```
 */
export const InputWithProgress = forwardRef<HTMLInputElement, InputWithProgressProps>(
    ({ indeterminateProgress, ...inputProps }, ref): JSX.Element => {
        return (
            <div className={`inputWithProgress${indeterminateProgress ? ' progress-active' : ''}`}>
                <Input ref={ref} {...inputProps} style={{ width: '100%', ...inputProps.style }} />
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
    },
);

InputWithProgress.displayName = 'InputWithProgress';
