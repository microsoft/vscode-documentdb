/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, type ButtonProps } from '@fluentui/react-components';
import { CheckmarkRegular, CopyRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useEffect, useState, type JSX } from 'react';
import { Announcer } from '../../components/accessibility';

export interface CopyButtonProps {
    /** Visible label, e.g. "Copy command". */
    label: string;
    /** Performs the copy. Resolving to `false` or rejecting counts as a failure. */
    onCopy: () => Promise<unknown> | unknown;
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
    const [state, setState] = useState<{ status: 'idle' | 'copied' | 'failed'; key: number }>({
        status: 'idle',
        key: 0,
    });

    useEffect(() => {
        if (state.status === 'idle') return undefined;
        const timer = window.setTimeout(() => setState((previous) => ({ ...previous, status: 'idle' })), 2000);
        return () => window.clearTimeout(timer);
    }, [state]);

    const handleClick = async (): Promise<void> => {
        let ok: boolean;
        try {
            ok = (await onCopy()) !== false;
        } catch {
            ok = false;
        }
        setState((previous) => ({ status: ok ? 'copied' : 'failed', key: previous.key + 1 }));
    };

    const copied = state.status === 'copied';
    return (
        <>
            <Button
                appearance={appearance}
                size={size}
                icon={copied ? <CheckmarkRegular /> : <CopyRegular />}
                onClick={() => void handleClick()}
            >
                {label}
            </Button>
            <Announcer
                key={`copy-${state.key}`}
                when={state.status !== 'idle'}
                message={
                    state.status === 'failed'
                        ? l10n.t('Could not copy to the clipboard')
                        : (copiedMessage ?? l10n.t('Copied to clipboard'))
                }
            />
        </>
    );
}
