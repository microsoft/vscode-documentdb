/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { cloneElement, isValidElement, type JSX, type ReactElement } from 'react';
import './StreamingPlaceholder.scss';

/**
 * Visual variant of {@link StreamingPlaceholder}.
 *
 * - `standalone`: a top-level row used before any streamed content has arrived
 *   (e.g. "Generating AI analysis…"). Slightly larger font and icon.
 * - `inline`: a compact row used at the tail of a card whose content is still
 *   streaming, or inside a recommendation shell awaiting its fill.
 */
export type StreamingPlaceholderVariant = 'standalone' | 'inline';

/**
 * Where the indeterminate bar renders inside the row.
 *
 * - `trailing` (default): the bar sits AFTER the label, near the right edge
 *   of the row — used by in-card placeholders (recommendation shells, the
 *   pre-first-block "Generating…" indicator) where the label is the primary
 *   visual element.
 * - `leading`: the bar sits BEFORE everything else, in the same horizontal
 *   slot the surrounding stepper / list uses for bullet markers. Used by
 *   {@link StreamingProgressStepper}'s active step so the bar visually
 *   replaces the bullet rather than crowding into the right edge.
 */
export type StreamingPlaceholderBarPosition = 'leading' | 'trailing';

/**
 * Animation style of the indeterminate bar.
 *
 * - `shimmer` (default): a thin highlight strip travels left → right across
 *   a short fixed-width bar. Good for compact in-card placeholders.
 * - `pulse`: the bar's opacity pulsates between dim and bright without any
 *   moving overlay — calmer, better suited to a vertical stepper where a
 *   traveling shimmer would compete with the surrounding step markers.
 */
export type StreamingPlaceholderBarStyle = 'shimmer' | 'pulse';

export interface StreamingPlaceholderProps {
    /**
     * Optional descriptive label, e.g. "Generating AI analysis…" or "writing…".
     * Localized by the caller.
     */
    label?: string;

    /**
     * Optional icon rendered before the label. Per the D11 design rule a
     * placeholder must carry the **same icon** the final card will use so a
     * shell never changes identity when filled.
     */
    icon?: ReactElement;

    /**
     * Optional elapsed-time hint, in milliseconds. When defined, displayed as
     * a tabular-numeric "{n.n}s" trailing meta value.
     */
    elapsedMs?: number;

    /**
     * Optional character counter shown after the elapsed time, e.g. for the
     * `status`/`receiving` event from the streaming pipeline.
     */
    charsReceived?: number;

    /**
     * Visual size variant. Defaults to `standalone`.
     */
    variant?: StreamingPlaceholderVariant;

    /**
     * Where the indeterminate bar renders. Defaults to `trailing`.
     */
    barPosition?: StreamingPlaceholderBarPosition;

    /**
     * Animation style of the indeterminate bar. Defaults to `shimmer`.
     */
    barStyle?: StreamingPlaceholderBarStyle;

    /**
     * Optional className for the outer row (e.g. for spacing in a card list).
     */
    className?: string;
}

const formatElapsedSeconds = (elapsedMs: number): string => {
    const seconds = Math.max(0, elapsedMs) / 1000;
    return seconds.toFixed(1);
};

/**
 * A compact shimmer/indeterminate row used as the shared progress placeholder
 * for streaming Query Insights content (Stage 3). It is the **one** shared
 * primitive for both the pre-first-block "Generating AI analysis…" indicator
 * and the in-item shimmer at the tail of a streaming card.
 *
 * Accessibility: rendered with `role="status"` and `aria-live="polite"` so
 * screen readers announce updates without interrupting the user.
 *
 * @example
 * ```tsx
 * <StreamingPlaceholder
 *     variant="standalone"
 *     icon={<SparkleRegular />}
 *     label={l10n.t('Generating AI analysis…')}
 *     elapsedMs={elapsed}
 * />
 * ```
 */
export function StreamingPlaceholder({
    label,
    icon,
    elapsedMs,
    charsReceived,
    variant = 'standalone',
    barPosition = 'trailing',
    barStyle = 'shimmer',
    className,
}: StreamingPlaceholderProps): JSX.Element {
    const meta: string[] = [];
    if (typeof elapsedMs === 'number' && Number.isFinite(elapsedMs)) {
        meta.push(l10n.t('{0}s', formatElapsedSeconds(elapsedMs)));
    }
    if (typeof charsReceived === 'number' && Number.isFinite(charsReceived) && charsReceived > 0) {
        meta.push(l10n.t('{0} chars', charsReceived.toLocaleString()));
    }

    const rootClass = [
        'streaming-placeholder',
        variant === 'standalone' ? 'streaming-placeholder--standalone' : 'streaming-placeholder--inline',
        barPosition === 'leading' ? 'streaming-placeholder--bar-leading' : 'streaming-placeholder--bar-trailing',
        barStyle === 'pulse' ? 'streaming-placeholder--bar-pulse' : 'streaming-placeholder--bar-shimmer',
        className,
    ]
        .filter(Boolean)
        .join(' ');

    // Re-apply `aria-hidden` so the decorative icon is not announced separately.
    const renderedIcon =
        icon && isValidElement(icon)
            ? cloneElement(icon as ReactElement<{ 'aria-hidden'?: boolean }>, { 'aria-hidden': true })
            : null;

    const bar = <span className="streaming-placeholder__bar" aria-hidden="true" />;

    return (
        <div role="status" aria-live="polite" aria-atomic="false" className={rootClass}>
            {barPosition === 'leading' && bar}
            {renderedIcon && <span className="streaming-placeholder__icon">{renderedIcon}</span>}
            {label && <span className="streaming-placeholder__label">{label}</span>}
            {barPosition === 'trailing' && bar}
            {meta.length > 0 && <span className="streaming-placeholder__meta">{meta.join(' · ')}</span>}
        </div>
    );
}
