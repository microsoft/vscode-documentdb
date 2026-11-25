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
/** A stable port keeps agent configs valid across restarts. */
export const DEFAULT_AGENT_PORT = 47017;
const SERVER_NAME = 'documentdb-wishing-well';
const CONNECT_COMMAND = 'vscode-documentdb.command.wishingWell.connectAgent';

export interface AgentToolset {
    readonly tools: readonly McpTool[];
    readonly instructions: string;
    callTool(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<McpToolResult>;
}

/** The port to ask for first: the stored one when it is valid, otherwise the default. */
export function preferredAgentPort(stored: unknown): number {
    return typeof stored === 'number' && Number.isInteger(stored) && stored > 0 && stored <= 65535
        ? stored
        : DEFAULT_AGENT_PORT;
}

export interface AgentPortDecision {
    /** The port to store, when it differs from what is stored. */
    readonly remember?: number;
    /** The preferred port was taken, so copied configs stop working after a restart. */
    readonly temporary: boolean;
}

/** Only the preferred port is remembered: a fallback would break every copied config on the next start. */
export function decideAgentPort(stored: unknown, bound: number): AgentPortDecision {
    if (bound !== preferredAgentPort(stored)) {
        return { temporary: true };
    }
    return stored === bound ? { temporary: false } : { temporary: false, remember: bound };
}

export interface AgentConfigs {
    readonly claudeCommand: string;
    readonly mcpJson: string;
}

export function agentConfigs(url: string, token: string): AgentConfigs {
    return {
        claudeCommand: `claude mcp add --transport http ${SERVER_NAME} ${url} --header "Authorization: Bearer ${token}"`,
        mcpJson: JSON.stringify(
            {
                mcpServers: {
                    [SERVER_NAME]: { type: 'http', url, headers: { Authorization: `Bearer ${token}` } },
                },
            },
            undefined,
            2,
        ),
    };
}

interface Endpoint {
    readonly server: RunningMcpServer;
    readonly preferredPort: number;
    readonly temporary: boolean;
}

/**
 * Lets agents outside VS Code (Claude Code, Copilot CLI, any MCP client) make wishes. Off until the
 * user picks how to connect an agent, then restored on every start until they turn it off.
 */
export class WishingWellAgentAccess implements vscode.Disposable {
    private endpoint: Endpoint | undefined;
    private starting: Promise<Endpoint> | undefined;
    private statusBarItem: vscode.StatusBarItem | undefined;

    constructor(private readonly toolset: AgentToolset) {}

