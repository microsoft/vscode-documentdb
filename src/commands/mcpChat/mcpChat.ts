/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { McpServerService } from '../../services/McpServerService';
import { type MongoVCoreResourceItem } from '../../tree/azure-resources-view/documentdb/mongo-vcore/MongoVCoreResourceItem';

/**
 * Command to start MCP chat for a vcore cluster
 */
export async function mcpChat(context: IActionContext, node: MongoVCoreResourceItem): Promise<void> {
    context.telemetry.properties.command = 'mcpChat';

    if (!node) {
        throw new Error(vscode.l10n.t('No cluster selected.'));
    }

    try {
        const mcpService = McpServerService.getInstance();
        
        if (!mcpService.isRunning()) {
            const response = await vscode.window.showWarningMessage(
                vscode.l10n.t('MCP server is not running. Would you like to start it first?'),
                vscode.l10n.t('Start MCP Server'),
                vscode.l10n.t('Cancel'),
            );

            if (response === vscode.l10n.t('Start MCP Server')) {
                await mcpService.startMcpServer(context);
            } else {
                return;
            }
        }

        // Show progress while processing
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: vscode.l10n.t('Processing MCP chat request...'),
                cancellable: false,
            },
            async () => {
                const collections = await mcpService.handleMcpChat(node.cluster.id, context);
                
                // For MVP, show collections in a quick pick
                await showCollectionsInQuickPick(collections, node.cluster.name);
            },
        );
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(
            vscode.l10n.t('MCP chat failed: {error}', { error: errorMessage }),
        );
        throw error;
    }
}

/**
 * Show collections in a VS Code quick pick for MVP
 */
async function showCollectionsInQuickPick(collections: string[], clusterName: string): Promise<void> {
    const items = collections.map(collection => ({
        label: collection,
        description: vscode.l10n.t('Collection in {clusterName}', { clusterName }),
    }));

    const selected = await vscode.window.showQuickPick(items, {
        title: vscode.l10n.t('Collections found via MCP chat'),
        placeHolder: vscode.l10n.t('Select a collection to explore'),
        canPickMany: false,
    });

    if (selected) {
        void vscode.window.showInformationMessage(
            vscode.l10n.t('Selected collection: {collection}', { collection: selected.label }),
        );
    }
}