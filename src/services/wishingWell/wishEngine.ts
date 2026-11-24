/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { z } from 'zod';
import { withoutControlCharacters } from '../../documentdb/shell/shellWish';
import { type WishOutcome } from '../../webviews/documentdb/wishingWell/wishingWellTypes';
import { toShellQuery } from './wishQuery';

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
              readonly database?: string;
              readonly collection?: string;
              readonly filter?: string;
              readonly project?: string;
              readonly sort?: string;
              readonly limit?: number;
          }
        /** Read-only; a pipeline with `$out` or `$merge` is refused when parsed. */
        | {
              readonly kind: 'aggregate';
              readonly database?: string;
              readonly collection?: string;
              readonly pipeline: string;
          }
        | {
              readonly kind: 'collectionView';
              readonly database?: string;
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
        | { readonly kind: 'newDocument'; readonly database?: string; readonly collection?: string }
        | { readonly kind: 'tool'; readonly tool: WishTool; readonly database?: string; readonly collection?: string }
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
        keywords: /\bzoom in\b|\bcan'?t see\b|\b(make|text|font|everything|screen) [\w ]{0,20}\b(bigger|larger)\b/i,
    },
    {
        id: 'workbench.action.zoomOut',
        summary: 'Make everything on screen smaller',
        label: () => l10n.t('Zoom out'),
        keywords: /\bzoom out\b|\b(make|text|font|everything|screen) [\w ]{0,20}\bsmaller\b/i,
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
        keywords: /\b(all commands|command palette)\b/i,
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
    /** `path: type` lines for other collections (all of a small database, else those the wish names), by name. */
    readonly fieldsByCollection?: Readonly<Record<string, readonly string[]>>;
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
        '1. {"spell":"answer"} — questions, explanations, advice, jokes. "message" IS the answer itself (plain text, at most 150 words), never a description of it.',
        '2. {"spell":"find","collection":"...","filter":{...},"project":{...},"sort":{...}} — answer a question about the data by reading documents; add "limit" only when the wish asks for a number of them. Runs read-only right away.',
        '3. {"spell":"aggregate","collection":"...","pipeline":[...]} — counts, sums, groupings, top-N, joins. Runs read-only right away; $out and $merge are not allowed.',
        '4. {"spell":"collectionView","collection":"...","filter":{...},"sort":{...},"tab":"documents|indexes|insights"} — show documents in the collection view; "indexes" manages indexes; "insights" explains and speeds up a slow query with index advice.',
        '5. {"spell":"shell","command":"..."} — open the interactive DocumentDB shell with one command typed in, ready for Enter.',
        '6. {"spell":"playground","script":"..."} — anything that CHANGES data (insert, update, delete, sample data, create index, drop) or a multi-step script. DocumentDB API shell JavaScript, e.g. db.getCollection(\'orders\').insertMany([...]). Comment it briefly; the user reviews and runs it.',
        '7. {"spell":"dashboard"} — the cluster dashboard: health, sizes, databases and collections at a glance.',
        '8. {"spell":"newDocument","collection":"..."} — open the editor for one new document.',
        '9. {"spell":"tool","tool":"import|export|diagnose|createCollection|createDatabase","collection":"..."} — import loads a JSON file the user picks; export writes the whole collection to a JSON file (no filter, no CSV, not a backup); diagnose checks a connection problem; createCollection and createDatabase ask the user for the name.',
        '10. {"spell":"command","commandId":"...","argument":"..."} — run one of these VS Code commands; "argument" only where noted:',
        commands,
        '11. {"spell":"agent","prompt":"..."} — work outside the database: writing or changing code and files in the workspace, research. "prompt" is a complete instruction for the Copilot agent.',
        '12. {"spell":"link","url":"https://..."} — a web page that grants the wish.',
        'Spells with "collection" (find, aggregate, collectionView, newDocument, tool) also take "database"; it defaults to the current one.',
        'Every spell also has "title" (at most 8 words) and "message". For "answer", "message" is the answer. For every other spell, "message" says in one or two sentences what will happen and names anything the query leaves out or assumes.',
        'filter, project, sort and pipeline are JSON; dates as {"$date":"2024-01-01T00:00:00Z"}, ids as {"$oid":"..."}.',
    ].join('\n');
}

function fieldLine(collection: string, fields: readonly string[]): string {
    return `Fields of ${JSON.stringify(collection)}: ${fields
        .slice(0, 80)
        .map((field) => clip(field, 120))
        .join(', ')}.`;
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
                `Databases: ${quoteList(scope.databaseNames, 40)}. Spells that need a collection also need "database".`,
            );
        }
        if (scope.collectionName) {
            where.push(`Current collection: "${scope.collectionName}".`);
        }
        if (scope.fields?.length) {
            where.push(fieldLine(scope.collectionName ?? '', scope.fields));
        }
        for (const [name, fields] of Object.entries(scope.fieldsByCollection ?? {})) {
            if (name !== scope.collectionName && fields.length > 0) {
                where.push(fieldLine(name, fields));
            }
        }
        where.push(
            'Use only field names listed here. If the wish needs a collection whose fields are not listed, say in "message" that its field names are a guess.',
        );
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
const namespace = { database: z.string().optional(), collection: z.string().optional() };
const spellReply = z.discriminatedUnion('spell', [
    // Small models sometimes put the answer in "answer" and describe it in "message".
    z.object({
        spell: z.literal('answer'),
        title: text.title,
        message: z.string().optional(),
        answer: z.string().optional(),
    }),
    z.object({
        spell: z.literal('find'),
        ...namespace,
        filter: jsonish,
        project: jsonish,
        sort: jsonish,
        limit: z.number().int().positive().optional(),
        ...text,
    }),
    z.object({ spell: z.literal('aggregate'), ...namespace, pipeline: jsonish, ...text }),
    z.object({
        spell: z.literal('collectionView'),
        ...namespace,
        filter: jsonish,
        project: jsonish,
        sort: jsonish,
        tab: z.enum(['documents', 'indexes', 'insights']).optional(),
        ...text,
    }),
    z.object({ spell: z.literal('shell'), command: z.string().optional(), ...text }),
    z.object({ spell: z.literal('playground'), script: z.string().min(1), ...text }),
    z.object({ spell: z.literal('dashboard'), ...text }),
    z.object({ spell: z.literal('newDocument'), ...namespace, ...text }),
    z.object({
        spell: z.literal('tool'),
        tool: z.enum(['import', 'export', 'diagnose', 'createCollection', 'createDatabase']),
        ...namespace,
        ...text,
    }),
    z.object({ spell: z.literal('command'), commandId: z.string().min(1), argument: z.string().optional(), ...text }),
    z.object({ spell: z.literal('agent'), prompt: z.string().min(1), ...text }),
    z.object({ spell: z.literal('link'), url: z.string().min(1), ...text }),
]);

/** Code is never cut: a cut filter or pipeline cannot parse, so one too long is refused instead. */
function asCode(name: string, value: unknown, toText: (raw: string) => string = (raw) => raw): CodeText {
    if (value === undefined) {
        return { text: undefined };
    }
    const raw = toText(typeof value === 'string' ? value.trim() : JSON.stringify(value));
    if (raw.length > MAX_CODE) {
        return { problem: `"${name}" is too long: keep it under ${MAX_CODE} characters` };
    }
    return { text: raw.length > 0 && raw !== '{}' ? raw : undefined };
}

type CodeText = { readonly text: string | undefined } | { readonly problem: string };

/** A find or view query as the shell text the read and the collection view both parse. */
function readQuery(value: {
    readonly filter?: unknown;
    readonly project?: unknown;
    readonly sort?: unknown;
}): { filter?: string; project?: string; sort?: string } | { problem: string } {
    const parts = {
        filter: asCode('filter', value.filter, toShellQuery),
        project: asCode('project', value.project, toShellQuery),
        sort: asCode('sort', value.sort, toShellQuery),
    };
    for (const part of Object.values(parts)) {
        if ('problem' in part) {
            return { problem: part.problem };
        }
    }
    const text = (part: CodeText): string | undefined => ('text' in part ? part.text : undefined);
    return { filter: text(parts.filter), project: text(parts.project), sort: text(parts.sort) };
}

