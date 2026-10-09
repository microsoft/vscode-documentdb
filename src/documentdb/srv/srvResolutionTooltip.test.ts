/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ClustersClient } from '../ClustersClient';
import { type SrvResolutionSummary } from './srvResolutionSummary';
import { appendSrvResolutionTooltipLine, withSrvResolutionTooltip } from './srvResolutionTooltip';

jest.mock('vscode', () => ({
    ...jest.requireActual<typeof vscode>('../../__mocks__/vscode.js'),
    MarkdownString: class MarkdownString {
        #delegate: Pick<vscode.MarkdownString, 'value' | 'isTrusted' | 'supportThemeIcons' | 'supportHtml' | 'baseUri'>;

        constructor(value = '', supportThemeIcons = false) {
            this.#delegate = { value, supportThemeIcons };
        }

        get value(): string {
            return this.#delegate.value;
        }
        set value(value: string) {
            this.#delegate.value = value;
        }
        get isTrusted(): vscode.MarkdownString['isTrusted'] {
            return this.#delegate.isTrusted;
        }
        set isTrusted(value: vscode.MarkdownString['isTrusted']) {
            this.#delegate.isTrusted = value;
        }
        get supportThemeIcons(): boolean | undefined {
            return this.#delegate.supportThemeIcons;
        }
        set supportThemeIcons(value: boolean | undefined) {
            this.#delegate.supportThemeIcons = value;
        }
        get supportHtml(): boolean | undefined {
            return this.#delegate.supportHtml;
        }
        set supportHtml(value: boolean | undefined) {
            this.#delegate.supportHtml = value;
        }
        get baseUri(): vscode.Uri | undefined {
            return this.#delegate.baseUri;
        }
        set baseUri(value: vscode.Uri | undefined) {
            this.#delegate.baseUri = value;
        }

        appendMarkdown(value: string): this {
            this.#delegate.value += value;
            return this;
        }

        appendText(value: string): this {
            this.#delegate.value += value.replace(/[\\`*_{}[\]()#+\-.!|~]/g, '\\$&');
            return this;
        }
    },
}));

jest.mock('@vscode/l10n', () => ({
    t: jest.fn((message: string, ...args: unknown[]): string =>
        args.reduce<string>((translated, arg, index) => translated.replace(`{${index}}`, String(arg)), message),
    ),
}));

describe('SRV resolution tooltip', (): void => {
    afterEach((): void => {
        jest.restoreAllMocks();
    });

    it.each(['node', 'nodeErrorPassthrough', undefined] as const)(
        'leaves the tooltip unchanged for %s',
        (path): void => {
            jest.spyOn(ClustersClient, 'getSrvResolution').mockReturnValue(path ? { path, resolvedAt: 1 } : undefined);
            const md = new vscode.MarkdownString('Original tooltip');
            appendSrvResolutionTooltipLine(md, 'stable-id');
            expect(md.value).toBe('Original tooltip');
        },
    );

    it.each(['EBADRESP', 'EFORMERR', 'ECONNREFUSED', undefined])(
        'renders a single host-free fallback line with code %s',
        (nodeErrorCode): void => {
            const summary: SrvResolutionSummary = { path: 'fallback', resolvedAt: 1, nodeErrorCode };
            const getSummary = jest.spyOn(ClustersClient, 'getSrvResolution').mockReturnValue(summary);
            const md = new vscode.MarkdownString();
            appendSrvResolutionTooltipLine(md, 'stable-id');
            appendSrvResolutionTooltipLine(md, 'stable-id');
            expect(getSummary).toHaveBeenCalledWith('stable-id');
            expect(md.value.match(/\*\*DNS:\*\*/g)).toHaveLength(1);
            expect(md.value).toContain("SRV record resolved by the extension's fallback resolver");
            if (nodeErrorCode) {
                expect(md.value).toContain(`could not use the reply (\`${nodeErrorCode}\`).`);
            } else {
                expect(md.value).not.toContain('because');
            }
            expect(md.value).not.toContain('mongodb://');
        },
    );

    it.each(['Translated sentence without a colon', 'Translated sentence with a full-width colon：'])(
        'localizes the DNS label separately from %s',
        (message): void => {
            jest.spyOn(ClustersClient, 'getSrvResolution').mockReturnValue({ path: 'fallback', resolvedAt: 1 });
            jest.mocked(l10n.t)
                .mockImplementationOnce(() => message)
                .mockImplementationOnce(() => 'Translated DNS');
            const md = new vscode.MarkdownString();
            appendSrvResolutionTooltipLine(md, 'stable-id');
            expect(md.value).toContain(`**Translated DNS:** ${message}`);
            expect(l10n.t).toHaveBeenCalledWith('DNS');
            expect(md.value).not.toContain('****');
        },
    );

    it('copies prototype-accessor markdown content and rendering options without mutating the original', (): void => {
        jest.spyOn(ClustersClient, 'getSrvResolution').mockReturnValue({ path: 'fallback', resolvedAt: 1 });
        const content = '### Cluster heading\n\n⚠️ **Security:** TLS/SSL Disabled';
        const original = new vscode.MarkdownString(content, true);
        original.isTrusted = { enabledCommands: ['documentdb.test'] };
        original.supportHtml = true;
        original.baseUri = vscode.Uri.parse('https://example.com/docs/');
        expect(Object.keys(original)).toEqual([]);

        const result = withSrvResolutionTooltip(original, 'stable-id') as vscode.MarkdownString;
        expect(result).not.toBe(original);
        expect(result.value).toContain(content);
        expect(result.value.match(/\*\*DNS:\*\*/g)).toHaveLength(1);
        expect(result.isTrusted).toBe(original.isTrusted);
        expect(result.supportThemeIcons).toBe(true);
        expect(result.supportHtml).toBe(true);
        expect(result.baseUri).toBe(original.baseUri);
        expect(original.value).toBe(content);
        expect(withSrvResolutionTooltip(result, 'stable-id')).toBe(result);
    });

    it('keeps an already decorated tooltip unchanged on a second pass', (): void => {
        jest.spyOn(ClustersClient, 'getSrvResolution').mockReturnValue({
            path: 'fallback',
            nodeErrorCode: 'EBADRESP',
            resolvedAt: 1,
        });
        const original = new vscode.MarkdownString('### Connection\n\nTLS/SSL Disabled', true);
        original.isTrusted = false;
        appendSrvResolutionTooltipLine(original, 'stable-id');
        expect(withSrvResolutionTooltip(original, 'stable-id')).toBe(original);
        expect(original.value).toContain('### Connection');
        expect(original.value).toContain('TLS/SSL Disabled');
        expect(original.value.match(/\*\*DNS:\*\*/g)).toHaveLength(1);
        expect(original.isTrusted).toBe(false);
        expect(original.supportThemeIcons).toBe(true);
    });

    it('escapes a plain-text fallback tooltip before appending the DNS line', (): void => {
        jest.spyOn(ClustersClient, 'getSrvResolution').mockReturnValue({ path: 'fallback', resolvedAt: 1 });
        const result = withSrvResolutionTooltip('plain *text*', 'stable-id') as vscode.MarkdownString;
        expect(result.value).toContain('plain \\*text\\*');
        expect(result.value.match(/\*\*DNS:\*\*/g)).toHaveLength(1);
    });
});
