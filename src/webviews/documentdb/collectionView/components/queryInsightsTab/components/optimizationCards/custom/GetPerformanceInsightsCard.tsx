/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Card,
    CardHeader,
    Link,
    MessageBar,
    MessageBarBody,
    MessageBarTitle,
    Text,
    tokens,
} from '@fluentui/react-components';
import { InfoRegular, SparkleRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import type * as React from 'react';
import { Announcer } from '../../../../../../../components/accessibility';
import '../baseOptimizationCard.scss';
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
     * Whether the card actions are enabled. When false, action buttons are disabled.
     */
    enabled?: boolean;

    /**
     * Optional error message. If provided, shows error state with retry button
     */
    errorMessage?: string;

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
     * Handler for the "Learn more about the utility model" link in the cost-disclosure row.
     * Navigates to the utility-model documentation page (separate from the general AI insights docs).
     */
    onLearnMoreUtilityModel: () => void;

    /**
     * Optional className to apply to the Card component (e.g., for spacing)
     */
    className?: string;

    /**
     * Ref to forward to the card element
     */
    ref?: React.Ref<HTMLDivElement>;
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
export function GetPerformanceInsightsCard({
    bodyText,
    recommendation,
    isLoading,
    enabled = true,
    errorMessage,
    onGetInsights,
    onLearnMore,
    onCancel,
    onLearnMoreUtilityModel,
    className,
    ref,
}: GetPerformanceInsightsCardProps) {
    return (
        <Card
            ref={ref}
            className={`get-performance-insights-card${className ? ` ${className}` : ''}`}
            style={{
                backgroundColor: tokens.colorBrandBackground2,
                border: `1px solid ${tokens.colorBrandStroke1}`,
            }}
        >
            <div className="optimization-card-container">
                <SparkleRegular
                    className="optimization-card-icon"
                    style={{ color: tokens.colorBrandForeground1, flexShrink: 0 }}
                />
                <div style={{ flex: 1 }}>
                    <CardHeader
                        header={
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                <Text weight="semibold" size={500}>
                                    {l10n.t('AI Performance Insights')}
                                </Text>
                            </div>
                        }
                        action={
                            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                                {l10n.t('AI responses may be inaccurate')}
                            </Text>
                        }
                        style={{ marginBottom: '8px' }}
                    />
                    <Text size={300} style={{ display: 'block', marginBottom: '16px' }}>
                        {bodyText}
                    </Text>
                    {recommendation && (
                        <Text size={400} weight="semibold" style={{ display: 'block', marginBottom: '16px' }}>
                            {recommendation}
                        </Text>
                    )}
                    {errorMessage && (
                        <MessageBar intent="info" style={{ marginBottom: '16px' }}>
                            <MessageBarBody>
                                <MessageBarTitle>Error:</MessageBarTitle>
                                {errorMessage}
                            </MessageBarBody>
                        </MessageBar>
                    )}
                    <Announcer when={isLoading} politeness="assertive" message={l10n.t('AI is analyzing...')} />
                    {isLoading ? (
                        // During Stage 3 loading we no longer render an
                        // in-card spinner + "AI is analyzing…" row. The
                        // three pre-reserved Stage 3 slots below the
                        // card each carry their own StreamingInlineProgress
                        // spinner (Analyzing… / Drafting… / Explaining…),
                        // so a fourth spinner inside this card was
                        // visually redundant. We keep ONLY the Cancel
                        // affordance so the user can still stop the
                        // request from this card. The accessibility
                        // announcer above continues to fire so screen
                        // readers hear "AI is analyzing…" once.
                        <div className="get-performance-insights-card-actions">
                            <Button appearance="subtle" size="small" onClick={onCancel}>
                                {l10n.t('Cancel')}
                            </Button>
                        </div>
                    ) : (
                        <div className="get-performance-insights-card-actions">
                            <Button
                                appearance="primary"
                                icon={<SparkleRegular />}
                                onClick={onGetInsights}
                                disabled={!enabled}
                            >
                                {errorMessage ? l10n.t('Retry') : l10n.t('Get AI Performance Insights')}
                            </Button>
                            <Button appearance="subtle" onClick={onLearnMore} disabled={!enabled}>
                                {l10n.t('Learn more about AI Performance Insights')}
                            </Button>
                        </div>
                    )}
                    {/* Cost-neutral disclosure row.
                        Always rendered so users see the disclosure both before clicking and during loading.
                        The "Learn more" link wires to `onLearnMoreUtilityModel` (the utility-model
                        cost-disclosure page), distinct from the general feature `onLearnMore` used by
                        the button above. Keeping the two URLs separate lets the parent panel update
                        each independently. */}
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: '6px',
                            marginTop: '12px',
                            color: tokens.colorNeutralForeground3,
                        }}
                    >
                        <InfoRegular aria-hidden="true" style={{ flexShrink: 0, marginTop: '2px' }} />
                        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                            {l10n.t('No additional cost for most GitHub Copilot subscribers.')}{' '}
                            <Link
                                appearance="subtle"
                                onClick={onLearnMoreUtilityModel}
                                inline
                                style={{
                                    fontSize: tokens.fontSizeBase200,
                                    lineHeight: tokens.lineHeightBase200,
                                }}
                            >
                                {l10n.t('Learn more about the utility model used.')}
                            </Link>
                        </Text>
                    </div>
                </div>
            </div>
        </Card>
    );
}
