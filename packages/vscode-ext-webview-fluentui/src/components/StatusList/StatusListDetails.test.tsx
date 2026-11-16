/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeAll, describe, expect, test } from 'vitest';

import { act } from 'react';
import { cleanupSurfaces, installTestEnvironment, renderSurface } from '../testing/renderSurface.js';
import {
    StatusList,
    StatusListDetailsFacts,
    StatusListDetailsMessage,
    StatusListDetailsSection,
    StatusListItem,
} from './index.js';

beforeAll(installTestEnvironment);
afterEach(cleanupSurfaces);

describe('StatusList details content', () => {
    describe('StatusListDetailsFacts', () => {
        test('renders term and value pairs as a description list, in order, skipping absent facts', async () => {
            const showUser = false as boolean;
            const { root } = await renderSurface(
                <StatusListDetailsFacts
                    items={[
                        { term: 'Scheme', value: 'mongodb+srv', mono: true },
                        showUser && { term: 'User', value: 'admin' },
                        undefined,
                        null,
                        { term: 'Authentication method', value: 'Username and password' },
                    ]}
                />,
            );

            expect(root.tagName).toBe('DL');
            expect([...root.querySelectorAll('dt')].map((term) => term.textContent)).toEqual([
                'Scheme',
                'Authentication method',
            ]);
            expect([...root.querySelectorAll('dd')].map((value) => value.textContent)).toEqual([
                'mongodb+srv',
                'Username and password',
            ]);
            // Each pair is grouped, so a term is always followed by its own value.
            for (const pair of root.children) {
                expect(pair.tagName).toBe('DIV');
                expect([...pair.children].map((child) => child.tagName)).toEqual(['DT', 'DD']);
            }
        });

        test('`mono` renders the whole value as code; other values are left as passed', async () => {
            const { root } = await renderSurface(
                <StatusListDetailsFacts
                    items={[
                        { term: 'Host', value: 'cluster.example.test', mono: true },
                        {
                            term: 'Address',
                            value: (
                                <>
                                    <code>203.0.113.24</code> <span>(IPv4, public)</span>
                                </>
                            ),
                        },
                        { term: 'Protocol', value: 'TLSv1.3' },
                    ]}
                />,
            );

            const values = root.querySelectorAll('dd');
            expect(values[0]?.querySelector('code')?.textContent).toBe('cluster.example.test');
            expect(values[1]?.querySelectorAll('code')).toHaveLength(1);
            expect(values[1]?.textContent).toBe('203.0.113.24 (IPv4, public)');
            expect(values[2]?.querySelector('code')).toBeNull();
        });

        test('renders nothing when no fact applies', async () => {
            const { root } = await renderSurface(<StatusListDetailsFacts items={[false, undefined]} />);
            expect(root).toBeNull();
        });

        test('passes through native props, such as an accessible name', async () => {
            const { root } = await renderSurface(
                <StatusListDetailsFacts
                    aria-label="Certificate"
                    items={[{ term: 'Issued by', value: 'Example CA' }]}
                />,
            );
            expect(root.getAttribute('aria-label')).toBe('Certificate');
        });
    });

    describe('StatusListDetailsSection', () => {
        test('shows a visual title above its content, and never an HTML heading', async () => {
            const { root } = await renderSurface(
                <StatusListDetailsSection title={<code>db.example.test</code>}>
                    <StatusListDetailsFacts items={[{ term: 'Protocol', value: 'TLSv1.3' }]} />
                </StatusListDetailsSection>,
            );

            expect(root.firstElementChild?.textContent).toBe('db.example.test');
            expect(root.firstElementChild?.querySelector('code')).not.toBeNull();
            expect(root.querySelector('dl')).not.toBeNull();
            expect(root.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]')).toBeNull();
        });

        test('without a title renders only its content', async () => {
            const { root } = await renderSurface(
                <StatusListDetailsSection>
                    <p>Only content</p>
                </StatusListDetailsSection>,
            );
            expect(root.childElementCount).toBe(1);
            expect(root.textContent).toBe('Only content');
        });
    });

    describe('StatusListDetailsMessage', () => {
        test('reads the severity, title, explanation and next step in order, with a hidden glyph', async () => {
            const { root } = await renderSurface(
                <StatusListDetailsMessage
                    severity="warning"
                    title="Public address for this host name"
                    nextStep="Next: Check the private endpoint."
                >
                    The name resolves to a public address.
                </StatusListDetailsMessage>,
            );

            expect(root.textContent).toBe(
                'Warning: Public address for this host name' +
                    'The name resolves to a public address.' +
                    'Next: Check the private endpoint.',
            );
            const glyph = root.querySelector('svg');
            expect(glyph?.getAttribute('aria-hidden')).toBe('true');
        });

        test('uses each severity’s own English default label and glyph', async () => {
            const render = async (severity: 'error' | 'warning' | 'info'): Promise<HTMLElement> =>
                (await renderSurface(<StatusListDetailsMessage severity={severity} title="Title" />)).root;

            const error = await render('error');
            const warning = await render('warning');
            const info = await render('info');

            expect(error.textContent).toBe('Error: Title');
            expect(warning.textContent).toBe('Warning: Title');
            expect(info.textContent).toBe('Information: Title');
            const glyphs = [error, warning, info].map((root) => root.querySelector('svg')?.outerHTML);
            expect(new Set(glyphs).size).toBe(3);
        });

        test('takes a localized severity label, or none', async () => {
            const localized = await renderSurface(
                <StatusListDetailsMessage severity="error" severityLabel="Erreur :" title="Hôte introuvable" />,
            );
            expect(localized.root.textContent).toBe('Erreur : Hôte introuvable');

            const none = await renderSurface(
                <StatusListDetailsMessage severity="error" severityLabel="" title="Error: host not found" />,
            );
            expect(none.root.textContent).toBe('Error: host not found');
        });

        test('omits the explanation and next step lines when they are absent', async () => {
            const { root } = await renderSurface(<StatusListDetailsMessage severity="info" title="Title" />);
            const copy = root.lastElementChild;
            expect(copy?.childElementCount).toBe(1);
        });
    });

    describe('inside a disclosure', () => {
        test('the region frames consumer content without adding text, focus or headings', async () => {
            const { root } = await renderSurface(
                <StatusList ariaLabel="Connection checks">
                    <StatusListItem
                        label="Secure connection (TLS)"
                        status="done"
                        detail="TLSv1.3 · certificate trusted"
                        disclosure={{
                            content: (
                                <StatusListDetailsSection title={<code>db.example.test</code>}>
                                    <StatusListDetailsFacts
                                        items={[
                                            { term: 'Protocol', value: 'TLSv1.3' },
                                            { term: 'Certificate for', value: '*.example.test', mono: true },
                                        ]}
                                    />
                                </StatusListDetailsSection>
                            ),
                            toggleText: 'Details',
                            toggleLabel: 'Details for Secure connection (TLS)',
                            placement: 'detail',
                        }}
                    />
                </StatusList>,
            );

            const toggle = root.querySelector('button');
            await act(async () => {
                toggle?.click();
            });

            const region = root.querySelector('[role="region"]');
            expect(region?.textContent).toBe('db.example.testProtocolTLSv1.3Certificate for*.example.test');
            expect(region?.querySelectorAll('dt')).toHaveLength(2);
            expect(region?.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]')).toBeNull();
            expect(region?.querySelector('button, a, input, [tabindex]')).toBeNull();
        });

        test('the region sets the base type, so plain content and code need no styles of their own', async () => {
            const { root } = await renderSurface(
                <StatusList ariaLabel="Connection checks">
                    <StatusListItem
                        label="Server response"
                        status="done"
                        disclosure={{
                            content: (
                                <p>
                                    Answered by <code>db.example.test</code>
                                </p>
                            ),
                            toggleText: 'Details',
                            toggleLabel: 'Details for Server response',
                            defaultExpanded: true,
                        }}
                    />
                </StatusList>,
            );

            const body = root.querySelector('[role="region"]')?.firstElementChild;
            const code = body?.querySelector('code');
            if (!(body instanceof HTMLElement) || !code) {
                throw new Error('Missing region body');
            }
            const bodyStyle = getComputedStyle(body);
            expect(bodyStyle.fontSize).toBe('var(--fontSizeBase200)');
            expect(bodyStyle.lineHeight).toBe('var(--lineHeightBase200)');
            expect(bodyStyle.color).toBe('var(--colorNeutralForeground1)');
            // The chip reset against VS Code's default `code` style needs a real cascade; see the README.
            expect(getComputedStyle(code).fontFamily).toBe('var(--fontFamilyMonospace)');
        });
    });
});
