/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    DialogTrigger,
} from '@fluentui/react-components';
import { DismissRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useId, useState, type JSX, type ReactNode } from 'react';
import {
    type ConnectionRecoveryAction,
    type ConnectionUnavailableDetails,
} from '../_integration/connectionUnavailable';
import { useTrpcClient } from '../_integration/useTrpcClient';
import './DisconnectedOverlay.scss';

interface DisconnectedOverlayProps {
    readonly unavailable?: ConnectionUnavailableDetails;
    readonly onAction: (action: ConnectionRecoveryAction) => void;
    readonly onDismiss: () => void;
    readonly recovering?: boolean;
    readonly warnOnClose?: boolean;
    readonly children: ReactNode;
}

export function DisconnectedOverlay({
    unavailable,
    onAction,
    onDismiss,
    recovering,
    warnOnClose,
    children,
}: DisconnectedOverlayProps): JSX.Element {
    const descriptionId = useId();
    const disconnected = unavailable !== undefined;
    const trpcClient = useTrpcClient();
    const [confirming, setConfirming] = useState(false);
    const [confirmationFailed, setConfirmationFailed] = useState(false);
    const closeView = async (): Promise<void> => {
        if (recovering || confirming) {
            return;
        }
        setConfirming(true);
        setConfirmationFailed(false);
        try {
            const { confirmed } = await trpcClient.common.confirm.mutate({
                message: l10n.t('Close this view?'),
                detail: warnOnClose
                    ? l10n.t('Closing this view discards unsaved changes.')
                    : l10n.t('Dismiss the connection dialog instead if you need to copy anything from the view.'),
                confirmLabel: l10n.t('Close view'),
            });
            if (confirmed) {
                onAction('close');
            }
        } catch {
            setConfirmationFailed(true);
        } finally {
            setConfirming(false);
        }
    };

    return (
        <>
            <div className="disconnectedOverlayBackground" inert={disconnected}>
                {children}
            </div>
            {unavailable && (
                <Dialog
                    open={disconnected}
                    modalType="modal"
                    inertTrapFocus
                    onOpenChange={(_event, data) => {
                        if (!data.open && data.type === 'triggerClick' && !confirming && !recovering) {
                            setConfirmationFailed(false);
                            onDismiss();
                        }
                    }}
                >
                    <DialogSurface className="disconnectedOverlay" aria-describedby={descriptionId}>
                        <DialogBody>
                            <DialogTitle
                                className="disconnectedOverlayTitle"
                                action={
                                    <DialogTrigger action="close" disableButtonEnhancement>
                                        <Button
                                            appearance="subtle"
                                            icon={<DismissRegular />}
                                            aria-label={l10n.t('Dismiss dialog to copy view contents')}
                                            disabledFocusable={confirming || recovering}
                                        />
                                    </DialogTrigger>
                                }
                            >
                                {unavailable.title}
                            </DialogTitle>
                            <DialogContent id={descriptionId} className="disconnectedOverlayDetail">
                                <p>{unavailable.detail}</p>
                                {warnOnClose && <p>{l10n.t('Closing this view discards unsaved changes.')}</p>}
                                {confirmationFailed && (
                                    <p role="alert">{l10n.t('Unable to confirm closing the view. Try again.')}</p>
                                )}
                            </DialogContent>
                            <DialogActions fluid className="disconnectedOverlayActions">
                                {unavailable.action !== 'close' && (
                                    <Button
                                        appearance="primary"
                                        disabledFocusable={recovering || confirming}
                                        onClick={() => {
                                            if (!recovering && !confirming) {
                                                onAction(unavailable.action);
                                            }
                                        }}
                                    >
                                        {l10n.t('Retry')}
                                    </Button>
                                )}
                                <Button disabledFocusable={recovering || confirming} onClick={() => void closeView()}>
                                    {l10n.t('Close view')}
                                </Button>
                            </DialogActions>
                        </DialogBody>
                    </DialogSurface>
                </Dialog>
            )}
        </>
    );
}
