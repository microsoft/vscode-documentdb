/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { type Dispatch, type RefObject, type SetStateAction, useCallback, useRef, useState } from 'react';
import {
    type ConnectionRecoveryAction,
    type ConnectionRecoveryRequest,
    type ConnectionRecoveryResponse,
    type ConnectionUnavailableDetails,
    type ConnectionUnavailableResponse,
} from '../_integration/connectionUnavailable';

interface BoundViewRecoveryOptions {
    recovery: {
        mutate(input: ConnectionRecoveryRequest): Promise<ConnectionUnavailableResponse | ConnectionRecoveryResponse>;
    };
    common: {
        explainOperationFailure: {
            query(input: { message: string }): Promise<string | null>;
        };
        reportEvent: {
            mutate(input: {
                eventName: string;
                properties?: Record<string, string>;
                measurements?: Record<string, number>;
            }): Promise<unknown>;
        };
        displayErrorMessage: {
            mutate(input: { message: string; modal: false; cause: string }): Promise<unknown>;
        };
    };
    onShowUnavailable: () => void;
    resetRecoveringOnUnavailable?: boolean;
    advanceRevisionAfterRecovery?: boolean;
}

export function explainRecoveryFailure(
    common: BoundViewRecoveryOptions['common'],
    cause: string,
): Promise<string | null> {
    return common.explainOperationFailure.query({ message: cause }).catch(() => {
        void common.reportEvent.mutate({ eventName: 'explainOperationFailureFailed' }).catch(() => {
            console.debug('Failed to report an explanation request failure');
        });
        return null;
    });
}

interface BoundViewRecovery {
    unavailable: ConnectionUnavailableDetails | undefined;
    setUnavailable: Dispatch<SetStateAction<ConnectionUnavailableDetails | undefined>>;
    unavailableRef: RefObject<ConnectionUnavailableDetails | undefined>;
    revisionRef: RefObject<number>;
    disposedRef: RefObject<boolean>;
    recovering: boolean;
    recoveryAnnouncement: string | undefined;
    showUnavailable(failure: ConnectionUnavailableDetails): void;
    isOperationCurrent(revision: number): boolean;
    handleUnavailableAction(action: ConnectionRecoveryAction): void;
}

export function useBoundViewRecovery({
    recovery,
    common,
    onShowUnavailable,
    resetRecoveringOnUnavailable = false,
    advanceRevisionAfterRecovery = false,
}: BoundViewRecoveryOptions): BoundViewRecovery {
    // Dismissing the dialog clears only its render state. The ref still blocks submissions.
    const [unavailable, setUnavailable] = useState<ConnectionUnavailableDetails>();
    const unavailableRef = useRef<ConnectionUnavailableDetails | undefined>(undefined);
    const revisionRef = useRef(0);
    const disposedRef = useRef(false);
    const [recovering, setRecovering] = useState(false);
    const [recoveryAnnouncement, setRecoveryAnnouncement] = useState<string>();

    const showUnavailable = useCallback(
        (failure: ConnectionUnavailableDetails): void => {
            revisionRef.current += 1;
            unavailableRef.current = failure;
            setUnavailable(failure);
            setRecoveryAnnouncement(undefined);
            if (resetRecoveringOnUnavailable) {
                setRecovering(false);
            }
            onShowUnavailable();
        },
        [onShowUnavailable, resetRecoveringOnUnavailable],
    );

    const isOperationCurrent = useCallback(
        (revision: number): boolean =>
            !disposedRef.current && revision === revisionRef.current && unavailableRef.current === undefined,
        [],
    );

    const handleUnavailableAction = useCallback(
        (action: ConnectionRecoveryAction): void => {
            const current = unavailableRef.current;
            if (!current || recovering) {
                return;
            }

            const revision = ++revisionRef.current;
            setRecovering(true);
            void recovery
                .mutate({ action })
                .then((response) => {
                    if (disposedRef.current || revision !== revisionRef.current || action === 'close') {
                        return;
                    }
                    if ('unavailable' in response) {
                        unavailableRef.current = response.unavailable;
                        setUnavailable(response.unavailable);
                        return;
                    }
                    if (advanceRevisionAfterRecovery) {
                        revisionRef.current += 1;
                    }
                    unavailableRef.current = undefined;
                    setUnavailable(undefined);
                    setRecoveryAnnouncement(response.recovered.text);
                })
                .catch(async (error: unknown) => {
                    if (disposedRef.current || revision !== revisionRef.current) {
                        return;
                    }
                    const cause = error instanceof Error ? error.message : String(error);
                    const explained = await explainRecoveryFailure(common, cause);
                    if (!disposedRef.current && revision === revisionRef.current) {
                        void common.displayErrorMessage.mutate({
                            message: explained ?? l10n.t('Unable to recover the connection'),
                            modal: false,
                            cause,
                        });
                    }
                })
                .finally(() => {
                    if (!disposedRef.current && (!resetRecoveringOnUnavailable || revision === revisionRef.current)) {
                        setRecovering(false);
                    }
                });
        },
        [advanceRevisionAfterRecovery, common, recovering, recovery, resetRecoveringOnUnavailable],
    );

    return {
        unavailable,
        setUnavailable,
        unavailableRef,
        revisionRef,
        disposedRef,
        recovering,
        recoveryAnnouncement,
        showUnavailable,
        isOperationCurrent,
        handleUnavailableAction,
    };
}
