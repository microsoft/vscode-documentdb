/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Card, Text } from '@fluentui/react-components';
import { DocumentArrowLeftRegular, EyeRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import * as React from 'react';
import './QuickActions.scss';

interface QuickActionsProps {
    stageState: 1 | 2 | 3;
}

export const QuickActions: React.FC<QuickActionsProps> = ({ stageState }) => {
    if (stageState < 2) {
        return null;
    }

    return (
        <Card className="quickActionsCard">
            <Text weight="semibold" size={400} className="quickActionsTitle">
                {l10n.t('Quick Actions')}
            </Text>
            <div className="quickActionsButtons">
                <Button appearance="secondary" size="small" icon={<DocumentArrowLeftRegular />}>
                    {l10n.t('Export Optimization Opportunities')}
                </Button>
                <Button appearance="secondary" size="small" icon={<DocumentArrowLeftRegular />}>
                    {l10n.t('Export Execution Plan Details')}
                </Button>
                <Button appearance="secondary" size="small" icon={<EyeRegular />}>
                    {l10n.t('View Raw Explain Output')}
                </Button>
            </div>
        </Card>
    );
};
