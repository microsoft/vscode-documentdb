/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, it, expect, vi } from 'vitest';

import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fixtures } from './fixtures';
import { prepare, serve, validatePrefix } from './harness';
import { augmentTemplate, hostTemplate, inertJson } from './template';
import { vsixTools } from './vsix';

const repository = resolve(__dirname, '../../..');

function writeFixtureVsix(filename: string, files: Map<string, Buffer>): void {
    vsixTools.writeVsix(filename, files);
}

describe('Stage 0 L2 production browser harness', (): void => {
    it.each(['views.js', 'dist/views.js'])('uses the shared extension-only extractor for %s layout', (entry: string): void => {
        const temporary = mkdtempSync(join(tmpdir(), 'documentdb-l2-extraction-test-'));
        const archive = join(temporary, 'fixture.vsix');
        const output = join(temporary, 'generated');
        const contents = Buffer.from('export function render() {}');
        try {
            writeFixtureVsix(archive, new Map([
                ['extension/package.json', Buffer.from('{"name":"fixture"}')],
                [`extension/${entry}`, contents],
                ['extension.vsixmanifest', Buffer.from('<manifest/>')],
                ['[Content_Types].xml', Buffer.from('<types/>')],
            ]));
            const read = vi.spyOn(vsixTools, 'readVsix');
            const extract = vi.spyOn(vsixTools, 'extractVsix');
            prepare({ vsix: archive, output, prefix: '/stage0/l2', origin: 'http://127.0.0.1:18081', repository });
            expect(read).toHaveBeenCalledWith(archive);
            expect(extract).toHaveBeenCalledWith(archive, join(output, 'unpacked'));
            expect(readFileSync(join(output, 'site/artifact/views.js'))).toEqual(contents);
            expect(existsSync(join(output, 'unpacked/extension.vsixmanifest'))).toBe(false);
            expect(existsSync(join(output, 'unpacked/[Content_Types].xml'))).toBe(false);
            expect(existsSync(join(output, 'site/pages/atlasCredentials.html'))).toBe(true);
            expect(existsSync(join(output, 'site/pages/clusterDashboard.html'))).toBe(true);
            expect(existsSync(join(output, 'site/pages/collectionView.html'))).toBe(true);
            expect(existsSync(join(output, 'site/pages/documentView.html'))).toBe(true);
            expect(existsSync(join(output, 'site/pages/localQuickStart.html'))).toBe(true);
            expect(existsSync(join(output, 'site/pages/collectionView-broken-css.html'))).toBe(true);
        } finally {
            vi.restoreAllMocks();
            rmSync(temporary, { recursive: true });
        }
    });

    it('rejects a package without the production entry before creating output', (): void => {
        const temporary = mkdtempSync(join(tmpdir(), 'documentdb-l2-invalid-vsix-test-'));
        try {
            const archive = join(temporary, 'fixture.vsix');
            const output = join(temporary, 'generated');
            writeFixtureVsix(archive, new Map([['extension/package.json', Buffer.from('{"name":"fixture"}')]]));
            expect((): void => prepare({ vsix: archive, output, prefix: '/stage0/l2',
                origin: 'http://127.0.0.1:18081', repository })).toThrow('Packaged production views.js missing');
            expect(existsSync(output)).toBe(false);
        } finally {
            rmSync(temporary, { recursive: true });
        }
    });

    it('covers all five registry keys with populated fixture contracts', (): void => {
        expect(Object.keys(fixtures).sort()).toEqual(['atlasCredentials', 'clusterDashboard', 'collectionView', 'documentView', 'localQuickStart']);
        for (const fixture of Object.values(fixtures)) {
            expect(fixture.content.length).toBeGreaterThan(0);
            expect(fixture.styles.length).toBeGreaterThan(0);
        }
    });

    it('executes the production host template and retains its CSP and boot script unchanged', (): void => {
        const html = hostTemplate(repository, '/stage0/l2/artifact', 'http://127.0.0.1:18081', 'collectionView', fixtures.collectionView.config);
        const augmented = augmentTemplate(html, fixtures.collectionView, '/stage0/l2');
        const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1];
        expect(csp).toBeDefined();
        expect(augmented).toContain(`content="${csp}"`);
        expect(csp).toContain("script-src http://127.0.0.1:18081 'nonce-");
        expect(csp).not.toContain("'unsafe-eval'");
        expect(csp).not.toContain('18080');
        const boot = /<script type="module"[\s\S]+?<\/script>/.exec(html)?.[0];
        expect(boot).toBeDefined();
        expect(augmented).toContain(boot);
        expect(boot).toContain('import { render } from "/stage0/l2/artifact/views.js"');
        expect(boot).toContain('render(__data.viewType, acquireVsCodeApi())');
    });

    it('rejects template drift instead of inventing a boot script or weaker CSP', (): void => {
        expect((): string => augmentTemplate('<html></html>', {}, '/stage0/l2')).toThrow('Host boot template changed');
    });

    it('escapes inert fixture data without changing values', (): void => {
        const value = { text: '</script><script>alert(1)</script>\u2028\u2029' };
        const encoded = inertJson(value);
        expect(encoded).not.toContain('<');
        expect(JSON.parse(encoded)).toEqual(value);
    });

    it.each(['/', '/stage0/', '/stage0?x=1', '/stage0/../assets', '//stage0'])('rejects invalid prefix %s', (prefix: string): void => {
        expect((): void => validatePrefix(prefix)).toThrow();
    });

    it('serves only query-free prefixed paths and persists browser reports', async (): Promise<void> => {
        const output = mkdtempSync(join(tmpdir(), 'documentdb-l2-test-'));
        mkdirSync(join(output, 'site'));
        writeFileSync(join(output, 'site', 'views.js'), 'export const render = () => {};');
        const server = serve(output, '/stage0/l2', 0);
        try {
            await new Promise<void>((resolve): void => { server.once('listening', resolve); });
            const address = server.address();
            if (!address || typeof address === 'string') {
                throw new Error('Test server has no TCP address');
            }
            const origin = `http://127.0.0.1:${address.port}`;
            expect((await fetch(`${origin}/stage0/l2/views.js`)).status).toBe(200);
            expect((await fetch(`${origin}/views.js`)).status).toBe(404);
            expect((await fetch(`${origin}/stage0/l2/views.js?x=1`)).status).toBe(404);
            expect((await fetch(`${origin}/stage0/l2/missing.js`)).status).toBe(404);
            expect((await fetch(`${origin}/stage0/l2/reports/collectionView`, {
                method: 'POST', body: JSON.stringify({ verified: true }),
            })).status).toBe(201);
        } finally {
            await new Promise<void>((resolve, reject): void => {
                server.close((error): void => { if (error) { reject(error); } else { resolve(); } });
            });
            rmSync(output, { recursive: true });
        }
    });
});
