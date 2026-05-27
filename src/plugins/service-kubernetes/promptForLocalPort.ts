/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as net from 'net';
import * as vscode from 'vscode';
import { type KubeServiceInfo } from './kubernetesClient';

type LocalPortStrategy = 'matchRemote' | 'autoSelect';

const KUBERNETES_SETTINGS_SECTION = 'documentDB.serviceDiscovery.kubernetes';
const LOCAL_PORT_STRATEGY_KEY = 'portForward.localPortStrategy';
const LOCAL_PORT_BASE_KEY = 'portForward.localPortBase';
const DEFAULT_LOCAL_PORT_BASE = 27100;
const LOCAL_PORT_SCAN_LIMIT = 100;

/**
 * Prompts the user to confirm or change the local port for port-forwarding a ClusterIP service.
 * Returns undefined when the user cancels so callers can abort cleanly.
 */
export async function promptForLocalPort(service: KubeServiceInfo): Promise<number | undefined> {
    const suggestedLocalPort = await resolveSuggestedLocalPort(service.port);
    const input = await vscode.window.showInputBox({
        title: vscode.l10n.t('Port Forward: {0}', service.displayName),
        prompt: vscode.l10n.t(
            'This ClusterIP service requires port-forwarding. Confirm or change the local port to forward to {0}/{1}:{2}.',
            service.namespace,
            service.serviceName,
            String(service.port),
        ),
        value: String(suggestedLocalPort),
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

async function resolveSuggestedLocalPort(remotePort: number): Promise<number> {
    const strategy = getLocalPortStrategy();
    if (strategy === 'matchRemote') {
        return remotePort;
    }

    return (await findAvailableLocalPort(getLocalPortBase())) ?? remotePort;
}

function getLocalPortStrategy(): LocalPortStrategy {
    const configured = vscode.workspace
        .getConfiguration(KUBERNETES_SETTINGS_SECTION)
        .get<string>(LOCAL_PORT_STRATEGY_KEY, 'matchRemote');

    return configured === 'autoSelect' ? 'autoSelect' : 'matchRemote';
}

function getLocalPortBase(): number {
    const configured = vscode.workspace
        .getConfiguration(KUBERNETES_SETTINGS_SECTION)
        .get<number>(LOCAL_PORT_BASE_KEY, DEFAULT_LOCAL_PORT_BASE);

    if (!Number.isInteger(configured) || configured < 1024 || configured > 65535) {
        return DEFAULT_LOCAL_PORT_BASE;
    }

    return configured;
}

async function findAvailableLocalPort(startPort: number): Promise<number | undefined> {
    const endPort = Math.min(65535, startPort + LOCAL_PORT_SCAN_LIMIT - 1);
    for (let port = startPort; port <= endPort; port++) {
        if (await isLocalPortAvailable(port)) {
            return port;
        }
    }

    return undefined;
}

function isLocalPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        // Advisory only: another process may bind the port before the tunnel starts.
        // PortForwardTunnelManager still handles the final bind-time conflict.
        const server = net.createServer();
        server.once('error', () => {
            resolve(false);
        });
        server.listen(port, '127.0.0.1', () => {
            server.close(() => {
                resolve(true);
            });
        });
    });
}
