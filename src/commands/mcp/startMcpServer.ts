/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { McpService } from '../../services/mcpService';

/**
 * Command to start the MCP server for DocumentDB
 */
export async function startMcpServer(_context: IActionContext): Promise<void> {
    try {
        if (McpService.isActive()) {
            void vscode.window.showInformationMessage(
                l10n.t('MCP server is already running')
            );
            return;
        }

        await McpService.start();
        
        void vscode.window.showInformationMessage(
            l10n.t('DocumentDB MCP server started successfully')
        );
        
        // Update VS Code context to reflect MCP server state
        await vscode.commands.executeCommand('setContext', 'documentdb.mcpServerActive', true);
        
    } catch (error) {
        const message = l10n.t('Failed to start MCP server: {0}', 
            error instanceof Error ? error.message : String(error)
        );
        
        void vscode.window.showErrorMessage(message);
        throw error;
    }
}