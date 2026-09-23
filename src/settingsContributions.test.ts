/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as packageJson from '../package.json';
import { settingsKeys } from './settingsKeys';

type ConfigurationNode = {
    title: string;
    order?: number;
    properties: Record<string, { order?: number; markdownDeprecationMessage?: string; scope?: string }>;
};

const nodes = packageJson.contributes.configuration as unknown as ConfigurationNode[];

/** Every setting ID declared in package.json, deprecated ones included. */
function declaredKeys(): string[] {
    return nodes.flatMap((node) => Object.keys(node.properties));
}

function deprecatedKeys(): string[] {
    return nodes.flatMap((node) =>
        Object.entries(node.properties)
            .filter(([, schema]) => schema.markdownDeprecationMessage !== undefined)
            .map(([key]) => key),
    );
}

/** Every setting ID this extension owns: current plus deprecated. `vsCode` holds VS Code's own keys. */
function constantKeys(): string[] {
    const owned = Object.entries(settingsKeys)
        .filter(([name]) => name !== 'legacy' && name !== 'vsCode')
        .map(([, value]) => value as string);

    return [...owned, ...Object.values(settingsKeys.legacy)];
}

describe('settings contributions', () => {
    describe('table of contents grouping', () => {
        // A node titled the same as the extension has its settings hoisted onto the parent
        // entry instead of becoming an expandable child, collapsing the whole grouping.
        it('has no group titled the same as the extension displayName', () => {
            const titles = nodes.map((node) => node.title);
            expect(titles).not.toContain(packageJson.displayName);
        });

        it('contributes more than one group, so the entry is expandable', () => {
            expect(nodes.length).toBeGreaterThan(1);
        });

        it('gives every group a unique title', () => {
            const titles = nodes.map((node) => node.title);
            expect(new Set(titles).size).toBe(titles.length);
        });

        // Groups without an order sort last in an arbitrary relative position.
        it('gives every group an explicit order', () => {
            for (const node of nodes) {
                expect(typeof node.order).toBe('number');
            }
        });

        it('gives every group a distinct order', () => {
            const orders = nodes.map((node) => node.order);
            expect(new Set(orders).size).toBe(orders.length);
        });
    });

    describe('property ordering', () => {
        // Mixing ordered and unordered properties in one group scrambles the list: ordered
        // ones come first, the rest fall back to alphabetical by key.
        it('orders every non-deprecated property within its group', () => {
            const deprecated = new Set(deprecatedKeys());

            for (const node of nodes) {
                const unordered = Object.entries(node.properties)
                    .filter(([key, schema]) => !deprecated.has(key) && typeof schema.order !== 'number')
                    .map(([key]) => key);

                expect({ group: node.title, unordered }).toEqual({ group: node.title, unordered: [] });
            }
        });
    });

    describe('settingsKeys', () => {
        it('declares every setting contributed in package.json', () => {
            expect(constantKeys().sort()).toEqual(declaredKeys().sort());
        });

        it('has no duplicate values', () => {
            const keys = constantKeys();
            expect(new Set(keys).size).toBe(keys.length);
        });

        it('lists every deprecated setting under settingsKeys.legacy', () => {
            expect(Object.values(settingsKeys.legacy).sort()).toEqual(deprecatedKeys().sort());
        });

        it('points each legacy key at a replacement that is still contributed', () => {
            const declared = new Set(declaredKeys());
            expect(declared.has(settingsKeys.confirmationStyle)).toBe(true);
            expect(declared.has(settingsKeys.enableAIQueryGeneration)).toBe(true);
        });
    });

    describe('user-facing text', () => {
        it('uses no em dashes in titles or descriptions', () => {
            const offenders: string[] = [];

            for (const node of nodes) {
                if (node.title.includes('\u2014')) {
                    offenders.push(node.title);
                }
                for (const [key, schema] of Object.entries(node.properties)) {
                    const text = JSON.stringify(schema);
                    if (text.includes('\u2014')) {
                        offenders.push(key);
                    }
                }
            }

            expect(offenders).toEqual([]);
        });
    });
});
