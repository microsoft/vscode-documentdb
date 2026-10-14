/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Static server for the webview visual harness (see README.md in this folder).
 *
 * It serves the built `dist/` as the site root — the harness imports `./views.js` as an ES module,
 * which needs a real http origin, not `file://` — and maps `*.html` to this folder, so the harness
 * is versioned here rather than inside the build output (which `rimraf ./dist` wipes and
 * `vsce package` would otherwise ship).
 *
 *   node test/webview-harness/serve.js            # http://127.0.0.1:18099/quickstart-harness.html
 *   node test/webview-harness/serve.js 18099 ./dist
 */

const fs = require('fs');
const http = require('http');
const path = require('path');

const port = Number(process.argv[2] ?? 18099);
const distRoot = path.resolve(process.argv[3] ?? path.join(__dirname, '..', '..', 'dist'));
const harnessRoot = __dirname;

const TYPES = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ttf': 'font/ttf',
};

/** Harness pages live in this folder; everything else comes from the build output. */
function resolveRequest(urlPath) {
    const requested = urlPath === '/' ? '/quickstart-harness.html' : urlPath;
    const harnessCandidate = path.join(harnessRoot, requested);
    if (requested.endsWith('.html') && harnessCandidate.startsWith(harnessRoot) && fs.existsSync(harnessCandidate)) {
        return harnessCandidate;
    }
    const distCandidate = path.join(distRoot, requested);
    return distCandidate.startsWith(distRoot) ? distCandidate : undefined;
}

http.createServer((req, res) => {
    const filePath = resolveRequest(decodeURIComponent(req.url.split('?')[0]));
    if (!filePath) {
        res.writeHead(403).end('forbidden');
        return;
    }
    fs.readFile(filePath, (error, data) => {
        if (error) {
            res.writeHead(404).end('not found');
            return;
        }
        res.writeHead(200, {
            'Content-Type': TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
            // The bundle is rebuilt between runs; never let a stale copy be screenshotted.
            'Cache-Control': 'no-store',
        });
        res.end(data);
    });
}).listen(port, '127.0.0.1', () => {
    if (!fs.existsSync(path.join(distRoot, 'views.js'))) {
        console.warn(`WARNING: ${path.join(distRoot, 'views.js')} not found — run "npm run webpack-dev-wv" first.`);
    }
    console.log(`Harness:  http://127.0.0.1:${port}/quickstart-harness.html?scenario=introduction`);
    console.log(`Serving:  ${distRoot}`);
});
