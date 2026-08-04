/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { useState, type JSX } from 'react';

import { useTrpcClient } from '../../../_integration/useTrpcClient';
// TODO(dashboard): promote the feedback pair to src/webviews/components/ so views don't
// reach into each other. Reused as-is meanwhile — a second copy of the consent flow and its
// privacy notice is the last thing this should grow.
import { FeedbackCard, FeedbackDialog } from '../../collectionView/components/queryInsightsTab/components';

/**
 * The thumbs-up / thumbs-down vehicle from Query Insights, asking about the dashboard.
 *
 * Same component, same consent flow, same privacy notice — only the wording and the reason
 * list change, because a reader is being asked about an inventory view rather than a query
 * analysis. Rendered only when the host says feedback signals are allowed, which tracks
 * VS Code's own telemetry level.
 */
export const DashboardFeedback = (): JSX.Element => {
    const trpcClient = useTrpcClient();

    const [dialogOpen, setDialogOpen] = useState(false);
    const [sentiment, setSentiment] = useState<'positive' | 'negative'>('positive');

    const handleFeedbackClick = (clicked: 'positive' | 'negative'): void => {
        void trpcClient.common.reportEvent.mutate({
            eventName: 'clusterDashboardThumb',
            properties: { sentiment: clicked, source: 'feedbackThumb' },
        });
        setSentiment(clicked);
        setDialogOpen(true);
    };

    const handleSubmit = (feedback: {
        sentiment: 'positive' | 'negative';
        selectedReasons: string[];
    }): Promise<void> => {
        // The reasons are booleans in telemetry, one property per selected reason — the
        // shape Query Insights already reports, so both surfaces query the same way.
        const reasonProperties = feedback.selectedReasons.reduce<Record<string, string>>((properties, reason) => {
            properties[reason] = 'true';
            return properties;
        }, {});

        void trpcClient.common.reportEvent.mutate({
            eventName: 'clusterDashboardFeedback',
            properties: { sentiment: feedback.sentiment, source: 'feedbackDialog', ...reasonProperties },
        });

        return Promise.resolve();
    };

    return (
        <>
            <FeedbackCard
                title={l10n.t('How would you rate the Cluster Dashboard?')}
                onFeedback={handleFeedbackClick}
            />
            <FeedbackDialog
                open={dialogOpen}
                onClose={() => setDialogOpen(false)}
                sentiment={sentiment}
                onSubmit={handleSubmit}
                promptPositive={l10n.t(
                    'Your positive feedback helps us understand what works well in the Cluster Dashboard. Tell us more:',
                )}
                promptNegative={l10n.t(
                    'Your feedback helps us improve the Cluster Dashboard. Tell us what could be better:',
                )}
                positiveReasons={[
                    l10n.t('Data shown was correct'),
                    l10n.t('Told me something I could not see elsewhere'),
                    l10n.t('Helped me find what is using storage'),
                    l10n.t('Helped me understand a running operation'),
                ]}
                negativeReasons={[
                    l10n.t('Data shown was incorrect'),
                    l10n.t('Too many values were unavailable for my cluster'),
                    l10n.t('Missing important information'),
                    l10n.t('I could not act on what it showed me'),
                ]}
            />
        </>
    );
};
