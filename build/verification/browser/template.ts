/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

export function hostTemplate(repository: string, assetRoot: string, origin: string, view: string, config: unknown): string {
    const filename = resolve(repository, 'packages/vscode-ext-webview/src/host/WebviewController.ts');
    const nativeRequire = createRequire(filename);
    const exported: { exports: Record<string, unknown> } = { exports: {} };
    const source = transpileModule(readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2023 },
    }).outputText;
    const load = (name: string): unknown => {
        switch (name) {
            case 'vscode': return {
                ExtensionMode: { Production: 1 },
                Uri: { file: (fsPath: string): { fsPath: string } => ({ fsPath }) },
                l10n: { bundle: {} },
            };
            case './attachTrpc':
            case './middleware/logging': return {};
            case 'path':
            case 'crypto': return nativeRequire(name);
            default: throw new Error(`Unexpected host-template dependency: ${name}`);
        }
    };
    runInNewContext(source, { exports: exported.exports, module: exported, require: load, process: { env: {} } }, { filename });
    const controller = exported.exports.WebviewController;
    if (typeof controller !== 'function') {
        throw new Error('Host template no longer exports WebviewController');
    }
    const template: unknown = Reflect.get(controller.prototype, 'getDocumentTemplate');
    if (typeof template !== 'function') {
        throw new Error('WebviewController.getDocumentTemplate changed; update the harness explicitly');
    }
    const html: unknown = Reflect.apply(template, {
        _options: {
            isBundled: true, config, viewType: view, sourceLayout: { bundled: { dir: '', file: 'views.js' } },
            extensionContext: { extensionMode: 1, extensionPath: '/stage0-artifact' },
        },
    }, [{
        cspSource: origin,
        asWebviewUri: (uri: { fsPath: string }): { toString: () => string } => ({
            toString: (): string => `${assetRoot}/${uri.fsPath.slice('/stage0-artifact/'.length)}`,
        }),
    }]);
    if (typeof html !== 'string') {
        throw new Error('Host template did not return HTML');
    }
    return html;
}

export function inertJson(value: unknown): string {
    return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export function augmentTemplate(html: string, fixture: unknown, prefix: string): string {
    const nonce = /<script type="module" nonce="([^"]+)">/.exec(html)?.[1];
    if (!nonce || !html.includes('<div id="root"></div>')) {
        throw new Error('Host boot template changed; cannot safely insert the fixture');
    }
    return html.replace('</head>', `<link rel="icon" href="data:,"><link rel="stylesheet" href="${prefix}/theme.css"></head>`)
        .replace('<body>', '<body data-vscode-theme-kind="vscode-light" class="vscode-light">')
        .replace('<div id="root"></div>', `<script type="application/json" id="stage0-fixture" nonce="${nonce}">${inertJson(fixture)}</script>
<script src="${prefix}/runtime.js" nonce="${nonce}"></script><div id="root"></div>`);
}
