/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomBytes } from 'crypto';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { startMcpHttpServer, type McpTool, type McpToolResult, type RunningMcpServer } from './mcpHttpServer';

const TOKEN_SECRET = 'documentdb.wishingWell.agentToken';
const ENABLED_STATE = 'documentdb.wishingWell.agentAccessEnabled';
const PORT_STATE = 'documentdb.wishingWell.agentAccessPort';
/** A stable port keeps agent configs valid across restarts; a free one is used when it is taken. */
const DEFAULT_PORT = 47017;
const SERVER_NAME = 'documentdb-wishing-well';

export interface AgentToolset {
    readonly tools: readonly McpTool[];
    readonly instructions: string;
    callTool(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<McpToolResult>;
}

/**
 * Lets agents outside VS Code (Claude Code, Copilot CLI, any MCP client) make wishes. Off until the
 * user turns it on, then restored on every start until they turn it off.
 */
export class WishingWellAgentAccess implements vscode.Disposable {
    private server: RunningMcpServer | undefined;
    private starting: Promise<RunningMcpServer> | undefined;

    constructor(private readonly toolset: AgentToolset) {}

    public get isRunning(): boolean {
        return this.server !== undefined;
    }

    public async restore(): Promise<void> {
        if (ext.context.globalState.get<boolean>(ENABLED_STATE) === true) {
            await this.start().catch((error: unknown) => {
                ext.outputChannel.warn(
                    `[Wishing Well] Agent access could not start: ${error instanceof Error ? error.message : String(error)}`,
                );
            });
        }
    }

    public async enable(): Promise<void> {
        await this.start();
        await ext.context.globalState.update(ENABLED_STATE, true);
        await this.showConnectionInfo();
    }

    public async disable(): Promise<void> {
        await ext.context.globalState.update(ENABLED_STATE, false);
        await this.stop();
        void vscode.window.showInformationMessage(vscode.l10n.t('Agents can no longer make wishes.'));
    }

    public async showConnectionInfo(): Promise<void> {
        const server = await this.start();
        const token = await this.token();

        type Choice = vscode.QuickPickItem & { readonly run: () => Promise<void> };
        const copy =
            (text: string, what: string): (() => Promise<void>) =>
            async () => {
                await vscode.env.clipboard.writeText(text);
                void vscode.window.showInformationMessage(
                    vscode.l10n.t('Copied {0}. It contains your access token.', what),
                );
            };

        const claudeCommand = `claude mcp add --transport http ${SERVER_NAME} ${server.url} --header "Authorization: Bearer ${token}"`;
        const jsonConfig = JSON.stringify(
            {
                mcpServers: {
                    [SERVER_NAME]: { type: 'http', url: server.url, headers: { Authorization: `Bearer ${token}` } },
                },
            },
            undefined,
            2,
        );

        const choices: Choice[] = [
            {
                label: vscode.l10n.t('Copy the Claude Code command'),
                detail: `claude mcp add --transport http ${SERVER_NAME} ${server.url} …`,
                run: copy(claudeCommand, vscode.l10n.t('the Claude Code command')),
            },
            {
                label: vscode.l10n.t('Copy the MCP configuration (JSON)'),
                detail: vscode.l10n.t('For Copilot CLI, Cursor, Claude Desktop and other MCP clients'),
                run: copy(jsonConfig, vscode.l10n.t('the MCP configuration')),
            },
            {
                label: vscode.l10n.t('Issue a new access token'),
                detail: vscode.l10n.t('Agents using the old token lose access.'),
                run: async () => {
                    await ext.context.secrets.store(TOKEN_SECRET, newToken());
                    await this.stop();
                    await this.showConnectionInfo();
                },
            },
            {
                label: vscode.l10n.t('Turn off agent access'),
                run: () => this.disable(),
            },
        ];

        const picked = await vscode.window.showQuickPick(choices, {
            title: vscode.l10n.t('Agents can make wishes at {0}', server.url),
            placeHolder: vscode.l10n.t('Connect an agent to the Wishing Well'),
        });
        await picked?.run();
    }

    public dispose(): void {
        void this.stop();
    }

    private async start(): Promise<RunningMcpServer> {
        if (this.server) {
            return this.server;
        }
        this.starting ??= (async () => {
            const preferredPort = ext.context.globalState.get<number>(PORT_STATE) ?? DEFAULT_PORT;
            const server = await startMcpHttpServer(
                {
                    name: SERVER_NAME,
                    version: extensionVersion(),
                    instructions: this.toolset.instructions,
                    token: await this.token(),
                    tools: this.toolset.tools,
                    callTool: (name, args, signal) => this.toolset.callTool(name, args, signal),
                    log: (message) => ext.outputChannel.warn(`[Wishing Well] ${message}`),
                },
                preferredPort,
            );
            await ext.context.globalState.update(PORT_STATE, server.port);
            ext.outputChannel.info(`[Wishing Well] Agent access listening on ${server.url}`);
            this.server = server;
            return server;
        })().finally(() => {
            this.starting = undefined;
        });
        return this.starting;
    }

    private async stop(): Promise<void> {
        const server = this.server;
        this.server = undefined;
        await server?.close();
    }

    private async token(): Promise<string> {
        const stored = await ext.context.secrets.get(TOKEN_SECRET);
        if (stored) {
            return stored;
        }
        const created = newToken();
        await ext.context.secrets.store(TOKEN_SECRET, created);
        return created;
    }
}

function extensionVersion(): string {
    const version = (ext.context.extension.packageJSON as { version?: unknown }).version;
    return typeof version === 'string' ? version : '0.0.0';
}

function newToken(): string {
    return randomBytes(32).toString('base64url');
}
