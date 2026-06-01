/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Compact "still working…" row used inside Stage 3 streaming cards.
 *
 * Replaces the earlier two-line `streaming-content-lines` shimmer with a
 * Fluent {@link Spinner} + descriptive label. The visual goal is to make
 * "the LLM is still writing" obvious at a glance without competing with
 * the actual streamed content for the user's attention.
 *
 * Used in two places today (PR #711):
 *  - {@link MarkdownCard} — below the rendered markdown, while the
 *    `summary` / `educational` value is still streaming
 *    (`complete: false`).
 *  - {@link ImprovementCardShell} — body of a recommendation shell
 *    between the `recommendationStarted` and `recommendation` events.
 *  - The Stage-3 pre-reserved slots (analysis / recommendations /
 *    educational) before any structured event has arrived.
 *
 * Accessibility: rendered with `role="status"` + `aria-live="polite"` so
 * screen readers announce the change without interrupting the user. The
 * spinner itself is decorative (`aria-hidden`) — the label carries the
 * meaning.
 */

import { Spinner, Text, tokens, makeStyles } from '@fluentui/react-components';
import { type JSX } from 'react';

const useStyles = makeStyles({
    root: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalS,
        marginTop: tokens.spacingVerticalS,
        color: tokens.colorNeutralForeground3,
        // Mirror the body-text font size so the row reads as part of the
        // card content rather than a chrome-y addendum.
        fontSize: tokens.fontSizeBase300,
    },
});

export interface StreamingInlineProgressProps {
    /**
     * Descriptive label, e.g. "Analyzing…" / "Writing recommendation…".
     * MUST be localized by the caller (this component is l10n-agnostic).
     */
    label: string;

    /**
     * Optional className for the outer row (e.g. for extra spacing in a
     * card body).
     */
    className?: string;
}

export function StreamingInlineProgress({ label, className }: StreamingInlineProgressProps): JSX.Element {
    const styles = useStyles();
    const rootClass = className ? `${styles.root} ${className}` : styles.root;
    return (
        <div role="status" aria-live="polite" className={rootClass}>
            {/* The Spinner is decorative — the label below carries the
                semantic meaning for screen readers. Size `extra-tiny` is
                the smallest Fluent variant that still animates clearly at
                the body-text height we use here. */}
            <Spinner size="extra-tiny" appearance="primary" aria-hidden />
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                {label}
            </Text>
        </div>
    );
}
