/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, type ButtonProps } from '@fluentui/react-components';
import { CheckmarkRegular, CopyRegular } from '@fluentui/react-icons';
import { type JSX } from 'react';
import { useCopyFeedback } from './useCopyFeedback';

export interface CopyButtonProps {
    /** Visible label, e.g. "Copy command". */
    label: string;
    /** Performs the copy. Resolving to `false` or rejecting counts as a failure. */
    onCopy: () => unknown;
    /** Screen reader message after a successful copy. Defaults to "Copied to clipboard". */
    copiedMessage?: string;
    appearance?: ButtonProps['appearance'];
    size?: ButtonProps['size'];
}

/**
 * Copy button with confirmation: after a successful copy the icon becomes a checkmark for two
 * seconds and the result is announced to screen readers. The label stays the same so the
 * accessible name does not change under focus. Same feedback as the Query Insights explorer's
 * snippet buttons.
 */
export function CopyButton({
    label,
    onCopy,
    copiedMessage,
    appearance = 'secondary',
    size = 'small',
}: CopyButtonProps): JSX.Element {
    const feedback = useCopyFeedback();

    return (
        <>
            <Button
                appearance={appearance}
                size={size}
                icon={feedback.copied ? <CheckmarkRegular /> : <CopyRegular />}
                onClick={() => void feedback.run(onCopy, copiedMessage)}
            >
                {label}
            </Button>
            {feedback.announcer}
        </>
    );
}
