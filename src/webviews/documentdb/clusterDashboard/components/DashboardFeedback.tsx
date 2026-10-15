/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ToolbarButton } from '@fluentui/react-components';
import { EmojiRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';

import { useTrpcClient } from '../../../_integration/useTrpcClient';

export const DashboardFeedback = (): JSX.Element => {
    const trpcClient = useTrpcClient();

    return (
        <ToolbarButton icon={<EmojiRegular />} onClick={() => void trpcClient.common.openFeedback.mutate({})}>
            {l10n.t('Give Feedback')}
        </ToolbarButton>
    );
};
