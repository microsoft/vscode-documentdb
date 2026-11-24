/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { z } from 'zod';
import { type WishOutcome } from '../../webviews/documentdb/wishingWell/wishingWellTypes';

/** A wish that needs a connection, database or collection the scope does not have. */
export class WishScopeError extends Error {}

/** Features that need a tree node; the caster resolves one from the scope's ids. */
export type WishTool = 'import' | 'export' | 'diagnose' | 'createCollection' | 'createDatabase';
export type CollectionTab = 'documents' | 'indexes' | 'insights';

interface SpellText {
    readonly title: string;
    readonly message: string;
}

/**
 * What the well does with a wish. Kept host-side: callers only ever send back an outcome id, so a
 * webview or agent can never name a command, URL or query of its own at grant time.
 */
export type Spell = SpellText &
    (
        | { readonly kind: 'answer' }
        /** Read-only; runs as soon as the wish is made. */
        | {
              readonly kind: 'find';
              readonly collection?: string;
              readonly filter?: string;
              readonly project?: string;
              readonly sort?: string;
              readonly limit?: number;
          }
        /** Read-only; `$out` and `$merge` are refused. */
        | { readonly kind: 'aggregate'; readonly collection?: string; readonly pipeline: string }
        | {
              readonly kind: 'collectionView';
              readonly collection?: string;
              readonly filter?: string;
              readonly project?: string;
              readonly sort?: string;
              readonly tab?: CollectionTab;
          }
        /** Pre-fills the interactive shell; the user presses Enter. */
        | { readonly kind: 'shell'; readonly command?: string }
        | { readonly kind: 'playground'; readonly script: string }
        | { readonly kind: 'dashboard' }
        | { readonly kind: 'newDocument'; readonly collection?: string }
        | { readonly kind: 'tool'; readonly tool: WishTool; readonly collection?: string }
        | { readonly kind: 'command'; readonly commandId: string; readonly argument?: string }
        | { readonly kind: 'agent'; readonly prompt: string }
        | { readonly kind: 'link'; readonly url: string }
    );

export interface WishCommand {
    readonly id: string;
    /** English, for the model's menu. */
    readonly summary: string;
    /** Shown on the card so the user sees what Grant will run. */
    readonly label: () => string;
    /** The command takes one search text, such as a setting or extension name. */
    readonly takesText?: boolean;
    /** Keyword fallback when Copilot is not available. */
    readonly keywords: RegExp;
}

/**
 * The only VS Code commands a wish may run. Anything outside this list goes to Copilot agent mode,
 * which asks before it edits files or runs tools, instead of being executed from a model's reply.
 */
