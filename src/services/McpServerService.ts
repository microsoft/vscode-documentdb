/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';

/**
 * Configuration interface for MCP server
 */
export interface McpServerConfig {
    azureOpenAiKey?: string;
    azureOpenAiEndpoint?: string;
    isEnabled: boolean;
}

/**
 * Service for managing MCP (Model Context Protocol) server functionality
 */
export class McpServerService {
    private static instance: McpServerService;
    private isServerRunning = false;
    private config: McpServerConfig = { isEnabled: false };

    private constructor() {
        this.loadConfiguration();
    }

    public static getInstance(): McpServerService {
        if (!McpServerService.instance) {
            McpServerService.instance = new McpServerService();
        }
        return McpServerService.instance;
    }

    /**
     * Load MCP configuration from VS Code settings
     */
    private loadConfiguration(): void {
        const config = vscode.workspace.getConfiguration('documentDB.mcp');
        this.config = {
            azureOpenAiKey: config.get<string>('azureOpenAiKey'),
            azureOpenAiEndpoint: config.get<string>('azureOpenAiEndpoint'),
            isEnabled: config.get<boolean>('enabled', false),
        };
    }

    /**
     * Start the MCP server with LLM connection
     */
    public async startMcpServer(_context: IActionContext): Promise<void> {
        if (this.isServerRunning) {
            ext.outputChannel.appendLine(vscode.l10n.t('MCP server is already running'));
            return;
        }

        this.loadConfiguration();

        if (!this.config.azureOpenAiKey) {
            const shouldConfigure = await vscode.window.showWarningMessage(
                vscode.l10n.t('Azure OpenAI key is not configured. Would you like to configure it now?'),
                vscode.l10n.t('Configure'),
                vscode.l10n.t('Cancel'),
            );

            if (shouldConfigure === vscode.l10n.t('Configure')) {
                await this.configureAzureOpenAi();
            } else {
                return;
            }
        }

        try {
            ext.outputChannel.appendLine(vscode.l10n.t('Starting MCP server...'));
            
            // For MVP, we'll simulate server startup
            await this.simulateServerStartup();
            
            this.isServerRunning = true;
            ext.outputChannel.appendLine(vscode.l10n.t('MCP server started successfully'));
            
            void vscode.window.showInformationMessage(
                vscode.l10n.t('MCP server is now running and connected to Azure OpenAI'),
            );
        } catch (error) {
            ext.outputChannel.appendLine(
                vscode.l10n.t('Failed to start MCP server: {error}', { 
                    error: error instanceof Error ? error.message : String(error) 
                }),
            );
            throw error;
        }
    }

    /**
     * Stop the MCP server
     */
    public async stopMcpServer(): Promise<void> {
        if (!this.isServerRunning) {
            return;
        }

        ext.outputChannel.appendLine(vscode.l10n.t('Stopping MCP server...'));
        this.isServerRunning = false;
        ext.outputChannel.appendLine(vscode.l10n.t('MCP server stopped'));
    }

    /**
     * Check if MCP server is running
     */
    public isRunning(): boolean {
        return this.isServerRunning;
    }

    /**
     * Configure Azure OpenAI settings
     */
    private async configureAzureOpenAi(): Promise<void> {
        const apiKey = await vscode.window.showInputBox({
            prompt: vscode.l10n.t('Enter your Azure OpenAI API key'),
            password: true,
            ignoreFocusOut: true,
        });

        if (!apiKey) {
            return;
        }

        const endpoint = await vscode.window.showInputBox({
            prompt: vscode.l10n.t('Enter your Azure OpenAI endpoint (optional)'),
            placeHolder: 'https://your-resource.openai.azure.com',
            ignoreFocusOut: true,
        });

        const config = vscode.workspace.getConfiguration('documentDB.mcp');
        await config.update('azureOpenAiKey', apiKey, vscode.ConfigurationTarget.Global);
        
        if (endpoint) {
            await config.update('azureOpenAiEndpoint', endpoint, vscode.ConfigurationTarget.Global);
        }

        await config.update('enabled', true, vscode.ConfigurationTarget.Global);

        this.loadConfiguration();

        void vscode.window.showInformationMessage(
            vscode.l10n.t('Azure OpenAI configuration saved successfully'),
        );
    }

    /**
     * Simulate server startup for MVP
     */
    private async simulateServerStartup(): Promise<void> {
        // Simulate startup delay
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // In a real implementation, this would:
        // 1. Start the actual MCP server process
        // 2. Initialize connection to Azure OpenAI
        // 3. Set up message handling
        
        ext.outputChannel.appendLine(vscode.l10n.t('Connecting to Azure OpenAI...'));
        await new Promise(resolve => setTimeout(resolve, 500));
        ext.outputChannel.appendLine(vscode.l10n.t('Connected to Azure OpenAI'));
    }

    /**
     * Handle MCP chat request for a cluster
     */
    public async handleMcpChat(clusterId: string, _context: IActionContext): Promise<string[]> {
        if (!this.isServerRunning) {
            throw new Error(vscode.l10n.t('MCP server is not running. Please start it first using the "Link MCP" command.'));
        }

        ext.outputChannel.appendLine(
            vscode.l10n.t('Processing MCP chat request for cluster: {clusterId}', { clusterId }),
        );

        // For MVP, we'll return hardcoded collection names
        // In a real implementation, this would:
        // 1. Connect to the actual cluster
        // 2. Query for collections
        // 3. Use LLM to format the response
        
        const mockCollections = [
            'users',
            'products', 
            'orders',
            'categories',
            'reviews'
        ];

        ext.outputChannel.appendLine(
            vscode.l10n.t('Found {count} collections', { count: mockCollections.length.toString() }),
        );

        return mockCollections;
    }
}