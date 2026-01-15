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
    MessageBar,
    MessageBarBody,
    MessageBarTitle,
    Spinner,
    Text,
    tokens,
} from '@fluentui/react-components';
import { ArrowTrendingSparkleRegular } from '@fluentui/react-icons';
// TODO: Copy content feature will be added in the next release
// import { CopyRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useState } from 'react';
import { type ImprovementCard as ImprovementCardConfig } from '../../../../types/queryInsights';
import './baseOptimizationCard.scss';

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
     * Returns a Promise with success status and optional message
     */
    onPrimaryAction?: (actionId: string, payload: unknown) => Promise<{ success: boolean; message?: string }>;

    /**
     * Callback when the secondary button is clicked
     * Returns a Promise with success status and optional message
     */
    onSecondaryAction?: (actionId: string, payload: unknown) => Promise<{ success: boolean; message?: string }>;

    /**
     * Ref to forward to the card element
     */
    ref?: React.Ref<HTMLDivElement>;
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
 * Each card manages its own execution state (loading, error, success) locally,
 * making it self-contained and independently operable.
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
// TODO: Copy content feature will be added in the next release - _onCopy parameter will be used then
export function ImprovementCard({
    config,
    onCopy: _onCopy,
    onPrimaryAction,
    onSecondaryAction,
    ref,
}: ImprovementCardProps) {
    // Separate state for each button - independent execution tracking
    const [primaryState, setPrimaryState] = useState<{
        isLoading: boolean;
        errorMessage?: string;
        successMessage?: string;
    }>({ isLoading: false });

    const [secondaryState, setSecondaryState] = useState<{
        isLoading: boolean;
        errorMessage?: string;
        successMessage?: string;
    }>({ isLoading: false });

    const handlePrimaryClick = async () => {
        if (!config.primaryButton || !onPrimaryAction) return;

        // Clear previous state, set loading for primary button only
        setPrimaryState({ isLoading: true });

        try {
            const result = await onPrimaryAction(config.primaryButton.actionId, config.primaryButton.payload);

            if (result.success) {
                setPrimaryState({
                    isLoading: false,
                    successMessage: result.message || l10n.t('Action completed successfully'),
                });
            } else {
                setPrimaryState({
                    isLoading: false,
                    errorMessage: result.message || l10n.t('Action failed'),
                });
            }
        } catch (error) {
            setPrimaryState({
                isLoading: false,
                errorMessage: error instanceof Error ? error.message : l10n.t('An unexpected error occurred'),
            });
        }
    };

    const handleSecondaryClick = async () => {
        if (!config.secondaryButton || !onSecondaryAction) return;

        // Clear previous state, set loading for secondary button only
        setSecondaryState({ isLoading: true });

        try {
            const result = await onSecondaryAction(config.secondaryButton.actionId, config.secondaryButton.payload);

            if (result.success) {
                setSecondaryState({
                    isLoading: false,
                    successMessage: result.message || l10n.t('Action completed successfully'),
                });
            } else {
                setSecondaryState({
                    isLoading: false,
                    errorMessage: result.message || l10n.t('Action failed'),
                });
            }
        } catch (error) {
            setSecondaryState({
                isLoading: false,
                errorMessage: error instanceof Error ? error.message : l10n.t('An unexpected error occurred'),
            });
        }
    };

    const priorityBadgeText = {
        high: l10n.t('HIGH PRIORITY'),
        medium: l10n.t('MEDIUM PRIORITY'),
        low: l10n.t('LOW PRIORITY'),
    }[config.priority];

    return (
        <Card ref={ref} style={{ marginBottom: '16px' }}>
            <div className="optimization-card-container">
                <ArrowTrendingSparkleRegular className="optimization-card-icon" style={{ flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                    <CardHeader
                        header={
                            <div className="optimization-card-title-container">
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
                        action={
                            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                                {l10n.t('AI responses may be inaccurate')}
                            </Text>
                        }
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
                            <Label size="small">
                                {config.primaryButton?.actionId === 'createIndex'
                                    ? l10n.t('Recommended Index')
                                    : l10n.t('Index Name')}
                            </Label>
                            <div style={{ marginTop: '4px' }}>
                                <pre className="index-code-block">
                                    {config.primaryButton?.actionId === 'createIndex'
                                        ? config.recommendedIndex
                                        : config.indexName}
                                </pre>
                                <Text size={200} className="index-details-text">
                                    {config.recommendedIndexDetails}
                                </Text>
                            </div>
                        </div>

                        {/* Index Options Section (if available) */}
                        {config.indexOptions && (
                            <div style={{ marginBottom: '12px' }}>
                                <Label size="small">{l10n.t('Index Options')}</Label>
                                <div style={{ marginTop: '4px' }}>
                                    <pre className="index-code-block">{config.indexOptions}</pre>
                                </div>
                            </div>
                        )}

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

                        {/* Primary Button Error Message Bar */}
                        {primaryState.errorMessage && (
                            <MessageBar layout="multiline" intent="warning" style={{ marginBottom: '12px' }}>
                                <MessageBarBody>
                                    <MessageBarTitle>{l10n.t('Error')}</MessageBarTitle>
                                    {primaryState.errorMessage}
                                </MessageBarBody>
                            </MessageBar>
                        )}

                        {/* Primary Button Success Message Bar */}
                        {primaryState.successMessage && (
                            <MessageBar layout="multiline" intent="success" style={{ marginBottom: '12px' }}>
                                <MessageBarBody>{primaryState.successMessage}</MessageBarBody>
                            </MessageBar>
                        )}

                        {/* Secondary Button Error Message Bar */}
                        {secondaryState.errorMessage && (
                            <MessageBar layout="multiline" intent="warning" style={{ marginBottom: '12px' }}>
                                <MessageBarBody>
                                    <MessageBarTitle>{l10n.t('Error')}</MessageBarTitle>
                                    {secondaryState.errorMessage}
                                </MessageBarBody>
                            </MessageBar>
                        )}

                        {/* Secondary Button Success Message Bar */}
                        {secondaryState.successMessage && (
                            <MessageBar layout="multiline" intent="success" style={{ marginBottom: '12px' }}>
                                <MessageBarBody>{secondaryState.successMessage}</MessageBarBody>
                            </MessageBar>
                        )}

                        {/* Action Buttons */}
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            {config.primaryButton && (
                                <Button
                                    appearance="primary"
                                    size="small"
                                    disabled={primaryState.isLoading || !!primaryState.successMessage}
                                    onClick={() => void handlePrimaryClick()}
                                >
                                    {primaryState.isLoading && <Spinner size="tiny" style={{ marginRight: '4px' }} />}
                                    {primaryState.isLoading
                                        ? l10n.t('Working...')
                                        : primaryState.errorMessage
                                          ? l10n.t('Retry')
                                          : config.primaryButton.label}
                                </Button>
                            )}
                            {config.secondaryButton && (
                                <Button
                                    appearance="subtle"
                                    size="small"
                                    disabled={secondaryState.isLoading || !!secondaryState.successMessage}
                                    onClick={() => void handleSecondaryClick()}
                                >
                                    {secondaryState.isLoading && <Spinner size="tiny" style={{ marginRight: '4px' }} />}
                                    {secondaryState.isLoading
                                        ? l10n.t('Working...')
                                        : secondaryState.errorMessage
                                          ? l10n.t('Retry')
                                          : config.secondaryButton.label}
                                </Button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </Card>
    );
}
