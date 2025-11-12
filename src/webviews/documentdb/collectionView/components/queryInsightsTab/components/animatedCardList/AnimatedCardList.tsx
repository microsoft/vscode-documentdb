/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CollapseRelaxed } from '@fluentui/react-motion-components-preview';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import './AnimatedCardList.scss';

export interface AnimatedCardItem {
    key: string;
    component: ReactNode;
}

interface AnimatedCardListProps {
    items: AnimatedCardItem[];
    exitDuration?: number; // Duration of exit animation (ms), default 300
}

interface ItemState {
    key: string;
    component: ReactNode;
    isExiting: boolean;
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
        const currentKeys = new Set(displayItems.map((item) => item.key));

        // Find which items to add and which to remove
        const toAdd = items.filter((item) => !currentKeys.has(item.key));
        const toRemove = displayItems.filter((item) => !newKeys.has(item.key) && !item.isExiting);

        if (toAdd.length === 0 && toRemove.length === 0) {
            return;
        }

        // Build new display list maintaining source order
        const updated: ItemState[] = [];
        const displayMap = new Map(displayItems.map((item) => [item.key, item]));

        // First, add all items from source in their original order
        for (const sourceItem of items) {
            const existing = displayMap.get(sourceItem.key);
            if (existing) {
                // Item already exists, keep it with updated component
                updated.push({ ...existing, component: sourceItem.component });
                displayMap.delete(sourceItem.key); // Mark as processed
            } else {
                // New item
                updated.push({ key: sourceItem.key, component: sourceItem.component, isExiting: false });
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

        setDisplayItems(updated);
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
            {displayItems.map((item) => (
                <CollapseRelaxed key={item.key} visible={!item.isExiting}>
                    <div>{item.component}</div>
                </CollapseRelaxed>
            ))}
        </div>
    );
};
