/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';

import * as packageJson from '../package.json';
import { normalizeCustomHostnameSuffix } from './documentdb/auth/oidcAllowedHosts';
import { settingsKeys } from './settingsKeys';

type ConfigurationNode = {
    title: string;
    order?: number;
    properties: Record<
        string,
        {
            order?: number;
            default?: unknown;
            markdownDeprecationMessage?: string;
            scope?: string;
        }
    >;
};

const nodes = packageJson.contributes.configuration as unknown as ConfigurationNode[];

function declaredKeys(): string[] {
    return nodes.flatMap((node) => Object.keys(node.properties));
}

function constantKeys(): string[] {
    return Object.entries(settingsKeys)
        .filter(([name]) => name !== 'vsCode')
        .map(([, value]) => value as string);
}

describe('settings contributions', () => {
    it('keeps the entire custom environment machine scoped, not workspace or folder overridable', () => {
        const properties = Object.fromEntries(nodes.flatMap((node) => Object.entries(node.properties)));
        expect(properties[settingsKeys.customEnvironment]?.scope).toBe('machine');
    });

    it('validates audience overrides in Settings while allowing an empty setting', () => {
        const setting = packageJson.contributes.configuration
            .flatMap((node) => Object.entries(node.properties))
            .find(([key]) => key === settingsKeys.customEnvironment)?.[1];
        expect(setting).toBeDefined();
        if (!setting || !('properties' in setting)) {
            throw new Error('Missing custom environment schema');
        }
        const schema = setting.properties.ossrdbmsEndpoint;
        const pattern = new RegExp(schema.pattern);
        expect(schema.patternErrorMessage).toContain('https://ossrdbms-aad.database.usgovcloudapi.net');
        for (const value of ['', ' \t ', 'https://database.example.com', ' https://database.example.com/ ']) {
            expect(pattern.test(value), value).toBe(true);
        }
        for (const value of ['http://database.example.com', 'https://database.example.com/.default', 'not a URL']) {
            expect(pattern.test(value), value).toBe(false);
        }
    });

    it('validates hostname suffixes in Settings using the existing normalization rules', () => {
        const setting = packageJson.contributes.configuration
            .flatMap((node) => Object.entries(node.properties))
            .find(([key]) => key === settingsKeys.customEnvironment)?.[1];
        if (!setting || !('properties' in setting)) {
            throw new Error('Missing custom environment schema');
        }
        const schema = setting.properties.mongoClusterHostnameSuffix;
        const pattern = new RegExp(schema.pattern);
        expect(schema.patternErrorMessage).toContain('.mongocluster.cosmos.example');
        expect(schema.patternErrorMessage).toContain('com.cn');
        for (const value of [
            '',
            ' \t\n ',
            '.mongocluster.cosmos.example',
            'mongocluster.cosmos.example',
            ' .DATABASE.EXAMPLE.COM ',
            '.service.example.com.cn',
            '.a.b',
            `.${'a'.repeat(63)}.example`,
            '.a-b.example',
            '.com',
            'com',
            '.cn',
            '.com.cn',
            ' COM.CN ',
            '.Co.Uk',
            '.NET.CN',
            '.org.cn',
            '.gov.us',
            '*.example.com',
            'https://example.com',
            '.example.com:10255',
            '.example.com/path',
            '.example.com/',
            '.example..com',
            '..example.com',
            '.example.com.',
            '.-example.com',
            '.example-.com',
            '.example_com',
            '.éxample.com',
            `.${'a'.repeat(64)}.example`,
            '.example. com',
        ]) {
            const accepted = value.trim() === '' || normalizeCustomHostnameSuffix(value) !== undefined;
            expect(pattern.test(value), value).toBe(accepted);
        }
    });

    describe('table of contents grouping', () => {
        // A node titled the same as the extension has its settings hoisted onto the parent
        // entry instead of becoming an expandable child, collapsing the whole grouping.
        it('has no group titled the same as the extension displayName', () => {
            const titles = nodes.map((node) => node.title);
            expect(titles).not.toContain(packageJson.displayName);
        });

        it('contributes the expected groups and orders', () => {
            expect(Object.fromEntries(nodes.map((node) => [node.title, node.order]))).toEqual({
                General: 10,
                'Connections & Discovery': 20,
                'Queries & Results': 30,
                'Copy & Paste': 40,
                'Query Playground': 50,
                'Interactive Shell': 60,
                'AI Assistant': 70,
                Accessibility: 80,
            });
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
        it('orders every property within its group', () => {
            for (const node of nodes) {
                const unordered = Object.entries(node.properties)
                    .filter(([, schema]) => typeof schema.order !== 'number')
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

        it('contributes no deprecated aliases', () => {
            for (const node of nodes) {
                for (const schema of Object.values(node.properties)) {
                    expect(schema.markdownDeprecationMessage).toBeUndefined();
                }
            }
        });

        it('keeps the renamed settings and their defaults', () => {
            const properties = Object.fromEntries(nodes.flatMap((node) => Object.entries(node.properties)));
            const renamedSettings = [
                [settingsKeys.confirmationStyle, 'documentDB.confirmations.style', 'wordConfirmation'],
                [settingsKeys.enableAIQueryGeneration, 'documentDB.aiAssistant.enableQueryGeneration', false],
                [settingsKeys.showOperationSummaries, 'documentDB.userInterface.showOperationSummaries', true],
                [settingsKeys.indexAdvisorFindPromptPath, 'documentDB.aiAssistant.indexAdvisorFindPromptPath', null],
                [
                    settingsKeys.indexAdvisorAggregatePromptPath,
                    'documentDB.aiAssistant.indexAdvisorAggregatePromptPath',
                    null,
                ],
                [settingsKeys.indexAdvisorCountPromptPath, 'documentDB.aiAssistant.indexAdvisorCountPromptPath', null],
                [
                    settingsKeys.queryGenerationCrossCollectionPromptPath,
                    'documentDB.aiAssistant.queryGenerationCrossCollectionPromptPath',
                    null,
                ],
                [
                    settingsKeys.queryGenerationSingleCollectionPromptPath,
                    'documentDB.aiAssistant.queryGenerationSingleCollectionPromptPath',
                    null,
                ],
                [settingsKeys.connectionTimeout, 'documentDB.connectionTimeout', 30],
            ] as const;

            for (const [actualKey, expectedKey, expectedDefault] of renamedSettings) {
                expect(actualKey).toBe(expectedKey);
                expect(properties[actualKey]?.default).toBe(expectedDefault);
            }
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
