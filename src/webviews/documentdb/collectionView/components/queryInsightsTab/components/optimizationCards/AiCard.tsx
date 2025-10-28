/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Card, CardHeader, Text } from '@fluentui/react-components';
import { CopyRegular, SparkleRegular } from '@fluentui/react-icons';
import { type JSX, type ReactNode } from 'react';

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

export const AiCard = ({ title, titleChildren, children, onCopy }: AiCardProps): JSX.Element => {
    return (
        <Card>
            <div style={{ display: 'flex', gap: '16px' }}>
                <SparkleRegular fontSize={40} style={{ flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                    <CardHeader
                        header={
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
                    {children}
                </div>
            </div>
        </Card>
    );
};
