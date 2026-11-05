/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { timestampFields } from './timestamps.js';

import { type IdentifierKind, type DiagnosticsReport } from './types.js';

const prefixes: Readonly<Record<IdentifierKind, string>> = {
    host: 'host',
    address: 'address',
    user: 'user',
    tenant: 'tenant',
    account: 'account',
    clientId: 'client',
    endpoint: 'endpoint',
    replicaSet: 'replica-set',
    certificateName: 'certificate',
    database: 'database',
    role: 'role',
    connectionName: 'connection',
    proxyHost: 'proxy',
    service: 'service',
    namespace: 'namespace',
};
const optionLists = new Set(['options', 'txtOptions', 'effectiveNetworkOptions']);
const protectedKeys = new Set([
    'language',
    'checkId',
    'stepId',
    'code',
    'errorCode',
    'errorName',
    'codeName',
    'status',
    'severity',
    'reason',
    'source',
    'origin',
    'timeoutProfile',
    'topology',
    'cloud',
]);

interface IdentifierPart {
    readonly value: string;
    readonly prefix: string;
    readonly suffix: string;
}

interface Replacement {
    readonly value: string;
    readonly placeholder: string;
    insensitive: boolean;
}

function isProtectedKey(key: string): boolean {
    return protectedKeys.has(key) || timestampFields.has(key) || /(?:ErrorCode|Version|Versions)$/i.test(key);
}

function identifierPart(value: string, kind: IdentifierKind): IdentifierPart {
    if (kind !== 'host' && kind !== 'proxyHost' && kind !== 'address') {
        return { value, prefix: '', suffix: '' };
    }
    const san = /^(DNS:|IP Address:)\s*/i.exec(value);
    const prefix = san?.[0] ?? '';
    const rest = value.slice(prefix.length);
    const target = /^(?:\[([^\]]+)\]|([^:]+)):(\d+)$/.exec(rest);
    if (target) {
        return { value: target[1] ?? target[2], prefix, suffix: `:${target[3]}` };
    }
    if (rest.startsWith('[') && rest.endsWith(']')) {
        return { value: rest.slice(1, -1), prefix, suffix: '' };
    }
    return { value: rest, prefix, suffix: '' };
}

function isMarker(value: string): boolean {
    return value === '[depth limit]' || /^\[\d+ more omitted\]$/.test(value);
}

