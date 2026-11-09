/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeAll, describe, expect, test } from 'vitest';

import { act, type ReactElement } from 'react';
import { cleanupSurfaces, installTestEnvironment, renderSurface } from '../testing/renderSurface.js';
import { StatusList, StatusListItem, type StatusListItemDisclosure } from './index.js';

beforeAll(installTestEnvironment);
afterEach(cleanupSurfaces);

describe('StatusList', () => {
    test('voices the status as a word after the label, and gives the row no aria-label', async () => {
        const { root } = await renderSurface(
            <StatusList ariaLabel="Setup progress">
                <StatusListItem label="Checking Docker" status="done" />
                <StatusListItem label="Pulling official image" status="active" />
                <StatusListItem label="Creating container" status="pending" />
            </StatusList>,
        );

        const rows = root.querySelectorAll('[role="listitem"]');
        expect(rows).toHaveLength(3);
        expect(rows[0]?.textContent).toBe('Checking Docker, done');
        expect(rows[1]?.textContent).toBe('Pulling official image, in progress');
        expect(rows[0]?.getAttribute('aria-label')).toBeNull();
    });

    test('takes localized status words', async () => {
        const { root } = await renderSurface(
            <StatusList ariaLabel="Fortschritt" statusLabels={{ error: 'fehlgeschlagen' }}>
                <StatusListItem label="Docker" status="error" />
                <StatusListItem label="Abbild" status="pending" />
            </StatusList>,
        );

        const rows = root.querySelectorAll('[role="listitem"]');
        expect(rows[0]?.textContent).toBe('Docker, fehlgeschlagen');
        // Unlisted statuses keep the English default rather than disappearing.
        expect(rows[1]?.textContent).toBe('Abbild, pending');
    });

    test('detail renders arbitrary content, and interactive content inside it stays reachable', async () => {
        const { root } = await renderSurface(
            <StatusList ariaLabel="Setup progress">
                <StatusListItem
                    label="Checking Docker"
                    status="error"
                    detail={
                        <>
                            {'no Docker CLI found · '}
                            <button type="button">Check Docker again</button>
                        </>
                    }
                />
            </StatusList>,
        );

        expect(root.querySelector('button')?.textContent).toBe('Check Docker again');
    });

    test('reserveDetailSpace holds the line before the detail arrives, and yields to it after', async () => {
        const row = (detail?: string): ReactElement => (
            <StatusList ariaLabel="Setup progress">
                <StatusListItem label="Checking Docker" status="active" detail={detail} reserveDetailSpace />
            </StatusList>
        );

        const { root, rerender } = await renderSurface(row(undefined));
        const detailLine = (): Element | null | undefined =>
            root.querySelector('[role="listitem"]')?.lastElementChild?.lastElementChild;
        expect(detailLine()?.textContent).toBe('\u00a0');

        await rerender(row('Docker Engine 27.3'));
        expect(detailLine()?.textContent).toBe('Docker Engine 27.3');
    });

    test('skipped shows a hidden glyph, voices its word, and keeps the reason in the detail line', async () => {
        const { root } = await renderSurface(
            <StatusList ariaLabel="Connection checks">
                <StatusListItem
                    label="Secure connection (TLS)"
                    status="skipped"
                    detail="Not used: TLS is off for this connection"
                />
            </StatusList>,
        );

        const row = root.querySelector('[role="listitem"]');
        const glyph = row?.querySelector('svg');
        expect(glyph).not.toBeNull();
        expect(glyph?.getAttribute('aria-hidden')).toBe('true');

        const copy = row?.lastElementChild;
        expect(copy?.firstElementChild?.textContent).toBe('Secure connection (TLS), skipped');
        expect(copy?.lastElementChild?.textContent).toBe('Not used: TLS is off for this connection');
    });

    test('skipped takes a localized status word', async () => {
        const { root } = await renderSurface(
            <StatusList ariaLabel="Connection checks" statusLabels={{ skipped: 'Not run' }}>
                <StatusListItem label="Server address (DNS)" status="skipped" />
            </StatusList>,
        );

        expect(root.querySelector('[role="listitem"]')?.textContent).toBe('Server address (DNS), Not run');
    });

    test('skipped renders a different glyph from pending', async () => {
        const glyphMarkup = async (status: 'pending' | 'skipped'): Promise<string | undefined> => {
            const { root } = await renderSurface(
                <StatusList ariaLabel="Connection checks">
                    <StatusListItem label="Authentication" status={status} />
                </StatusList>,
            );
            return root.querySelector('[role="listitem"] svg')?.innerHTML;
        };

        const pending = await glyphMarkup('pending');
        const skipped = await glyphMarkup('skipped');
        expect(skipped).toBeDefined();
        expect(skipped).not.toBe(pending);
    });

    test('a row without a detail and without reserved space renders no detail line', async () => {
        const { root } = await renderSurface(
            <StatusList ariaLabel="Setup progress">
                <StatusListItem label="Creating container" status="pending" />
            </StatusList>,
        );

        const copy = root.querySelector('[role="listitem"]')?.lastElementChild;
        expect(copy?.children).toHaveLength(1);
    });

    test('aside sits after the label and its status word, on the label line', async () => {
        const { root } = await renderSurface(
            <StatusList ariaLabel="Connection checks">
                <StatusListItem
                    label="Authentication"
                    status="done"
                    detail="Username and password"
                    aside={<span data-testid="duration">4.38 s</span>}
                />
            </StatusList>,
        );

        const row = root.querySelector('[role="listitem"]');
        const copy = row?.lastElementChild;
        // Still two lines: the label line (now holding the aside) and the detail line.
        expect(copy?.children).toHaveLength(2);
        expect(copy?.firstElementChild?.textContent).toBe('Authentication, done4.38 s');
        expect(copy?.firstElementChild?.querySelector('[data-testid="duration"]')).not.toBeNull();
        expect(copy?.lastElementChild?.textContent).toBe('Username and password');
    });

    test('an empty aside renders exactly as no aside', async () => {
        const markup = async (aside?: false | null | ''): Promise<string | undefined> => {
            const { root } = await renderSurface(
                <StatusList ariaLabel="Connection checks">
                    <StatusListItem label="Authentication" status="done" aside={aside} />
                </StatusList>,
            );
            return root.querySelector('[role="listitem"]')?.innerHTML;
        };

        const without = await markup();
        for (const empty of [false, null, ''] as const) {
            expect(await markup(empty)).toBe(without);
        }
    });

    test('aside works with a label-placed disclosure toggle', async () => {
        const { root } = await renderSurface(
            <StatusList ariaLabel="Connection checks">
                <StatusListItem
                    label="Authentication"
                    status="warning"
                    aside="4.38 s"
                    disclosure={{ content: 'More', toggleText: 'Details', toggleLabel: 'Details for Authentication' }}
                />
            </StatusList>,
        );

        const labelLine = root.querySelector('[role="listitem"]')?.lastElementChild?.firstElementChild;
        expect(labelLine?.querySelector('button')?.textContent).toBe('Details');
        expect(labelLine?.textContent).toBe('Authentication, warningDetails4.38 s');
    });

    test('highlightRowsOnHover never changes the markup of its rows', async () => {
        // The shade is CSS on the list (Griffel classes, which this renderer does not emit); the rows'
        // structure, and so their layout and accessible text, stay the same.
        const rowsMarkup = async (highlight: boolean): Promise<string | undefined> => {
            const { root } = await renderSurface(
                <StatusList ariaLabel="Connection checks" highlightRowsOnHover={highlight}>
                    <StatusListItem label="Authentication" status="done" />
                </StatusList>,
            );
            return root.querySelector('[role="list"]')?.innerHTML;
        };

        expect(await rowsMarkup(true)).toBe(await rowsMarkup(false));
    });

    describe('disclosure', () => {
        const disclosureRow = (extra: Partial<StatusListItemDisclosure> = {}): ReactElement => (
            <StatusList ariaLabel="Connection checks">
                <StatusListItem
                    label="Server address (DNS)"
                    status="warning"
                    detail="SRV record lists 1 host · all resolve"
                    disclosure={{
                        content: <p>Private endpoint resolves publicly</p>,
                        toggleText: 'Details',
                        toggleLabel: 'Details for Server address (DNS)',
                        ...extra,
                    }}
                />
            </StatusList>
        );

        test('a row without a disclosure renders no toggle and no region', async () => {
            const { root } = await renderSurface(
                <StatusList ariaLabel="Connection checks">
                    <StatusListItem label="Authentication" status="done" detail="Username and password" />
                </StatusList>,
            );

            expect(root.querySelector('button')).toBeNull();
            expect(root.querySelector('[role="region"]')).toBeNull();
        });

        test('the toggle controls a mounted, inert, labelled region with no collapsed content', async () => {
            const { root } = await renderSurface(disclosureRow());

            const toggle = root.querySelector('button');
            const region = root.querySelector('[role="region"]');
            expect(toggle?.getAttribute('aria-label')).toBe('Details for Server address (DNS)');
            expect(toggle?.textContent).toBe('Details');
            expect(toggle?.getAttribute('aria-expanded')).toBe('false');
            expect(toggle?.getAttribute('aria-controls')).toBe(region?.id);
            expect(region?.getAttribute('aria-labelledby')).toBe(toggle?.id);
            expect(region?.hasAttribute('inert')).toBe(true);
            expect(region?.childElementCount).toBe(0);
            // The detail line is unchanged and still follows the label.
            expect(root.querySelector('[role="listitem"]')?.textContent).toContain(
                'SRV record lists 1 host · all resolve',
            );
        });

        test('clicking expands and collapses the region without moving focus', async () => {
            const { root } = await renderSurface(disclosureRow());
            const toggle = root.querySelector('button');
            toggle?.focus();

            await act(async () => {
                toggle?.click();
            });
            expect(toggle?.getAttribute('aria-expanded')).toBe('true');
            expect(root.querySelector('[role="region"]')?.hasAttribute('inert')).toBe(false);
            expect(root.querySelector('[role="region"]')?.textContent).toBe('Private endpoint resolves publicly');
            expect(document.activeElement).toBe(toggle);

            await act(async () => {
                toggle?.click();
            });
            expect(toggle?.getAttribute('aria-expanded')).toBe('false');
            expect(root.querySelector('[role="region"]')?.hasAttribute('inert')).toBe(true);
            expect(root.querySelector('[role="region"]')?.childElementCount).toBe(0);
            expect(document.activeElement).toBe(toggle);
        });

        test('a controlled disclosure follows `expanded` and reports clicks', async () => {
            const changes: boolean[] = [];
            const { root, rerender } = await renderSurface(
                disclosureRow({ expanded: false, onExpandedChange: (next) => changes.push(next) }),
            );
            const toggle = root.querySelector('button');

            await act(async () => {
                toggle?.click();
            });
            expect(changes).toEqual([true]);
            expect(toggle?.getAttribute('aria-expanded')).toBe('false');

            await rerender(disclosureRow({ expanded: true, onExpandedChange: (next) => changes.push(next) }));
            expect(toggle?.getAttribute('aria-expanded')).toBe('true');
        });

        test('collapsing removes interactive content and keeps aria-controls valid', async () => {
            const { root, rerender } = await renderSurface(
                disclosureRow({ expanded: true, content: <button type="button">Check again</button> }),
            );
            const toggle = root.querySelector('button');
            const region = root.querySelector('[role="region"]');
            const regionId = toggle?.getAttribute('aria-controls') ?? '';
            expect(region?.querySelector('button')?.textContent).toBe('Check again');
            expect(region?.hasAttribute('inert')).toBe(false);
            toggle?.focus();

            await rerender(disclosureRow({ expanded: false, content: <button type="button">Check again</button> }));

            expect(document.getElementById(regionId)).toBe(region);
            expect(toggle?.getAttribute('aria-expanded')).toBe('false');
            expect(region?.hasAttribute('inert')).toBe(true);
            // Fluent finishes immediately without Web Animations in jsdom: no descendants remain
            // to reach by keyboard or expose to assistive technology after the exit.
            expect(region?.childElementCount).toBe(0);
            expect(root.querySelectorAll('button')).toHaveLength(1);
            expect(document.activeElement).toBe(toggle);
        });

        test('defaultExpanded shows content immediately and still allows collapse', async () => {
            const { root } = await renderSurface(disclosureRow({ defaultExpanded: true }));
            const toggle = root.querySelector('button');
            const region = root.querySelector('[role="region"]');
            expect(toggle?.getAttribute('aria-expanded')).toBe('true');
            expect(region?.textContent).toBe('Private endpoint resolves publicly');
            expect(region?.hasAttribute('inert')).toBe(false);

            await act(async () => {
                toggle?.click();
            });
            expect(region?.hasAttribute('inert')).toBe(true);
            expect(region?.childElementCount).toBe(0);
        });

        test('toggleDescription becomes the button description', async () => {
            const { root } = await renderSurface(disclosureRow({ toggleDescription: '1 warning' }));
            const toggle = root.querySelector('button');
            const describedBy = toggle?.getAttribute('aria-describedby');
            expect(describedBy).toBeTruthy();
            expect(document.getElementById(describedBy ?? '')?.textContent).toBe('1 warning');
        });

        test('toggleRef receives the button', async () => {
            let button: HTMLButtonElement | null = null;
            await renderSurface(
                disclosureRow({
                    toggleRef: (element: HTMLButtonElement | null): void => {
                        button = element;
                    },
                }),
            );
            expect(button).toBeInstanceOf(HTMLButtonElement);
        });

        describe("placement: 'detail'", () => {
            const lines = (root: HTMLElement): Element[] =>
                Array.from(root.querySelector('[role="listitem"]')?.lastElementChild?.children ?? []);

            test('the label line is a plain label and the toggle ends the detail line', async () => {
                const { root } = await renderSurface(disclosureRow({ placement: 'detail' }));

                const [labelLine, detailLine, region] = lines(root);
                expect(labelLine.querySelector('button')).toBeNull();
                expect(labelLine.textContent).toBe('Server address (DNS), warning');
                const toggle = detailLine.querySelector('button');
                expect(detailLine.textContent).toBe('SRV record lists 1 host · all resolve Details');
                expect(detailLine.lastElementChild).toBe(toggle);
                expect(region.getAttribute('role')).toBe('region');
            });

            test('keeps the disclosure semantics of the label placement', async () => {
                const { root } = await renderSurface(
                    disclosureRow({ placement: 'detail', toggleDescription: '1 warning' }),
                );
                const toggle = root.querySelector('button');
                const region = root.querySelector('[role="region"]');
                expect(toggle?.getAttribute('aria-label')).toBe('Details for Server address (DNS)');
                expect(toggle?.getAttribute('aria-expanded')).toBe('false');
                expect(toggle?.getAttribute('aria-controls')).toBe(region?.id);
                expect(region?.getAttribute('aria-labelledby')).toBe(toggle?.id);
                const describedBy = toggle?.getAttribute('aria-describedby') ?? '';
                expect(document.getElementById(describedBy)?.textContent).toBe('1 warning');

                toggle?.focus();
                await act(async () => {
                    toggle?.click();
                });
                expect(toggle?.getAttribute('aria-expanded')).toBe('true');
                expect(region?.hasAttribute('inert')).toBe(false);
                expect(document.activeElement).toBe(toggle);
            });

            test('an empty detail line still holds the toggle', async () => {
                const { root } = await renderSurface(
                    <StatusList ariaLabel="Connection checks">
                        <StatusListItem
                            label="Diagnosis setup"
                            status="warning"
                            disclosure={{
                                content: <p>Checks run on a remote host</p>,
                                toggleText: 'Details',
                                toggleLabel: 'Details for Diagnosis setup',
                                placement: 'detail',
                            }}
                        />
                    </StatusList>,
                );

                const [labelLine, detailLine] = lines(root);
                expect(labelLine.querySelector('button')).toBeNull();
                expect(detailLine.textContent).toBe('Details');
                expect(detailLine.querySelector('button')?.getAttribute('aria-expanded')).toBe('false');
            });
        });
    });
});
