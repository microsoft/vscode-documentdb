/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CollapseRelaxed, Fade } from '@fluentui/react-motion-components-preview';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import './AnimatedCardList.scss';

export interface AnimatedCardItem {
    key: string;
    component: ReactNode;
    /**
     * Explicit enter/leave motion for this card. When set, it takes
     * precedence over the {@link inFlight} heuristic below.
     *
     * - `'fade'` — opacity-only enter/leave (no height clipping). Preferred
     *   for cards whose height GROWS after mount: AI content cards (the
     *   analysis / educational markdown cards and the recommendation cards)
     *   stream or expand their content over time, and a height-collapse
     *   animation measures `scrollHeight` once at mount and clips anything
     *   that arrives later.
     * - `'collapse'` — height + opacity collapse/expand. Kept as a
     *   first-class option for cards with a stable height where the
     *   accordion-style motion reads better. Not currently used by the
     *   Query Insights card list, but intentionally retained for future use.
     *
     * Frozen at first mount (like {@link inFlight}); changing it later does
     * not swap the wrapper mid-life (that would remount the inner card).
     */
    motion?: CardMotion;
    /**
     * @deprecated Prefer the explicit {@link motion} prop. Retained for
     * backward compatibility: when `motion` is not set, `inFlight: true`
     * selects `'fade'` and `inFlight`/unset selects `'collapse'`.
     *
     * When `true`, the card uses a `Fade` enter animation instead of the
     * default `CollapseRelaxed`. Use this for cards whose content streams
     * progressively (e.g. the Stage 3 summary / educational markdown cards).
     *
     * `CollapseRelaxed` animates `maxHeight` from `0` to the element's
     * `scrollHeight` over 400 ms with `overflow:hidden`, which **clips any
     * content that arrives during the enter animation** and makes the card
     * pop to its current size when the animation ends. For streaming cards
     * that grow over several seconds, this clipping reads as "title only,
     * then suddenly filled" — i.e. two visible frames instead of a smooth
     * fill. `Fade` (200 ms opacity-only) does not clip, so content updates
     * stay visible as they arrive.
     *
     * The choice is captured on the first mount of the item's `key` and
     * does **not** flip if `inFlight` later changes — flipping the wrapper
     * component would unmount/remount the inner card.
     */
    inFlight?: boolean;
}

interface AnimatedCardListProps {
    items: AnimatedCardItem[];
    exitDuration?: number; // Duration of exit animation (ms), default 300
}

type CardMotion = 'collapse' | 'fade';

interface ItemState {
    key: string;
    component: ReactNode;
    isExiting: boolean;
    /**
     * `true` for the single render between "item just added to source"
     * and "item committed visible". The render with `pendingEnter: true`
     * passes `visible={false}` to the presence component; a `requestAnimationFrame`
     * then flips it to `false`, producing the `false → true` transition
     * that `createPresenceComponent` requires to play the enter motion.
     *
     * Without this two-step, new items mount with `visible=true` and
     * `appear=false` (Fluent's default), and the framework treats them as
     * "already in" → the enter animation is silently skipped. That's the
     * "cards just pop in without animation" bug.
     *
     * **For future maintainers:** do NOT simplify this to
     * `<CollapseRelaxed appear={true} visible={true}>`. We tried; it
     * doesn't fix the bug consistently in our usage (items are added
     * from a parent reducer that re-renders the list synchronously, and
     * by the time the presence component's effect runs, `visible=true`
     * is already the initial value — Fluent only animates on a
     * subsequent `visible` *change*). The two-step ensures the change
     * actually happens after first paint.
     */
    pendingEnter: boolean;
    /**
     * Captured on first mount from `AnimatedCardItem.motion` (or, when that
     * is unset, derived from the deprecated `inFlight` flag). Determines
     * which presence wrapper (`CollapseRelaxed` vs. `Fade`) renders this
     * item. Frozen for the item's lifetime so the wrapper doesn't swap out
     * mid-stream (which would remount the inner card and lose its state).
     */
    motion: CardMotion;
}

/**
 * A container for animated cards. New items appear immediately with collapse animation.
 * Removed items animate out before being unmounted.
 */
