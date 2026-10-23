/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, Card, CardHeader, Label, Text, tokens } from '@fluentui/react-components';
import {
    BeakerRegular,
    CodeRegular,
    DatabaseRegular,
    LightbulbRegular,
    PersonSupportRegular,
    WrenchRegular,
} from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useId } from 'react';
import { CopyButton } from '../../../../queryInsightsShared/CopyButton';
import { type InsightCard as InsightCardConfig, type InsightKind } from '../../../types/queryInsights';
import './baseOptimizationCard.scss';

export interface InsightCardProps {
    config: InsightCardConfig;
    /** Copies the card's command. A resolved `false` or a rejection is reported as a failed copy. */
    onCopy?: (command: string) => Promise<unknown> | unknown;
    ref?: React.Ref<HTMLDivElement>;
}

const priorityColors: Record<'high' | 'medium' | 'low', 'danger' | 'warning' | 'informative'> = {
    high: 'danger',
    medium: 'warning',
    low: 'informative',
};

const kindIcons: Record<InsightKind, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
    'query-change': CodeRegular,
    verify: BeakerRegular,
    maintenance: WrenchRegular,
    'data-model': DatabaseRegular,
    support: PersonSupportRegular,
    other: LightbulbRegular,
};

/**
 * Card for a recommendation that is not an index change (`action: "none"`): a query change,
 * a verification step, maintenance, a data-model change or a support escalation.
 * It is advisory only: there is no execute button, and an optional command can be copied.
 * Same outer layout and spacing as {@link ImprovementCard} so both can share a card stack.
 */
export function InsightCard({ config, onCopy, ref }: InsightCardProps) {
    const commandLabelId = useId();
    const Icon = kindIcons[config.kind];
    const priorityBadgeText = {
        high: l10n.t('HIGH PRIORITY'),
        medium: l10n.t('MEDIUM PRIORITY'),
        low: l10n.t('LOW PRIORITY'),
    }[config.priority];

    return (
        <Card ref={ref} style={{ marginBottom: '16px' }}>
            <div className="optimization-card-container">
                <Icon className="optimization-card-icon" style={{ flexShrink: 0 }} aria-hidden="true" />
                <div style={{ flex: 1, minWidth: 0 }}>
                    <CardHeader
                        header={
                            <div className="optimization-card-title-container">
                                <Text weight="semibold" size={400}>
                                    {config.title}
                                </Text>
                                <Badge
                                    appearance="tint"
                                    shape="rounded"
                                    color={priorityColors[config.priority]}
                                    size="small"
                                >
                                    {priorityBadgeText}
                                </Badge>
                            </div>
                        }
                    />
                    <div style={{ marginTop: '12px' }}>
                        <Text size={300} style={{ display: 'block', marginBottom: '12px' }}>
                            {config.description}
                        </Text>

                        {config.shellCommand && (
                            <div style={{ marginBottom: '12px' }}>
                                <Label size="small" id={commandLabelId}>
                                    {l10n.t('Suggested command')}
                                </Label>
                                <pre
                                    className="index-code-block"
                                    style={{ marginTop: '4px' }}
                                    aria-labelledby={commandLabelId}
                                >
                                    {config.shellCommand}
                                </pre>
                            </div>
                        )}

                        {config.details && (
                            <Text
                                size={200}
                                style={{ color: tokens.colorNeutralForeground3, display: 'block', marginBottom: '12px' }}
                            >
                                {config.details}
                            </Text>
                        )}

                        {config.shellCommand && onCopy && (
                            <CopyButton
                                label={l10n.t('Copy command')}
                                onCopy={() => onCopy(config.shellCommand ?? '')}
                            />
                        )}
                    </div>
                </div>
            </div>
        </Card>
    );
}
