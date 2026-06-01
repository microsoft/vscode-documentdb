/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Loading and empty-state shell for {@link ImprovementCard}.
 *
 * Renders the same outer `Card` layout as the filled recommendation card
 * so the recommendation slot has a consistent identity across all three
 * Stage 3 states the slot can be in:
 *
 * | `mode`     | Icon                            | Title                          | Body                      |
 * | ---------- | ------------------------------- | ------------------------------ | ------------------------- |
 * | `loading`  | `ArrowTrendingSparkleRegular`   | "Generating recommendation…"   | Drafting spinner row      |
 * | `empty`    | `CheckmarkCircleRegular`        | "No index changes recommended" | Plain success text        |
 *
 * The component type stays the same across modes, so the parent can use a
 * single React key for the recommendation slot (`rec-0`) and React renders
 * the mode change IN PLACE: no remount, no card disappearing and
 * reappearing. Only the icon, title, and body swap. The outer `Card`
 * frame stays. See plan D11 / WI-9 and PR #711 review.
 *
 * Used:
 *  - `mode='loading'` between the `recommendationStarted` and
 *    `recommendation` streaming events (WI-7 / WI-8) AND as the pre-event
 *    placeholder reserved by Option A while we wait for the first event.
 *  - `mode='empty'` after the terminal `complete` event when
 *    `improvements.length === 0` (the "query is already optimal" path).
 *    Reuses the same React key as the `loading` placeholder so the
 *    transition is in-place.
 */

import { Card, CardHeader, Text, tokens } from '@fluentui/react-components';
import { ArrowTrendingSparkleRegular, CheckmarkCircleRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type JSX, type Ref } from 'react';
import { StreamingInlineProgress } from '../streamingPlaceholder/StreamingInlineProgress';
import './baseOptimizationCard.scss';

export interface ImprovementCardShellProps {
    /**
     * Visual / semantic mode of the card. `'loading'` (default) reserves
     * the slot with a spinner; `'empty'` becomes the "no recommendations"
     * success card.
     */
    mode?: 'loading' | 'empty';

    /** Ref forwarded to the outer card (for animation libraries). */
    ref?: Ref<HTMLDivElement>;
}

export function ImprovementCardShell({ mode = 'loading', ref }: ImprovementCardShellProps): JSX.Element {
    const isEmpty = mode === 'empty';

    // Icon swap is the strongest visual signal that "we went from
    // 'preparing a recommendation' to 'done — nothing needed'". The icon
    // node is in the same DOM slot in both modes, so React just swaps
    // the element type without reflowing the surrounding layout.
    const icon = isEmpty ? (
        <CheckmarkCircleRegular className="optimization-card-icon" style={{ flexShrink: 0 }} />
    ) : (
        <ArrowTrendingSparkleRegular className="optimization-card-icon" style={{ flexShrink: 0 }} />
    );

    const title = isEmpty ? l10n.t('No index changes recommended') : l10n.t('Generating recommendation…');

    return (
        <Card ref={ref} style={{ marginBottom: '16px' }}>
            <div className="optimization-card-container">
                {icon}
                <div style={{ flex: 1 }}>
                    <CardHeader
                        header={
                            <div className="optimization-card-title-container">
                                <Text weight="semibold" size={400}>
                                    {title}
                                </Text>
                            </div>
                        }
                        // Match {@link ImprovementCard}: the AI disclaimer is
                        // visible on every state the recommendation slot can
                        // be in (loading shell, filled card, empty state).
                        // Showing it only after content arrives created a
                        // perceived inconsistency — the disclaimer would
                        // appear at the same moment the user starts reading,
                        // i.e. exactly the wrong moment to ask them to be
                        // sceptical.
                        action={
                            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                                {l10n.t('AI responses may be inaccurate')}
                            </Text>
                        }
                    />
                    {isEmpty ? (
                        <Text size={300} style={{ display: 'block', marginTop: tokens.spacingVerticalS }}>
                            {l10n.t(
                                'Your query is already running efficiently. No index changes are necessary. The other cards explain the analysis and how the query executes.',
                            )}
                        </Text>
                    ) : (
                        <StreamingInlineProgress label={l10n.t('Drafting…')} />
                    )}
                </div>
            </div>
        </Card>
    );
}
