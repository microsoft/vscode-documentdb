/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * "Insert at the top" experiment — the exact production scenario the
 * user remembered being painful. A new item is prepended to the list,
 * and we observe how the existing items react with each motion variant.
 *
 * Why this is hard:
 *  - For motion components that animate ONLY a non-layout property
 *    (`Fade`, `Blur`, `Scale`, `Rotate`, `Slide` with transform), the
 *    newly-mounted item INSTANTLY occupies its full natural height.
 *    Siblings get pushed down in one frame — there's no animation on
 *    that push, just a jump.
 *  - Only `Collapse` animates the height itself (max-height 0 →
 *    natural). With Collapse, the inserted item grows in height
 *    smoothly, so siblings get pushed down in lock step with the
 *    animation.
 *
 * Use this lab to confirm the above for yourself with each variant.
 * The "Reset" button clears the list; "Add at TOP" prepends; "Add at
 * BOTTOM" appends (for comparison — bottom never has the push-down
 * problem). The `appear` switch is exposed so we can verify Fluent's
 * presence components animate on mount when asked to.
 */

import { Button, Card, CardHeader, Dropdown, Field, Option, Switch, Text, tokens } from '@fluentui/react-components';
import { AddRegular, DeleteRegular } from '@fluentui/react-icons';
import { useCallback, useState, type JSX } from 'react';
import { DemoCard, MOTIONS, type MotionKey } from './shared';

interface Item {
    id: number;
    label: string;
    /**
     * Captured motion key at insert time. We don't re-key on motion
     * change because that would unmount/remount every item — instead
     * each existing item keeps the motion it was created with, and only
     * new inserts pick up the freshly-selected motion. This matches the
     * production constraint that we cannot swap an item's animation
     * wrapper at runtime without losing its state.
     */
    motion: MotionKey;
}

let NEXT_ID = 1;

