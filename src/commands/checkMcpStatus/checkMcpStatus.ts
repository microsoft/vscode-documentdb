/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { McpService } from '../../services/McpService';

export async function checkMcpStatus(context: IActionContext): Promise<void> {
    const mcpService = McpService.getInstance();
    const status = await mcpService.getConnectionStatus();
    
    context.telemetry.properties.mcpServerRunning = String(status.serverRunning);
    context.telemetry.properties.mcpConnected = String(status.connected);

    let message: string;
    let messageType: 'info' | 'warning' = 'info';

    if (status.serverRunning) {
        if (status.connected) {
            message = l10n.t(
                'DocumentDB MCP Server is running and connected to: {uri}',
                { uri: status.connectionUri ?? 'unknown' }
            );
        } else {
            message = l10n.t('DocumentDB MCP Server is running but not connected to any database.');
            messageType = 'warning';
        }
    } else {
        message = status.error 
            ? l10n.t('DocumentDB MCP Server is not running: {error}', { error: status.error })
            : l10n.t('DocumentDB MCP Server is not running (documentdb-mcp module not available).');
        messageType = 'warning';
    }

    // Show appropriate message based on status
    switch (messageType) {
        case 'info':
            void vscode.window.showInformationMessage(message);
            break;
        case 'warning':
            void vscode.window.showWarningMessage(message);
            break;
    }

    // Also log detailed status to output channel
    const detailedInfo = [
        `DocumentDB MCP Server Status:`,
        `  Server Running: ${status.serverRunning}`,
        `  Connected: ${status.connected}`,
        `  Connection URI: ${status.connectionUri ?? 'none'}`,
        status.error ? `  Error: ${status.error}` : null
    ].filter(Boolean).join('\n');

    console.log(detailedInfo);
}