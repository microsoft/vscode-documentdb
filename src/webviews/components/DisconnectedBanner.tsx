/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { type JSX, type Ref } from 'react';
import {
    type ConnectionRecoveryAction,
    type ConnectionUnavailableDetails,
} from '../_integration/connectionUnavailable';
import { Announcer } from './accessibility';
import { MessageBlock } from './MessageBlock';

interface DisconnectedBannerProps {
    readonly unavailable: ConnectionUnavailableDetails;
    readonly onAction: (action: ConnectionRecoveryAction) => void;
    readonly recovering?: boolean;
    readonly actionRef?: Ref<HTMLButtonElement>;
}

function actionLabel(action: ConnectionRecoveryAction): string {
    switch (action) {
        case 'reconnect':
            return l10n.t('Reconnect');
        case 'signInAgain':
            return l10n.t('Retry sign-in');
        case 'updateCredentials':
            return l10n.t('Update credentials…');
        case 'close':
            return l10n.t('Close tab');
    }
}

export function DisconnectedBanner({
    unavailable: { reason, text, action },
    onAction,
    recovering,
    actionRef,
}: DisconnectedBannerProps): JSX.Element {
    return (
        <>
            <MessageBlock
                intent="warning"
                actions={
                    <Button ref={actionRef} disabled={recovering} onClick={() => onAction(action)}>
                        {actionLabel(action)}
                    </Button>
                }
            >
                {text}
            </MessageBlock>
            <Announcer key={`${reason}:${text}`} when message={text} />
        </>
    );
}
