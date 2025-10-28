/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Card, CardHeader, Text, tokens } from '@fluentui/react-components';
import { ChevronLeftRegular, ChevronRightRegular, DismissRegular, LightbulbRegular } from '@fluentui/react-icons';
import { type JSX, useState } from 'react';

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
}

export const TipsCard = ({ title, tips, onDismiss }: TipsCardProps): JSX.Element => {
    const [currentIndex, setCurrentIndex] = useState(0);

    const handleNext = () => {
        setCurrentIndex((prev) => (prev + 1) % tips.length);
    };

    const handlePrevious = () => {
        setCurrentIndex((prev) => (prev - 1 + tips.length) % tips.length);
    };

    return (
        <Card>
            <div style={{ display: 'flex', gap: '16px' }}>
                <LightbulbRegular
                    fontSize={40}
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
                            <div style={{ display: 'flex', gap: '4px' }}>
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
                                        onClick={onDismiss}
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
};