function optionalName(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? clip(trimmed, 255) : undefined;
}

/** Reasons are read by the model or agent that wrote the spell, like the spell menu, so English. */
function describeIssues(error: z.ZodError): string {
    return error.issues
        .slice(0, 3)
        .map((issue) =>
            issue.path.length > 0 ? `"${issue.path.map(String).join('.')}": ${issue.message}` : issue.message,
        )
        .join('; ');
}

/** A pipeline's stages, or why it is not a list of stages. */
function readPipeline(value: unknown): { stages: unknown[] } | { problem: string } {
    let pipeline = value;
    if (typeof value === 'string') {
        try {
            pipeline = JSON.parse(value);
        } catch (error) {
            // The read parses it the same way, so it could never run.
            return {
                problem: `"pipeline" is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
    }
    return Array.isArray(pipeline) ? { stages: pipeline } : { problem: '"pipeline" must be a list of stages' };
}

/** Why a pipeline cannot run, checked before anything reaches the database. */
function pipelineProblem(value: unknown): string | undefined {
    const pipeline = readPipeline(value);
    if ('problem' in pipeline) {
        return pipeline.problem;
    }
    let stage: string | undefined;
    try {
        stage = writeStage(pipeline.stages);
    } catch {
        return '"pipeline" is nested too deeply';
    }
    return stage ? `aggregate pipeline uses ${stage}, which writes` : undefined;
}

/** The reply's JSON object, checked against the spell shapes, or why it is not one. */
function readReply(reply: string): { value: z.infer<typeof spellReply> } | { reason: string } {
    const start = reply.indexOf('{');
    const end = reply.lastIndexOf('}');
    if (start < 0 || end <= start) {
        return { reason: 'the reply holds no JSON object' };
    }

    let json: unknown;
    try {
        json = JSON.parse(reply.slice(start, end + 1));
    } catch (error) {
        return { reason: `the reply is not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
    }

    const parsed = spellReply.safeParse(json);
    return parsed.success ? { value: parsed.data } : { reason: describeIssues(parsed.error) };
}

export interface SpellResult {
    readonly spell?: Spell;
    /** Names the field or rule that failed, so a model or agent can correct its spell. */
    readonly reason?: string;
}

/**
 * Reads a spell from a model's reply. Anything that is not a valid spell, including a command
 * outside {@link WISH_COMMANDS}, a non-HTTPS link or a pipeline that writes, comes back with a reason.
 */
export function parseSpellResult(reply: string): SpellResult {
    const read = readReply(reply);
    if ('reason' in read) {
        return { reason: read.reason };
    }

    const value = read.value;
    if (value.spell === 'answer') {
        const answer = [value.answer, value.message].find((candidate) => candidate?.trim());
        return answer
            ? { spell: { kind: 'answer', title: clip(value.title, MAX_TITLE), message: clip(answer, MAX_MESSAGE) } }
            : { reason: '"message" is required for an answer: it holds the answer' };
    }
    const base = { title: clip(value.title, MAX_TITLE), message: clip(value.message, MAX_MESSAGE) };
    switch (value.spell) {
        case 'find': {
            const query = readQuery(value);
            if ('problem' in query) {
                return { reason: query.problem };
            }
            return {
                spell: {
                    kind: 'find',
                    ...base,
                    database: optionalName(value.database),
                    collection: optionalName(value.collection),
                    ...query,
                    // Kept as asked: the read clamps it to the cap and can then say more rows exist.
                    limit: value.limit,
                },
            };
        }
        case 'aggregate': {
            const code = asCode('pipeline', value.pipeline);
            if ('problem' in code) {
                return { reason: code.problem };
            }
            const pipeline = code.text;
            if (!pipeline) {
                return { reason: '"pipeline" is required for aggregate' };
            }
            const problem = pipelineProblem(value.pipeline);
            if (problem) {
                return { reason: problem };
            }
            return {
                spell: {
                    kind: 'aggregate',
                    ...base,
                    database: optionalName(value.database),
                    collection: optionalName(value.collection),
                    pipeline,
                },
            };
        }
        case 'collectionView': {
            const query = readQuery(value);
            if ('problem' in query) {
                return { reason: query.problem };
            }
            return {
                spell: {
                    kind: 'collectionView',
                    ...base,
                    database: optionalName(value.database),
                    collection: optionalName(value.collection),
                    ...query,
                    tab: value.tab,
                },
            };
        }
        case 'shell': {
            const command = withoutControlCharacters(value.command ?? '');
            return {
                spell: {
                    kind: 'shell',
                    ...base,
                    command: command.trim() ? clip(command, MAX_CODE) : undefined,
                },
            };
        }
        case 'playground':
            return { spell: { kind: 'playground', ...base, script: clip(value.script, MAX_CODE) } };
        case 'dashboard':
            return { spell: { kind: 'dashboard', ...base } };
        case 'newDocument':
            return {
                spell: {
                    kind: 'newDocument',
                    ...base,
                    database: optionalName(value.database),
                    collection: optionalName(value.collection),
                },
            };
        case 'tool':
            return {
                spell: {
                    kind: 'tool',
                    ...base,
                    tool: value.tool,
                    database: optionalName(value.database),
                    collection: optionalName(value.collection),
                },
            };
        case 'command': {
            const command = WISH_COMMANDS.find((candidate) => candidate.id === value.commandId);
            if (!command) {
                return {
                    reason: `"commandId": ${JSON.stringify(clip(value.commandId, 100))} is not a command the well may run`,
                };
            }
            const argument = command.takesText && value.argument?.trim() ? clip(value.argument, 200) : undefined;
            return { spell: { kind: 'command', ...base, commandId: command.id, argument } };
        }
        case 'agent':
            return { spell: { kind: 'agent', ...base, prompt: clip(value.prompt, MAX_MESSAGE) } };
        case 'link':
            return isHttpsUrl(value.url)
                ? { spell: { kind: 'link', ...base, url: value.url } }
                : { reason: '"url" must be an https:// link' };
    }
}

/** {@link parseSpellResult} without the reason, for callers that only fall back. */
export function parseSpell(reply: string): Spell | undefined {
    return parseSpellResult(reply).spell;
}

/**
 * A reply refused only because its pipeline writes ($out, $merge), as a playground draft the user
 * reviews and runs. `undefined` for a reply that parses, or that is refused for any other reason.
 */
export function writeAggregateToPlayground(reply: string, fallbackCollection?: string): Spell | undefined {
    const read = readReply(reply);
    if ('reason' in read || read.value.spell !== 'aggregate') {
        return undefined;
    }
    const value = read.value;
    const pipeline = readPipeline(value.pipeline);
    let stage: string | undefined;
    try {
        stage = 'stages' in pipeline ? writeStage(pipeline.stages) : undefined;
    } catch {
        return undefined;
    }
    if (!stage || 'problem' in pipeline) {
        return undefined;
    }
    const collection = `getCollection(${quoteJs(optionalName(value.collection) ?? fallbackCollection ?? 'collectionName')})`;
    const database = optionalName(value.database);
    // The playground is bound to the scope's database; a named one is where the stage writes.
    const target = database ? `db.getSiblingDB(${quoteJs(database)}).${collection}` : `db.${collection}`;
    return {
        kind: 'playground',
        title: clip(value.title, MAX_TITLE),
        message: l10n.t(
            'This pipeline writes with {0}, so the well drafted it in a playground for you to review and run.',
            stage,
        ),
        // Not clipped: a cut pipeline would not parse. Extended JSON ($date, $oid) goes through EJSON.parse.
        script: [
            `// This pipeline writes with ${stage}: check where it writes before you run it.`,
            /"\$(date|oid|numberLong|numberDecimal|binary|regularExpression)"/.test(JSON.stringify(pipeline.stages))
                ? `${target}.aggregate(EJSON.parse(${JSON.stringify(JSON.stringify(pipeline.stages))}))`
                : `${target}.aggregate(${JSON.stringify(pipeline.stages, undefined, 2)})`,
        ].join('\n'),
    };
}

/** Where a spell points, as the card names it: `shop.orders`, or just `orders`. */
function spellTarget(spell: Spell): string | undefined {
    if (!('collection' in spell) || !spell.collection) {
        return undefined;
    }
    return spell.database ? `${spell.database}.${spell.collection}` : spell.collection;
}

function toolLabel(tool: WishTool): string {
    const labels: Record<WishTool, string> = {
        import: l10n.t('Import documents'),
        export: l10n.t('Export documents'),
        diagnose: l10n.t('Diagnose the connection'),
        createCollection: l10n.t('Create a collection'),
        createDatabase: l10n.t('Create a database'),
    };
    return labels[tool];
}

/** What a tool's grant really does, for the card, naming the collection the documents go into or come from. */
function toolHint(spell: Extract<Spell, { kind: 'tool' }>): string {
    const where = spellTarget(spell);
    if (where && spell.tool === 'import') {
        return l10n.t('Imports a JSON file you pick into {0}.', where);
    }
    if (where && spell.tool === 'export') {
        return l10n.t('Exports the whole of {0} as JSON to a file you pick.', where);
    }
    const hints: Record<WishTool, string> = {
        import: l10n.t('Imports a JSON file you pick.'),
        export: l10n.t('Exports the whole collection as JSON to a file you pick.'),
        diagnose: l10n.t('Opens the connection diagnostics.'),
        createCollection: l10n.t('Asks you for the name of the new collection.'),
        createDatabase: l10n.t('Asks you for the name of the new database.'),
    };
    return hints[spell.tool];
}

/** The message a spell sent without one gets, so it is never shown as the sender's own words. */
export function defaultMessage(spell: Spell): string {
    return defaultText(spell).message;
}

/** Card text for a spell an agent sent without its own, built from what the spell does. */
function defaultText(spell: Spell): SpellText {
    const where = spellTarget(spell) ?? l10n.t('this collection');
    switch (spell.kind) {
        case 'answer':
            return { title: l10n.t('An answer'), message: spell.message };
        case 'find':
            return { title: l10n.t('Find in {0}', where), message: l10n.t('Reads documents in {0}.', where) };
        case 'aggregate':
            return {
                title: l10n.t('Aggregation on {0}', where),
                message: l10n.t('Runs a read-only aggregation on {0}.', where),
            };
        case 'collectionView':
            if (spell.tab === 'insights') {
                return {
                    title: l10n.t('Query Insights for {0}', where),
                    message: l10n.t('Opens Query Insights for {0}.', where),
                };
            }
            if (spell.tab === 'indexes') {
                return { title: l10n.t('Indexes of {0}', where), message: l10n.t('Opens the indexes of {0}.', where) };
            }
            return {
                title: l10n.t('Documents in {0}', where),
                message: l10n.t('Opens {0} in the collection view.', where),
            };
        case 'shell':
            return {
                title: l10n.t('Interactive shell'),
                message: spell.command
                    ? l10n.t('Opens the shell with the command typed in, ready for Enter.')
                    : l10n.t('Opens the interactive shell.'),
            };
        case 'playground':
            return {
                title: l10n.t('A playground script'),
                message: l10n.t('Opens the script in a playground. Nothing runs until you run it.'),
            };
        case 'dashboard':
            return { title: l10n.t('Cluster dashboard'), message: l10n.t('Opens the cluster dashboard.') };
        case 'newDocument':
            return {
                title: l10n.t('A new document in {0}', where),
                message: l10n.t('Opens the editor for a new document in {0}.', where),
            };
        case 'tool':
            return { title: toolLabel(spell.tool), message: toolHint(spell) };
        case 'command': {
            const label =
                WISH_COMMANDS.find((candidate) => candidate.id === spell.commandId)?.label() ?? spell.commandId;
            return { title: label, message: l10n.t('Runs "{0}".', label) };
        }
        case 'agent':
            return {
                title: l10n.t('A job for Copilot'),
                message: l10n.t('Opens Copilot Chat in agent mode with this request.'),
            };
        case 'link':
            return { title: l10n.t('A web page'), message: l10n.t('Opens {0}.', spell.url) };
    }
}

function givenText(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/**
 * A spell an agent wrote itself, checked exactly like a Copilot reply. A missing title or message
 * is built from the spell's kind and target; an agent spell without a prompt hands over the wish.
 */
export function parseAgentSpell(spell: Readonly<Record<string, unknown>>, wish: string): SpellResult {
    const title = givenText(spell.title);
    const message = givenText(spell.message);
    if (spell.spell === 'answer' && !message && !givenText(spell.answer)) {
        return { reason: '"message" is required for an answer: it holds the answer' };
    }

    const result = parseSpellResult(
        JSON.stringify({
            ...(spell.spell === 'agent' ? { prompt: wish } : {}),
            ...spell,
            title: title ?? '-',
            message: message ?? '-',
        }),
    );
    if (!result.spell) {
        return result;
    }
    const fallback = defaultText(result.spell);
    return {
        spell: {
            ...result.spell,
            title: title ? result.spell.title : clip(fallback.title, MAX_TITLE),
            message: message ? result.spell.message : clip(fallback.message, MAX_MESSAGE),
        },
    };
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

/** The first stage that writes, wherever it hides ($facet, $lookup, $unionWith). */
function writeStage(value: unknown): string | undefined {
    if (Array.isArray(value)) {
        for (const item of value) {
            const stage = writeStage(item);
            if (stage) {
                return stage;
            }
        }
        return undefined;
    }
    if (typeof value === 'object' && value !== null) {
        for (const [key, inner] of Object.entries(value)) {
            const stage = WRITE_STAGES.has(key) ? key : writeStage(inner);
            if (stage) {
                return stage;
            }
        }
    }
    return undefined;
}

/** `true` when a pipeline would write, wherever the stage hides ($facet, $lookup, $unionWith). */
export function pipelineWrites(value: unknown): boolean {
    return writeStage(value) !== undefined;
}

/** Read verbs with a generic noun; a wish that names a real collection needs neither. */
const DATA_WISH =
    /\b(find|show|list|query|search|get|see|view|check|which|who|how many|count|top|latest|newest|oldest)\b[\s\S]*\b(documents?|records?|rows?|data|items?|entries)\b/i;
/** Verbs that ask for a change. Without Copilot the well never guesses which write call, so this only routes. */
const CHANGE_VERB =
    /\b(insert|add|create|update|delete|remove|drop|seed|generate|fake|rename|set|populate|clear|purge|wipe|change|modify|edit|mark|increase|decrease|replace|fix|truncate|empty|get rid of)\b/i;
const CHANGE_NOUNS =
    /\b(documents?|records?|rows?|data|users?|customers?|orders?|items?|products?|index(es)?|fields?|entries|this collection)\b/i;
/** Questions and reads lead with these, so "can you show the orders I need to delete" stays a read. */
const READ_LEAD =
    /^\s*(?:(?:please|hey|ok|okay|now|so|can you|could you|would you|i want to|i'?d like to|help me|let me)[\s,]+)*(show|list|find|get|fetch|display|search|look|see|view|check|select|any|which|what|how|who|when|where|why|count|give me|tell me|is|are|was|were|did|does|do)\b/i;
/** A read that goes on to change: "find all test orders and delete them". */
const THEN_CHANGE = /\band (then )?(delete|remove|update|change|fix|mark|drop|clear)\b/i;
/** Look like change verbs but are not: "add up the totals", "set up DocumentDB", "a data set". */
const NOT_A_CHANGE = /\b(add up|adds up|set up|sets up|data ?sets?|sets? of|add-ons?)\b/gi;
/** Asks for a script to read with: a find to start from is the honest draft. */
const SCRIPT_ASK = /\b(playground|script|query|report|chart|pipeline|aggregation)\b/i;
/** The whole wish asks for help, so "what can you do to speed up queries" is not one. */
const HELP_WISH =
    /^\W*(please\W+)?help\W*$|^\W*what can (you|the well) do( for me| here)?\W*$|^\W*what can i (wish|ask) for( here)?\W*$/i;
/** A question about the connection's health; the cluster's health is the dashboard's. */
const DIAGNOSE_WISH =
    /\b(diagnose|troubleshoot|health ?check|can'?t connect|cannot connect|connection (problem|issue|error)s?)\b|\bconnection\b.*\bhealthy?\b|\bhealthy?\b.*\bconnection\b/i;
/** The noun ends the request or names what follows, so "create a database user" is not one. */
const NOUN_ENDS = String.raw`(?=\s*[.!?]*\s*$|\s+(called|named|for|in|on)\b|\s+["'\x60])`;
const CREATE_COLLECTION = new RegExp(
    String.raw`(\b(create|add|make)\s+(an?\s+|the\s+)?(new\s+|empty\s+)?|\bnew\s+)collection` + NOUN_ENDS,
    'i',
);
const CREATE_DATABASE = new RegExp(
    String.raw`(\b(create|add|make)\s+(an?\s+|the\s+)?(new\s+|empty\s+)?|\bnew\s+)(database|db)` + NOUN_ENDS,
    'i',
);
/** Asks to run something or names the shell, so a shell expression in the wish is meant for it. */
const RUN_OR_SHELL = /\b(run|execute|exec|shell|repl|mongosh)\b/i;
/** A question that quotes an expression asks about it; only "run" or "execute" types it in. */
const QUESTION = /^\W*(why|how|what|does|do|is|are|can|could|should|when|where|which)\b|\?\s*$/i;
/** Words that may come before the first collection a wish names when it only names what to read. */
const NAME_LEAD =
    /^(the|a|an|all|every|each|my|our|your|some|any|top|first|last|newest|latest|oldest|recent|most|least|biggest|largest|smallest|cheapest|highest|lowest|number|of|total|sum|average|avg|max|maximum|min|minimum|distinct|\d+)$/i;

/** How the keyword fallback was reached: no Copilot at all, or a Copilot reply the well could not use. */
export type KeywordReason = 'unavailable' | 'unreadable';

/** `true` when the wish asks to change data, wherever the verb sits; questions and reads are not. */
function asksForChange(wish: string, scope: WishPromptScope): boolean {
    const text = wish.replace(NOT_A_CHANGE, ' ');
    // "create a query to find…" asks for a read, whatever verb asks for it.
    const readsInTheEnd = /\bto (find|show|list|get|count|see|fetch|search|look up|report)\b/i.test(text);
    if ((READ_LEAD.test(text) || readsInTheEnd) && !THEN_CHANGE.test(text)) {
        return false;
    }
    const aboutData =
        CHANGE_NOUNS.test(text) ||
        mentionedCollections(text, scopeCollections(scope)).length > 0 ||
        scope.collectionName !== undefined;
    return aboutData && CHANGE_VERB.test(text);
}

/** Questions about every collection or database that the cluster dashboard answers on one page. */
const DASHBOARD_WISH =
    /\b(each|every|all|per) (collections?|databases?)\b|\b(collections?|databases?) (sizes?|stats)\b|\bhow (big|large)\b[\s\S]*\b(collections?|databases?|cluster)\b|\b(biggest|largest|smallest) (collections?|databases?)\b|\bwhich (collection|database)s? (is|are|has|have|uses?)\b|\bsizes? of\b|\bhow much (space|storage|disk)\b|\bsummary of (my|the|this) (database|cluster|data)\b|\b(list|show|which|how many)\b[\s\S]*\b(collections|databases)\b/i;

/** "what's in this database?", "what do I have in shop": the user looks around, which the dashboard shows. */
const LOOK_AROUND =
    /^\W*(?:what['\u2019]?s|what is|what do (?:i|we) have|what have (?:i|we) got)\s+in\s+(?:(?:this|my|our|the)\s+)?([\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)*)(?:\s+(?:database|db|cluster))?\W*$/iu;
const PLACE_WORDS = /^(here|there|database|db|cluster|server|connection|data)$/i;

/** The place a look-around wish asks about: a place word or a database name, never a collection. */
function lookAroundPlace(request: string, scope: WishPromptScope): string | undefined {
    const place = LOOK_AROUND.exec(request)?.[1];
    if (!place) {
        return undefined;
    }
    const databases = [scope.databaseName, ...(scope.databaseNames ?? [])].filter(
        (name): name is string => name !== undefined,
    );
    const isDatabase = databases.some((name) => name.toLowerCase() === place.toLowerCase());
    return PLACE_WORDS.test(place) || isDatabase ? place.toLowerCase() : undefined;
}

const FILTER_WORDS =
    /\b(where|with|without|over|under|above|below|between|before|after|since|named|called|which|who|whose|contains?|containing|equals?|greater|less|more than|fewer than|at least|at most|not|today|yesterday)\b|\b(last|this|past|previous) (\d+ )?(minute|hour|day|week|month|year)s?\b|\b(in|from) \d{4}\b|[<>=]/i;
/** "customer 42" is a value, not a limit; "last 3 days" is a filter. */
const LIMIT_WORDS =
    /\b(top|first|last|latest|newest|oldest|recent|limit( to)?) \d+\b(?! (minute|hour|day|week|month|year)s?\b)|\b\d+ (newest|latest|oldest)\b|\b(show|list|find|get|fetch|display|export|give)( me)?( the)? \d+\b(?! (minute|hour|day|week|month|year)s?\b)/i;
const SORT_WORDS =
    /\b(newest|latest|oldest|recent|top|biggest|largest|smallest|highest|lowest|cheapest|most|least|sort(ed)?|order(ed)? by)\b/i;
/** Not bare "total": it is often a field, as in "sorted by total". */
const COUNT_WORDS =
    /\b(how many|count|number of|sum|in total|totals|average|avg|per|max(imum)?|min(imum)?|group(ed)? by|distinct)\b/i;
/** Words that only say "show me the documents"; anything else in a wish is something left undone. */
const READ_FILLER =
    /\b(please|can|could|would|you|i|want|to|see|show|list|find|get|fetch|display|open|view|me|my|all|the|a|an|of|in|from|documents?|records?|rows?|data|entries|collection|everything|items?|whole)\b/gi;
/** What an export wish says about the export itself, which the export tool covers. */
const EXPORT_FILLER = /\b(export|json|csv|files?|as|into|out)\b/gi;

/** Turns a wish into a comment line that cannot break out of the comment. */
function asComment(wish: string): string {
    return `// Wish: ${wish.replace(/[\r\n\u2028\u2029]+/g, ' ').trim()}`;
}

function quoteJs(name: string): string {
    // JSON escaping covers backslashes and newlines; only the quote style changes.
    return `'${JSON.stringify(name).slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'")}'`;
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The forms a wish may use for a name: the name, and for a plural also its singular. */
function nameForms(name: string, singular: boolean): string[] {
    const lower = name.toLowerCase();
    const forms = [lower];
    if (singular && lower.length > 3) {
        if (lower.endsWith('ies')) {
            forms.push(`${lower.slice(0, -3)}y`);
        }
        if (/(s|x|z|ch|sh)es$/.test(lower)) {
            forms.push(lower.slice(0, -2));
        }
        if (lower.endsWith('s') && !lower.endsWith('ss')) {
            forms.push(lower.slice(0, -1));
        }
    }
    return forms;
}

/** Scripts written without spaces between words, where a name sits inside the sentence. */
const UNSPACED_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u;

/** A whole-word match, so "order" is not found inside "reorder" or "order_items". */
function wordPattern(form: string): RegExp {
    if (UNSPACED_SCRIPT.test(form)) {
        return new RegExp(escapeRegExp(form), 'giu');
    }
    return new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(form)}(?![\\p{L}\\p{N}_])`, 'giu');
}

/** "I wish I could see the orders" asks to see the orders, not about a "wishes" collection. */
const WISH_LEAD =
    /^\W*(?:i\s+wish|my\s+wish(?:\s+is)?)(?:\s+(?:for|that|to|i\s+(?:could|had|knew|would|might)))?\b[\s:,.-]*/i;

function withoutWishLead(wish: string): string {
    const rest = wish.replace(WISH_LEAD, '');
    return rest.trim().length > 0 ? rest : wish;
}

interface Mention {
    readonly name: string;
    readonly start: number;
    readonly end: number;
}

/** Each name the wish mentions once, ordered by where it appears, with where it was found. */
function mentionSpans(wish: string, names: readonly string[] | undefined, singular: boolean): Mention[] {
    const lower = wish.toLowerCase();
    const spans: (Mention & { exactness: number })[] = [];
    for (const name of new Set(names ?? [])) {
        for (const form of name ? nameForms(name, singular) : []) {
            // Compiling a pattern per name is slow with thousands of collections, so only names in the text.
            if (!lower.includes(form)) {
                continue;
            }
            for (const match of wish.matchAll(wordPattern(form))) {
                const exactness = match[0] === name ? 2 : Number(form === name.toLowerCase());
                spans.push({ name, start: match.index, end: match.index + match[0].length, exactness });
            }
        }
    }
    // At one position the longer name wins, then the exact name over a singular or another case.
    spans.sort((a, b) => a.start - b.start || b.end - a.end || b.exactness - a.exactness);
    const accepted: Mention[] = [];
    let covered = 0;
    for (const span of spans) {
        if (span.start >= covered) {
            covered = span.end;
            accepted.push(span);
        }
    }
    // In "customer orders" the last name is the head noun; the ones before it only describe it.
    const ordered: Mention[] = [];
    let run: Mention[] = [];
    for (const span of accepted) {
        const previous = run[run.length - 1];
        if (previous && !/^\s*$/.test(wish.slice(previous.end, span.start))) {
            ordered.push(...run.reverse());
            run = [];
        }
        run.push(span);
    }
    ordered.push(...run.reverse());
    return ordered.filter((span, index) => ordered.findIndex((other) => other.name === span.name) === index);
}

function mentions(wish: string, names: readonly string[] | undefined, singular: boolean): string[] {
    return mentionSpans(withoutWishLead(wish), names, singular).map((span) => span.name);
}

/** Every collection in `names` the wish mentions, by name or singular, in the order they appear. */
export function mentionedCollections(wish: string, names: readonly string[] | undefined): string[] {
    return mentions(wish, names, true);
}

/** The first name the wish puts right after `lead` (which ends in `$`), as in "into customers". */
function nameAfter(wish: string, names: readonly string[], lead: RegExp): string | undefined {
    return mentionSpans(wish, names, true).find((span) => lead.test(wish.slice(0, span.start)))?.name;
}

function scopeCollections(scope: WishPromptScope): string[] {
    return [...(scope.collectionNames ?? []), ...(scope.collectionName ? [scope.collectionName] : [])];
}

/** "a", "a or b", "a, b or c". */
function orList(items: readonly string[]): string {
    return items.length <= 1
        ? (items[0] ?? '')
        : l10n.t('{0} or {1}', items.slice(0, -1).join(', '), items[items.length - 1]);
}

/** What a keyword pick leaves out of the wish, as "apply the filter or run the count". */
function droppedParts(wish: string): string | undefined {
    const nouns = [
        FILTER_WORDS.test(wish) ? l10n.t('the filter') : undefined,
        SORT_WORDS.test(wish) ? l10n.t('the sort order') : undefined,
        LIMIT_WORDS.test(wish) ? l10n.t('the limit') : undefined,
    ].filter((noun): noun is string => noun !== undefined);
    const parts = [
        nouns.length > 0 ? l10n.t('apply {0}', orList(nouns)) : undefined,
        COUNT_WORDS.test(wish) ? l10n.t('run the count') : undefined,
    ].filter((part): part is string => part !== undefined);
    return parts.length > 0 ? orList(parts) : undefined;
}

/** The words of a read wish beyond "show me the documents in orders", which a keyword pick cannot apply. */
function leftover(wish: string, collection: string, verb: 'open' | 'export'): string {
    let rest = wish;
    for (const form of nameForms(collection, true)) {
        rest = rest.replace(wordPattern(form), ' ');
    }
    rest = rest.replace(READ_FILLER, ' ');
    if (verb === 'export') {
        rest = rest.replace(EXPORT_FILLER, ' ');
    }
    return rest
        .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** The keyword fallback's standard line, honest about why it matched words at all. */
function matchedWords(copilot: KeywordReason): string {
    return copilot === 'unreadable'
        ? l10n.t("Copilot's reply could not be used, so the well matched your words to a tool instead.")
        : l10n.t('Copilot is not available, so the well matched your words to a tool.');
}

/** What a keyword pick tells the user about the part of the wish it did not do. */
function honestOpen(wish: string, collection: string, verb: 'open' | 'export', copilot: KeywordReason): string {
    const rest = leftover(wish, collection, verb);
    const skipped = droppedParts(wish) ?? (rest.length > 0 ? l10n.t('apply "{0}"', rest) : undefined);
    if (!skipped) {
        return matchedWords(copilot);
    }
    if (copilot === 'unreadable') {
        return verb === 'open'
            ? l10n.t(
                  "Copilot's reply could not be used, so the well matched your words: it can open {0}, but it did not {1}.",
                  collection,
                  skipped,
              )
            : l10n.t(
                  "Copilot's reply could not be used, so the well matched your words: it can export {0}, but it did not {1}.",
                  collection,
                  skipped,
              );
    }
    return verb === 'open'
        ? l10n.t('Without Copilot I can open {0}, but I did not {1}.', collection, skipped)
        : l10n.t('Without Copilot I can export {0}, but I did not {1}.', collection, skipped);
}

/** Words that leave "drop the orders collection" about the whole collection. */
const WHOLE_COLLECTION_WORDS =
    /\b(drop|delete|remove|the|a|an|this|that|my|our|whole|entire|please|can|could|you|i|want|to|collection|table)\b/gi;

/** "drop orders" or "delete the orders collection", with nothing that narrows it to some documents. */
function dropsWholeCollection(wish: string, collection: string | undefined): boolean {
    let rest = wish;
    for (const form of collection ? nameForms(collection, true) : []) {
        rest = rest.replace(wordPattern(form), ' ');
    }
    return rest.replace(WHOLE_COLLECTION_WORDS, ' ').replace(/[^\p{L}\p{N}]+/gu, '').length === 0;
}

/** The calls a change wish chooses from, as comments: the keyword well never writes one itself. */
function changeCalls(wish: string, collection: string | undefined, names: readonly string[]): string[] {
    const deleteMany = '//   deleteMany({ <filter> })   // cannot be undone';
    if (/\bindex(es)?\b/i.test(wish)) {
        return /\b(drop|remove|delete)\b/i.test(wish)
            ? ["//   dropIndex('<index name>')"]
            : ['//   createIndex({ <field>: 1 })'];
    }
    const aboutDocuments = /\b(documents?|records?|rows?|entries|fields?|columns?|keys?|values?)\b/i.test(wish);
    if (!aboutDocuments && (/\bdrop\b/i.test(wish) || /\b(delete|remove)\b[\s\S]*\bcollection\b/i.test(wish))) {
        const drop = '//   drop()   // deletes the whole collection and its indexes; cannot be undone';
        // "drop the test orders" may mean some documents, so the call that keeps the rest comes first.
        return dropsWholeCollection(wish, collection) ? [drop] : [deleteMany, drop];
    }
    if (/\brename\b/i.test(wish)) {
        const renamesCollection =
            !/\bfields?\b/i.test(wish) &&
            (/\bcollection\b/i.test(wish) || nameAfter(wish, names, /\brename\s+(the\s+)?$/i) !== undefined);
        return renamesCollection
            ? ["//   renameCollection('<new name>')"]
            : ["//   updateMany({}, { $rename: { '<old name>': '<new name>' } })"];
    }
    return [
        '//   insertMany([{ ... }])',
        '//   updateMany({ <filter> }, { $set: { <field>: <value> } })',
        "//   updateMany({ <filter> }, { $unset: { <field>: '' } })",
        deleteMany,
    ];
}

/**
 * Without Copilot the well cannot tell which write a wish means ("remove the tag" is an $unset, not a
 * deleteMany), so it never drafts one: it opens a find on the collection and lists the calls to choose
 * from. Nothing runs until the user runs it.
 */
function startingScript(
    wish: string,
    collection: string | undefined,
    change: boolean,
    copilot: KeywordReason,
    names: readonly string[],
): string {
    const target = `db.getCollection(${quoteJs(collection ?? 'collectionName')})`;
    const why = copilot === 'unreadable' ? "Copilot's reply could not be used" : 'Copilot is not available';
    const choices = change
        ? [
              `// ${why} to write this change. Look at the documents first, then pick the call you need:`,
              ...changeCalls(wish, collection, names),
          ]
        : [`// ${why} to write this query. Start from this find and add a filter, sort or limit.`];
    return [asComment(wish), ...choices, `${target}.find({})`].join('\n');
}

/** Ends a `db.` expression at the first space outside brackets and quotes. */
function expressionAt(text: string, start: number): string {
    let depth = 0;
    let quote: string | undefined;
    let end = start;
    for (; end < text.length; end++) {
        const char = text[end];
        if (quote) {
            if (char === '\\') {
                end++;
            } else if (char === quote) {
                quote = undefined;
            }
        } else if (char === '"' || char === "'" || char === '`') {
            quote = char;
        } else if ('([{'.includes(char)) {
            depth++;
        } else if (')]}'.includes(char)) {
            depth--;
        } else if (/\s/.test(char) && depth <= 0) {
            break;
        }
    }
    return text.slice(start, end).replace(/[.,;:!?]+$/, '');
}

/** A shell expression the wish asks to run, typed in as written; the user still presses Enter. */
function shellCommand(wish: string, scope: WishPromptScope): string | undefined {
    if (!RUN_OR_SHELL.test(wish) || (QUESTION.test(wish) && !/\b(run|execute|exec)\b/i.test(wish))) {
        return undefined;
    }
    const quoted = /`([^`]+)`/.exec(wish)?.[1].trim();
    const start = wish.search(/\bdb\.[\w$]/);
    const show = /\bshow (dbs|databases|collections|tables)\b/i.exec(wish);
    const use = /\buse ([\w-]+)/.exec(wish);
    const databases = [...(scope.databaseNames ?? []), ...(scope.databaseName ? [scope.databaseName] : [])];
    let command: string | undefined;
    if (quoted && /^(db\.|show\s|use\s)/.test(quoted)) {
        command = quoted;
    } else if (start >= 0) {
        command = expressionAt(wish, start);
    } else if (show) {
        command = `show ${show[1].toLowerCase()}`;
    } else if (use && databases.includes(use[1])) {
        command = `use ${use[1]}`;
    }
    // A line break would read as Enter in the shell.
    return command === undefined
        ? undefined
        : withoutControlCharacters(command.replace(/\s*[\r\n\u2028\u2029]+\s*/g, ' '));
}

/** What the keyword well can do where it was opened, for "help" and "what can you do". */
function helpSpell(scope: WishPromptScope, copilot: KeywordReason): Spell {
    const lines: string[] = [];
    if (scope.connectionName === undefined) {
        lines.push(
            l10n.t('Set up DocumentDB Local, add a connection, or discover your clusters.'),
            l10n.t('Open settings, keyboard shortcuts, extensions or a color theme.'),
            l10n.t('Open the well from a connection, database or collection to work with its data.'),
        );
    } else {
        // Only a name that opens its collection when typed as it is; "stats" opens the dashboard.
        const example = [scope.collectionName, ...(scope.collectionNames ?? []).slice(0, 10)].find((name) => {
            const spell = name ? keywordSpell(name, scope, copilot, false) : undefined;
            return spell?.kind === 'collectionView' && spell.collection === name && spell.tab === undefined;
        });
        if (scope.databaseName) {
            lines.push(
                example
                    ? l10n.t('Open a collection by naming it, such as "{0}".', example)
                    : l10n.t('Open a collection by naming it.'),
                l10n.t('Show the indexes or Query Insights of a collection.'),
                l10n.t('Import a JSON file, or export a whole collection as JSON.'),
                l10n.t('Draft a playground for a change; nothing runs until you run it.'),
                l10n.t('Create a collection; it asks you for the name.'),
            );
        }
        lines.push(l10n.t('Open the dashboard or the shell, diagnose the connection, or create a database.'));
    }
    const lead =
        copilot === 'unreadable'
            ? l10n.t("Copilot's reply could not be used, so the well matched your words. By keywords it can:")
            : l10n.t(
                  'Without Copilot the well matches your words to a tool; it does not read or change data itself. It can:',
              );
    return {
        kind: 'answer',
        title: l10n.t('What the well can do'),
        message: [lead, ...lines.map((line) => `- ${line}`)].join('\n'),
    };
}

/**
 * The keyword fallback used without Copilot, or when Copilot's reply could not be used: a tool
 * launcher, not a query writer. Returns `undefined` when nothing matches; the caller then hands the
 * wish to Copilot agent mode or says honestly that it cannot grant it.
 */
export function matchWishByKeyword(
    wish: string,
    scope: WishPromptScope,
    copilot: KeywordReason = 'unavailable',
): Spell | undefined {
    return keywordSpell(wish, scope, copilot, true);
}

/**
 * `true` when the wish only names what to read: a read verb, or nothing but "the 5 newest" before the
 * name. After an unusable Copilot reply only a read verb counts; anything else goes to agent mode.
 */
function readsNamedCollection(request: string, names: readonly string[], copilot: KeywordReason): boolean {
    if (READ_LEAD.test(request)) {
        return true;
    }
    if (copilot === 'unreadable') {
        return false;
    }
    const first = mentionSpans(request, names, true).reduce(
        (earliest, span) => Math.min(earliest, span.start),
        request.length,
    );
    return request
        .slice(0, first)
        .split(/[^\p{L}\p{N}]+/u)
        .every((word) => word.length === 0 || NAME_LEAD.test(word));
}

/** `help` is false while the help answer looks for a collection name that opens as written. */
function keywordSpell(wish: string, scope: WishPromptScope, copilot: KeywordReason, help: boolean): Spell | undefined {
    const connected = scope.connectionName !== undefined;
    const request = withoutWishLead(wish);
    const names = scopeCollections(scope);
    const named = mentionedCollections(request, names);
    const collection = named[0] ?? scope.collectionName;
    // Where a write lands: "import orders.json into customers" imports into customers.
    const target = nameAfter(request, names, /\b(into|to|in)\s+(the\s+)?$/i) ?? collection;
    const known = { title: '', message: matchedWords(copilot) };

    if (HELP_WISH.test(request)) {
        return help ? helpSpell(scope, copilot) : undefined;
    }

    if (connected) {
        const command = shellCommand(request, scope);
        if (command) {
            return { kind: 'shell', command, ...known, title: l10n.t('Interactive shell') };
        }
        if (DIAGNOSE_WISH.test(request)) {
            return { kind: 'tool', tool: 'diagnose', ...known, title: l10n.t('Diagnose the connection') };
        }
        if (/\b(dashboard|overview|healthy?|stats|statistics)\b/i.test(request)) {
            return { kind: 'dashboard', ...known, title: l10n.t('Cluster dashboard') };
        }
        if (/\b(shell|repl|mongosh)\b/i.test(request)) {
            return { kind: 'shell', ...known, title: l10n.t('Interactive shell') };
        }
        if (/\bimport\b/i.test(request)) {
            return { kind: 'tool', tool: 'import', collection: target, ...known, title: l10n.t('Import documents') };
        }
        if (/\bexport\b/i.test(request)) {
            const csv = /\bcsv\b/i.test(request)
                ? l10n.t('Export writes JSON, not CSV, and always the whole collection.')
                : undefined;
            return {
                kind: 'tool',
                tool: 'export',
                collection,
                title: l10n.t('Export documents'),
                message: [collection ? honestOpen(request, collection, 'export', copilot) : known.message, csv]
                    .filter((part): part is string => part !== undefined)
                    .join(' '),
            };
        }
        const database = mentions(request, scope.databaseNames, false)[0];
        // At cluster scope a new collection needs a database to go in, or the grant fails.
        if (CREATE_COLLECTION.test(request) && (scope.databaseName !== undefined || database !== undefined)) {
            return { kind: 'tool', tool: 'createCollection', database, ...known, title: l10n.t('Create a collection') };
        }
        if (CREATE_DATABASE.test(request)) {
            return { kind: 'tool', tool: 'createDatabase', ...known, title: l10n.t('Create a database') };
        }
        const insights =
            /\bexplain\b/i.test(request) ||
            (/\b(slow|faster|speed up|performance)\b/i.test(request) && /\b(quer(y|ies)|index(es)?)\b/i.test(request));
        if (collection && (insights || /\bindex(es)?\b/i.test(request))) {
            return {
                kind: 'collectionView',
                collection,
                tab: insights ? 'insights' : 'indexes',
                ...known,
                title: insights ? l10n.t('Query Insights for {0}', collection) : l10n.t('Indexes of {0}', collection),
            };
        }
        if (collection && /\bnew (document|record|item)\b/i.test(request)) {
            return { kind: 'newDocument', collection, ...known, title: l10n.t('A new document in {0}', collection) };
        }
    }

    const change = asksForChange(request, scope);
    // "playground" is explicit; "query" or "report" only when the wish does not read as a question.
    if (change || /\bplayground\b/i.test(request) || (SCRIPT_ASK.test(request) && !READ_LEAD.test(request))) {
        return {
            kind: 'playground',
            title: l10n.t('A playground for your wish'),
            message: playgroundMessage(change, copilot),
            script: startingScript(wish, change ? target : collection, change, copilot, names),
        };
    }

    // "how big is orders" asks about the collection; "how big is order 5" about one document.
    const sizeOfCollection = /\bhow (big|large)\b/i.test(request) && mentions(request, names, false).length > 0;
    const place = named.length === 0 ? lookAroundPlace(request, scope) : undefined;
    // "what's in here" on a collection asks about that collection.
    if (connected && scope.collectionName && (place === 'here' || place === 'there')) {
        return openCollection(request, scope.collectionName, copilot);
    }
    if (connected && (DASHBOARD_WISH.test(request) || sizeOfCollection || place !== undefined)) {
        return {
            kind: 'dashboard',
            title: l10n.t('Cluster dashboard'),
            message: l10n.t(
                'The dashboard answers this: it lists every database and collection with its documents and size.',
            ),
        };
    }

    // A generic noun ("show the documents") reads the scoped or named collection, ahead of any command.
    if (connected && collection && DATA_WISH.test(request)) {
        return openCollection(request, collection, copilot);
    }

    const command = WISH_COMMANDS.find((candidate) => candidate.keywords.test(request));
    if (command) {
        return {
            kind: 'command',
            commandId: command.id,
            argument: command.takesText ? searchTextFrom(request, command.keywords) : undefined,
            title: command.label(),
            message: l10n.t('The well knows a command for this.'),
        };
    }

    // After the commands, so a "settings" collection does not take over "open my settings"; and only for
    // a read, so a change the verb list misses ("archive the orders") is not opened as if it were one.
    if (connected && named.length > 0 && readsNamedCollection(request, names, copilot)) {
        return openCollection(request, named[0], copilot);
    }
    return undefined;
}

function openCollection(wish: string, collection: string, copilot: KeywordReason): Spell {
    return {
        kind: 'collectionView',
        collection,
        title: l10n.t('Documents in {0}', collection),
        message: honestOpen(wish, collection, 'open', copilot),
    };
}

function playgroundMessage(change: boolean, copilot: KeywordReason): string {
    if (copilot === 'unreadable') {
        return change
            ? l10n.t(
                  "Copilot's reply could not be used, so the well did not write this change. The playground lists the calls to choose from; nothing runs until you run it.",
              )
            : l10n.t(
                  "Copilot's reply could not be used, so the well did not write this query. The playground starts from a find.",
              );
    }
    return change
        ? l10n.t(
              'Without Copilot the well cannot write this change. The playground lists the calls to choose from; nothing runs until you run it.',
          )
        : l10n.t('Without Copilot the well cannot write this query. The playground starts from a find.');
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

/** When nothing matched: says so honestly and what the well can do, instead of guessing. */
export function cannotGrantSpell(copilotAvailable: boolean): Spell {
    return {
        kind: 'answer',
        title: l10n.t('The well could not grant this'),
        message: copilotAvailable
            ? l10n.t(
                  'The well could not turn this wish into something it can do. It can read and count your data, open the collection view, shell, dashboard or a playground, import or export documents, and run a few VS Code commands. Try naming the collection and what you want.',
              )
            : l10n.t(
                  'Without Copilot the well understands simple wishes only, and it could not match this one. It can open the dashboard or the shell, show the documents or indexes of a collection, import or export documents, draft a playground script to add, change or delete documents, and set up DocumentDB Local.',
              ),
    };
}

/** What the examples know about where the well was opened. */
export interface WishExampleScope {
    readonly connected: boolean;
    readonly databaseName?: string;
    readonly collectionName?: string;
    readonly collectionNames?: readonly string[];
}

const MAX_EXAMPLES = 5;

/** An example and the spell the keyword fallback must make of it; anything else would misfire. */
interface KeywordExample {
    readonly text: string;
    readonly kind: Spell['kind'];
    /** The collection the example names, which the spell must act on. */
    readonly collection?: string;
    readonly tab?: CollectionTab;
    readonly tool?: WishTool;
    readonly commandId?: string;
}

function keywordExamples(scope: WishExampleScope, collection: string | undefined): KeywordExample[] {
    const sideBar: KeywordExample = {
        text: l10n.t('Show the DocumentDB side bar'),
        kind: 'command',
        commandId: 'workbench.view.extension.documentDB',
    };
    const insertCustomers: KeywordExample = {
        text: l10n.t('Draft a script to insert sample customers'),
        kind: 'playground',
    };
    const shell: KeywordExample = { text: l10n.t('Open the shell'), kind: 'shell' };
    const eachCollection: KeywordExample = {
        text: l10n.t('How many documents are in each collection?'),
        kind: 'dashboard',
    };
    if (!scope.connected) {
        return [
            {
                text: l10n.t('Run DocumentDB on my laptop'),
                kind: 'command',
                commandId: 'vscode-documentdb.command.localQuickStart.open',
            },
            {
                text: l10n.t('Add a connection from a connection string'),
                kind: 'command',
                commandId: 'vscode-documentdb.command.connectionsView.newConnection',
            },
            {
                text: l10n.t('Discover my clusters in Azure'),
                kind: 'command',
                commandId: 'vscode-documentdb.command.discoveryView.addRegistry',
            },
            sideBar,
            insertCustomers,
        ];
    }
    if (collection) {
        return [
            { text: l10n.t('Show the documents in {0}', collection), kind: 'collectionView', collection },
            scope.collectionName
                ? {
                      text: l10n.t('Why is my query on {0} slow?', collection),
                      kind: 'collectionView',
                      collection,
                      tab: 'insights',
                  }
                : eachCollection,
            { text: l10n.t('Add sample documents to {0}', collection), kind: 'playground', collection },
            { text: l10n.t('Show the indexes of {0}', collection), kind: 'collectionView', collection, tab: 'indexes' },
            scope.collectionName
                ? { text: l10n.t('Export {0} to JSON', collection), kind: 'tool', tool: 'export', collection }
                : shell,
        ];
    }
    return [
        scope.databaseName ? eachCollection : { text: l10n.t('How big is each database?'), kind: 'dashboard' },
        shell,
        { text: l10n.t('Diagnose the connection'), kind: 'tool', tool: 'diagnose' },
        insertCustomers,
        sideBar,
    ];
}

function copilotExamples(scope: WishExampleScope, collection: string | undefined): string[] {
    if (!scope.connected) {
        return [
            l10n.t('Run DocumentDB on my laptop'),
            l10n.t('Explain what an index does'),
            l10n.t('Draft a script to insert 20 sample customers'),
            l10n.t('Add a connection from a connection string'),
            l10n.t('Write a README for this project'),
        ];
    }
    if (collection) {
        return [
            l10n.t('Show the 5 newest documents in {0}', collection),
            l10n.t('Count the documents in {0}', collection),
            l10n.t('Add 20 sample documents to {0}', collection),
            l10n.t('Why is my query on {0} slow?', collection),
            scope.collectionName
                ? l10n.t('Export {0} to JSON', collection)
                : l10n.t('How many documents are in each collection?'),
        ];
    }
    return [
        scope.databaseName ? l10n.t('How many documents are in each collection?') : l10n.t('How big is each database?'),
        l10n.t('Open the shell'),
        l10n.t('Explain what an index does'),
        l10n.t('Draft a script to insert 20 sample customers'),
        l10n.t('Diagnose the connection'),
    ];
}

/** True when the keyword fallback makes exactly the spell the example promises. */
function grantsAsWritten(example: KeywordExample, scope: WishPromptScope): boolean {
    const spell = matchWishByKeyword(example.text, scope);
    if (!spell || spell.kind !== example.kind) {
        return false;
    }
    if (spell.kind === 'playground') {
        // The draft must start on the collection the example names.
        const target = example.collection ? `db.getCollection(${quoteJs(example.collection)})` : '';
        return spell.script.includes(`${target}.find({})`);
    }
    return (
        (!example.collection || ('collection' in spell && spell.collection === example.collection)) &&
        ('tab' in spell ? spell.tab : undefined) === example.tab &&
        ('tool' in spell ? spell.tool : undefined) === example.tool &&
        ('commandId' in spell ? spell.commandId : undefined) === example.commandId
    );
}

/**
 * Up to five wishes the well can really grant here. Without Copilot each one is checked against
 * the keyword fallback for this scope, so clicking an example never misfires.
 */
export function wishExamples(scope: WishExampleScope, copilotAvailable: boolean): string[] {
    const collection =
        scope.collectionName ??
        (scope.databaseName
            ? scope.collectionNames?.find(
                  (name) => name.length <= 40 && mentionedCollections(name, scope.collectionNames)[0] === name,
              )
            : undefined);
    if (copilotAvailable) {
        return copilotExamples(scope, collection).slice(0, MAX_EXAMPLES);
    }
    const promptScope: WishPromptScope = scope.connected
        ? {
              connectionName: 'connection',
              databaseName: scope.databaseName,
              collectionName: scope.collectionName,
              collectionNames: scope.collectionNames,
          }
        : {};
    // The keywords are English: a translated example that no longer matches is dropped, not shown.
    // A collection named like a tool ("stats", "shell") misfires, so the general examples fill in.
    const granted = [...keywordExamples(scope, collection), ...(collection ? keywordExamples(scope, undefined) : [])]
        .filter((example) => grantsAsWritten(example, promptScope))
        .map((example) => example.text);
    return [...new Set(granted)].slice(0, MAX_EXAMPLES);
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

/** Where a collection-view spell lands and what the card says Grant will open there. */
function collectionViewAction(spell: Extract<Spell, { kind: 'find' | 'collectionView' }>): {
    actionLabel: string;
    actionHint: string;
} {
    const where = spellTarget(spell);
    const query = Boolean(spell.filter || spell.project || spell.sort);
    const tab = spell.kind === 'collectionView' ? spell.tab : undefined;
    if (tab === 'insights') {
        return {
            actionLabel: l10n.t('Open Query Insights'),
            actionHint: where
                ? query
                    ? l10n.t('Opens Query Insights for {0} with this query.', where)
                    : l10n.t('Opens Query Insights for {0}.', where)
                : l10n.t('Opens Query Insights for this collection.'),
        };
    }
    if (tab === 'indexes') {
        return {
            actionLabel: l10n.t('Open the indexes'),
            actionHint: where
                ? l10n.t('Opens the indexes of {0}.', where)
                : l10n.t('Opens the indexes of this collection.'),
        };
    }
    return {
        actionLabel: l10n.t('Open in collection view'),
        actionHint: where
            ? query
                ? l10n.t('Opens {0} in the collection view with this query.', where)
                : l10n.t('Opens {0} in the collection view.', where)
            : query
              ? l10n.t('Opens the collection view with this query.')
              : l10n.t('Opens this collection in the collection view.'),
    };
}

/** What a card says Grant will do, so nothing happens behind the user's back. */
function actionFor(spell: Spell): { actionLabel?: string; actionHint?: string } {
    switch (spell.kind) {
        case 'answer':
            return {};
        case 'find':
        case 'collectionView':
            return collectionViewAction(spell);
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
            return { actionLabel: l10n.t('Open a new document'), actionHint: spellTarget(spell) };
        case 'tool':
            return { actionLabel: toolLabel(spell.tool), actionHint: toolHint(spell) };
        case 'command': {
            const command = WISH_COMMANDS.find((candidate) => candidate.id === spell.commandId);
            const label = command?.label() ?? spell.commandId;
            return {
                actionLabel: command ? label : l10n.t('Grant wish'),
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
                    // The rows a limit returns are not every match, so the card says it was there.
                    spell.kind === 'find' && spell.limit !== undefined ? `limit: ${spell.limit}` : undefined,
                ]
                    .filter(Boolean)
                    .join('\n') || undefined
            );
        default:
            return undefined;
    }
}

/** `wish` is the user's own words, echoed on the card; leave it out for lucky draws. */
export function spellToOutcome(
    spell: Spell,
    id: string,
    interpretedBy: WishOutcome['interpretedBy'],
    wish?: string,
): WishOutcome {
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
    const action = actionFor(spell);
    const code = codeFor(spell);
    // A read's rows go in `detail` once it runs; the query that found them stays beside them.
    const read = spell.kind === 'find' || spell.kind === 'aggregate';
    return {
        id,
        kind: kinds[spell.kind],
        title: spell.title,
        message: spell.message,
        detail: read ? undefined : code,
        // An unfiltered find ran a query too, and a read card always shows what ran.
        query: read ? (code ?? 'filter: {}') : undefined,
        status: action.actionLabel ? 'proposed' : 'info',
        wish: wish === undefined ? undefined : clip(wish, MAX_MESSAGE),
        interpretedBy,
        ...action,
    };
}
