/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Shared helpers for the Motion Sandbox lab panels.
 *
 * - A {@link MOTIONS} table mapping a stable string id to a Fluent preview
 *   presence component, so dropdowns can round-trip through state.
 * - A reusable {@link DemoCard} so every lab is comparing the same DOM /
 *   layout shape (this matters: the differences we're studying are about
 *   how the surrounding flow reacts to each motion variant, so the
 *   content has to be identical).
 */

import {
    Blur,
    Collapse,
    CollapseDelayed,
    CollapseRelaxed,
    CollapseSnappy,
    Fade,
    FadeRelaxed,
    FadeSnappy,
    Rotate,
    Scale,
    ScaleRelaxed,
    ScaleSnappy,
    Slide,
    SlideRelaxed,
    SlideSnappy,
} from '@fluentui/react-motion-components-preview';
import { Card, CardHeader, Text, tokens } from '@fluentui/react-components';
import { type JSX, type ReactNode } from 'react';

/**
 * Catalogue of every preview presence variant we offer in lab dropdowns.
 * The id is the dropdown value; the `label` is what's shown; `Wrapper`
 * is the component itself.
 *
 * `typeof Collapse` is used as the component type because every entry is
 * built with `createPresenceComponent` (or a variant), so they share the
 * `{ visible, appear, children }` shape — TypeScript infers it from the
 * first member.
 */
export const MOTIONS: Record<string, { label: string; Wrapper: typeof Collapse }> = {
    collapse: { label: 'Collapse', Wrapper: Collapse },
    collapseSnappy: { label: 'CollapseSnappy', Wrapper: CollapseSnappy },
    collapseRelaxed: { label: 'CollapseRelaxed', Wrapper: CollapseRelaxed },
    collapseDelayed: { label: 'CollapseDelayed', Wrapper: CollapseDelayed },
    fade: { label: 'Fade', Wrapper: Fade },
    fadeSnappy: { label: 'FadeSnappy', Wrapper: FadeSnappy },
    fadeRelaxed: { label: 'FadeRelaxed', Wrapper: FadeRelaxed },
    slide: { label: 'Slide', Wrapper: Slide },
    slideSnappy: { label: 'SlideSnappy', Wrapper: SlideSnappy },
    slideRelaxed: { label: 'SlideRelaxed', Wrapper: SlideRelaxed },
    scale: { label: 'Scale', Wrapper: Scale },
    scaleSnappy: { label: 'ScaleSnappy', Wrapper: ScaleSnappy },
    scaleRelaxed: { label: 'ScaleRelaxed', Wrapper: ScaleRelaxed },
    blur: { label: 'Blur', Wrapper: Blur },
    rotate: { label: 'Rotate', Wrapper: Rotate },
};

export type MotionKey = keyof typeof MOTIONS;

/**
 * Reusable card body. Big enough that height-affecting motions like
 * `Collapse` are clearly different from opacity-only ones like `Fade`,
 * and small enough that the visible delta of each entry/exit is on
 * screen at once.
 */
export function DemoCard({ title, accent, children }: { title: string; accent?: string; children?: ReactNode }): JSX.Element {
    return (
        <Card
            style={{
                marginBottom: 0,
                borderLeft: accent ? `4px solid ${accent}` : undefined,
            }}
        >
            <CardHeader
                header={
                    <Text weight="semibold" size={400}>
                        {title}
                    </Text>
                }
                description={
                    <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                        Demo card — fixed content
                    </Text>
                }
            />
            <div style={{ padding: `${tokens.spacingVerticalS} 0` }}>
                {children ?? (
                    <>
                        <p style={{ margin: 0 }}>
                            Three lines of body content so the card has a noticeable height. Two presence
                            components that animate opacity only (Fade, Blur) keep this height reserved as
                            soon as the element mounts; Collapse animates the height itself, so siblings move
                            in lock step with the card.
                        </p>
                        <ul style={{ margin: `${tokens.spacingVerticalS} 0 0`, paddingLeft: tokens.spacingHorizontalL }}>
                            <li>List item A</li>
                            <li>List item B</li>
                        </ul>
                    </>
                )}
            </div>
        </Card>
    );
}
