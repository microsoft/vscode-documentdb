/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Dialog, DialogActions, DialogBody, DialogSurface, DialogTitle } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { type JSX, type ReactNode } from 'react';
import {
    type ConnectionRecoveryAction,
    type ConnectionUnavailableDetails,
} from '../_integration/connectionUnavailable';
import './DisconnectedOverlay.scss';

interface DisconnectedOverlayProps {
    readonly unavailable?: ConnectionUnavailableDetails;
    readonly onAction: (action: ConnectionRecoveryAction) => void;
    readonly recovering?: boolean;
    readonly children: ReactNode;
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
            return l10n.t('Close view');
    }
}

export function DisconnectedOverlay({
    unavailable,
    onAction,
    recovering,
    children,
}: DisconnectedOverlayProps): JSX.Element {
    const disconnected = unavailable !== undefined;

    return (
        <>
            <div className="disconnectedOverlayBackground" inert={disconnected}>
                {children}
            </div>
            {unavailable && (
                <Dialog open={disconnected} modalType="modal" inertTrapFocus>
                    <DialogSurface className="disconnectedOverlay">
                        <DialogBody>
                            <DialogTitle className="disconnectedOverlayTitle">{unavailable.text}</DialogTitle>
                            <DialogActions className="disconnectedOverlayActions">
                                {unavailable.action !== 'close' && (
                                    <Button
                                        appearance="primary"
                                        disabledFocusable={recovering}
                                        onClick={() => {
                                            if (!recovering) {
                                                onAction(unavailable.action);
                                            }
                                        }}
                                    >
                                        {actionLabel(unavailable.action)}
                                    </Button>
                                )}
                                <Button onClick={() => onAction('close')}>{actionLabel('close')}</Button>
                            </DialogActions>
                        </DialogBody>
                    </DialogSurface>
                </Dialog>
            )}
        </>
    );
}
