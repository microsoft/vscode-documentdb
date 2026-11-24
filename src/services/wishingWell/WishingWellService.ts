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
    writeAggregateToPlayground,
    type Spell,
} from './wishEngine';
import { type ReadResult, type WishPowers } from './wishPowers';
import { type WishScope } from './wishScope';

/** Where a wish came from. Every source gets the same well; only an outside agent's grant asks first. */
export type WishSource = 'webview' | 'shell' | 'copilotTool' | 'mcp';

/**
 * `declined`: the user said no in VS Code; the wish stays pending. `waiting`: the user has not
 * answered yet, or the caller gave up; it is still granted if the user allows it.
 */
export type GrantResult = 'granted' | 'unknown' | 'declined' | 'waiting';

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
/** How long an outside agent's grant waits on the user's answer before it hears `waiting`. */
const CONFIRM_PATIENCE_MS = 60_000;

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
    /** Grants the user is being asked about, so a second call waits on the same answer. */
    private readonly asking = new Map<string, Promise<GrantResult>>();
    /** Grants whose every caller already got `waiting`. */
    private readonly abandoned = new Set<string>();
    /** Casts in flight, so a second grant of the same wish waits for the first. */
    private readonly running = new Map<string, Promise<GrantResult>>();
    /** One-shot wishes (agent hand-offs, links) already granted; asking again is not an error. */
    private readonly done = new Set<string>();

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
        let cannotGrant = false;
        if (!spell) {
            // Agent mode without Copilot would only end in a sign-in error, so say what the well can do.
            cannotGrant = !(copilotAvailable && (await this.isChatAvailable()));
            spell = cannotGrant ? cannotGrantSpell(copilotAvailable) : handToAgent(wish);
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
        if (cannotGrant) {
            return { ...outcome, status: 'refused' };
        }
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
                    ...(card.kind === 'document' ? documentHint(card.spell) : {}),
                });
            }
        }

        if (kind === 'tip') {
            const tips = LUCKY_TIPS.filter(
                (tip) =>
                    (scope.cluster !== undefined || tip.needsCluster !== true) &&
                    // The shell is already open there.
                    (source !== 'shell' || tip.spell().kind !== 'shell'),
            );
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

    /**
     * Carries out a pending wish. `unknown` when the id is unknown, a one-shot grant was used, or
     * the grant is being cast right now. An outside agent waits at most a minute on the user's
     * answer, then hears `waiting`; the grant still happens if the user allows it later.
     */
    public async grant(
        id: string,
        context: IActionContext,
        source: WishSource,
        signal?: AbortSignal,
    ): Promise<GrantResult> {
        context.telemetry.properties.wishSource = source;
        const asking = this.asking.get(id);
        if (asking) {
            // A caller is listening again, so a late failure reaches it instead of a second notice.
            this.abandoned.delete(id);
            return this.awaitAnswer(id, asking, context, signal);
        }
        // A one-shot wish the user already allowed stays granted for the agent that asks again.
        if (this.done.has(id)) {
            context.telemetry.properties.granted = 'again';
            return 'granted';
        }
        const running = this.running.get(id);
        if (running) {
            return running;
        }
        const pending = this.grants.get(id);
        if (!pending) {
            context.telemetry.properties.granted = 'unknown';
            return 'unknown';
        }
        context.telemetry.properties.spell = pending.spell.kind;
        if (source !== 'mcp' || !leavesTheExtension(pending.spell)) {
            // Two grants of the same wish at once share one cast.
            const run = this.cast(id, pending, context).finally(() => this.running.delete(id));
            this.running.set(id, run);
            return run;
        }

        const answer = this.confirmThenCast(id, pending, context).finally(() => this.asking.delete(id));
        // Once every caller got `waiting`, a failed cast has nobody to tell but the user.
        answer.then(
            () => this.abandoned.delete(id),
            (error: unknown) => {
                if (this.abandoned.delete(id)) {
                    this.powers.reportLateFailure?.(pending.spell.title, error);
                }
            },
        );
        this.asking.set(id, answer);
        return this.awaitAnswer(id, answer, context, signal);
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

    private async confirmThenCast(id: string, pending: PendingGrant, context: IActionContext): Promise<GrantResult> {
        if (!(await this.powers.confirmGrant(pending.spell))) {
            return 'declined';
        }
        return this.cast(id, pending, context);
    }

    /** A grant that fails (say, a tree node to expand first) stays pending, so it can be tried again. */
    private async cast(id: string, pending: PendingGrant, context: IActionContext): Promise<GrantResult> {
        await this.powers.cast(pending.spell, pending.scope, context);
        // A Chat request or a web page opened twice is a mistake; anything else can be opened again.
        if (pending.spell.kind === 'agent' || pending.spell.kind === 'link') {
            this.grants.delete(id);
            this.done.add(id);
            if (this.done.size > MAX_PENDING_GRANTS) {
                const [oldest] = this.done;
                this.done.delete(oldest);
            }
        }
        context.telemetry.properties.granted = 'true';
        return 'granted';
    }

    /** The user's answer, or `waiting` when the caller gives up or the user takes too long. */
    private async awaitAnswer(
        id: string,
        answer: Promise<GrantResult>,
        context: IActionContext,
        signal: AbortSignal | undefined,
    ): Promise<GrantResult> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let stopWaiting: () => void = () => undefined;
        const gaveUp = new Promise<GrantResult>((resolve) => {
            stopWaiting = () => resolve('waiting');
            timer = setTimeout(stopWaiting, CONFIRM_PATIENCE_MS);
            if (signal?.aborted) {
                stopWaiting();
            }
            signal?.addEventListener('abort', stopWaiting, { once: true });
        });
        try {
            const result = await Promise.race([answer, gaveUp]);
            if (result === 'waiting') {
                this.abandoned.add(id);
            }
            context.telemetry.properties.granted = result === 'granted' ? 'true' : result;
            return result;
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', stopWaiting);
        }
    }

    private async interpretWithCopilot(
        wish: string,
        promptScope: Parameters<typeof buildWishPrompt>[1],
        context: IActionContext,
        signal?: AbortSignal,
    ): Promise<Spell | undefined> {
        try {
            const reply = await this.powers.askCopilot(buildWishPrompt(wish, promptScope), signal);
            const spell = parseSpell(reply);
            if (spell) {
                context.telemetry.properties.copilot = 'granted';
                return spell;
            }
            // A pipeline that writes never runs here, but it makes a fine playground script.
            const playground = writeAggregateToPlayground(reply, promptScope.collectionName);
            context.telemetry.properties.copilot = playground ? 'writeToPlayground' : 'unparsable';
            return playground;
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
                message: readReceipt(spell, spell.collection ?? scope.collectionName ?? '', result),
                detail: result.count === 0 ? outcome.detail : result.text,
                resultCount: result.count,
                truncated: result.truncated,
                capped: result.capped,
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

/** The fished document's own filter opens it, not a query the user wrote. */
function documentHint(spell: Spell): { actionHint?: string } {
    if (spell.kind !== 'collectionView' || !spell.filter || !spell.collection) {
        return {};
    }
    const where = spell.database ? `${spell.database}.${spell.collection}` : spell.collection;
    return { actionHint: l10n.t('Opens {0} filtered to this document.', where) };
}

/** How many whole rows a read's text shows. It is always a JSON array. */
export function rowsShown(text: string): number | undefined {
    try {
        const rows: unknown = JSON.parse(text);
        return Array.isArray(rows) ? rows.length : undefined;
    } catch {
        return undefined;
    }
}

/** "Found 3 documents in orders.", plus whether more exist and whether all of them fit. */
function readReceipt(spell: Spell, collection: string, result: ReadResult): string {
    const receipt = countReceipt(spell, collection, result.count, result.capped);
    const shown = result.truncated ? rowsShown(result.text) : undefined;
    if (shown === undefined || shown >= result.count) {
        return receipt;
    }
    return shown === 1
        ? l10n.t('{0} Only the first one is shown; the rest did not fit.', receipt)
        : l10n.t('{0} Only the first {1} are shown; the rest did not fit.', receipt, shown);
}

function countReceipt(spell: Spell, collection: string, count: number, capped: boolean): string {
    if (spell.kind === 'aggregate') {
        if (count === 0) {
            return l10n.t('Aggregation on {0}: no result rows.', collection);
        }
        if (capped) {
            return l10n.t('Aggregation on {0}: the first {1} result rows; there are more.', collection, count);
        }
        return count === 1
            ? l10n.t('Aggregation on {0}: 1 result row.', collection)
            : l10n.t('Aggregation on {0}: {1} result rows.', collection, count);
    }
    if (count === 0) {
        return l10n.t('No documents in {0} matched.', collection);
    }
    if (capped) {
        return l10n.t('The first {0} documents in {1}; there are more.', count, collection);
    }
    return count === 1
        ? l10n.t('Found 1 document in {0}.', collection)
        : l10n.t('Found {0} documents in {1}.', count, collection);
}
