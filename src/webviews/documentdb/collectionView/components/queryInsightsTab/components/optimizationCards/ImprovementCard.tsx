/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Badge,
    Button,
    Card,
    CardHeader,
    Label,
    Popover,
    PopoverSurface,
    PopoverTrigger,
    Text,
    tokens,
} from '@fluentui/react-components';
import { ArrowTrendingSparkleRegular } from '@fluentui/react-icons';
// TODO: Copy content feature will be added in the next release
// import { CopyRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { forwardRef } from 'react';
import { type ImprovementCard as ImprovementCardConfig } from '../../../../types/queryInsights';
import './AiCard.scss';
import './optimizationCard.scss';

export interface ImprovementCardProps {
    /**
     * Configuration for the improvement card
     */
    config: ImprovementCardConfig;

    /**
     * Optional callback when the copy button is clicked
     */
    onCopy?: () => void;

    /**
     * Callback when the primary button is clicked
     */
    onPrimaryAction?: (actionId: string, payload: unknown) => void;

    /**
     * Callback when the secondary button is clicked
     */
    onSecondaryAction?: (actionId: string, payload: unknown) => void;
}

/**
 * Priority badge color mapping
 */
const priorityColors: Record<'high' | 'medium' | 'low', 'danger' | 'warning' | 'informative'> = {
    high: 'danger',
    medium: 'warning',
    low: 'informative',
};

/**
 * Improvement card component for displaying AI-generated optimization recommendations.
 * This component supports ref forwarding for use with animation libraries.
 *
 * **Usage with animations**: Use directly with animation libraries like @fluentui/react-motion-components-preview:
 *
 * ```tsx
 * <CollapseRelaxed visible={isVisible}>
 *     <ImprovementCard config={improvementConfig} {...props} />
 * </CollapseRelaxed>
 * ```
 *
 * **Important**: The component applies `marginBottom: '16px'` by default for proper spacing in animated lists.
 * The margin is on the Card itself to ensure borders and shadows render immediately during collapse animations.
 */
export const ImprovementCard = forwardRef<HTMLDivElement, ImprovementCardProps>(
    // TODO: Copy content feature will be added in the next release - _onCopy parameter will be used then
    ({ config, onCopy: _onCopy, onPrimaryAction, onSecondaryAction }, ref) => {
        const priorityBadgeText = {
            high: l10n.t('HIGH PRIORITY'),
            medium: l10n.t('MEDIUM PRIORITY'),
            low: l10n.t('LOW PRIORITY'),
        }[config.priority];

        return (
            <Card ref={ref} style={{ marginBottom: '16px' }}>
                <Text
                    size={200}
                    style={{
                        position: 'absolute',
                        top: '12px',
                        right: '12px',
                        color: tokens.colorNeutralForeground3,
                    }}
                >
                    {l10n.t('AI responses may be inaccurate.')}
                </Text>
                <div className="optimization-card-container">
                    <ArrowTrendingSparkleRegular className="optimization-card-icon" style={{ flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                        <CardHeader
                            header={
                                <div className="ai-card-title-container">
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
                            // TODO: Copy content feature will be added in the next release
                            // action={
                            //     onCopy ? (
                            //         <Button appearance="subtle" icon={<CopyRegular />} size="small" onClick={onCopy} />
                            //     ) : undefined
                            // }
                        />
                        <div style={{ marginTop: '12px' }}>
                            {/* Description */}
                            <Text
                                size={300}
                                style={{
                                    display: 'block',
                                    marginBottom: '12px',
                                }}
                            >
                                {config.description}
                            </Text>

                            {/* Recommended Index Section */}
                            <div style={{ marginBottom: '12px' }}>
                                <Label size="small">{l10n.t('Recommended Index')}</Label>
                                <div style={{ marginTop: '4px' }}>
                                    <Popover positioning="below-start" withArrow openOnHover mouseLeaveDelay={0}>
                                        <PopoverTrigger disableButtonEnhancement>
                                            <Button appearance="secondary" size="small">
                                                {config.recommendedIndex}
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverSurface style={{ padding: '16px', maxWidth: '400px' }}>
                                            <Text
                                                size={300}
                                                weight="semibold"
                                                style={{ display: 'block', marginBottom: '8px' }}
                                            >
                                                {l10n.t('Index Details')}
                                            </Text>
                                            <Text size={200}>{config.recommendedIndexDetails}</Text>
                                        </PopoverSurface>
                                    </Popover>
                                </div>
                            </div>

                            {/* Details/Risks */}
                            <Text
                                size={200}
                                style={{
                                    color: tokens.colorNeutralForeground3,
                                    display: 'block',
                                    marginBottom: '12px',
                                }}
                            >
                                {config.details}
                            </Text>

                            {/* Action Buttons */}
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <Button
                                    appearance="primary"
                                    size="small"
                                    onClick={() =>
                                        onPrimaryAction?.(config.primaryButton.actionId, config.primaryButton.payload)
                                    }
                                >
                                    {config.primaryButton.label}
                                </Button>
                                {config.secondaryButton && (
                                    <Button
                                        appearance="subtle"
                                        size="small"
                                        onClick={() =>
                                            onSecondaryAction?.(
                                                config.secondaryButton!.actionId,
                                                config.secondaryButton!.payload,
                                            )
                                        }
                                    >
                                        {config.secondaryButton.label}
                                    </Button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </Card>
        );
    },
);

ImprovementCard.displayName = 'ImprovementCard';
