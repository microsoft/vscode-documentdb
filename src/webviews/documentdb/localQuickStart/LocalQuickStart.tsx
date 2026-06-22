/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Spinner, Text } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { type JSX, useEffect, useState } from 'react';
import { useTrpcClient } from '../../_integration/useTrpcClient';
import { type DockerStatusResult } from './localQuickStartRouter';

/**
 * Local Quick Start webview entry (WI-2 scaffold).
 *
 * WI-3 (Review & Start) and WI-4 (staged progress + success) flesh out the UI.
 * For now this verifies the plumbing by loading the Docker readiness status.
 */
export const LocalQuickStart = (): JSX.Element => {
    const { trpcClient } = useTrpcClient();
    const [status, setStatus] = useState<DockerStatusResult | undefined>(undefined);
    const [loadError, setLoadError] = useState<string | undefined>(undefined);

    useEffect(() => {
        void trpcClient.localQuickStart.getDockerStatus
            .query()
            .then(setStatus)
            .catch((error: unknown) => setLoadError(error instanceof Error ? error.message : String(error)));
    }, [trpcClient]);

    if (loadError) {
        return <Text>{l10n.t('Failed to read Docker status: {0}', loadError)}</Text>;
    }

    if (!status) {
        return <Spinner label={l10n.t('Checking Docker…')} />;
    }

    return (
        <div style={{ padding: 16 }}>
            <Text as="h2" size={600} weight="semibold">
                {l10n.t('DocumentDB Local - Quick Start')}
            </Text>
            <p>
                {status.readiness.cliInstalled && status.readiness.daemonReachable
                    ? l10n.t('Docker is ready.')
                    : l10n.t('Docker is not ready.')}
            </p>
        </div>
    );
};
