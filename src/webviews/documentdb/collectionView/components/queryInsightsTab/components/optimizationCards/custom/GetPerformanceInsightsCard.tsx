/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Card, Spinner, Text, tokens } from '@fluentui/react-components';
import { SparkleRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';

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
            style={{
                padding: '20px',
                backgroundColor: tokens.colorBrandBackground2,
                border: `1px solid ${tokens.colorBrandStroke1}`,
                marginBottom: '12px',
                position: 'relative',
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
            <div style={{ display: 'flex', gap: '16px' }}>
                <SparkleRegular fontSize={40} style={{ color: tokens.colorBrandForeground1, flexShrink: 0 }} />
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
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            <Button appearance="primary" icon={<SparkleRegular />} onClick={onGetInsights}>
                                {l10n.t('Get AI Performance Insights')}
                            </Button>
                            <Button appearance="subtle" onClick={onLearnMore}>
                                {l10n.t('Learn more about AI Performance Insights')}
                            </Button>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
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
