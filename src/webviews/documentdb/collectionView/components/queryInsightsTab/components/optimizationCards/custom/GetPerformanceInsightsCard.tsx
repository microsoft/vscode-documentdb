/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Card, Spinner, Text, tokens } from '@fluentui/react-components';
import { SparkleRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';
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
}

/**
 * Branded card component for prompting users to get AI-powered performance insights.
 *
 * **Important**: When using this card with animation libraries (e.g., @fluentui/react-motion-components-preview),
 * wrap it in a `<div>` to ensure proper ref forwarding:
 *
 * ```tsx
 * <CollapseRelaxed visible={isVisible}>
 *     <div>
 *         <GetPerformanceInsightsCard bodyText="..." {...props} />
 *     </div>
 * </CollapseRelaxed>
 * ```
 *
 * This is required because GetPerformanceInsightsCard is not a ForwardRefComponent and motion components
 * need to attach refs for animations. The wrapper div provides the necessary ref target.
 */
export const GetPerformanceInsightsCard = ({
    bodyText,
    recommendation,
    isLoading,
    onGetInsights,
    onLearnMore,
    onCancel,
}: GetPerformanceInsightsCardProps): JSX.Element => {
    return (
        <Card
            className="get-performance-insights-card"
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
};
