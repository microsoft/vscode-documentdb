/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Card, Text } from '@fluentui/react-components';
import { ThumbDislikeRegular, ThumbLikeRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useId, type JSX } from 'react';

export interface FeedbackCardProps {
    /** Callback when feedback button is clicked */
    onFeedback: (sentiment: 'positive' | 'negative') => void;

    /**
     * Heading of the card. Defaults to the Query Insights wording, so existing call sites
     * are unchanged; other views (e.g. the Cluster Dashboard) name themselves instead.
     */
    title?: string;
}

export const FeedbackCard = ({ onFeedback, title }: FeedbackCardProps): JSX.Element => {
    // Generated rather than a fixed string: two cards on one page would otherwise share an
    // id, and `aria-labelledby` would resolve to whichever mounted first.
    const labelId = useId();

    return (
        <Card>
            <div role="group" aria-labelledby={labelId}>
                <Text id={labelId} size={400} weight="semibold" style={{ display: 'block', marginBottom: '12px' }}>
                    {title ?? l10n.t('How would you rate Query Insights?')}
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