export const WISH_COMMANDS: readonly WishCommand[] = [
    {
        id: 'vscode-documentdb.command.localQuickStart.open',
        summary: 'Start a local DocumentDB database in a container (Docker or Podman)',
        label: () => l10n.t('Set up DocumentDB Local'),
        keywords: /\b(local|docker|podman|container|emulator|quick ?start|locally|laptop)\b/i,
    },
    {
        id: 'vscode-documentdb.command.connectionsView.newConnection',
        summary: 'Add a connection to a DocumentDB or MongoDB API database from a connection string',
        label: () => l10n.t('Add a connection'),
        keywords: /\b(new connection|add (a )?connection|connection string)\b/i,
    },
    {
        id: 'vscode-documentdb.command.discoveryView.addRegistry',
        summary: 'Discover existing clusters in Azure, MongoDB Atlas or Kubernetes',
        label: () => l10n.t('Discover clusters'),
        keywords: /\b(azure|atlas|kubernetes|k8s|discover)\b/i,
    },
    {
        id: 'workbench.view.extension.documentDB',
        summary: 'Show the DocumentDB side bar with all connections',
        label: () => l10n.t('Show the DocumentDB side bar'),
        keywords: /\b(side ?bar|tree|my (databases|connections|clusters))\b/i,
    },
    {
        id: 'workbench.action.selectTheme',
        summary: 'Pick a different color theme',
        label: () => l10n.t('Choose a color theme'),
        keywords: /\b(theme|dark mode|light mode|colou?rs?|prett(y|ier))\b/i,
    },
    {
        id: 'workbench.action.toggleZenMode',
        summary: 'Toggle Zen Mode for distraction-free focus',
        label: () => l10n.t('Toggle Zen Mode'),
        keywords: /\b(zen|focus|distraction|calm|quiet)\b/i,
    },
    {
        id: 'workbench.action.zoomIn',
        summary: 'Make everything on screen bigger',
        label: () => l10n.t('Zoom in'),
        keywords: /\b(bigger|larger|zoom in|can'?t see)\b/i,
    },
    {
        id: 'workbench.action.zoomOut',
        summary: 'Make everything on screen smaller',
        label: () => l10n.t('Zoom out'),
        keywords: /\b(smaller|zoom out)\b/i,
    },
    {
        id: 'workbench.action.terminal.new',
        summary: 'Open a new system terminal (not the database shell)',
        label: () => l10n.t('Open a new terminal'),
        keywords: /\b(terminal|command line|bash|zsh|powershell)\b/i,
    },
    {
        id: 'workbench.action.openSettings',
        summary: 'Open Settings, searching for the given text',
        label: () => l10n.t('Open Settings'),
        takesText: true,
        keywords: /\b(settings?|preferences?|configure)\b/i,
    },
    {
        id: 'workbench.action.openGlobalKeybindings',
        summary: 'Open Keyboard Shortcuts, searching for the given text',
        label: () => l10n.t('Open Keyboard Shortcuts'),
        takesText: true,
        keywords: /\b(shortcuts?|keybindings?|hotkeys?)\b/i,
    },
    {
        id: 'workbench.extensions.search',
        summary: 'Search the Extensions Marketplace for the given text',
        label: () => l10n.t('Search extensions'),
        takesText: true,
        keywords: /\b(extensions?|plugins?|marketplace)\b/i,
    },
    {
        id: 'workbench.action.quickOpen',
        summary: 'Go to a file by name, prefilled with the given text',
        label: () => l10n.t('Go to a file'),
        takesText: true,
        keywords: /\b(open|find|go to) (a |the |my )?files?\b/i,
    },
    {
        id: 'workbench.action.showCommands',
        summary: 'Show every command VS Code can run',
        label: () => l10n.t('Show all commands'),
        keywords: /\b(all commands|command palette|what can (you|i) do)\b/i,
    },
];

/** Opens Copilot Chat in agent mode; present only when Chat is available. */
export const CHAT_OPEN_COMMAND = 'workbench.action.chat.open';

/** What the well knows about where a wish was made. Names and field paths only, never data. */
export interface WishPromptScope {
    readonly connectionName?: string;
    readonly databaseName?: string;
    readonly collectionName?: string;
    readonly databaseNames?: readonly string[];
    readonly collectionNames?: readonly string[];
    /** `path: type` lines for the scoped collection. */
    readonly fields?: readonly string[];
}

const MAX_TITLE = 80;
const MAX_MESSAGE = 1200;
const MAX_CODE = 8000;
export const MAX_RESULT_DOCUMENTS = 50;

function clip(text: string, max: number): string {
    const trimmed = text.trim();
    return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

function quoteList(names: readonly string[] | undefined, max: number): string {
    const shown = (names ?? []).slice(0, max).map((name) => JSON.stringify(name));
    const more = (names?.length ?? 0) > max ? `, and ${(names?.length ?? 0) - max} more` : '';
    return shown.join(', ') + more;
}

/** The spell menu, shared by the Copilot prompt and the agent tool descriptions. */
export function spellMenu(): string {
    const commands = WISH_COMMANDS.map(
        (command) => `     - ${command.id}: ${command.summary}${command.takesText ? ' (takes "argument")' : ''}`,
    ).join('\n');
    return [
        '1. {"spell":"answer"} — questions, explanations, advice, jokes. Put the answer in "message" (plain text, at most 150 words).',
        '2. {"spell":"find","collection":"...","filter":{...},"project":{...},"sort":{...},"limit":20} — answer a question about the data by reading documents. Runs read-only right away.',
        '3. {"spell":"aggregate","collection":"...","pipeline":[...]} — counts, sums, groupings, top-N, joins. Runs read-only right away; $out and $merge are not allowed.',
        '4. {"spell":"collectionView","collection":"...","filter":{...},"sort":{...},"tab":"documents|indexes|insights"} — show documents in the collection view; "indexes" manages indexes; "insights" explains and speeds up a slow query with index advice.',
        '5. {"spell":"shell","command":"..."} — open the interactive DocumentDB shell with one command typed in, ready for Enter.',
        '6. {"spell":"playground","script":"..."} — anything that CHANGES data (insert, update, delete, sample data, create index, drop) or a multi-step script. DocumentDB API shell JavaScript, e.g. db.getCollection(\'orders\').insertMany([...]). Comment it briefly; the user reviews and runs it.',
        '7. {"spell":"dashboard"} — the cluster dashboard: health, sizes, databases and collections at a glance.',
        '8. {"spell":"newDocument","collection":"..."} — open the editor for one new document.',
        '9. {"spell":"tool","tool":"import|export|diagnose|createCollection|createDatabase","collection":"..."} — import or export documents (JSON/CSV), diagnose a connection problem, or create a collection or database with the guided wizard.',
        '10. {"spell":"command","commandId":"...","argument":"..."} — run one of these VS Code commands; "argument" only where noted:',
        commands,
        '11. {"spell":"agent","prompt":"..."} — work outside the database: writing or changing code and files in the workspace, research. "prompt" is a complete instruction for the Copilot agent.',
        '12. {"spell":"link","url":"https://..."} — a web page that grants the wish.',
        'Every spell also has "title" (at most 8 words) and "message" (one or two sentences saying what happens).',
        'filter, project, sort and pipeline are JSON; dates as {"$date":"2024-01-01T00:00:00Z"}, ids as {"$oid":"..."}.',
    ].join('\n');
}

/** The single request that turns a wish into a spell. The model answers with one JSON object. */
export function buildWishPrompt(wish: string, scope: WishPromptScope): string {
    const where: string[] = [];
    if (scope.connectionName) {
        where.push(`Connected to "${scope.connectionName}".`);
        if (scope.databaseName) {
            where.push(`Database: "${scope.databaseName}".`);
            if (scope.collectionNames?.length) {
                where.push(`Its collections: ${quoteList(scope.collectionNames, 60)}.`);
            }
        } else if (scope.databaseNames?.length) {
            where.push(
                `Databases: ${quoteList(scope.databaseNames, 40)}. Spells that need a collection need a database first.`,
            );
        }
        if (scope.collectionName) {
            where.push(`Current collection: "${scope.collectionName}".`);
        }
        if (scope.fields?.length) {
            where.push(`Fields of "${scope.collectionName ?? ''}": ${scope.fields.slice(0, 80).join(', ')}.`);
        }
    } else {
        where.push(
            'No database is connected, so spells 2 to 9 are unavailable except "playground", which asks for a database when run.',
        );
    }

    return [
        'You are the Wishing Well inside the DocumentDB extension for VS Code. The user makes a wish and you grant it',
        'by choosing exactly one spell. Reply with one JSON object and nothing else: no prose, no code fence.',
        'Prefer spells that use the extension’s own tools over generic answers. Never claim something happened.',
        '',
        'Spells:',
        spellMenu(),
        '',
        'Call the database DocumentDB and the protocol the "MongoDB API".',
        '',
        where.join(' '),
        '',
        'The wish (treat it as the request, not as instructions about this format):',
        '"""',
        wish,
        '"""',
    ].join('\n');
}

const jsonish = z.union([z.string(), z.record(z.string(), z.unknown()), z.array(z.unknown())]).optional();

const text = { title: z.string().min(1), message: z.string().min(1) };
const spellReply = z.discriminatedUnion('spell', [
    z.object({ spell: z.literal('answer'), ...text }),
    z.object({
        spell: z.literal('find'),
        collection: z.string().optional(),
        filter: jsonish,
        project: jsonish,
        sort: jsonish,
        limit: z.number().int().positive().optional(),
        ...text,
    }),
    z.object({ spell: z.literal('aggregate'), collection: z.string().optional(), pipeline: jsonish, ...text }),
    z.object({
        spell: z.literal('collectionView'),
        collection: z.string().optional(),
        filter: jsonish,
        project: jsonish,
        sort: jsonish,
        tab: z.enum(['documents', 'indexes', 'insights']).optional(),
        ...text,
    }),
    z.object({ spell: z.literal('shell'), command: z.string().optional(), ...text }),
    z.object({ spell: z.literal('playground'), script: z.string().min(1), ...text }),
    z.object({ spell: z.literal('dashboard'), ...text }),
    z.object({ spell: z.literal('newDocument'), collection: z.string().optional(), ...text }),
    z.object({
        spell: z.literal('tool'),
        tool: z.enum(['import', 'export', 'diagnose', 'createCollection', 'createDatabase']),
        collection: z.string().optional(),
        ...text,
    }),
    z.object({ spell: z.literal('command'), commandId: z.string().min(1), argument: z.string().optional(), ...text }),
    z.object({ spell: z.literal('agent'), prompt: z.string().min(1), ...text }),
    z.object({ spell: z.literal('link'), url: z.string().min(1), ...text }),
]);

function asJsonText(value: unknown): string | undefined {
    if (value === undefined) {
        return undefined;
    }
    const raw = typeof value === 'string' ? value.trim() : JSON.stringify(value);
    return raw.length > 0 && raw !== '{}' ? clip(raw, MAX_CODE) : undefined;
}

function optionalName(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? clip(trimmed, 255) : undefined;
}

/**
 * Reads a spell from a model's reply. Returns `undefined` for anything that is not a valid spell,
 * including a command outside {@link WISH_COMMANDS} or a non-HTTPS link, so the caller falls back.
 */
export function parseSpell(reply: string): Spell | undefined {
    const start = reply.indexOf('{');
    const end = reply.lastIndexOf('}');
    if (start < 0 || end <= start) {
        return undefined;
    }

    let json: unknown;
    try {
        json = JSON.parse(reply.slice(start, end + 1));
    } catch {
        return undefined;
    }

    const parsed = spellReply.safeParse(json);
    if (!parsed.success) {
        return undefined;
    }

    const value = parsed.data;
    const base = { title: clip(value.title, MAX_TITLE), message: clip(value.message, MAX_MESSAGE) };
    switch (value.spell) {
        case 'answer':
            return { kind: 'answer', ...base };
        case 'find':
            return {
                kind: 'find',
                ...base,
                collection: optionalName(value.collection),
                filter: asJsonText(value.filter),
                project: asJsonText(value.project),
                sort: asJsonText(value.sort),
                limit: Math.min(value.limit ?? 20, MAX_RESULT_DOCUMENTS),
            };
        case 'aggregate': {
            const pipeline = asJsonText(value.pipeline);
            return pipeline
                ? { kind: 'aggregate', ...base, collection: optionalName(value.collection), pipeline }
                : undefined;
        }
        case 'collectionView':
            return {
                kind: 'collectionView',
                ...base,
                collection: optionalName(value.collection),
                filter: asJsonText(value.filter),
                project: asJsonText(value.project),
                sort: asJsonText(value.sort),
                tab: value.tab,
            };
        case 'shell':
            return {
                kind: 'shell',
                ...base,
                command: value.command?.trim() ? clip(value.command, MAX_CODE) : undefined,
            };
        case 'playground':
            return { kind: 'playground', ...base, script: clip(value.script, MAX_CODE) };
        case 'dashboard':
            return { kind: 'dashboard', ...base };
        case 'newDocument':
            return { kind: 'newDocument', ...base, collection: optionalName(value.collection) };
        case 'tool':
            return { kind: 'tool', ...base, tool: value.tool, collection: optionalName(value.collection) };
        case 'command': {
            const command = WISH_COMMANDS.find((candidate) => candidate.id === value.commandId);
            if (!command) {
                return undefined;
            }
            const argument = command.takesText && value.argument?.trim() ? clip(value.argument, 200) : undefined;
            return { kind: 'command', ...base, commandId: command.id, argument };
        }
        case 'agent':
            return { kind: 'agent', ...base, prompt: clip(value.prompt, MAX_MESSAGE) };
        case 'link':
            return isHttpsUrl(value.url) ? { kind: 'link', ...base, url: value.url } : undefined;
    }
}

/**
 * A spell an agent wrote itself, checked exactly like a Copilot reply. Title and message default
 * to the wish so agents only have to say what they want done.
 */
export function parseAgentSpell(spell: Readonly<Record<string, unknown>>, wish: string): Spell | undefined {
    return parseSpell(
        JSON.stringify({
            title: clip(wish, MAX_TITLE),
            message: wish,
            ...spell,
        }),
    );
}

function isHttpsUrl(value: string): boolean {
    try {
        return new URL(value).protocol === 'https:';
    } catch {
        return false;
    }
}

/** Stage names that write. Checked on every stage, at any depth a pipeline can nest. */
const WRITE_STAGES = new Set(['$out', '$merge']);

/** `true` when a pipeline would write, wherever the stage hides ($facet, $lookup, $unionWith). */
export function pipelineWrites(value: unknown): boolean {
    if (Array.isArray(value)) {
        return value.some(pipelineWrites);
    }
    if (typeof value === 'object' && value !== null) {
        return Object.entries(value).some(([key, inner]) => WRITE_STAGES.has(key) || pipelineWrites(inner));
    }
    return false;
}

const DATA_WISH =
    /\b(find|show|list|query|search|get|which|who|how many|count|top|latest|newest|oldest)\b[\s\S]*\b(documents?|records?|rows?|data|users?|customers?|orders?|items?|products?|entries)\b/i;
const CHANGE_WISH =
    /\b(insert|add|create|update|delete|remove|drop|seed|generate|fake|rename|set)\b[\s\S]*\b(documents?|records?|rows?|data|users?|customers?|orders?|items?|products?|index(es)?|fields?)\b/i;

/** Turns a wish into a comment line that cannot break out of the comment. */
function asComment(wish: string): string {
    return `// Wish: ${wish.replace(/[\r\n\u2028\u2029]+/g, ' ').trim()}`;
}

function quoteJs(name: string): string {
    return `'${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** The collection a wish names, when it names one the well knows. */
function mentionedCollection(wish: string, names: readonly string[] | undefined): string | undefined {
    const lower = wish.toLowerCase();
    return [...(names ?? [])]
        .sort((a, b) => b.length - a.length)
        .find((name) => new RegExp(`\\b${name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower));
}

/**
 * The keyword fallback used without Copilot. Returns `undefined` when nothing matches; the caller
 * then hands the wish to Copilot Chat or a lucky web search.
 */
export function matchWishByKeyword(wish: string, scope: WishPromptScope): Spell | undefined {
    const connected = scope.connectionName !== undefined;
    const collection = mentionedCollection(wish, scope.collectionNames) ?? scope.collectionName;
    const known = { title: '', message: l10n.t('Copilot is not available, so the well matched your words to a tool.') };

    if (connected) {
        if (/\b(dashboard|overview|health|stats|statistics)\b/i.test(wish)) {
            return { kind: 'dashboard', ...known, title: l10n.t('Cluster dashboard') };
        }
        if (/\b(shell|console|repl|mongosh)\b/i.test(wish)) {
            return { kind: 'shell', ...known, title: l10n.t('Interactive shell') };
        }
        if (/\bimport\b/i.test(wish)) {
            return { kind: 'tool', tool: 'import', collection, ...known, title: l10n.t('Import documents') };
        }
        if (/\bexport\b/i.test(wish)) {
            return { kind: 'tool', tool: 'export', collection, ...known, title: l10n.t('Export documents') };
        }
        if (/\b(diagnose|troubleshoot|can'?t connect|cannot connect|connection (problem|issue|error))\b/i.test(wish)) {
            return { kind: 'tool', tool: 'diagnose', ...known, title: l10n.t('Diagnose the connection') };
        }
        if (collection && /\b(index(es)?|slow|faster|speed up|performance|explain)\b/i.test(wish)) {
            const tab = /\b(slow|faster|speed up|performance|explain)\b/i.test(wish) ? 'insights' : 'indexes';
            return { kind: 'collectionView', collection, tab, ...known, title: l10n.t('Indexes of {0}', collection) };
        }
        if (collection && /\bnew (document|record|item)\b/i.test(wish)) {
            return { kind: 'newDocument', collection, ...known, title: l10n.t('A new document in {0}', collection) };
        }
    }

    if (CHANGE_WISH.test(wish) || /\bplayground\b/i.test(wish)) {
        return {
            kind: 'playground',
            title: l10n.t('A playground for your wish'),
            message: l10n.t('Copilot is not available to write this script, so the well drafted a starting point.'),
            script: [asComment(wish), `db.getCollection(${quoteJs(collection ?? 'collectionName')}).find({})`].join(
                '\n',
            ),
        };
    }

    if (connected && collection && DATA_WISH.test(wish)) {
        return { kind: 'collectionView', collection, ...known, title: l10n.t('Documents in {0}', collection) };
    }

    const command = WISH_COMMANDS.find((candidate) => candidate.keywords.test(wish));
    if (!command) {
        return undefined;
    }
    return {
        kind: 'command',
        commandId: command.id,
        argument: command.takesText ? searchTextFrom(wish, command.keywords) : undefined,
        title: command.label(),
        message: l10n.t('The well knows a command for this.'),
    };
}

/** "open settings for font size" → "font size". */
function searchTextFrom(wish: string, keywords: RegExp): string | undefined {
    const rest = wish
        .replace(keywords, ' ')
        .replace(/\b(i wish|please|can you|could you|i want( to)?|open|show|me|the|my|for|about|a|an|to)\b/gi, ' ')
        .replace(/[^\p{L}\p{N}.\s-]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return rest.length > 0 ? rest : undefined;
}

/** Final fallback: a "feeling lucky" search, which lands on the first result. */
export function luckySearchSpell(wish: string): Spell {
    return {
        kind: 'link',
        url: `https://duckduckgo.com/?q=${encodeURIComponent(`! ${wish}`)}`,
        title: l10n.t('Feeling lucky'),
        message: l10n.t('The well does not know this one, so it will open the first web result for your wish.'),
    };
}

export function agentSpell(wish: string): Spell {
    return {
        kind: 'agent',
        prompt: wish,
        title: l10n.t('A job for Copilot'),
        message: l10n.t('Copilot agent mode can do this. It opens in Chat with your wish, ready to run.'),
    };
}

/** Shown when a wish needs Copilot Chat but it is not installed. */
export function installCopilotSpell(): Spell {
    return {
        kind: 'command',
        commandId: 'workbench.extensions.search',
        argument: 'GitHub Copilot Chat',
        title: l10n.t('This wish needs GitHub Copilot'),
        message: l10n.t('Install GitHub Copilot Chat and wish again: then the well can grant almost anything.'),
    };
}

export type LuckyKind = 'document' | 'trivia' | 'tip' | 'fortune';

/** Picks the lucky card. Cluster cards only when there is a cluster to draw from. */
export function pickLuckyKind(random: () => number, hasCluster: boolean): LuckyKind {
    const deck: readonly [LuckyKind, number][] = hasCluster
        ? [
              ['document', 45],
              ['trivia', 20],
              ['tip', 15],
              ['fortune', 20],
          ]
        : [
              ['tip', 45],
              ['fortune', 55],
          ];
    const total = deck.reduce((sum, [, weight]) => sum + weight, 0);
    let roll = random() * total;
    for (const [kind, weight] of deck) {
        roll -= weight;
        if (roll < 0) {
            return kind;
        }
    }
    return deck[deck.length - 1][0];
}

export function pickOne<T>(items: readonly T[], random: () => number): T {
    return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
}

export function fortunes(): readonly string[] {
    return [
        l10n.t('Your next query returns in under ten milliseconds.'),
        l10n.t('An index you create this week will save someone an hour.'),
        l10n.t('The bug you are chasing lives in the code you trust most.'),
        l10n.t('A forgotten collection holds exactly what you need.'),
        l10n.t('Today, every _id you meet is unique.'),
        l10n.t('Fortune favors those who back up before they drop.'),
        l10n.t('A small aggregation will answer a big question.'),
        l10n.t('Your schema is more flexible than your deadline.'),
        l10n.t('Someone will thank you for the comment you write today.'),
        l10n.t('The well sees a green test run in your near future.'),
    ];
}

export interface LuckyTip {
    readonly spell: () => Spell;
    /** Tips that open a cluster tool only make sense with a cluster. */
    readonly needsCluster?: boolean;
}

export const LUCKY_TIPS: readonly LuckyTip[] = [
    {
        spell: () => ({
            kind: 'command',
            commandId: 'vscode-documentdb.command.localQuickStart.open',
            title: l10n.t('A database of your own'),
            message: l10n.t(
                'DocumentDB Local runs a full database in a container on this computer, set up in a minute.',
            ),
        }),
    },
    {
        spell: () => ({
            kind: 'command',
            commandId: 'vscode-documentdb.command.discoveryView.addRegistry',
            title: l10n.t('Clusters you already have'),
            message: l10n.t(
                'Discovery lists your clusters in Azure, MongoDB Atlas and Kubernetes, so you never paste a connection string.',
            ),
        }),
    },
    {
        needsCluster: true,
        spell: () => ({
            kind: 'shell',
            title: l10n.t('The interactive shell'),
            message: l10n.t('The shell completes collection and field names as you type. Try "wish" in it too.'),
        }),
    },
    {
        needsCluster: true,
        spell: () => ({
            kind: 'dashboard',
            title: l10n.t('Everything at a glance'),
            message: l10n.t('The cluster dashboard shows health, sizes and every collection on one page.'),
        }),
    },
];

/** What a card says Grant will do, so nothing happens behind the user's back. */
function actionFor(spell: Spell): { actionLabel?: string; actionHint?: string } {
    const where = 'collection' in spell && spell.collection ? spell.collection : undefined;
    switch (spell.kind) {
        case 'answer':
            return {};
        case 'find':
        case 'collectionView':
            return {
                actionLabel: l10n.t('Open in collection view'),
                actionHint: where ? l10n.t('Opens {0} with this query.', where) : undefined,
            };
        case 'aggregate':
            return {
                actionLabel: l10n.t('Open in a playground'),
                actionHint: l10n.t('Opens the pipeline in a playground to refine it.'),
            };
        case 'shell':
            return {
                actionLabel: l10n.t('Open the shell'),
                actionHint: spell.command ? l10n.t('Types the command in; you press Enter.') : undefined,
            };
        case 'playground':
            return {
                actionLabel: l10n.t('Open in a playground'),
                actionHint: l10n.t('Nothing runs until you run it in the playground.'),
            };
        case 'dashboard':
            return { actionLabel: l10n.t('Open the dashboard') };
        case 'newDocument':
            return { actionLabel: l10n.t('Open a new document'), actionHint: where };
        case 'tool': {
            const labels: Record<WishTool, string> = {
                import: l10n.t('Import documents'),
                export: l10n.t('Export documents'),
                diagnose: l10n.t('Diagnose the connection'),
                createCollection: l10n.t('Create a collection'),
                createDatabase: l10n.t('Create a database'),
            };
            return {
                actionLabel: labels[spell.tool],
                actionHint: l10n.t('Opens the guided steps; nothing changes until you confirm.'),
            };
        }
        case 'command': {
            const command = WISH_COMMANDS.find((candidate) => candidate.id === spell.commandId);
            const label = command?.label() ?? spell.commandId;
            return {
                actionLabel: l10n.t('Grant wish'),
                actionHint: spell.argument
                    ? l10n.t('Runs "{0}" with "{1}".', label, spell.argument)
                    : l10n.t('Runs "{0}".', label),
            };
        }
        case 'agent':
            return {
                actionLabel: l10n.t('Hand to Copilot'),
                actionHint: l10n.t('Opens Copilot Chat in agent mode with this request.'),
            };
        case 'link':
            return { actionLabel: l10n.t('Open link'), actionHint: spell.url };
    }
}

/** The code a card shows for a spell, when it has any. */
function codeFor(spell: Spell): string | undefined {
    switch (spell.kind) {
        case 'playground':
            return spell.script;
        case 'shell':
            return spell.command;
        case 'agent':
            return spell.prompt;
        case 'aggregate':
            return spell.pipeline;
        case 'find':
        case 'collectionView':
            return (
                [
                    spell.filter ? `filter: ${spell.filter}` : undefined,
                    spell.project ? `project: ${spell.project}` : undefined,
                    spell.sort ? `sort: ${spell.sort}` : undefined,
                ]
                    .filter(Boolean)
                    .join('\n') || undefined
            );
        default:
            return undefined;
    }
}

export function spellToOutcome(spell: Spell, id: string, interpretedBy: WishOutcome['interpretedBy']): WishOutcome {
    const kinds: Record<Spell['kind'], WishOutcome['kind']> = {
        answer: 'answer',
        find: 'query',
        aggregate: 'query',
        collectionView: 'view',
        shell: 'shell',
        playground: 'playground',
        dashboard: 'view',
        newDocument: 'document',
        tool: 'tool',
        command: 'command',
        agent: 'agent',
        link: 'link',
    };
    return {
        id,
        kind: kinds[spell.kind],
        title: spell.title,
        message: spell.message,
        detail: codeFor(spell),
        interpretedBy,
        ...actionFor(spell),
    };
}
