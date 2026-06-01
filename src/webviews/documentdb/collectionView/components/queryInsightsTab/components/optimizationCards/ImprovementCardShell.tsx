/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Loading-state shell for {@link ImprovementCard}.
 *
 * Renders the same outer `Card` layout and the same `ArrowTrendingSparkleRegular`
 * icon as the filled recommendation card, with a generic title and a
 * {@link StreamingInlineProgress} body. This component is used between the
 * `recommendationStarted` and `recommendation` streaming events (WI-7 / WI-8)
 * so the card's identity (frame, icon, layout) never changes when content
 * arrives — only the body swaps from the spinner progress row to the real
 * recommendation content. See plan D11 / WI-9.
 */

import { Card, CardHeader, Text } from '@fluentui/react-components';
import { ArrowTrendingSparkleRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type JSX, type Ref } from 'react';
import { StreamingInlineProgress } from '../streamingPlaceholder/StreamingInlineProgress';
import './baseOptimizationCard.scss';

export interface ImprovementCardShellProps {
    /** Ref forwarded to the outer card (for animation libraries). */
    ref?: Ref<HTMLDivElement>;
}

export function ImprovementCardShell({ ref }: ImprovementCardShellProps): JSX.Element {
    return (
        <Card ref={ref} style={{ marginBottom: '16px' }}>
            <div className="optimization-card-container">
                <ArrowTrendingSparkleRegular className="optimization-card-icon" style={{ flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                    <CardHeader
                        header={
                            <div className="optimization-card-title-container">
                                <Text weight="semibold" size={400}>
                                    {l10n.t('Generating recommendation…')}
                                </Text>
                            </div>
                        }
                    />
                    <StreamingInlineProgress label={l10n.t('Drafting…')} />
                </div>
            </div>
        </Card>
    );
}
