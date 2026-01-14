/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Card, Text } from '@fluentui/react-components';
import { ThumbDislikeRegular, ThumbLikeRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';

export interface FeedbackCardProps {
    /** Callback when feedback button is clicked */
    onFeedback: (sentiment: 'positive' | 'negative') => void;
}

export const FeedbackCard = ({ onFeedback }: FeedbackCardProps): JSX.Element => {
    return (
        <Card>
            <div role="group" aria-labelledby="query-insights-rating-label">
                <Text id="query-insights-rating-label" size={400} weight="semibold" style={{ display: 'block', marginBottom: '12px' }}>
                    {l10n.t('How would you rate Query Insights?')}
                </Text>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <Button
                        appearance="subtle"
                        size="small"
                        icon={<ThumbLikeRegular />}
                        onClick={() => onFeedback('positive')}
                    >
                        {l10n.t('I like it')}
                    </Button>
                    <Button
                        appearance="subtle"
                        size="small"
                        icon={<ThumbDislikeRegular />}
                        onClick={() => onFeedback('negative')}
                    >
                        {l10n.t('It could be better')}
                    </Button>
                </div>
            </div>
        </Card>
    );
};

FeedbackCard.displayName = 'FeedbackCard';