export function AddFromTopLab(): JSX.Element {
    const [items, setItems] = useState<Item[]>([]);
    const [motionKey, setMotionKey] = useState<MotionKey>('collapse');
    const [appear, setAppear] = useState(true);
    /**
     * Per-item "visible" map. New inserts start at `visible=false` and
     * flip to `true` on the next frame so the presence component plays
     * its enter animation. Without this two-step, the mount happens
     * with `visible=true` already set, the framework sees "already in",
     * and `appear=false` means no enter motion fires. This is exactly
     * the bug we fixed in AnimatedCardList; we duplicate the fix here
     * (rather than reuse AnimatedCardList) so this lab stays
     * self-contained and isolates the framework behaviour.
     */
    const [visibility, setVisibility] = useState<Record<number, boolean>>({});

    const addAt = useCallback(
        (position: 'top' | 'bottom') => {
            const id = NEXT_ID++;
            const newItem: Item = {
                id,
                label: `Item #${id} (${MOTIONS[motionKey].label})`,
                motion: motionKey,
            };
            setItems((prev) => (position === 'top' ? [newItem, ...prev] : [...prev, newItem]));
            setVisibility((prev) => ({ ...prev, [id]: false }));
            // Flip `visible` to true on the next animation frame so the
            // presence component sees a `false → true` transition and
            // plays the enter motion regardless of the `appear` setting.
            requestAnimationFrame(() => {
                setVisibility((prev) => ({ ...prev, [id]: true }));
            });
        },
        [motionKey],
    );

    const removeOne = useCallback((id: number) => {
        // Mark the item as not-visible so the presence component plays
        // its exit. The actual unmount is deferred slightly — see the
        // timeout — so the exit animation has time to run before the
        // node leaves the tree.
        setVisibility((prev) => ({ ...prev, [id]: false }));
        setTimeout(() => {
            setItems((prev) => prev.filter((item) => item.id !== id));
            setVisibility((prev) => {
                const next = { ...prev };
                delete next[id];
                return next;
            });
        }, 400);
    }, []);

    const clear = useCallback(() => {
        // Animate all current items out together, then unmount.
        setVisibility((prev) => {
            const next: Record<number, boolean> = {};
            for (const key of Object.keys(prev)) {
                next[Number(key)] = false;
            }
            return next;
        });
        setTimeout(() => {
            setItems([]);
            setVisibility({});
        }, 400);
    }, []);

    return (
        <Card
            style={{
                backgroundColor: tokens.colorNeutralBackground2,
                border: `1px dashed ${tokens.colorNeutralStroke2}`,
            }}
        >
            <CardHeader
                header={
                    <Text weight="semibold" size={400}>
                        Insert at top (production scenario)
                    </Text>
                }
                description={
                    <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                        Prepending to a list pushes existing items down. Only{' '}
                        <code>Collapse</code> animates height — every other variant lets the
                        newly-mounted item grab its natural height instantly, causing siblings to jump.
                    </Text>
                }
            />

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalL }}>
                <Field label="Motion for next inserted item">
                    <Dropdown
                        value={MOTIONS[motionKey].label}
                        selectedOptions={[motionKey]}
                        onOptionSelect={(_, data) => {
                            if (data.optionValue) setMotionKey(data.optionValue as MotionKey);
                        }}
                        style={{ minWidth: '220px' }}
                    >
                        {Object.entries(MOTIONS).map(([key, { label }]) => (
                            <Option key={key} value={key}>
                                {label}
                            </Option>
                        ))}
                    </Dropdown>
                </Field>
                <Field label="appear (for future inserts)">
                    <Switch checked={appear} onChange={(_, data) => setAppear(data.checked)} />
                </Field>
            </div>

            <div
                style={{
                    display: 'flex',
                    gap: tokens.spacingHorizontalS,
                    marginTop: tokens.spacingVerticalL,
                    flexWrap: 'wrap',
                }}
            >
                <Button appearance="primary" icon={<AddRegular />} onClick={() => addAt('top')}>
                    Add at TOP
                </Button>
                <Button icon={<AddRegular />} onClick={() => addAt('bottom')}>
                    Add at bottom
                </Button>
                <Button appearance="subtle" icon={<DeleteRegular />} onClick={clear}>
                    Clear all
                </Button>
            </div>

            <div
                style={{
                    marginTop: tokens.spacingVerticalL,
                    padding: tokens.spacingVerticalM,
                    border: `1px dotted ${tokens.colorNeutralStroke2}`,
                    borderRadius: tokens.borderRadiusMedium,
                    backgroundColor: tokens.colorNeutralBackground1,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: tokens.spacingVerticalM,
                    minHeight: '320px',
                }}
            >
                {items.length === 0 && (
                    <Text size={200} style={{ color: tokens.colorNeutralForeground3, fontStyle: 'italic' }}>
                        List is empty. Pick a motion and click &quot;Add at TOP&quot;.
                    </Text>
                )}

                {items.map((item) => {
                    const Wrapper = MOTIONS[item.motion].Wrapper;
                    return (
                        <Wrapper
                            key={item.id}
                            visible={visibility[item.id] ?? false}
                            appear={appear}
                        >
                            <div onClick={() => removeOne(item.id)} style={{ cursor: 'pointer' }}>
                                <DemoCard title={item.label}>
                                    <p style={{ margin: 0 }}>
                                        <strong>Click to remove.</strong> Existing items above (older) should{' '}
                                        {item.motion === 'collapse' ||
                                        item.motion === 'collapseRelaxed' ||
                                        item.motion === 'collapseSnappy' ||
                                        item.motion === 'collapseDelayed'
                                            ? 'be pushed down smoothly as this card grows.'
                                            : 'jump down instantly (no height animation on this variant).'}
                                    </p>
                                </DemoCard>
                            </div>
                        </Wrapper>
                    );
                })}
            </div>
        </Card>
    );
}
