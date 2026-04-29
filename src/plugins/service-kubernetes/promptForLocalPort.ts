/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { type KubeServiceInfo } from './kubernetesClient';

/**
 * Prompts the user to confirm or change the local port for port-forwarding a ClusterIP service.
 * Returns undefined when the user cancels so callers can abort cleanly.
 */
export async function promptForLocalPort(service: KubeServiceInfo): Promise<number | undefined> {
    const input = await vscode.window.showInputBox({
        title: vscode.l10n.t('Port Forward: {0}', service.displayName),
        prompt: vscode.l10n.t(
            'This ClusterIP service requires port-forwarding. Confirm or change the local port to forward to {0}/{1}:{2}.',
            service.namespace,
            service.serviceName,
            String(service.port),
        ),
        value: String(service.port),
        validateInput: (value: string) => {
            const num = parseInt(value, 10);
            if (isNaN(num) || num < 1 || num > 65535) {
                return vscode.l10n.t('Enter a valid port number (1-65535)');
            }
            return undefined;
        },
    });

    if (input === undefined) {
        return undefined;
    }

    return parseInt(input, 10);
}
