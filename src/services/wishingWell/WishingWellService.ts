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
    fortunes,
    agentSpell as handToAgent,
    installCopilotSpell,
    LUCKY_TIPS,
    luckySearchSpell,
    matchWishByKeyword,
    parseSpell,
    pickLuckyKind,
    pickOne,
    spellToOutcome,
    WishScopeError,
    type Spell,
} from './wishEngine';
import { type WishPowers } from './wishPowers';
import { type WishScope } from './wishScope';

/** Where a wish came from. Telemetry only; every source gets the same well. */
export type WishSource = 'webview' | 'shell' | 'copilotTool' | 'mcp';

interface PendingGrant {
    readonly spell: Spell;
    readonly scope: WishScope;
}

/** Keeps the pending grants bounded in a long session. */
const MAX_PENDING_GRANTS = 200;

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
        const fromCopilot = agentSpell
            ? undefined
            : await this.interpretWithCopilot(wish, promptScope, context, signal);
        let spell = agentSpell ?? fromCopilot ?? matchWishByKeyword(wish, promptScope);
        if (!spell) {
            spell = (await this.powers.isChatAvailable().catch(() => false))
                ? handToAgent(wish)
                : luckySearchSpell(wish);
        }
        if (spell.kind === 'agent' && !(await this.powers.isChatAvailable().catch(() => false))) {
            spell = installCopilotSpell();
        }
        context.telemetry.properties.spell = spell.kind;

        const outcome = spellToOutcome(spell, randomUUID(), agentSpell ? 'agent' : fromCopilot ? 'copilot' : 'well');
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
            interpretedBy: 'well',
        };
    }

    /** Carries out a pending wish. `false` when the id is unknown or already granted. */
    public async grant(id: string, context: IActionContext, source: WishSource): Promise<boolean> {
        context.telemetry.properties.wishSource = source;
        const pending = this.grants.get(id);
        if (!pending) {
            context.telemetry.properties.granted = 'unknown';
            return false;
        }
        context.telemetry.properties.spell = pending.spell.kind;
        await this.powers.cast(pending.spell, pending.scope, context);
        this.grants.delete(id);
        context.telemetry.properties.granted = 'true';
        return true;
    }

    /** The pending spell's card text, for a confirmation before an agent grants it. */
    public describeGrant(id: string): { readonly title: string; readonly message: string } | undefined {
        const pending = this.grants.get(id);
        return pending ? { title: pending.spell.title, message: pending.spell.message } : undefined;
    }

    private async interpretWithCopilot(
        wish: string,
        promptScope: Parameters<typeof buildWishPrompt>[1],
        context: IActionContext,
        signal?: AbortSignal,
    ): Promise<Spell | undefined> {
        if (!(await this.isCopilotAvailable())) {
            context.telemetry.properties.copilot = 'unavailable';
            return undefined;
        }
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

    /** Runs a read-only spell. A failed read is still an outcome: the user sees why and can open it. */
    private async read(
        spell: Extract<Spell, { kind: 'find' | 'aggregate' }>,
        scope: WishScope,
        outcome: WishOutcome,
        signal?: AbortSignal,
    ): Promise<WishOutcome> {
        try {
            const result = await this.powers.read(spell, scope, signal);
            const summary =
                result.count === 0 ? l10n.t('No documents matched.') : l10n.t('{0} documents.', result.count);
            return {
                ...outcome,
                message: `${outcome.message} ${summary}`.trim(),
                detail: result.count === 0 ? outcome.detail : result.text,
                resultCount: result.count,
            };
        } catch (error) {
            if (signal?.aborted) {
                throw error;
            }
            const reason = error instanceof Error ? error.message : String(error);
            return {
                ...outcome,
                message: l10n.t('The well could not read this: {0}', reason),
                ...(error instanceof WishScopeError ? { actionLabel: undefined, actionHint: undefined } : {}),
            };
        }
    }

    private remember(spell: Spell, scope: WishScope, outcome: WishOutcome): WishOutcome {
        if (outcome.actionLabel) {
            this.grants.set(outcome.id, { spell, scope });
            while (this.grants.size > MAX_PENDING_GRANTS) {
                const [oldest] = this.grants.keys();
                if (oldest === undefined) {
                    break;
                }
                this.grants.delete(oldest);
            }
        }
        return outcome;
    }
}
