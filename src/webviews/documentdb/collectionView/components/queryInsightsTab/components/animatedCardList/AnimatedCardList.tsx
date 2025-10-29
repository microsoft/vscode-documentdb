/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CollapseRelaxed } from '@fluentui/react-motion-components-preview';
import { type JSX, type ReactElement, type ReactNode, useEffect, useRef, useState } from 'react';

interface AnimatedCardListProps {
    /**
     * Cards to display. Each child must have a unique key prop.
     */
    children: ReactNode;

    /**
     * Delay in milliseconds between each card animation. Defaults to 1000ms.
     */
    animationDelay?: number;
}

interface CardState {
    key: string;
    element: ReactElement;
    visible: boolean;
}

interface AnimationAction {
    type: 'show' | 'hide';
    cardKey: string;
    delay: number; // Delay before this action executes (from previous action)
}

const DEFAULT_ANIMATION_DELAY = 1000;

export const AnimatedCardList = ({
    children,
    animationDelay = DEFAULT_ANIMATION_DELAY,
}: AnimatedCardListProps): JSX.Element => {
    const [cardStates, setCardStates] = useState<Map<string, CardState>>(new Map());
    const [animationQueue, setAnimationQueue] = useState<AnimationAction[]>([]);
    const isInitialRender = useRef(true);
    const previousKeysRef = useRef<Set<string>>(new Set());

    // Extract children with keys
    const extractCards = (childrenNodes: ReactNode): CardState[] => {
        const childArray = Array.isArray(childrenNodes) ? childrenNodes : [childrenNodes];
        return childArray
            .filter((child): child is ReactElement => {
                return child !== null && typeof child === 'object' && 'key' in child;
            })
            .map((child) => ({
                key: child.key as string,
                element: child,
                visible: true, // Will be controlled by state
            }));
    };

    // Generate animation queue based on state diff
    const generateAnimationQueue = (
        currentStates: Map<string, CardState>,
        targetCards: CardState[],
    ): AnimationAction[] => {
        const queue: AnimationAction[] = [];
        const targetKeys = new Set(targetCards.map((c) => c.key));
        const currentKeys = new Set(Array.from(currentStates.keys()));

        console.log('[AnimatedCardList] generateAnimationQueue');
        console.log('  Current keys:', Array.from(currentKeys));
        console.log('  Target keys:', Array.from(targetKeys));

        // Cards changed (additions/removals)
        const removedKeys = Array.from(currentKeys).filter((key) => !targetKeys.has(key));
        const addedKeys = Array.from(targetKeys).filter((key) => !currentKeys.has(key));

        console.log('  Removed keys:', removedKeys);
        console.log('  Added keys:', addedKeys);

        if (removedKeys.length === 0 && addedKeys.length === 0) {
            console.log('  → No animation needed');
            return []; // No changes
        }

        console.log('  → Animating card changes');

        // Hide removed cards first (top to bottom)
        removedKeys.forEach((key, index) => {
            queue.push({ type: 'hide', cardKey: key, delay: index === 0 ? 0 : animationDelay });
        });

        // Show added cards after removals (top to bottom)
        addedKeys.forEach((key, index) => {
            const delay = index === 0 && removedKeys.length > 0 ? animationDelay : index === 0 ? 0 : animationDelay;
            queue.push({ type: 'show', cardKey: key, delay });
        });

        return queue;
    };

    // Main effect: Generate animation queue when children change
    useEffect(() => {
        const currentCards = extractCards(children);
        const currentKeys = new Set(currentCards.map((card) => card.key));

        console.log('[AnimatedCardList] useEffect triggered');
        console.log('  Current children keys:', Array.from(currentKeys));
        console.log('  Previous keys:', Array.from(previousKeysRef.current));

        // Initial render case
        if (isInitialRender.current) {
            isInitialRender.current = false;
            console.log('[AnimatedCardList] Initial render');

            const initialStates = new Map<string, CardState>();

            // Show all cards immediately without animation
            currentCards.forEach((card) => {
                initialStates.set(card.key, { ...card, visible: true });
            });
            console.log('  Showing initial cards:', Array.from(initialStates.keys()));

            setCardStates(initialStates);
            previousKeysRef.current = currentKeys;
            return;
        }

        // Generate new animation queue based on current state vs target state
        const queue = generateAnimationQueue(cardStates, currentCards);

        if (queue.length > 0) {
            console.log('[AnimatedCardList] Setting animation queue:', queue);

            // Prepare initial state for animations
            const newStates = new Map(cardStates);

            // Add any new cards that will be shown (set to invisible initially)
            currentCards.forEach((card) => {
                if (!newStates.has(card.key)) {
                    newStates.set(card.key, { ...card, visible: false });
                }
            });

            setCardStates(newStates);
            setAnimationQueue(queue);
        } else {
            // No animations needed, just update elements
            console.log('[AnimatedCardList] No animations needed, updating elements only');
            const updatedStates = new Map(cardStates);
            currentCards.forEach((card) => {
                const existing = updatedStates.get(card.key);
                if (existing) {
                    updatedStates.set(card.key, { ...card, visible: existing.visible });
                }
            });
            setCardStates(updatedStates);
        }

        previousKeysRef.current = currentKeys;
    }, [children, animationDelay]);

    // Queue processor: Execute animation actions one by one
    useEffect(() => {
        if (animationQueue.length === 0) return;

        const [nextAction, ...remainingQueue] = animationQueue;

        console.log(`[AnimatedCardList Queue Processor] Processing action:`, nextAction);
        console.log(`  Remaining queue length: ${remainingQueue.length}`);

        const timeout = setTimeout(() => {
            console.log(`  Executing ${nextAction.type} for card: ${nextAction.cardKey}`);

            setCardStates((prev) => {
                const updated = new Map(prev);
                const card = updated.get(nextAction.cardKey);

                if (card) {
                    updated.set(nextAction.cardKey, { ...card, visible: nextAction.type === 'show' });
                } else {
                    console.warn(`    Card not found in state: ${nextAction.cardKey}`);
                }

                const visibleCards = Array.from(updated.entries())
                    .filter(([_, state]) => state.visible)
                    .map(([key]) => key);
                console.log(`    Visible cards after ${nextAction.type}:`, visibleCards);
                console.log(`    All card keys in state:`, Array.from(updated.keys()));

                return updated;
            });

            // Move to next action
            setAnimationQueue(remainingQueue);
        }, nextAction.delay);

        return () => clearTimeout(timeout);
    }, [animationQueue]);

    // Render cards in order from children
    const currentCards = extractCards(children);

    const orderedCards = currentCards.map((card) => {
        const state = cardStates.get(card.key);
        return state || { ...card, visible: false };
    });

    console.log('[AnimatedCardList RENDER]');
    console.log('  currentCards count:', currentCards.length);
    console.log('  cardStates size:', cardStates.size);
    console.log('  cardStates keys:', Array.from(cardStates.keys()));
    console.log(
        '  ordered cards visible:',
        orderedCards.filter((c) => c.visible).map((c) => c.key),
    );

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {orderedCards.map((card) => (
                <CollapseRelaxed key={card.key} visible={card.visible}>
                    {/* Wrapper div required for motion animations:
                        Custom card components (AiCard, TipsCard, GetPerformanceInsightsCard)
                        are not ForwardRefComponents, so they cannot receive refs directly.
                        Motion components need to attach refs for animations, so we wrap
                        each card in a div that can accept the ref. */}
                    <div>{card.element}</div>
                </CollapseRelaxed>
            ))}
        </div>
    );
};
