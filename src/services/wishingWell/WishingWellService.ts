/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { randomUUID } from 'crypto';
import { type WishOutcome } from '../../webviews/documentdb/wishingWell/wishingWellTypes';
import {
    buildWishPrompt,
    cannotGrantSpell,
    fortunes,
    agentSpell as handToAgent,
    installCopilotSpell,
    LUCKY_TIPS,
    matchWishByKeyword,
    parseSpell,
    pickLuckyKind,
    pickOne,
    spellToOutcome,
    type Spell,
} from './wishEngine';
import { type WishPowers } from './wishPowers';
import { type WishScope } from './wishScope';

/** Where a wish came from. Every source gets the same well; only an outside agent's grant asks first. */
export type WishSource = 'webview' | 'shell' | 'copilotTool' | 'mcp';

/** `declined`: the user said no in VS Code; the wish stays pending. */
export type GrantResult = 'granted' | 'unknown' | 'declined';

/** What a pending grant will do, resolved by the host so a confirmation never relies on agent prose. */
export interface GrantDescription {
    readonly title: string;
    readonly message: string;
    readonly actionLabel?: string;
    readonly actionHint?: string;
    /** The query, script, prompt or filter the grant opens. */
    readonly detail?: string;
}

interface PendingGrant {
    readonly spell: Spell;
    readonly scope: WishScope;
    readonly description: GrantDescription;
}

/** Keeps the pending grants bounded in a long session. */
const MAX_PENDING_GRANTS = 200;

/** Spells that reach past the extension: an outside agent needs the user's yes in VS Code first. */
function leavesTheExtension(spell: Spell): boolean {
    return (
        spell.kind === 'link' ||
        spell.kind === 'agent' ||
        (spell.kind === 'command' && !spell.commandId.startsWith('vscode-documentdb.'))
    );
}

/**
 * The Wishing Well itself. The tab, the shell's `wish` command, Copilot's agent tools and the MCP
 * server all call this, so a wish behaves the same wherever it is made.
 *
 * Read-only queries run when the wish is made; anything that opens UI waits for {@link grant}.
 * Nothing here ever writes data: a change becomes a playground script the user runs.
 */
export class WishingWellService {
    private readonly grants = new Map<string, PendingGrant>();

    constructor(
        private readonly powers: WishPowers,
        private readonly random: () => number = Math.random,
    ) {}

    public async isCopilotAvailable(): Promise<boolean> {
        return this.powers.isCopilotAvailable().catch(() => false);
    }

    public async makeWish(
        wish: string,
        scope: WishScope,
        context: IActionContext,
        source: WishSource,
        signal?: AbortSignal,
        agentSpell?: Spell,
    ): Promise<WishOutcome> {
        // Never the wish text: it is the user's own words.
        context.telemetry.properties.wishSource = source;
        context.telemetry.properties.hasCluster = String(scope.cluster !== undefined);
        context.telemetry.measurements.wishLength = wish.length;

        const promptScope = agentSpell ? {} : await this.powers.describeScope(scope).catch(() => ({}));
        const copilotAvailable = agentSpell ? false : await this.isCopilotAvailable();
        if (!agentSpell && !copilotAvailable) {
            context.telemetry.properties.copilot = 'unavailable';
        }
        const fromCopilot = copilotAvailable
            ? await this.interpretWithCopilot(wish, promptScope, context, signal)
            : undefined;
        let spell = agentSpell ?? fromCopilot ?? matchWishByKeyword(wish, promptScope);
        if (!spell) {
            // Agent mode without Copilot would only end in a sign-in error, so say what the well can do.
            spell =
                copilotAvailable && (await this.isChatAvailable())
                    ? handToAgent(wish)
                    : cannotGrantSpell(copilotAvailable);
        }
        if (spell.kind === 'agent' && !(await this.isChatAvailable())) {
            spell = installCopilotSpell();
        }
        context.telemetry.properties.spell = spell.kind;

        const outcome = spellToOutcome(
            spell,
            randomUUID(),
            agentSpell ? 'agent' : fromCopilot ? 'copilot' : 'well',
            wish,
        );
        if (spell.kind === 'find' || spell.kind === 'aggregate') {
            return this.remember(spell, scope, await this.read(spell, scope, outcome, signal));
        }
        return this.remember(spell, scope, outcome);
    }

    public async feelingLucky(scope: WishScope, context: IActionContext, source: WishSource): Promise<WishOutcome> {
        context.telemetry.properties.wishSource = source;
        const kind = pickLuckyKind(this.random, scope.cluster !== undefined);
        context.telemetry.properties.luckyKind = kind;
        const id = randomUUID();

        if (kind === 'document' || kind === 'trivia') {
            const card = await this.powers.drawFromCluster(kind, scope, this.random).catch(() => undefined);
            if (card) {
                return this.remember(card.spell, scope, {
                    ...spellToOutcome(card.spell, id, 'well'),
                    kind: card.kind,
                    detail: card.detail,
                });
            }
        }

        if (kind === 'tip') {
            const tips = LUCKY_TIPS.filter((tip) => scope.cluster !== undefined || tip.needsCluster !== true);
            const spell = pickOne(tips, this.random).spell();
            return this.remember(spell, scope, { ...spellToOutcome(spell, id, 'well'), kind: 'tip' });
        }

        return {
            id,
            kind: 'fortune',
            title: l10n.t('Your fortune'),
            message: pickOne(fortunes(), this.random),
            status: 'info',
            interpretedBy: 'well',
        };
    }

