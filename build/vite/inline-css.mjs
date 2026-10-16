/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Moves the single stylesheet of the production build into `views.js`.
//
// The webview HTML (`WebviewController.getDocumentTemplate`) loads one module script and no
// stylesheet, so CSS has to travel through JavaScript, as webpack's `style-loader` did. With
// `build.cssCodeSplit: false` Vite emits one `.css` asset; this plugin deletes it and appends to
// the entry chunk a statement that inserts one `<style data-documentdb-views-css>` element when
// `views.js` evaluates, before `render()` runs. The CSP allows it (`style-src 'unsafe-inline'`).
//
// Asset URLs: a relative `url(codicon-….ttf)` inside a runtime `<style>` resolves against the
// document (`vscode-webview://…`), which the resource server rejects. Each `url()` that names an
// emitted asset is therefore rewritten to `new URL('<file>', import.meta.url).href`, the absolute
// resource URL of the asset next to `views.js`. Fonts stay files because the CSP's `font-src`
// does not allow `data:`. Unresolvable relative or root-relative `url()`s fail the build.

export const VIEWS_CSS_MARKER = 'data-documentdb-views-css';

const URL_PATTERN = /url\(\s*(['"]?)([^'")]+?)\1\s*\)/g;

function stripSearchAndHash(reference) {
    return reference.replace(/[?#].*$/, '');
}

/**
 * Splits `css` around asset references and returns a JavaScript expression that rebuilds it with
 * absolute asset URLs at runtime.
 */
function toRuntimeCssExpression(css, assetFileNames, fail) {
    const parts = [];
    let last = 0;
    for (const match of css.matchAll(URL_PATTERN)) {
        const reference = match[2].trim();
        if (/^(?:data:|https?:|#)/i.test(reference)) {
            continue;
        }
        const fileName = stripSearchAndHash(reference).replace(/^\.\//, '');
        if (reference.startsWith('/') || !assetFileNames.has(fileName)) {
            fail(`Cannot inline CSS: url(${reference}) does not name an emitted asset next to views.js`);
        }
        parts.push(JSON.stringify(css.slice(last, match.index)));
        parts.push(`"url(" + JSON.stringify(new URL(${JSON.stringify(fileName)}, import.meta.url).href) + ")"`);
        last = match.index + match[0].length;
    }
    parts.push(JSON.stringify(css.slice(last)));
    return parts.join(' + ');
}

/** @returns {import('vite').Plugin} */
export function inlineCss() {
    return {
        name: 'documentdb:inline-css',
        apply: 'build',
        enforce: 'post',
        generateBundle(_options, bundle) {
            const cssAssets = Object.values(bundle).filter(
                (output) => output.type === 'asset' && output.fileName.endsWith('.css'),
            );
            if (cssAssets.length === 0) {
                return;
            }
            const entries = Object.values(bundle).filter((output) => output.type === 'chunk' && output.isEntry);
            if (entries.length !== 1) {
                this.error(`Cannot inline CSS: expected one entry chunk, found ${entries.length}`);
            }

            const css = cssAssets
                .map((asset) =>
                    typeof asset.source === 'string' ? asset.source : Buffer.from(asset.source).toString('utf8'),
                )
                .join('\n');
            for (const asset of cssAssets) {
                delete bundle[asset.fileName];
            }
            const assetFileNames = new Set(
                Object.values(bundle)
                    .filter((output) => output.type === 'asset')
                    .map((output) => output.fileName),
            );
            const expression = toRuntimeCssExpression(css, assetFileNames, (message) => this.error(message));

            // Appended rather than prepended: imports are hoisted either way, and appending keeps
            // the entry's source map (development builds) aligned. An injection failure is logged
            // as an error instead of thrown, so views still render (unstyled) and L2 reports it.
            entries[0].code +=
                '\n;try{const style=document.createElement("style");' +
                `style.setAttribute(${JSON.stringify(VIEWS_CSS_MARKER)},"");` +
                `style.textContent=${expression};` +
                'document.head.appendChild(style);' +
                '}catch(error){console.error("[documentdb] views.js could not inject its stylesheet",error);}\n';
        },
    };
}