export const AnimatedCardList = ({ items, exitDuration = 300 }: AnimatedCardListProps) => {
    const [displayItems, setDisplayItems] = useState<ItemState[]>([]);
    const exitTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

    useEffect(() => {
        // Use functional update to get current state without dependency
        setDisplayItems((currentDisplayItems) => {
            // NOTE: do NOT early-return when no keys were added/removed.
            // The parent passes a fresh `items` array on every render (e.g.
            // when a card's `component` prop carries new streaming content),
            // and if we skip the update here those new component references
            // never reach `displayItems` — meaning the rendered tree keeps
            // showing the stale `ReactNode` from the previous render and
            // the card looks frozen even though its source content is
            // changing. The general case below already handles "no
            // additions, no removals" correctly: it walks `items` in order,
            // updates `component` for matched keys, and produces a fresh
            // `displayItems` array. The shallow comparison React uses on
            // the children inside `<CollapseRelaxed>` then sees the new
            // component and re-renders.

            // Build new display list maintaining source order
            const updated: ItemState[] = [];
            const displayMap = new Map(currentDisplayItems.map((item) => [item.key, item]));

            // First, add all items from source in their original order
            for (const sourceItem of items) {
                const existing = displayMap.get(sourceItem.key);
                if (existing) {
                    // Item already exists, keep it with updated component.
                    // `motion` is intentionally NOT updated from the source
                    // item — swapping the wrapper component (CollapseRelaxed
                    // vs. Fade) would remount the inner card. The choice is
                    // frozen at first mount.
                    updated.push({ ...existing, component: sourceItem.component });
                    displayMap.delete(sourceItem.key); // Mark as processed
                } else {
                    // New item. `pendingEnter: true` keeps it in `visible=false`
                    // for the first render so the presence component sees a
                    // `false → true` transition and actually runs the enter
                    // animation. Without this the item mounts with
                    // `visible=true` and Fluent's `createPresenceComponent`
                    // (which defaults `appear=false`) treats first-mount as
                    // "already in" and silently skips the enter motion — that
                    // is the "cards just pop in with no animation" bug.
                    updated.push({
                        key: sourceItem.key,
                        component: sourceItem.component,
                        isExiting: false,
                        pendingEnter: true,
                        // Explicit `motion` wins; otherwise fall back to the
                        // legacy `inFlight` heuristic (true → fade). Frozen
                        // here for the item's lifetime.
                        motion: sourceItem.motion ?? (sourceItem.inFlight ? 'fade' : 'collapse'),
                    });
                }
            }

            // Then, handle items that were removed (not in source but still in display)
            for (const [key, item] of displayMap) {
                if (!item.isExiting) {
                    // Mark as exiting
                    const exitingItem = { ...item, isExiting: true };
                    updated.push(exitingItem);

                    // Schedule removal after animation
                    const timer = setTimeout(() => {
                        setDisplayItems((current) => current.filter((i) => i.key !== key));
                        exitTimersRef.current.delete(key);
                    }, exitDuration);

                    exitTimersRef.current.set(key, timer);
                } else {
                    // Already exiting, keep it
                    updated.push(item);
                }
            }

            // If any items still carry `pendingEnter`, schedule a follow-up
            // tick to clear the flag so they transition to `visible=true`
            // and the presence component animates them in. A `requestAnimationFrame`
            // is enough — we just need React to commit the `visible=false`
            // render before flipping to `true`. `setTimeout(…, 0)` also
            // works but rAF aligns better with the browser's paint cycle.
            if (updated.some((item) => item.pendingEnter)) {
                requestAnimationFrame(() => {
                    setDisplayItems((current) =>
                        current.map((item) => (item.pendingEnter ? { ...item, pendingEnter: false } : item)),
                    );
                });
            }

            return updated;
        });
    }, [items, exitDuration]);

    // Cleanup timers on unmount
    useEffect(() => {
        return () => {
            exitTimersRef.current.forEach((timer) => clearTimeout(timer));
            exitTimersRef.current.clear();
        };
    }, []);

    return (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
            {displayItems.map((item) => {
                // `visible` flips from `false → true` on the second render
                // after mount (see `pendingEnter` machinery above) so the
                // presence component actually plays its enter animation.
                // For already-mounted items, `pendingEnter` is `false` from
                // the start so they behave normally.
                const visible = !item.isExiting && !item.pendingEnter;
                // Per-item motion: `Fade` for cards whose content streams
                // in (no `maxHeight`/`overflow:hidden` clipping during the
                // enter animation), `CollapseRelaxed` otherwise. Rendered
                // inline rather than via a `Wrapper` variable because the
                // Fluent presence components lose their callable JSX type
                // when assigned to a union-typed local.
                return item.motion === 'fade' ? (
                    <Fade key={item.key} visible={visible}>
                        <div>{item.component}</div>
                    </Fade>
                ) : (
                    <CollapseRelaxed key={item.key} visible={visible}>
                        <div>{item.component}</div>
                    </CollapseRelaxed>
                );
            })}
        </div>
    );
};