export function redactReport<TCode extends string>(report: DiagnosticsReport<TCode>): DiagnosticsReport<TCode> {
    const replacements: Replacement[] = [];
    const counters = new Map<IdentifierKind, number>();
    const classifications = Object.entries(report.identifierKeys).sort(
        ([left], [right]): number => right.split('.').length - left.split('.').length,
    );

    function classification(
        path: readonly string[],
        parent?: Readonly<Record<string, unknown>>,
    ): IdentifierKind | undefined {
        const key = path.at(-1);
        if (key === 'target' || key === 'targets') {
            return 'host';
        }
        if (key === 'connectionName') {
            return 'connectionName';
        }
        if (
            key === 'value' &&
            parent &&
            typeof parent.name === 'string' &&
            path.some((part): boolean => optionLists.has(part))
        ) {
            // URI option names are case-insensitive, unlike ordinary fact/data keys.
            const name = parent.name.toLowerCase();
            return classifications.find(
                ([candidate]): boolean => !candidate.includes('.') && candidate.toLowerCase() === name,
            )?.[1];
        }
        for (const [candidate, kind] of classifications) {
            const segments = candidate.split('.');
            if (segments.at(-1) !== key) {
                continue;
            }
            let index = 0;
            for (const ancestor of path.slice(0, -1)) {
                if (ancestor === segments[index] && index < segments.length - 1) {
                    index++;
                }
            }
            if (index === segments.length - 1) {
                return kind;
            }
        }
        return undefined;
    }

    function existing(value: string, kind: IdentifierKind): Replacement | undefined {
        return replacements.find(
            (entry): boolean =>
                entry.value === value ||
                ((entry.insensitive || kind === 'host' || kind === 'proxyHost') &&
                    entry.value.toLowerCase() === value.toLowerCase()),
        );
    }

    function collect(value: unknown, path: readonly string[], kind?: IdentifierKind): void {
        if (typeof value === 'string') {
            if (kind === undefined || isMarker(value)) {
                return;
            }
            const part = identifierPart(value, kind);
            if (part.value === '') {
                return;
            }
            const previous = existing(part.value, kind);
            if (previous) {
                if (kind === 'host' || kind === 'proxyHost') {
                    previous.insensitive = true;
                }
                return;
            }
            const count = (counters.get(kind) ?? 0) + 1;
            counters.set(kind, count);
            replacements.push({
                value: part.value,
                placeholder: `${prefixes[kind]}-${count}`,
                insensitive: kind === 'host' || kind === 'proxyHost',
            });
        } else if (Array.isArray(value)) {
            for (const entry of value as unknown[]) {
                collect(entry, path, kind);
            }
        } else if (value !== null && typeof value === 'object') {
            const object = value as Readonly<Record<string, unknown>>;
            for (const [key, child] of Object.entries(object)) {
                if (key === 'issuerChain' || key === 'identifierKeys' || isProtectedKey(key)) {
                    continue;
                }
                const next = [...path, key];
                collect(child, next, classification(next, object) ?? (key === 'address' ? kind : undefined));
            }
        }
    }

    for (const result of report.results) {
        collect(result.facts, ['results', 'facts']);
        for (const finding of result.findings) {
            collect(finding.data, ['results', 'findings', 'data']);
        }
        collect(result.steps, ['results', 'steps']);
        collect(result.target, ['results', 'target'], 'host');
    }
    collect(report.summary, ['summary']);
    collect(report.connectionName, ['connectionName'], 'connectionName');
    collect(report.targets, ['targets'], 'host');
    collect(report.coverage, ['coverage']);
    collect(report.clockOffset, ['clockOffset']);

    const substrings = replacements
        .filter((entry): boolean => entry.value.length >= 3)
        .sort((left, right): number => right.value.length - left.value.length);

    function replaceSubstrings(text: string): string {
        const folded = text.toLowerCase();
        const output: string[] = [];
        let position = 0;
        while (position < text.length) {
            let selected: Replacement | undefined;
            let start = text.length;
            for (const entry of substrings) {
                const index = entry.insensitive
                    ? folded.indexOf(entry.value.toLowerCase(), position)
                    : text.indexOf(entry.value, position);
                if (index !== -1 && index < start) {
                    selected = entry;
                    start = index;
                }
            }
            if (!selected) {
                output.push(text.slice(position));
                break;
            }
            output.push(text.slice(position, start), selected.placeholder);
            position = start + selected.value.length;
        }
        return output.join('');
    }

    function replace(value: unknown, path: readonly string[], kind?: IdentifierKind, preserve = false): unknown {
        if (typeof value === 'string') {
            if (preserve || isMarker(value)) {
                return value;
            }
            if (kind !== undefined) {
                const part = identifierPart(value, kind);
                const entry = existing(part.value, kind);
                if (entry) {
                    return `${part.prefix}${entry.placeholder}${part.suffix}`;
                }
            }
            return replaceSubstrings(value);
        }
        if (Array.isArray(value)) {
            return Object.freeze((value as unknown[]).map((child): unknown => replace(child, path, kind, preserve)));
        }
        if (value !== null && typeof value === 'object') {
            const object = value as Readonly<Record<string, unknown>>;
            return Object.freeze(
                Object.fromEntries(
                    Object.entries(object).map(([key, child]): [string, unknown] => {
                        const next = [...path, key];
                        const keep =
                            preserve || key === 'issuerChain' || key === 'identifierKeys' || isProtectedKey(key);
                        return [
                            key,
                            replace(
                                child,
                                next,
                                classification(next, object) ?? (key === 'address' ? kind : undefined),
                                keep,
                            ),
                        ];
                    }),
                ),
            );
        }
        return value;
    }

    return replace(report, []) as DiagnosticsReport<TCode>;
}
