/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { type WishOutcome } from '../../webviews/documentdb/wishingWell/wishingWellTypes';
import { type AgentToolset } from './agentAccess';
import { type McpToolResult } from './mcpHttpServer';
import { parseAgentSpell, spellMenu } from './wishEngine';
import { type WishingWellService, type WishSource } from './WishingWellService';
import { listConnections, resolveScope, type ConnectionSummary, type ScopeRequest, type WishScope } from './wishScope';
import {
    feelingLuckyInput,
    grantWishInput,
    makeWishInput,
    WISH_TOOL_INSTRUCTIONS,
    WISH_TOOL_NAMES,
    WISH_TOOLS,
    type WishScopeInput,
} from './wishTools';

/** What an agent reads back: the card as text, plus the same facts as structured data. */
export function outcomeForAgent(outcome: WishOutcome): McpToolResult {
    const lines = [`${outcome.title}`, outcome.message];
    if (outcome.detail) {
        lines.push('', outcome.detail);
    }
    if (outcome.actionLabel) {
        lines.push(
            '',
            `To make it happen in the user's VS Code ("${outcome.actionLabel}"${outcome.actionHint ? `: ${outcome.actionHint}` : ''}), call ${WISH_TOOL_NAMES.grantWish} with wishId "${outcome.id}".`,
        );
    }
    return {
        text: lines.join('\n'),
        structured: {
            wishId: outcome.id,
            kind: outcome.kind,
            title: outcome.title,
            message: outcome.message,
            detail: outcome.detail,
            resultCount: outcome.resultCount,
            action: outcome.actionLabel,
            actionHint: outcome.actionHint,
            interpretedBy: outcome.interpretedBy,
        },
    };
}

function connectionsForAgent(connections: readonly ConnectionSummary[]): McpToolResult {
    if (connections.length === 0) {
        return {
            text: 'No saved connections. Wish without a connection, or ask the user to add one in the DocumentDB side bar.',
            structured: { connections: [] },
        };
    }
    const lines = connections.map(
        (connection) =>
            `- ${connection.name} (id: ${connection.id}${connection.kind === 'local' ? ', local' : ''}${connection.connected ? ', connected' : ''})`,
    );
    return { text: ['Saved DocumentDB connections:', ...lines].join('\n'), structured: { connections } };
}

function scopeRequest(input: WishScopeInput): ScopeRequest {
    return { connection: input.connection, database: input.database, collection: input.collection };
}

/** Runs one tool call inside the extension's usual telemetry and error handling. */
async function withContext<T>(eventName: string, run: (context: IActionContext) => Promise<T>): Promise<T> {
    let failure: unknown;
    const result = await callWithTelemetryAndErrorHandling(`wishingWell.agent.${eventName}`, async (context) => {
        context.errorHandling.suppressDisplay = true;
        try {
            return await run(context);
        } catch (error) {
            failure = error;
            throw error;
        }
    });
    if (failure !== undefined) {
        throw failure instanceof Error ? failure : new Error(l10n.t('The wish could not be completed.'));
    }
    if (result === undefined) {
        throw new Error(l10n.t('The wish could not be completed.'));
    }
    return result;
}

/** Tells the user an outside agent did something in their window. */
function announce(source: WishSource, title: string): void {
    if (source === 'mcp') {
        void vscode.window.showInformationMessage(l10n.t('An agent granted a wish: {0}', title));
    }
}

export async function callWishTool(
    well: WishingWellService,
    name: string,
    args: Record<string, unknown>,
    source: WishSource,
    signal?: AbortSignal,
): Promise<McpToolResult> {
    switch (name) {
        case WISH_TOOL_NAMES.listConnections:
            return connectionsForAgent(await listConnections());

        case WISH_TOOL_NAMES.makeWish: {
            const input = makeWishInput.parse(args);
            const spell = input.spell ? parseAgentSpell(input.spell, input.wish) : undefined;
            if (input.spell && !spell) {
                return {
                    text: `That spell is not one the well knows, or it breaks a rule (only allowlisted commands, https links, no $out/$merge). Spells:\n${spellMenu()}`,
                    isError: true,
                };
            }
            return withContext('makeWish', async (context) => {
                const scope: WishScope = await resolveScope(scopeRequest(input), context);
                return outcomeForAgent(await well.makeWish(input.wish, scope, context, source, signal, spell));
            });
        }

        case WISH_TOOL_NAMES.feelingLucky: {
            const input = feelingLuckyInput.parse(args);
            return withContext('feelingLucky', async (context) => {
                const scope = await resolveScope(scopeRequest(input), context);
                return outcomeForAgent(await well.feelingLucky(scope, context, source));
            });
        }

        case WISH_TOOL_NAMES.grantWish: {
            const input = grantWishInput.parse(args);
            const described = well.describeGrant(input.wishId);
            return withContext('grantWish', async (context) => {
                if (!(await well.grant(input.wishId, context, source))) {
                    return {
                        text: `No pending wish "${input.wishId}". It was already granted or has expired; make the wish again.`,
                        isError: true,
                    };
                }
                announce(source, described?.title ?? input.wishId);
                return {
                    text: `Granted in VS Code: ${described?.title ?? input.wishId}.`,
                    structured: { granted: true },
                };
            });
        }

        default:
            throw new Error(`Unknown tool: ${name}`);
    }
}

/** The MCP face of the well. The spell menu goes in the instructions so agents know what to ask for. */
export function createAgentToolset(well: () => WishingWellService): AgentToolset {
    return {
        tools: WISH_TOOLS,
        instructions: `${WISH_TOOL_INSTRUCTIONS}\n\nWhat the well can do:\n${spellMenu()}`,
        callTool: (name, args, signal) => callWishTool(well(), name, args, 'mcp', signal),
    };
}

interface ToolInput {
    readonly [key: string]: unknown;
}

/**
 * Copilot agent mode inside VS Code gets the same four tools. Granting asks the user first, the
 * way Copilot asks before any tool with a side effect.
 */
export function registerWishLanguageModelTools(well: () => WishingWellService): vscode.Disposable[] {
    return Object.values(WISH_TOOL_NAMES).map((name) =>
        vscode.lm.registerTool<ToolInput>(name, {
            async invoke(options, token): Promise<vscode.LanguageModelToolResult> {
                const abort = new AbortController();
                const listener = token.onCancellationRequested(() => abort.abort());
                try {
                    const result = await callWishTool(well(), name, { ...options.input }, 'copilotTool', abort.signal);
                    return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(result.text)]);
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    ext.outputChannel.warn(`[Wishing Well] ${name} failed: ${message}`);
                    return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(message)]);
                } finally {
                    listener.dispose();
                }
            },
            prepareInvocation(options): vscode.PreparedToolInvocation {
                if (name !== WISH_TOOL_NAMES.grantWish) {
                    return {
                        invocationMessage:
                            name === WISH_TOOL_NAMES.makeWish
                                ? l10n.t(
                                      'Making a wish: {0}',
                                      typeof options.input.wish === 'string' ? options.input.wish : '',
                                  )
                                : undefined,
                    };
                }
                const described = well().describeGrant(
                    typeof options.input.wishId === 'string' ? options.input.wishId : '',
                );
                return {
                    invocationMessage: l10n.t('Granting the wish'),
                    confirmationMessages: {
                        title: l10n.t('Grant this wish?'),
                        message: described
                            ? `${described.title}\n\n${described.message}`
                            : l10n.t('The wish has expired.'),
                    },
                };
            },
        }),
    );
}
