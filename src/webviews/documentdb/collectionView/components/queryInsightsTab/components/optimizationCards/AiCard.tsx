/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Card, CardHeader, Text } from '@fluentui/react-components';
import { CopyRegular, SparkleRegular } from '@fluentui/react-icons';
import { type JSX, type ReactNode } from 'react';
import './AiCard.scss';
import './optimizationCard.scss';

export interface AiCardProps {
    /**
     * The main title of the card
     */
    title: string;

    /**
     * Optional badges or other elements to display alongside the title
     */
    titleChildren?: ReactNode;

    /**
     * The main content of the card
     */
    children: ReactNode;

    /**
     * Optional callback when the copy button is clicked
     */
    onCopy?: () => void;
}

/**
 * AI-themed card component for displaying optimization recommendations.
 *
 * **Important**: When using this card with animation libraries (e.g., @fluentui/react-motion-components-preview),
 * wrap it in a `<div>` to ensure proper ref forwarding:
 *
 * ```tsx
 * <CollapseRelaxed visible={isVisible}>
 *     <div>
 *         <AiCard title="..." {...props} />
 *     </div>
 * </CollapseRelaxed>
 * ```
 *
 * This is required because AiCard is not a ForwardRefComponent and motion components
 * need to attach refs for animations. The wrapper div provides the necessary ref target.
 */
export const AiCard = ({ title, titleChildren, children, onCopy }: AiCardProps): JSX.Element => {
    return (
        <Card>
            <div className="optimization-card-container">
                <SparkleRegular className="optimization-card-icon" style={{ flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                    <CardHeader
                        header={
                            <div className="ai-card-title-container">
                                <Text weight="semibold" size={400}>
                                    {title}
                                </Text>
                                {titleChildren}
                            </div>
                        }
                        action={
                            onCopy ? (
                                <Button appearance="subtle" icon={<CopyRegular />} size="small" onClick={onCopy} />
                            ) : undefined
                        }
                    />
                    <div style={{ marginTop: '12px' }}>{children}</div>
                </div>
            </div>
        </Card>
    );
};
