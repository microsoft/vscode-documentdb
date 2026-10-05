/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { fixtures, type HarnessFixture } from './fixtures';
import { runIntegratedCheck } from './playwright';
import { augmentTemplate, hostTemplate } from './template';
import { vsixTools } from './vsix';

export interface HarnessOptions {
    readonly vsix: string;
    readonly output: string;
    readonly origin: string;
    readonly prefix: string;
    readonly repository: string;
}

export function validatePrefix(prefix: string): void {
    if (!/^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(prefix)) {
        throw new Error('L2 requires a non-root path prefix without a trailing slash');
    }
}

function browserRuntime(): string {
    const compile = (filename: string): string => transpileModule(readFileSync(join(import.meta.dirname, filename), 'utf8'), {
        compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2023 },
    }).outputText;
    // Inline only these browser modules: a classic script installs the API synchronously before
    // the unchanged host boot module. No eval, Node loader, or extra CSP/chunk exceptions.
    const modules = ['core/fixtures', 'core/fakeVsCodeApi'].map((name): string =>
        `modules[${JSON.stringify(`./${name}`)}] = (() => {
const exports = {};
${compile(`${name}.ts`)}
return exports;
})();`).join('\n');
    return `(() => {
const modules = {};
const require = (name) => {
    if (!Object.hasOwn(modules, name)) throw new Error('Unexpected browser runtime dependency: ' + name);
    return modules[name];
};
${modules}
const exports = {};
${compile('runtime.ts')}
})();\n`;
}

