/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { McpService } from '../../services/mcpService';
import { type ClusterItemBase } from '../../tree/documentdb/ClusterItemBase';

/**
 * Command to set the MCP connection context from a tree item
 */
export async function setMcpConnection(_context: IActionContext, treeItem: ClusterItemBase): Promise<void> {
    try {
        if (!McpService.isActive()) {
            void vscode.window.showWarningMessage(
                l10n.t('MCP server is not running. Start it first.')
            );
            return;
        }

        // Get the cluster ID from the tree item
        const clusterId = treeItem.id;
        
        await McpService.setConnectionFromStorage(clusterId);
        
        const context_info = McpService.getConnectionContext();
        void vscode.window.showInformationMessage(
            l10n.t('MCP connection set to cluster: {0}', 
                context_info.databaseName || 'default database'
            )
        );
        
    } catch (error) {
        const message = l10n.t('Failed to set MCP connection: {0}', 
            error instanceof Error ? error.message : String(error)
        );
        
        void vscode.window.showErrorMessage(message);
        throw error;
    }
}

/**
 * Command to switch MCP database context
 */
export async function switchMcpDatabase(_context: IActionContext): Promise<void> {
    try {
        if (!McpService.isActive()) {
            void vscode.window.showWarningMessage(
                l10n.t('MCP server is not running. Start it first.')
            );
            return;
        }

        const currentContext = McpService.getConnectionContext();
        if (!currentContext.connectionString) {
            void vscode.window.showWarningMessage(
                l10n.t('No active connection in MCP. Set a connection first.')
            );
            return;
        }

        const databaseName = await vscode.window.showInputBox({
            prompt: l10n.t('Enter database name'),
            value: currentContext.databaseName || '',
            validateInput: (value) => {
                if (!value.trim()) {
                    return l10n.t('Database name cannot be empty');
                }
                return undefined;
            },
        });

        if (!databaseName) {
            return; // User cancelled
        }

        await McpService.switchDatabase(databaseName);
        
        void vscode.window.showInformationMessage(
            l10n.t('MCP database switched to: {0}', databaseName)
        );
        
    } catch (error) {
        const message = l10n.t('Failed to switch MCP database: {0}', 
            error instanceof Error ? error.message : String(error)
        );
        
        void vscode.window.showErrorMessage(message);
        throw error;
    }
}

/**
 * Command to switch MCP collection context
 */
export async function switchMcpCollection(_context: IActionContext): Promise<void> {
    try {
        if (!McpService.isActive()) {
            void vscode.window.showWarningMessage(
                l10n.t('MCP server is not running. Start it first.')
            );
            return;
        }

        const currentContext = McpService.getConnectionContext();
        if (!currentContext.connectionString) {
            void vscode.window.showWarningMessage(
                l10n.t('No active connection in MCP. Set a connection first.')
            );
            return;
        }

        if (!currentContext.databaseName) {
            void vscode.window.showWarningMessage(
                l10n.t('No active database in MCP. Set a database first.')
            );
            return;
        }

        const collectionName = await vscode.window.showInputBox({
            prompt: l10n.t('Enter collection name'),
            value: currentContext.collectionName || '',
            validateInput: (value) => {
                if (!value.trim()) {
                    return l10n.t('Collection name cannot be empty');
                }
                return undefined;
            },
        });

        if (!collectionName) {
            return; // User cancelled
        }

        await McpService.switchCollection(collectionName);
        
        void vscode.window.showInformationMessage(
            l10n.t('MCP collection switched to: {0}', collectionName)
        );
        
    } catch (error) {
        const message = l10n.t('Failed to switch MCP collection: {0}', 
            error instanceof Error ? error.message : String(error)
        );
        
        void vscode.window.showErrorMessage(message);
        throw error;
    }
}