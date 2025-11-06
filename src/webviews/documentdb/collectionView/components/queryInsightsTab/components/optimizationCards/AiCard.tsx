/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Card, CardHeader, Text, tokens } from '@fluentui/react-components';
// TODO: Copy content feature will be added in the next release
// import { Button, CopyRegular } from '@fluentui/react-icons';
import { SparkleRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { forwardRef, type ReactNode } from 'react';
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
 * This component supports ref forwarding for use with animation libraries.
 *
 * **Usage with animations**: Use directly with animation libraries like @fluentui/react-motion-components-preview:
 *
 * ```tsx
 * <CollapseRelaxed visible={isVisible}>
 *     <AiCard title="..." {...props} />
 * </CollapseRelaxed>
 * ```
 *
 * **Important**: The component applies `marginBottom: '16px'` by default for proper spacing in animated lists.
 * The margin is on the Card itself to ensure borders and shadows render immediately during collapse animations.
 */
export const AiCard = forwardRef<HTMLDivElement, AiCardProps>(
    // TODO: Copy content feature will be added in the next release - _onCopy parameter will be used then
    ({ title, titleChildren, children, onCopy: _onCopy }, ref) => {
        return (
            <Card ref={ref} style={{ marginBottom: '16px' }}>
                <Text
                    size={200}
                    style={{
                        position: 'absolute',
                        top: '12px',
                        right: '12px',
                        color: tokens.colorNeutralForeground3,
                    }}
                >
                    {l10n.t('AI responses may be inaccurate.')}
                </Text>
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
                            // TODO: Copy content feature will be added in the next release
                            // action={
                            //     onCopy ? (
                            //         <Button appearance="subtle" icon={<CopyRegular />} size="small" onClick={onCopy} />
                            //     ) : undefined
                            // }
                        />
                        <div style={{ marginTop: '12px' }}>{children}</div>
                    </div>
                </div>
            </Card>
        );
    },
);

AiCard.displayName = 'AiCard';
