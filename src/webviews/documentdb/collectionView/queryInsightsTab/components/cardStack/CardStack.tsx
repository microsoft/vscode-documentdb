/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Collapse, Fade, FadeRelaxed } from '@fluentui/react-motion-components-preview';
import { type JSX, type ReactNode, useState } from 'react';

export interface CardStackItem {
    key: string;
    component: ReactNode;
    /**
     * Per-item enter/leave motion.
     * - `'collapse'` (default): height collapses in/out. Looks best for
     *   static cards but measures `scrollHeight` at mount, so content that
     *   grows during the enter window may clip transiently.
     * - `'fade'`: opacity-only; safe for cards whose content streams /
     *   grows after mount (e.g. MarkdownCard, ImprovementCardShell).
     */
    motion?: 'fade' | 'collapse';
}

export interface CardStackProps {
    items: CardStackItem[];
    /**
     * When `false`, the whole stack fades out together (single group exit).
     * Flipping back to `true` re-mounts and re-enters the cards.
     * Defaults to `true`.
     */
    visible?: boolean;
    /**
     * Milliseconds between each card's enter animation on the INITIAL mount,
     * producing a gentle cascade. Cards added later animate immediately
     * (delay 0) so a single insertion does not sit and wait. Defaults to 60.
     */
    staggerDelay?: number;
    /** Remove the stack from the DOM after the group fade-out. Defaults to `true`. */
    unmountOnExit?: boolean;
}

/**
 * A lightweight alternative to {@link AnimatedCardList} for the common case
 * where cards are only ever ADDED (never individually removed) and the whole
 * group disappears at once.
 *
 * Design (no manual rAF / pendingEnter bookkeeping required):
 * - **Enter** — each card is wrapped in `<Collapse appear visible>`. The
 *   `appear` prop makes the Fluent presence component animate on its very
 *   first mount (it sets `applyInitialStyles = !appear && isFirstMount` to
 *   `false`), so both the initial cards and any card inserted mid-life expand
 *   in. No `requestAnimationFrame` dance is needed.
 * - **Cascade** — the initial batch gets a per-index `delay`; later additions
 *   get `delay: 0`.
 * - **Exit** — the entire list is wrapped in a single `<FadeRelaxed>` keyed
 *   off `visible`, so the group fades out together at a slightly slower,
 *   calmer rate than the per-card enter Fade. Because no card is removed
 *   individually, there is no per-item exit bookkeeping at all.
 *
 * {@link AnimatedCardList} is intentionally left in place for scenarios that
 * DO need per-item enter/exit choreography.
 */
export const CardStack = ({
    items,
    visible = true,
    staggerDelay = 60,
    unmountOnExit = true,
}: CardStackProps): JSX.Element => {
    // Capture the keys present at first mount (in order). Cards in this set
    // cascade by their initial index; any card added later is NOT in the set
    // and so expands immediately (delay 0) rather than waiting behind a stale
    // cascade offset. Captured once via the lazy initializer so later renders
    // never reshuffle the cascade.
    const [initialKeys] = useState<readonly string[]>(() => items.map((item) => item.key));

    // Retain the last non-empty items while the group is exiting. Callers
    // typically clear `items` on the same render that flips `visible` to
    // false (e.g. Stage 3 cancel removes all cards AND the wrapper hides).
    // Without this snapshot the inner map would yield nothing during the
    // fade-out, so there would be nothing on screen to actually fade.
    //
    // Stored in state (updated via the in-render setter, the React
    // "store-derived-state" pattern) rather than a ref so the lint rule
    // that forbids ref reads/writes during render stays satisfied. The
    // setter is only called when `items` is non-empty AND differs from the
    // current snapshot, which avoids the infinite-render-loop trap.
    //
    // LOAD-BEARING (F10): the `items !== lastNonEmpty` reference check
    // relies on the parent passing a memoized `items` array — see
    // QueryInsightsTab.tsx, where `insightCards` is wrapped in `useMemo`.
    // If a caller passes a freshly-built array each render, this guard
    // converges immediately (no infinite loop) but costs one extra commit
    // per parent render. Keep the parent's `useMemo` and this snapshot in
    // sync: if you change one, audit the other.
    const [lastNonEmpty, setLastNonEmpty] = useState<CardStackItem[]>(items);
    if (items.length > 0 && items !== lastNonEmpty) {
        setLastNonEmpty(items);
    }
    const renderedItems = visible ? items : lastNonEmpty;

    // Compute a stable enter delay per card for THIS render.
    const delays: Record<string, number> = {};
    renderedItems.forEach((item) => {
        const initialIndex = initialKeys.indexOf(item.key);
        delays[item.key] = initialIndex >= 0 ? initialIndex * staggerDelay : 0;
    });

    return (
        <FadeRelaxed visible={visible} unmountOnExit={unmountOnExit}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
                {renderedItems.map((item) => {
                    const delay = delays[item.key];
                    if (item.motion === 'fade') {
                        return (
                            <Fade key={item.key} appear visible delay={delay}>
                                <div>{item.component}</div>
                            </Fade>
                        );
                    }
                    return (
                        <Collapse key={item.key} appear visible delay={delay}>
                            <div>{item.component}</div>
                        </Collapse>
                    );
                })}
            </div>
        </FadeRelaxed>
    );
};
