/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Card, Spinner, Text, tokens } from '@fluentui/react-components';
import { SparkleRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { forwardRef } from 'react';
import '../optimizationCard.scss';
import './GetPerformanceInsightsCard.scss';

export interface GetPerformanceInsightsCardProps {
    /**
     * The body text describing the query performance
     */
    bodyText: string;

    /**
     * Optional recommendation text. If not provided, the recommendation line won't be shown
     */
    recommendation?: string;

    /**
     * Whether the AI is currently loading/analyzing
     */
    isLoading: boolean;

    /**
     * Handler for the "Get AI Performance Insights" button
     */
    onGetInsights: () => void;

    /**
     * Handler for the "Learn more about AI Performance Insights" button
     */
    onLearnMore: () => void;

    /**
     * Handler for the "Cancel" button (shown during loading)
     */
    onCancel: () => void;

    /**
     * Optional className to apply to the Card component (e.g., for spacing)
     */
    className?: string;
}

/**
 * Branded card component for prompting users to get AI-powered performance insights.
 * This component supports ref forwarding for use with animation libraries.
 *
 * **Usage with animations**: Use directly with animation libraries like @fluentui/react-motion-components-preview:
 *
 * ```tsx
 * <CollapseRelaxed visible={isVisible}>
 *     <GetPerformanceInsightsCard className="cardSpacing" bodyText="..." {...props} />
 * </CollapseRelaxed>
 * ```
 *
 * **Note**: This component does not apply default margins. Use the `className` prop to apply
 * spacing classes (e.g., `cardSpacing`) when using in layouts that require spacing.
 */
export const GetPerformanceInsightsCard = forwardRef<HTMLDivElement, GetPerformanceInsightsCardProps>(
    ({ bodyText, recommendation, isLoading, onGetInsights, onLearnMore, onCancel, className }, ref) => {
        return (
            <Card
                ref={ref}
                className={`get-performance-insights-card${className ? ` ${className}` : ''}`}
                style={{
                    backgroundColor: tokens.colorBrandBackground2,
                    border: `1px solid ${tokens.colorBrandStroke1}`,
                }}
            >
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
                    <SparkleRegular
                        className="optimization-card-icon"
                        style={{ color: tokens.colorBrandForeground1, flexShrink: 0 }}
                    />
                    <div style={{ flex: 1 }}>
                        <Text weight="semibold" size={500} style={{ display: 'block', marginBottom: '8px' }}>
                            {l10n.t('AI Performance Insights')}
                        </Text>
                        <Text size={300} style={{ display: 'block', marginBottom: '16px' }}>
                            {bodyText}
                        </Text>
                        {recommendation && (
                            <Text size={400} weight="semibold" style={{ display: 'block', marginBottom: '16px' }}>
                                {recommendation}
                            </Text>
                        )}
                        {!isLoading ? (
                            <div className="get-performance-insights-card-actions">
                                <Button appearance="primary" icon={<SparkleRegular />} onClick={onGetInsights}>
                                    {l10n.t('Get AI Performance Insights')}
                                </Button>
                                <Button appearance="subtle" onClick={onLearnMore}>
                                    {l10n.t('Learn more about AI Performance Insights')}
                                </Button>
                            </div>
                        ) : (
                            <div className="get-performance-insights-card-loading">
                                <Spinner size="small" />
                                <Text size={300}>{l10n.t('AI is analyzing...')}</Text>
                                <Button appearance="subtle" size="small" onClick={onCancel}>
                                    {l10n.t('Cancel')}
                                </Button>
                            </div>
                        )}
                    </div>
                </div>
            </Card>
        );
    },
);

GetPerformanceInsightsCard.displayName = 'GetPerformanceInsightsCard';
