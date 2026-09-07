/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ToolbarButton, Tooltip } from '@fluentui/react-components';
import { ThumbDislikeRegular, ThumbLikeRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useState, type JSX } from 'react';

import { useTrpcClient } from '../../../_integration/useTrpcClient';
// TODO(dashboard): promote the feedback dialog to src/webviews/components/ so views don't
// reach into each other. Reused as-is meanwhile — a second copy of the consent flow and its
// privacy notice is the last thing this should grow.
import { FeedbackDialog } from '../../collectionView/queryInsightsTab/components';

/**
 * The thumbs-up / thumbs-down question, as a labelled pair of toolbar buttons.
 *
 * Query Insights asks it from a card in a column of cards, where a card is the right shape.
 * This page has no such column, and anything at the foot of it competes with the last row of
 * a table for the reader's attention. In the action bar it is available from every tab and
 * costs no vertical space at all. The dialog behind it — the consent flow, the privacy
 * notice, the reason lists — is Query Insights' own, unchanged.
 *
 * Returns a fragment of toolbar children, so it must be rendered inside a `Toolbar`.
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
            <div className="dashboardFeedbackGroup" role="group" aria-label={l10n.t('Feedback')}>
                <Tooltip content={l10n.t('I like the Cluster Dashboard')} relationship="label" withArrow>
                    <ToolbarButton
                        icon={<ThumbLikeRegular />}
                        onClick={() => handleFeedbackClick('positive')}
                        aria-label={l10n.t('I like the Cluster Dashboard')}
                    />
                </Tooltip>
                <Tooltip content={l10n.t('The Cluster Dashboard could be better')} relationship="label" withArrow>
                    <ToolbarButton
                        icon={<ThumbDislikeRegular />}
                        onClick={() => handleFeedbackClick('negative')}
                        aria-label={l10n.t('The Cluster Dashboard could be better')}
                    />
                </Tooltip>
            </div>
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
