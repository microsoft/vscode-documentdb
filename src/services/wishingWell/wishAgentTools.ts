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
import { parseAgentSpell, spellMenu, type Spell } from './wishEngine';
import { type GrantDescription, type WishingWellService, type WishSource } from './WishingWellService';
import {
    listConnections,
    NeedsSignInError,
    resolveScope,
    type ConnectionSummary,
    type ScopeRequest,
    type WishScope,
} from './wishScope';
import {
    feelingLuckyInput,
    grantWishInput,
    listConnectionsInput,
    makeWishInput,
    WISH_TOOL_INSTRUCTIONS,
    WISH_TOOL_NAMES,
    WISH_TOOLS,
    type WishScopeInput,
} from './wishTools';

/** "Open link (https://…)": the host's own words for what a grant does. */
function grantEffect(actionLabel: string, actionHint: string | undefined): string {
    return actionHint ? `${actionLabel} (${actionHint.replace(/\.$/, '')})` : actionLabel;
}

/** What an agent reads back: the card as text, plus the same facts as structured data. */
export function outcomeForAgent(outcome: WishOutcome): McpToolResult {
    const lines = [outcome.title, outcome.message];
    if (outcome.detail) {
        lines.push('', outcome.detail);
    }
    if (outcome.truncated) {
        lines.push(
            '',
            `Cut to fit: fewer than the ${outcome.resultCount ?? 0} rows are shown. Narrow the query or project fewer fields to see the rest.`,
        );
    }
    const grantable =
        outcome.actionLabel !== undefined && (outcome.status === 'answered' || outcome.status === 'proposed');
    if (grantable && outcome.actionLabel) {
        const effect = grantEffect(outcome.actionLabel, outcome.actionHint);
        const call = `${WISH_TOOL_NAMES.grantWish} with wishId "${outcome.id}"`;
        lines.push(
            '',
            outcome.status === 'answered'
                ? `Optional: call ${call} to also open this in the user's VS Code: ${effect}.`
                : `Not done yet. Granting does this in the user's VS Code: ${effect}. Call ${call} only if the user asked for it to open.`,
        );
    }
    return {
        text: lines.join('\n'),
        ...(outcome.status === 'refused' ? { isError: true } : {}),
        structured: {
            status: outcome.status,
            ...(grantable ? { wishId: outcome.id } : {}),
            kind: outcome.kind,
            title: outcome.title,
            message: outcome.message,
            detail: outcome.detail,
            resultCount: outcome.resultCount,
            truncated: outcome.truncated,
            action: grantable ? outcome.actionLabel : undefined,
            actionHint: grantable ? outcome.actionHint : undefined,
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

/** One level down from a connected connection: its databases, or a database's collections. */
async function contentsForAgent(
    well: WishingWellService,
    scope: WishScope,
    database: string | undefined,
): Promise<McpToolResult> {
    const name = scope.cluster?.clusterDisplayName ?? '';
    const connection = { connectionId: scope.cluster?.clusterId, connection: name };
    const { databases, collections } = await well.describeConnection(scope);
    if (database !== undefined) {
        const names = collections ?? [];
        return {
            text:
                names.length === 0
                    ? `Database "${database}" on "${name}" has no collections.`
                    : [`Collections in database "${database}" on "${name}":`, ...names.map((n) => `- ${n}`)].join('\n'),
            structured: { ...connection, database, collections: names },
        };
    }
    const names = databases ?? [];
    return {
        text:
            names.length === 0
                ? `"${name}" has no databases yet.`
                : [
                      `Databases on "${name}" (pass one as "database" to list its collections):`,
                      ...names.map((n) => `- ${n}`),
                  ].join('\n'),
        structured: { ...connection, databases: names },
    };
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

/**
 * Resolves the scope, then runs the call. A connection that needs signing in is a result the agent
 * can act on (ask the user, then retry), not a failure.
 */
async function withScope(
    eventName: string,
    request: ScopeRequest,
    interactive: boolean,
    run: (scope: WishScope, context: IActionContext) => Promise<McpToolResult>,
): Promise<McpToolResult> {
    return withContext(eventName, async (context) => {
        let scope: WishScope;
        try {
            scope = await resolveScope(request, context, { interactive });
        } catch (error) {
            if (!(error instanceof NeedsSignInError)) {
                throw error;
            }
            context.telemetry.properties.needsSignIn = 'true';
            return {
                text: error.message,
                isError: true,
                structured: { needsSignIn: true, connectionId: error.connectionId, connection: error.connectionName },
            };
        }
        return run(scope, context);
    });
}

/** Points at the spell contract without repeating it on every mistake. */
const SPELL_POINTER = `The spells and their fields are in the "spell" parameter description of ${WISH_TOOL_NAMES.makeWish}.`;

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
    // Only Copilot inside VS Code may bring up a sign-in; an outside agent cannot see the prompt.
    const interactive = source !== 'mcp';
    switch (name) {
        case WISH_TOOL_NAMES.listConnections: {
            const input = listConnectionsInput.parse(args);
            if (!input.connection && !input.database) {
                return connectionsForAgent(await listConnections());
            }
            // Listing never signs in, whoever asks.
            return withScope('listConnections', scopeRequest(input), false, async (scope) =>
                contentsForAgent(well, scope, input.database),
            );
        }

        case WISH_TOOL_NAMES.makeWish: {
            const input = makeWishInput.parse(args);
            let spell: Spell | undefined;
            if (input.spell) {
                const parsed = parseAgentSpell(input.spell, input.wish);
                if (!parsed.spell) {
                    const reason = (parsed.reason ?? 'it is not a spell the well knows').replace(/\.$/, '');
                    return { text: `The well refused that spell: ${reason}. ${SPELL_POINTER}`, isError: true };
                }
                spell = parsed.spell;
            }
            return withScope('makeWish', scopeRequest(input), interactive, async (scope, context) =>
                outcomeForAgent(await well.makeWish(input.wish, scope, context, source, signal, spell)),
            );
        }

        case WISH_TOOL_NAMES.feelingLucky: {
            const input = feelingLuckyInput.parse(args);
            return withScope('feelingLucky', scopeRequest(input), interactive, async (scope, context) =>
                outcomeForAgent(await well.feelingLucky(scope, context, source)),
            );
        }

        case WISH_TOOL_NAMES.grantWish: {
            const input = grantWishInput.parse(args);
            const title = well.describeGrant(input.wishId)?.title ?? input.wishId;
            return withContext('grantWish', async (context): Promise<McpToolResult> => {
                const result = await well.grant(input.wishId, context, source);
                switch (result) {
                    case 'unknown':
                        return {
                            text: `No pending wish "${input.wishId}". It was already granted or has expired; make the wish again.`,
                            isError: true,
                            structured: { granted: false, result },
                        };
                    case 'declined':
                        return {
                            text: `The user declined "${title}" in VS Code, so nothing happened. Do not grant it again unless the user asks.`,
                            structured: { granted: false, result },
                        };
                    case 'granted':
                        announce(source, title);
                        return { text: `Granted in VS Code: ${title}.`, structured: { granted: true, result } };
                }
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

const PREVIEW_LINES = 8;
const PREVIEW_CHARS = 400;

/** The host's account of the grant: what opens, and the start of the query, script or prompt it opens with. */
export function grantConfirmation(described: GrantDescription): string {
    const parts = [described.title];
    if (described.actionLabel) {
        parts.push(grantEffect(described.actionLabel, described.actionHint));
    }
    if (described.detail) {
        const shown = described.detail.split('\n').slice(0, PREVIEW_LINES).join('\n').slice(0, PREVIEW_CHARS);
        parts.push(shown.length < described.detail.length ? `${shown}…` : shown);
    }
    return parts.join('\n\n');
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
                    typeof options.input.wishId === 'string' ? options.input.wishId.trim() : '',
                );
                // Nothing to confirm for an unknown or expired id; invoke tells Copilot so.
                if (!described) {
                    return { invocationMessage: l10n.t('Granting the wish') };
                }
                return {
                    invocationMessage: l10n.t('Granting the wish'),
                    confirmationMessages: { title: l10n.t('Grant this wish?'), message: grantConfirmation(described) },
                };
            },
        }),
    );
}