    public get isRunning(): boolean {
        return this.endpoint !== undefined;
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

    /** The Connect an Agent command. Access turns on only once the user picks what to copy. */
    public async enable(): Promise<void> {
        // A restore still starting counts as on, so the user is not offered to turn it on twice.
        await this.starting?.catch(() => undefined);
        if (this.endpoint) {
            await this.showConnectionInfo(this.endpoint);
            return;
        }

        type Choice = vscode.QuickPickItem & { readonly config: keyof AgentConfigs };
        const picked = await vscode.window.showQuickPick<Choice>(
            [
                {
                    label: vscode.l10n.t('Turn on and copy the Claude Code command'),
                    detail: `claude mcp add --transport http ${SERVER_NAME} …`,
                    config: 'claudeCommand',
                },
                {
                    label: vscode.l10n.t('Turn on and copy the MCP JSON (mcpServers)'),
                    detail: jsonChoiceDetail(),
                    config: 'mcpJson',
                },
            ],
            {
                title: vscode.l10n.t('Connect an Agent to the Wishing Well'),
                placeHolder: vscode.l10n.t(
                    'Agent access is off. Picking one turns it on in this window and after restarts, until you turn it off.',
                ),
            },
        );
        if (!picked) {
            return;
        }

        const endpoint = await this.start();
        await ext.context.globalState.update(ENABLED_STATE, true);
        await this.copy(endpoint, picked.config);
    }

    public async disable(): Promise<void> {
        await ext.context.globalState.update(ENABLED_STATE, false);
        await this.stop();
        void vscode.window.showInformationMessage(vscode.l10n.t('Agents can no longer make wishes.'));
    }

    public dispose(): void {
        const item = this.statusBarItem;
        this.statusBarItem = undefined;
        item?.dispose();
        void this.stop();
    }

    private async showConnectionInfo(endpoint: Endpoint): Promise<void> {
        type Choice = vscode.QuickPickItem & { readonly run: () => Promise<void> };
        const choices: Choice[] = [
            {
                label: vscode.l10n.t('Copy the Claude Code command'),
                detail: `claude mcp add --transport http ${SERVER_NAME} ${endpoint.server.url} …`,
                run: () => this.copy(endpoint, 'claudeCommand'),
            },
            {
                label: vscode.l10n.t('Copy the MCP JSON (mcpServers)'),
                detail: jsonChoiceDetail(),
                run: () => this.copy(endpoint, 'mcpJson'),
            },
            {
                label: vscode.l10n.t('Issue a new access token'),
                detail: vscode.l10n.t('Agents using the old token lose access until you copy the config again.'),
                run: async () => {
                    await ext.context.secrets.store(TOKEN_SECRET, newToken());
                    await this.stop();
                    await this.showConnectionInfo(await this.start());
                },
            },
            {
                label: vscode.l10n.t('Turn off agent access'),
                run: () => this.disable(),
            },
        ];

        const picked = await vscode.window.showQuickPick(choices, {
            title: vscode.l10n.t('Agents can make wishes at {0}', endpoint.server.url),
            placeHolder: endpoint.temporary
                ? temporaryAddressNotice(endpoint)
                : vscode.l10n.t('Connect an agent to the Wishing Well'),
        });
        await picked?.run();
    }

    private async copy(endpoint: Endpoint, which: keyof AgentConfigs): Promise<void> {
        await vscode.env.clipboard.writeText(agentConfigs(endpoint.server.url, await this.token())[which]);
        const what =
            which === 'claudeCommand' ? vscode.l10n.t('the Claude Code command') : vscode.l10n.t('the MCP JSON');
        const receipt = [
            vscode.l10n.t('Copied {0}. It contains your access token, so keep it private.', what),
            vscode.l10n.t(
                "Copilot in the Wishing Well sees only field names, but documents an agent reads are sent to the agent's model.",
            ),
            vscode.l10n.t(
                'Keep this VS Code window open while the agent works. To check the setup, ask the agent to list your DocumentDB connections.',
            ),
        ];
        if (endpoint.temporary) {
            receipt.push(temporaryAddressNotice(endpoint));
        }
        void vscode.window.showInformationMessage(receipt.join(' '));
    }

    private async start(): Promise<Endpoint> {
        if (this.endpoint) {
            return this.endpoint;
        }
        this.starting ??= (async () => {
            const stored = ext.context.globalState.get<unknown>(PORT_STATE);
            const preferredPort = preferredAgentPort(stored);
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
            const { remember, temporary } = decideAgentPort(stored, server.port);
            if (remember !== undefined) {
                await ext.context.globalState.update(PORT_STATE, remember);
            }
            if (temporary) {
                ext.outputChannel.warn(
                    `[Wishing Well] Port ${preferredPort} is in use, so agent access listens on a temporary address: ${server.url}`,
                );
            } else {
                ext.outputChannel.info(`[Wishing Well] Agent access listening on ${server.url}`);
            }
            const endpoint: Endpoint = { server, preferredPort, temporary };
            this.endpoint = endpoint;
            this.showStatus(endpoint);
            return endpoint;
        })().finally(() => {
            this.starting = undefined;
        });
        return this.starting;
    }

    private async stop(): Promise<void> {
        // Otherwise a start still in flight would leave a server running after it was turned off.
        await this.starting?.catch(() => undefined);
        const endpoint = this.endpoint;
        this.endpoint = undefined;
        this.statusBarItem?.hide();
        await endpoint?.server.close();
    }

    private showStatus(endpoint: Endpoint): void {
        const item = (this.statusBarItem ??= vscode.window.createStatusBarItem(
            'vscode-documentdb.wishingWell.agentAccess',
            vscode.StatusBarAlignment.Right,
            100,
        ));
        item.name = vscode.l10n.t('DocumentDB Agent Access');
        item.text = `$(plug) ${vscode.l10n.t('Agents')}`;
        const listening = vscode.l10n.t('Agents can make wishes at {0}', endpoint.server.url);
        item.tooltip = endpoint.temporary ? `${listening}\n${temporaryAddressNotice(endpoint)}` : listening;
        item.command = CONNECT_COMMAND;
        item.show();
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

function jsonChoiceDetail(): string {
    return vscode.l10n.t(
        'The mcpServers shape that Claude Code and similar clients read. VS Code itself does not need it.',
    );
}

function temporaryAddressNotice(endpoint: Endpoint): string {
    return vscode.l10n.t(
        'Port {0} is in use, probably by another VS Code window, so this window uses a temporary address. Configs copied from it stop working after a restart.',
        endpoint.preferredPort,
    );
}

function extensionVersion(): string {
    const version = (ext.context.extension.packageJSON as { version?: unknown }).version;
    return typeof version === 'string' ? version : '0.0.0';
}

function newToken(): string {
    return randomBytes(32).toString('base64url');
}
