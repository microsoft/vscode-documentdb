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
     * Captured on first mount from `AnimatedCardItem.inFlight`. Determines
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
        const newKeys = new Set(items.map((item) => item.key));

        // Use functional update to get current state without dependency
        setDisplayItems((currentDisplayItems) => {
            const currentKeys = new Set(currentDisplayItems.map((item) => item.key));

            // Find which items to add and which to remove
            const toAdd = items.filter((item) => !currentKeys.has(item.key));
            const toRemove = currentDisplayItems.filter((item) => !newKeys.has(item.key) && !item.isExiting);

            if (toAdd.length === 0 && toRemove.length === 0) {
                return currentDisplayItems;
            }

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
                    // New item
                    updated.push({
                        key: sourceItem.key,
                        component: sourceItem.component,
                        isExiting: false,
                        motion: sourceItem.inFlight ? 'fade' : 'collapse',
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
            {displayItems.map((item) =>
                // Per-item motion: `Fade` for cards whose content streams
                // in (no `maxHeight`/`overflow:hidden` clipping during the
                // enter animation), `CollapseRelaxed` otherwise. Rendered
                // inline rather than via a `Wrapper` variable because the
                // Fluent presence components lose their callable JSX type
                // when assigned to a union-typed local.
                item.motion === 'fade' ? (
                    <Fade key={item.key} visible={!item.isExiting}>
                        <div>{item.component}</div>
                    </Fade>
                ) : (
                    <CollapseRelaxed key={item.key} visible={!item.isExiting}>
                        <div>{item.component}</div>
                    </CollapseRelaxed>
                ),
            )}
        </div>
    );
};