    /** Carries out a pending wish. `unknown` when the id is unknown or already granted. */
    public async grant(id: string, context: IActionContext, source: WishSource): Promise<GrantResult> {
        context.telemetry.properties.wishSource = source;
        const pending = this.grants.get(id);
        if (!pending) {
            context.telemetry.properties.granted = 'unknown';
            return 'unknown';
        }
        context.telemetry.properties.spell = pending.spell.kind;
        // Taken out while the user decides or the grant runs, so a second call cannot cast it twice.
        this.grants.delete(id);
        try {
            if (
                source === 'mcp' &&
                leavesTheExtension(pending.spell) &&
                !(await this.powers.confirmGrant(pending.spell))
            ) {
                this.keep(id, pending);
                context.telemetry.properties.granted = 'declined';
                return 'declined';
            }
            await this.powers.cast(pending.spell, pending.scope, context);
        } catch (error) {
            // A grant that failed (say, a tree node to expand first) can be tried again.
            this.keep(id, pending);
            throw error;
        }
        context.telemetry.properties.granted = 'true';
        return 'granted';
    }

    /** What granting will do, for a confirmation before an agent grants it. */
    public describeGrant(id: string): GrantDescription | undefined {
        return this.grants.get(id)?.description;
    }

    /** One level down from the scope: a cluster's databases, or a database's collections. */
    public async describeConnection(scope: WishScope): Promise<{ databases?: string[]; collections?: string[] }> {
        if (!scope.cluster) {
            return {};
        }
        if (scope.databaseName) {
            return { collections: await this.powers.listCollections(scope.cluster, scope.databaseName) };
        }
        return { databases: await this.powers.listDatabases(scope.cluster) };
    }

    private async isChatAvailable(): Promise<boolean> {
        return this.powers.isChatAvailable().catch(() => false);
    }

    private async interpretWithCopilot(
        wish: string,
        promptScope: Parameters<typeof buildWishPrompt>[1],
        context: IActionContext,
        signal?: AbortSignal,
    ): Promise<Spell | undefined> {
        try {
            const spell = parseSpell(await this.powers.askCopilot(buildWishPrompt(wish, promptScope), signal));
            context.telemetry.properties.copilot = spell ? 'granted' : 'unparsable';
            return spell;
        } catch (error) {
            if (signal?.aborted) {
                throw error;
            }
            context.telemetry.properties.copilot = 'failed';
            return undefined;
        }
    }

    /** Runs a read-only spell. A read that fails is refused: the card says why and offers nothing to open. */
    private async read(
        spell: Extract<Spell, { kind: 'find' | 'aggregate' }>,
        scope: WishScope,
        outcome: WishOutcome,
        signal?: AbortSignal,
    ): Promise<WishOutcome> {
        try {
            const result = await this.powers.read(spell, scope, signal);
            return {
                ...outcome,
                status: 'answered',
                message: readReceipt(spell, spell.collection ?? scope.collectionName ?? '', result.count),
                detail: result.count === 0 ? outcome.detail : result.text,
                resultCount: result.count,
                truncated: result.truncated,
            };
        } catch (error) {
            if (signal?.aborted) {
                throw error;
            }
            const reason = error instanceof Error ? error.message : String(error);
            return {
                ...outcome,
                status: 'refused',
                message: l10n.t('The well could not read this: {0}', reason),
                actionLabel: undefined,
                actionHint: undefined,
            };
        }
    }

    private remember(spell: Spell, scope: WishScope, outcome: WishOutcome): WishOutcome {
        if (outcome.actionLabel) {
            this.keep(outcome.id, {
                spell,
                scope,
                description: {
                    title: outcome.title,
                    message: spell.message,
                    actionLabel: outcome.actionLabel,
                    actionHint: outcome.actionHint,
                    // What the grant opens, not the rows a read already showed.
                    detail: spellToOutcome(spell, outcome.id, outcome.interpretedBy).detail,
                },
            });
        }
        return outcome;
    }

    private keep(id: string, pending: PendingGrant): void {
        this.grants.set(id, pending);
        while (this.grants.size > MAX_PENDING_GRANTS) {
            const [oldest] = this.grants.keys();
            if (oldest === undefined) {
                break;
            }
            this.grants.delete(oldest);
        }
    }
}

/** "Found 3 documents in orders." or "Aggregation on orders: 3 result rows." */
function readReceipt(spell: Spell, collection: string, count: number): string {
    if (spell.kind === 'aggregate') {
        if (count === 0) {
            return l10n.t('Aggregation on {0}: no result rows.', collection);
        }
        return count === 1
            ? l10n.t('Aggregation on {0}: 1 result row.', collection)
            : l10n.t('Aggregation on {0}: {1} result rows.', collection, count);
    }
    if (count === 0) {
        return l10n.t('No documents in {0} matched.', collection);
    }
    return count === 1
        ? l10n.t('Found 1 document in {0}.', collection)
        : l10n.t('Found {0} documents in {1}.', count, collection);
}
