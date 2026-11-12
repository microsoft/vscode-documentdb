/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { useCallback, useEffect, useState, type JSX } from 'react';
import { Announcer } from '../../components/accessibility';

/** Returned by a copy action to replace the success announcement, e.g. after a fallback. */
export interface CopiedWithMessage {
    readonly copiedMessage: string;
}

export interface CopyFeedback {
    /** True for two seconds after a successful copy: show a checkmark instead of the icon. */
    readonly copied: boolean;
    /**
     * Runs a copy action. Resolving to `false` or rejecting counts as a failure; resolving to
     * {@link CopiedWithMessage} overrides `copiedMessage`.
     */
    readonly run: (copy: () => unknown, copiedMessage?: string) => Promise<void>;
    /** Announces the result to screen readers. Render it next to the button. */
    readonly announcer: JSX.Element;
}

function isCopiedWithMessage(value: unknown): value is CopiedWithMessage {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as Partial<CopiedWithMessage>).copiedMessage === 'string'
    );
}

/**
 * Copy confirmation shared by the Query Insights copy buttons: the caller swaps its icon for a
 * checkmark while `copied` is true, and the announcer reports success or failure. Labels never
 * change, so the accessible name stays stable under focus.
 */
export function useCopyFeedback(): CopyFeedback {
    const [state, setState] = useState<{ status: 'idle' | 'copied' | 'failed'; key: number; message?: string }>({
        status: 'idle',
        key: 0,
    });

    useEffect(() => {
        if (state.status === 'idle') return undefined;
        const timer = window.setTimeout(() => setState((previous) => ({ ...previous, status: 'idle' })), 2000);
        return () => window.clearTimeout(timer);
    }, [state]);

    const run = useCallback(async (copy: () => unknown, copiedMessage?: string): Promise<void> => {
        let ok: boolean;
        let message = copiedMessage;
        try {
            const result = await copy();
            ok = result !== false;
            if (isCopiedWithMessage(result)) message = result.copiedMessage;
        } catch {
            ok = false;
        }
        setState((previous) => ({ status: ok ? 'copied' : 'failed', key: previous.key + 1, message }));
    }, []);

    const announcer = (
        <Announcer
            key={`copy-${state.key}`}
            when={state.status !== 'idle'}
            message={
                state.status === 'failed'
                    ? l10n.t('Could not copy to the clipboard')
                    : (state.message ?? l10n.t('Copied to clipboard'))
            }
        />
    );

    return { copied: state.status === 'copied', run, announcer };
}
