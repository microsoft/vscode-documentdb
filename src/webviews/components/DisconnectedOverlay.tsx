/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { useId, type JSX, type ReactNode } from 'react';
import {
    type ConnectionRecoveryAction,
    type ConnectionUnavailableDetails,
} from '../_integration/connectionUnavailable';
import './DisconnectedOverlay.scss';

interface DisconnectedOverlayProps {
    readonly unavailable?: ConnectionUnavailableDetails;
    readonly onAction: (action: ConnectionRecoveryAction) => void;
    readonly recovering?: boolean;
    readonly warnOnClose?: boolean;
    readonly children: ReactNode;
}

export function DisconnectedOverlay({
    unavailable,
    onAction,
    recovering,
    warnOnClose,
    children,
}: DisconnectedOverlayProps): JSX.Element {
    const descriptionId = useId();
    const disconnected = unavailable !== undefined;

    return (
        <>
            <div className="disconnectedOverlayBackground" inert={disconnected}>
                {children}
            </div>
            {unavailable && (
                <Dialog open={disconnected} modalType="modal" inertTrapFocus>
                    <DialogSurface className="disconnectedOverlay" aria-describedby={descriptionId}>
                        <DialogBody>
                            <DialogTitle className="disconnectedOverlayTitle">{unavailable.title}</DialogTitle>
                            <DialogContent id={descriptionId} className="disconnectedOverlayDetail">
                                <p>{unavailable.detail}</p>
                                {warnOnClose && <p>{l10n.t('Closing this view discards unsaved changes.')}</p>}
                            </DialogContent>
                            <DialogActions fluid className="disconnectedOverlayActions">
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
                                        {l10n.t('Retry')}
                                    </Button>
                                )}
                                <Button onClick={() => onAction('close')}>{l10n.t('Close view')}</Button>
                            </DialogActions>
                        </DialogBody>
                    </DialogSurface>
                </Dialog>
            )}
        </>
    );
}
