/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { useEffect, useId, useRef, type JSX, type ReactNode } from 'react';
import {
    type ConnectionRecoveryAction,
    type ConnectionUnavailableDetails,
} from '../_integration/connectionUnavailable';
import { Announcer } from './accessibility';
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
            return l10n.t('Close');
    }
}

export function DisconnectedOverlay({
    unavailable,
    onAction,
    recovering,
    children,
}: DisconnectedOverlayProps): JSX.Element {
    const textId = useId();
    const firstAction = useRef<HTMLButtonElement>(null);
    const disconnected = unavailable !== undefined;
    useEffect(() => {
        if (disconnected) {
            firstAction.current?.focus();
        }
    }, [disconnected]);

    return (
        <>
            <div className="disconnectedOverlayBackground" inert={disconnected}>
                {children}
            </div>
            {unavailable && (
                <section className="disconnectedOverlay" aria-labelledby={textId}>
                    <p id={textId}>{unavailable.text}</p>
                    <div className="disconnectedOverlayActions">
                        {unavailable.action !== 'close' && (
                            <Button
                                ref={firstAction}
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
                        <Button
                            ref={unavailable.action === 'close' ? firstAction : undefined}
                            onClick={() => onAction('close')}
                        >
                            {actionLabel('close')}
                        </Button>
                    </div>
                    <Announcer key={`${unavailable.reason}:${unavailable.text}`} when message={unavailable.text} />
                </section>
            )}
        </>
    );
}
