/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ClustersClient, type ConnectionBinding } from '../../documentdb/ClustersClient';
import { isRetiredConnectionBinding } from '../../documentdb/connectionBindingRetirement';
import { ConnectionUnavailableError } from '../../documentdb/ConnectionUnavailableError';
import { runWithClient } from '../../documentdb/runWithClient';
import {
    type ConnectionRecoveryRequest,
    type ConnectionRecoveryResponse,
    type ConnectionUnavailableResponse,
} from '../_integration/connectionUnavailable';
import { describeUnavailableConnection } from '../_integration/describeUnavailableConnection';

export async function recoverBoundView(
    binding: ConnectionBinding,
    trigger: NonNullable<Parameters<typeof runWithClient>[2]>['trigger'],
    close: () => void,
    { action }: ConnectionRecoveryRequest,
): Promise<ConnectionRecoveryResponse | ConnectionUnavailableResponse> {
    if (action === 'close') {
        close();
        return { recovered: { text: '' } };
    }

    const reason = isRetiredConnectionBinding(binding)
        ? 'credentialsChanged'
        : ClustersClient.getLatchReason(binding.clusterId);
    if (reason) {
        return describeUnavailableConnection(reason);
    }

    try {
        const assertCurrent = guardBoundViewOperation(binding);
        const result = await runWithClient(binding, async () => ({ recovered: { text: l10n.t('Reconnected') } }), {
            trigger,
        });
        if ('unavailable' in result) {
            return describeUnavailableConnection(result.unavailable.reason);
        }
        assertCurrent();
        return result;
    } catch (error) {
        if (error instanceof ConnectionUnavailableError) {
            return describeUnavailableConnection(error.reason);
        }
        throw error;
    }
}

/** Snapshot per operation, not per panel: later operations can use a recovered generation. */
export function guardBoundViewOperation(binding: ConnectionBinding, signal?: AbortSignal): () => void {
    const { clusterId, fingerprint } = binding;
    const epoch = ClustersClient.getEpoch(clusterId);

    return () => {
        if (signal?.aborted) {
            throw new UserCancelledError('staleBoundViewOperation');
        }
        const reason = isRetiredConnectionBinding(binding) ? 'credentialsChanged' : ClustersClient.getLatchReason(clusterId);
        if (reason) {
            throw new ConnectionUnavailableError(reason);
        }
        const current = ClustersClient.getBinding(clusterId);
        if (current && current.fingerprint !== fingerprint) {
            throw new ConnectionUnavailableError('identityChanged');
        }
        if (!current || ClustersClient.getEpoch(clusterId) !== epoch) {
            throw new UserCancelledError('staleBoundViewOperation');
        }
    };
}

/** Best-effort cleanup must neither update a stale view nor replace the original command error. */
export function isBoundViewOperationCurrent(assertCurrent: () => void): boolean {
    try {
        assertCurrent();
        return true;
    } catch (error) {
        if (error instanceof ConnectionUnavailableError || error instanceof UserCancelledError) {
            return false;
        }
        throw error;
    }
}

/** Lets collectors that normally absorb driver errors preserve terminal connection failures. */
export function throwIfBoundViewUnavailable(binding: ConnectionBinding, error: unknown): void {
    const kind = ClustersClient.reportFailure(binding, error);
    switch (kind) {
        case 'signInRequired':
        case 'credentialsRejected':
        case 'credentialsMissing':
        case 'identityChanged':
            throw new ConnectionUnavailableError(kind);
        case 'clientClosed':
            throw new ConnectionUnavailableError('unreachable');
    }
}

/** Preserve procedure success shapes until the shared host mapping lands. */
export async function runBoundViewOperation<T>(
    binding: ConnectionBinding,
    assertCurrent: () => void,
    operation: (client: ClustersClient) => Promise<T>,
    options: NonNullable<Parameters<typeof runWithClient>[2]>,
): Promise<T> {
    const result = await runWithClient(
        binding,
        async (client) => {
            assertCurrent();
            return { value: await operation(client) };
        },
        options,
    );
    if ('unavailable' in result) {
        throw new ConnectionUnavailableError(result.unavailable.reason);
    }
    assertCurrent();
    return result.value;
}
