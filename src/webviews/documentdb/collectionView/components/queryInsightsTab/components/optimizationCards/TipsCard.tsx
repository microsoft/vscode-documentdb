/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Card, CardHeader, Text, tokens } from '@fluentui/react-components';
import { ChevronLeftRegular, ChevronRightRegular, DismissRegular, LightbulbRegular } from '@fluentui/react-icons';
import { useState } from 'react';
import { useTrpcClient } from '../../../../../../api/webview-client/useTrpcClient';
import './optimizationCard.scss';
import './TipsCard.scss';

export interface Tip {
    title: string;
    description: string;
}

export interface TipsCardProps {
    /**
     * The main title of the card
     */
    title: string;

    /**
     * Array of tips to display
     */
    tips: Tip[];

    /**
     * Optional callback when the card is dismissed
     */
    onDismiss?: () => void;

    /**
     * Optional callback when the copy button is clicked
     */
    onCopy?: () => void;

    /**
     * Ref to forward to the card element
     */
    ref?: React.Ref<HTMLDivElement>;
}

/**
 * Card component for displaying performance tips with carousel navigation.
 * This component supports ref forwarding for use with animation libraries.
 *
 * **Usage with animations**: Use directly with animation libraries like @fluentui/react-motion-components-preview:
 *
 * ```tsx
 * <CollapseRelaxed visible={isVisible}>
 *     <TipsCard title="..." tips={[...]} {...props} />
 * </CollapseRelaxed>
 * ```
 *
 * **Important**: The component applies `marginBottom: '16px'` by default for proper spacing in animated lists.
 * The margin is on the Card itself to ensure borders and shadows render immediately during collapse animations.
 */
export function TipsCard({ title, tips, onDismiss, ref }: TipsCardProps) {
    const { trpcClient } = useTrpcClient();
    const [currentIndex, setCurrentIndex] = useState(0);

    const handleNext = () => {
        setCurrentIndex((prev) => (prev + 1) % tips.length);

        // Report tip navigation telemetry
        trpcClient.common.reportEvent
            .mutate({
                eventName: 'queryInsights.tipNavigated',
                properties: {
                    direction: 'next',
                    fromIndex: currentIndex.toString(),
                    toIndex: ((currentIndex + 1) % tips.length).toString(),
                },
            })
            .catch((error) => {
                console.debug('Failed to report tip navigation:', error);
            });
    };

    const handlePrevious = () => {
        setCurrentIndex((prev) => (prev - 1 + tips.length) % tips.length);

        // Report tip navigation telemetry
        trpcClient.common.reportEvent
            .mutate({
                eventName: 'queryInsights.tipNavigated',
                properties: {
                    direction: 'previous',
                    fromIndex: currentIndex.toString(),
                    toIndex: ((currentIndex - 1 + tips.length) % tips.length).toString(),
                },
            })
            .catch((error) => {
                console.debug('Failed to report tip navigation:', error);
            });
    };

    const handleDismiss = () => {
        // Report tips dismissal telemetry
        trpcClient.common.reportEvent
            .mutate({
                eventName: 'queryInsights.tipsDismissed',
            })
            .catch((error) => {
                console.debug('Failed to report tips dismissal:', error);
            });

        onDismiss?.();
    };

    return (
        <Card ref={ref} style={{ marginBottom: '16px' }}>
            <div className="optimization-card-container">
                <LightbulbRegular
                    className="optimization-card-icon"
                    style={{ color: tokens.colorPaletteYellowForeground1, flexShrink: 0 }}
                />
                <div style={{ flex: 1 }}>
                    <CardHeader
                        header={
                            <Text weight="semibold" size={400}>
                                {title}
                            </Text>
                        }
                        action={
                            <div className="tips-card-actions-container">
                                <Button
                                    appearance="subtle"
                                    icon={<ChevronLeftRegular />}
                                    size="small"
                                    onClick={handlePrevious}
                                    disabled={currentIndex <= 0}
                                />
                                <Button
                                    appearance="subtle"
                                    icon={<ChevronRightRegular />}
                                    size="small"
                                    onClick={handleNext}
                                    disabled={currentIndex >= tips.length - 1}
                                />
                                {onDismiss && (
                                    <Button
                                        appearance="subtle"
                                        icon={<DismissRegular />}
                                        size="small"
                                        onClick={handleDismiss}
                                    />
                                )}
                            </div>
                        }
                    />
                    <Text
                        weight="semibold"
                        size={300}
                        style={{ display: 'block', marginTop: '12px', marginBottom: '8px' }}
                    >
                        {tips[currentIndex].title}
                    </Text>
                    <Text size={300}>{tips[currentIndex].description}</Text>
                </div>
            </div>
        </Card>
    );
}