export function prepare(options: HarnessOptions): void {
    validatePrefix(options.prefix);
    const origin = new URL(options.origin);
    if (origin.pathname !== '/' || origin.search || origin.hash || !['http:', 'https:'].includes(origin.protocol)) {
        throw new Error('origin must be an HTTP(S) origin without path/query/fragment');
    }
    if (existsSync(options.output)) {
        throw new Error(`Output already exists; use a fresh artifact directory: ${options.output}`);
    }
    const files = vsixTools.readVsix(resolve(options.vsix));
    const flatLayout = files.has('extension/views.js');
    if (!flatLayout && !files.has('extension/dist/views.js')) {
        throw new Error('Packaged production views.js missing');
    }
    mkdirSync(options.output, { recursive: true });
    const unpacked = join(options.output, 'unpacked');
    vsixTools.extractVsix(resolve(options.vsix), unpacked);
    const assetDirectory = flatLayout ? unpacked : join(unpacked, 'dist');
    const viewsSource = readFileSync(join(assetDirectory, 'views.js'), 'utf8');
    const brokenCss: HarnessFixture['brokenCss'] = viewsSource.includes('data-documentdb-views-css')
        ? 'bundle-stylesheet' : 'all-styles';
    // webpack's single-file views.js has no relative static imports; a split (Vite) entry does. A
    // split entry without the marker would silently fall back to the webpack control.
    if (brokenCss === 'all-styles' && /\bfrom\s*["']\.\//.test(viewsSource)) {
        throw new Error('Split views.js has no data-documentdb-views-css stylesheet marker; cannot build the CSS-negative control');
    }
    const site = join(options.output, 'site');
    mkdirSync(join(site, 'pages'), { recursive: true });
    cpSync(assetDirectory, join(site, 'artifact'), { recursive: true });
    const assetRoot = `${options.prefix}/artifact`;
    cpSync(join(import.meta.dirname, 'theme.css'), join(site, 'theme.css'));
    writeFileSync(join(site, 'runtime.js'), browserRuntime());
    for (const [view, fixture] of Object.entries(fixtures)) {
        const html = hostTemplate(options.repository, assetRoot, origin.origin, view, fixture.config);
        writeFileSync(join(site, 'pages', `${view}.html`), augmentTemplate(html, { ...fixture, view, assetRoot, brokenCss: false }, options.prefix));
        if (view === 'collectionView') {
            writeFileSync(join(site, 'pages', `${view}-broken-css.html`),
                augmentTemplate(html, { ...fixture, view, assetRoot, brokenCss }, options.prefix));
        }
    }
    // tsx (esbuild keepNames) wraps named functions in `__name(...)`; the serialized helper runs in
    // the Playwright tool's context, which has no such helper.
    const helper = `const __name = (target, value) => Object.defineProperty(target, 'name', { value, configurable: true });
${runIntegratedCheck.toString()}`;
    const snippet = `${helper}\nreturn await runIntegratedCheck(page, PAGE_URL, EXPECT_CSS_FAILURE);\n`;
    writeFileSync(join(options.output, 'integrated-check.js'), snippet);
    const pages = Object.keys(fixtures).map((view): string => `${origin.origin}${options.prefix}/pages/${view}.html`);
    const negative = `${origin.origin}${options.prefix}/pages/collectionView-broken-css.html`;
    const allChecks = `${helper}
const results = [];
for (const url of ${JSON.stringify(pages)}) {
    results.push(await runIntegratedCheck(page, url));
}
results.push(await runIntegratedCheck(page, ${JSON.stringify(negative)}, true));
return results;
`;
    writeFileSync(join(options.output, 'integrated-all-checks.js'), allChecks);
    writeFileSync(join(site, 'integrated-all-checks.js'), allChecks);
    const digest = createHash('sha256').update(readFileSync(options.vsix)).digest('hex');
    writeFileSync(join(options.output, 'manifest.json'), JSON.stringify({
        vsix: resolve(options.vsix), sha256: digest, origin: origin.origin, prefix: options.prefix,
        template: 'packages/vscode-ext-webview/src/host/WebviewController.ts',
        templateSha256: createHash('sha256').update(readFileSync(join(options.repository, 'packages/vscode-ext-webview/src/host/WebviewController.ts'))).digest('hex'),
        pages, negative,
        cssNegativeControl: brokenCss === 'bundle-stylesheet'
            ? 'Remove only style[data-documentdb-views-css]; retain Fluent/Griffel runtime styles, host theme and CSP; require a removed bundle stylesheet.'
            : 'Remove all style elements for webpack/style-loader; retain host theme and CSP.',
    }, null, 2));
}

const mime: Readonly<Record<string, string>> = {
    '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2',
};

export function serve(output: string, prefix: string, port: number): Server {
    validatePrefix(prefix);
    const root = realpathSync(join(output, 'site'));
    const server = createServer((request, response): void => {
        const url = new URL(request.url ?? '/', 'http://localhost');
        if (url.search || !url.pathname.startsWith(`${prefix}/`)) {
            response.writeHead(404).end('L2 serves only query-free prefixed paths');
            return;
        }
        let pathname: string;
        try {
            pathname = decodeURIComponent(url.pathname.slice(prefix.length + 1));
        } catch {
            response.writeHead(400).end('Invalid URL encoding');
            return;
        }
        if (request.method === 'POST' && /^reports\/(?:clusterDashboard|collectionView|documentView|localQuickStart|atlasCredentials)(?:-broken-css)?$/.test(pathname)) {
            const chunks: Buffer[] = [];
            let size = 0;
            request.on('data', (chunk: Buffer): void => {
                size += chunk.length;
                if (size > 1024 * 1024) {
                    request.destroy(new Error('L2 report exceeds 1 MiB'));
                } else {
                    chunks.push(chunk);
                }
            });
            request.on('end', (): void => {
                try {
                    const report: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                    mkdirSync(join(output, 'reports'), { recursive: true });
                    writeFileSync(join(output, `${pathname}.json`), JSON.stringify(report, null, 2));
                    response.writeHead(201).end('L2 report persisted');
                } catch (error) {
                    response.writeHead(400).end(error instanceof Error ? error.message : String(error));
                }
            });
            request.on('error', (error: Error): void => { console.error(`L2 report upload failed: ${error.message}`); });
            return;
        }
        if (request.method !== 'GET' && request.method !== 'HEAD') {
            response.writeHead(405).end('Method not allowed');
            return;
        }
        const filename = resolve(root, pathname);
        if (!filename.startsWith(`${root}${sep}`) || !existsSync(filename) || !lstatSync(filename).isFile() ||
            relative(root, realpathSync(filename)).startsWith('..')) {
            response.writeHead(404).end('Asset missing or outside L2 prefix');
            return;
        }
        response.writeHead(200, { 'Content-Type': `${mime[extname(filename)] ?? 'application/octet-stream'}; charset=utf-8`,
            'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        response.end(request.method === 'HEAD' ? undefined : readFileSync(filename));
    });
    server.listen(port, '127.0.0.1');
    return server;
}

function main(): void {
    const [command, ...args] = process.argv.slice(2);
    const flags = new Map<string, string>();
    for (let index = 0; index < args.length; index += 2) {
        const name = args[index];
        const value = args[index + 1];
        if (!['--vsix', '--output', '--port', '--prefix', '--origin'].includes(name) || value === undefined || flags.has(name)) {
            throw new Error(`Invalid L2 option: ${name}`);
        }
        flags.set(name, value);
    }
    const output = flags.get('--output');
    if (!output) {
        throw new Error('Usage: harness.ts prepare|serve --output <fresh-directory> [--vsix <production.vsix>] [--port 18081] [--prefix /stage0/l2] [--origin http://127.0.0.1:18081]');
    }
    const port = Number(flags.get('--port') ?? 18081);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
        throw new Error('Invalid L2 port');
    }
    const prefix = flags.get('--prefix') ?? '/stage0/l2';
    if (command === 'prepare') {
        const vsix = flags.get('--vsix');
        if (!vsix) {
            throw new Error('prepare requires --vsix');
        }
        prepare({ vsix, output: resolve(output), prefix, origin: flags.get('--origin') ?? `http://127.0.0.1:${port}`,
            repository: resolve(import.meta.dirname, '../../..') });
        console.log(`L2 pages prepared: ${resolve(output, 'manifest.json')}`);
    } else if (command === 'serve') {
        const server = serve(resolve(output), prefix, port);
        server.on('error', (error: Error): void => { console.error(error); process.exitCode = 1; });
        server.on('listening', (): void => { console.log(`L2 listening at http://127.0.0.1:${port}${prefix}/pages/collectionView.html`); });
    } else {
        throw new Error(`Unknown L2 command: ${command}`);
    }
}

// The root package is `"type": "module"`, so tsx runs this file as an ES module.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main();
}
