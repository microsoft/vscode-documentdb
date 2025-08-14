/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { McpServerService } from '../../services/McpServerService';

/**
 * Command to link/start the MCP server with LLM connection
 */
export async function linkMcp(context: IActionContext): Promise<void> {
    context.telemetry.properties.command = 'linkMcp';

    try {
        const mcpService = McpServerService.getInstance();
        
        if (mcpService.isRunning()) {
            const response = await vscode.window.showInformationMessage(
                vscode.l10n.t('MCP server is already running. Would you like to restart it?'),
                vscode.l10n.t('Restart'),
                vscode.l10n.t('Cancel'),
            );

            if (response === vscode.l10n.t('Restart')) {
                await mcpService.stopMcpServer();
                await mcpService.startMcpServer(context);
            }
        } else {
            await mcpService.startMcpServer(context);
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(
            vscode.l10n.t('Failed to link MCP server: {error}', { error: errorMessage }),
        );
        throw error;
    }
}