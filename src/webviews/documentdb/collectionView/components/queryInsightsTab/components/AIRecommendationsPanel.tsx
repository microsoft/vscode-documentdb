/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Stage 3: AI-Powered Optimization Recommendations Component
 *
 * This component calls the getQueryInsightsStage3 tRPC endpoint and displays:
 * - Analysis card with overall AI analysis
 * - Improvement cards with actionable recommendations
 * - Action buttons for creating/dropping indexes
 * - Learn more links
 *
 * Design: docs/design-documents/query-insights-router-plan.md
 */

import { Button, Spinner, Text, tokens } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { type JSX, useState } from 'react';
import { useTrpcClient } from '../../../../../api/webview-client/useTrpcClient';
import { type ImprovementCard, type QueryInsightsStage3Response } from '../../../types/queryInsights';
import { AiCard } from './optimizationCards';

export const AIRecommendationsPanel = (): JSX.Element => {
    const { trpcClient } = useTrpcClient();
    const [isLoading, setIsLoading] = useState(false);
    const [aiData, setAiData] = useState<QueryInsightsStage3Response | null>(null);
    const [error, setError] = useState<string | null>(null);

    const handleGetAIRecommendations = () => {
        setIsLoading(true);
        setError(null);

        // Call the tRPC endpoint (8 second delay expected)
        void trpcClient.mongoClusters.collectionView.getQueryInsightsStage3
            .query({})
            .then((response) => {
                setAiData(response as QueryInsightsStage3Response);
                setIsLoading(false);
            })
            .catch((err: unknown) => {
                setError(err instanceof Error ? err.message : l10n.t('Failed to get AI recommendations'));
                setIsLoading(false);
            });
    };

    const handleCreateIndex = (payload: unknown) => {
        // TODO: Implement index creation via tRPC
        console.log('Create index:', payload);
    };

    const handleDropIndex = (payload: unknown) => {
        // TODO: Implement index deletion via tRPC
        console.log('Drop index:', payload);
    };

    const handleLearnMore = (payload: unknown) => {
        // TODO: Open documentation link
        console.log('Learn more:', payload);
    };

    // Initial state: Show button to trigger AI analysis
    if (!isLoading && !aiData) {
        return (
            <div style={{ padding: '16px', textAlign: 'center' }}>
                <Text size={400} style={{ display: 'block', marginBottom: '16px' }}>
                    {l10n.t('Get AI-powered optimization recommendations for your query')}
                </Text>
                <Button appearance="primary" onClick={handleGetAIRecommendations}>
                    {l10n.t('Get Performance Insights')}
                </Button>
            </div>
        );
    }

    // Loading state: Show spinner and message
    if (isLoading) {
        return (
            <div style={{ padding: '24px', textAlign: 'center' }}>
                <Spinner size="large" label={l10n.t('Analyzing query performance...')} />
                <Text
                    size={300}
                    style={{
                        display: 'block',
                        marginTop: '16px',
                        color: tokens.colorNeutralForeground3,
                    }}
                >
                    {l10n.t('This may take up to 10 seconds')}
                </Text>
            </div>
        );
    }

    // Error state
    if (error) {
        return (
            <div style={{ padding: '16px', textAlign: 'center' }}>
                <Text
                    size={400}
                    style={{ display: 'block', marginBottom: '16px', color: tokens.colorPaletteRedForeground1 }}
                >
                    {error}
                </Text>
                <Button appearance="secondary" onClick={handleGetAIRecommendations}>
                    {l10n.t('Retry')}
                </Button>
            </div>
        );
    }

    // Success state: Display AI recommendations
    if (!aiData) {
        return <></>;
    }

    return (
        <div style={{ padding: '16px' }}>
            {/* Analysis Card */}
            <AiCard
                title={l10n.t('Query Performance Analysis')}
                onCopy={() => {
                    void navigator.clipboard.writeText(aiData.analysisCard.content);
                }}
            >
                <Text size={300}>{aiData.analysisCard.content}</Text>
            </AiCard>

            {/* Improvement Cards */}
            {aiData.improvementCards.map((card: ImprovementCard) => (
                <AiCard
                    key={card.cardId}
                    title={card.title}
                    onCopy={() => {
                        void navigator.clipboard.writeText(card.mongoShellCommand);
                    }}
                >
                    <div style={{ marginBottom: '12px' }}>
                        <Text size={300} style={{ display: 'block', marginBottom: '8px' }}>
                            <strong>{l10n.t('Priority')}:</strong> {card.priority}
                        </Text>
                        <Text size={300} style={{ display: 'block', marginBottom: '8px' }}>
                            {card.description}
                        </Text>
                        <div
                            style={{
                                padding: '12px',
                                backgroundColor: tokens.colorNeutralBackground2,
                                borderRadius: tokens.borderRadiusMedium,
                                marginBottom: '12px',
                            }}
                        >
                            <Text size={200} style={{ fontFamily: 'monospace', display: 'block' }}>
                                {card.recommendedIndex}
                            </Text>
                        </div>
                        <Text size={300} style={{ display: 'block', marginBottom: '8px' }}>
                            {card.recommendedIndexDetails}
                        </Text>
                        {card.details && (
                            <Text
                                size={200}
                                style={{
                                    display: 'block',
                                    color: tokens.colorNeutralForeground3,
                                    marginTop: '8px',
                                }}
                            >
                                ⚠️ {card.details}
                            </Text>
                        )}
                    </div>

                    {/* Action Buttons */}
                    <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                        <Button
                            appearance="primary"
                            onClick={() => {
                                if (card.primaryButton.actionId === 'createIndex') {
                                    handleCreateIndex(card.primaryButton.payload);
                                } else if (card.primaryButton.actionId === 'dropIndex') {
                                    handleDropIndex(card.primaryButton.payload);
                                }
                            }}
                        >
                            {card.primaryButton.label}
                        </Button>
                        {card.secondaryButton && (
                            <Button
                                appearance="secondary"
                                onClick={() => {
                                    if (card.secondaryButton?.actionId === 'learnMore') {
                                        handleLearnMore(card.secondaryButton.payload);
                                    }
                                }}
                            >
                                {card.secondaryButton.label}
                            </Button>
                        )}
                    </div>
                </AiCard>
            ))}

            {/* Verification Steps */}
            {aiData.verificationSteps && (
                <div
                    style={{
                        marginTop: '24px',
                        padding: '16px',
                        backgroundColor: tokens.colorNeutralBackground2,
                        borderRadius: tokens.borderRadiusMedium,
                    }}
                >
                    <Text size={400} weight="semibold" style={{ display: 'block', marginBottom: '8px' }}>
                        {l10n.t('Verification Steps')}
                    </Text>
                    <Text size={300} style={{ whiteSpace: 'pre-line' }}>
                        {aiData.verificationSteps}
                    </Text>
                </div>
            )}
        </div>
    );
};
