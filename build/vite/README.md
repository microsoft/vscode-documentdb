# Vite build settings and rationale

This is the rationale for both [views](../../vite.config.views.mjs) and
[extension-host](../../vite.config.ext.mjs) configs and their local plugins. The configs are the
source of truth for settings; the [Stage 4 and 5 record](../../docs/ai-and-plans/modernization/build-and-test-stack.md#stage-4-webviews-to-vite-split-per-view)
records the experiments and rejected alternatives.

## Shared build contract

The [package scripts](../../package.json) build workspace packages first, then build the host and
views into `dist/`. `npm run package` packages that directory without dependency installation.
`npm run build` is the TypeScript build, not the production bundling check.

| Setting                                                       | Reason                                                                                                                                                                                                           |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `root` from `import.meta.dirname`                             | Resolve entries, copied files and reports from the repository, not the caller's working directory.                                                                                                               |
| `build.outDir: 'dist'`, `build.emptyOutDir: false`            | Both configs, and both host environments, share the output directory. Clearing it in any individual build would delete the other output. `build-prod` and `build-dev` clean it once before running both configs. |
| `publicDir: false`                                            | Static host assets are copied explicitly. The old views static directory contained only an unreferenced `.gitkeep`; there is no public tree to copy.                                                             |
| `clearScreen: false`                                          | Keep watch diagnostics and readiness messages visible for developers and VS Code task matchers.                                                                                                                  |
| Views `build.target: 'es2023'`; host `build.target: 'node22'` | Target the modern webview renderer and Node extension host respectively; the host needs native ESM and top-level await.                                                                                          |
| `build.minify` / `build.sourcemap`                            | Standard production builds are minified without maps; `--mode development` builds are unminified with maps for debugging. Views use `isProduction` / `!isProduction`; host uses `!isDev` / `isDev`.              |
| `build.reportCompressedSize: false`                           | Skip gzip estimates that are not the shipped graph measurements. L1 reads actual packaged bytes.                                                                                                                 |
| `build.chunkSizeWarningLimit` (`8192` views, `16384` host)    | Monaco and the shell runtime are intentionally large. Generic single-chunk warnings are not the gate; the [graph size budget](../verification/README.md#size-budget-enforced) is.                                |
| `output.comments: { legal: true }`                            | Keep legal notices inline when minifying. This replaces webpack's separate `*.LICENSE.txt` files without discarding their comments.                                                                              |

## Views

### Resource URLs, the entry and CSS

[WebviewController.getDocumentTemplate](../../packages/vscode-ext-webview/src/host/WebviewController.ts)
loads `views.js` through `asWebviewUri()` in production. The document is a `vscode-webview://`
page; its resource URL is not the document's root. The HTML template and CSP are unchanged by
the Vite migration: an inert JSON data block and one nonce-bearing `<script type="module">`
boot the view, with no stylesheet link.

| Setting                                                                                        | Reason and prevented failure                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `base: './'`                                                                                   | Vite resolves chunk, preload and asset URLs relative to the importing module's `import.meta.url`. Root-relative URLs would instead target the webview/document root and fail to find the packaged resources.                                                           |
| `build.assetsDir: ''`                                                                          | Keep emitted assets next to `views.js`; the CSS plugin and worker URLs use this flat layout.                                                                                                                                                                           |
| `build.assetsInlineLimit: 0`                                                                   | Keep fonts as files. The CSP permits `data:` only in `img-src`, not in `font-src` or `worker-src`; a base64 codicon font would be blocked.                                                                                                                             |
| `output.entryFileNames: 'views.js'`                                                            | Match the name the host template loads, in both disk builds and development.                                                                                                                                                                                           |
| `rolldownOptions.preserveEntrySignatures: 'strict'`, `output.format: 'es'`                     | Preserve the named `render` export imported by the boot module. Vite's application default can remove entry exports and leave every panel blank, as in [microsoft/vscode-cosmosdb#3037](https://github.com/microsoft/vscode-cosmosdb/issues/3037).                     |
| `output.chunkFileNames: '[name]-[hash].js'`, `output.assetFileNames: '[name]-[hash][extname]'` | Give split chunks/assets content-dependent names while leaving the host-facing entry stable. L1 reports hash-normalized file drift rather than demanding a fixed chunk list.                                                                                           |
| `build.cssCodeSplit: false`                                                                    | Produce one stylesheet for [inline-css.mjs](./inline-css.mjs). Per-view CSS would require stylesheet links/preloads the host does not emit. CSS is therefore global even though JavaScript is lazy.                                                                    |
| `output.keepNames: false`                                                                      | Preserve the old production behavior, not an ineffective webpack intermediate setting: swc kept class names but terser subsequently mangled them. The Stage 4 experiment found retaining names added about 460 KB. The host has a different runtime requirement below. |

[inline-css.mjs](./inline-css.mjs) runs in builds, including on-disk development builds. It
removes the emitted CSS asset and appends a single `<style data-documentdb-views-css>` insertion
to the entry. Appending keeps the entry's development source-map offsets aligned; insertion
happens when the entry evaluates, before the template calls `render()`. Injection errors are
logged, so L2 can report an unstyled view rather than silently passing it.

A relative CSS `url()` in that runtime style would resolve against the document, not the bundle.
The plugin rewrites emitted-asset references into expressions using
`new URL('<file>', import.meta.url).href`. Unresolvable relative or root-relative references fail
the build. The existing `style-src 'unsafe-inline'` allows the style insertion; `font-src`
allows resource files and `worker-src` allows `blob:`. No CSP relaxation is needed.
L1 checks the `render` export and literal URL targets; L2 checks fonts, computed styles, CSP,
preload failures and a CSS-removal negative control.

### Lazy views and chunk-group ordering

Each entry in [WebviewRegistry.ts](../../src/webviews/_integration/WebviewRegistry.ts) uses
`React.lazy` with a literal `import()`, mapping the view's named component to `default`.
[index.tsx](../../src/webviews/index.tsx) renders it inside `Suspense`, after configuring l10n.
Opening one panel does not evaluate every view module.

Rolldown's `output.codeSplitting.groups` replaces the deprecated `manualChunks` / `advancedChunks`.
The groups capture modules in this priority order:

| Group            | `priority` | Match                                                                                    |
| ---------------- | ---------- | ---------------------------------------------------------------------------------------- |
| `preload-helper` | `50`       | Vite's virtual preload helper.                                                           |
| `react`          | `40`       | `react`, `react-dom`, `scheduler`.                                                       |
| `fluentui`       | `30`       | `@fluentui`, `@griffel`.                                                                 |
| `slickgrid`      | `20`       | `slickgrid-react`, `@slickgrid-universal`.                                               |
| `monaco`         | `10`       | `monaco-editor`, `@monaco-editor`, and the plugin's `monacoVirtualModulePrefix` modules. |

Order matters because `includeDependenciesRecursively` remains at its default, enabled:
a group also takes its dependencies that earlier groups have not captured. Capturing Monaco
first absorbed React and the preload helper; because the entry needs those modules, it then
statically imported Monaco. Capture the most shared modules first to preserve lazy boundaries
without introducing circular chunks.

There is deliberately no catch-all vendor group. A group shared by the entry and a lazy view
would hoist the view's dependencies into the entry's static graph. React and Fluent UI are
needed by the entry; Monaco remains behind editor views, and SlickGrid behind Collection View.
Other modules are split automatically. L1 requires each registry-backed lazy chunk and excludes
Monaco/SlickGrid from Local Quick Start and Atlas Credentials. L2 checks actual fetched chunks
and SlickGrid's rendered rows/styles, not just an apparent drop in `views.js` size.

### Monaco features and workers

[monaco.mjs](./monaco.mjs) supplies what `monaco-editor-webpack-plugin` previously injected:

- External imports of `editor.api` resolve to a virtual wrapper that installs the worker
  environment and imports every editor feature from Monaco's `metadata.js`, in metadata order,
  before the API and selected language contributions. `editor.api` alone lacks features such as
  find, folding and suggestions. Internal Monaco imports still resolve to the real API to
  avoid a wrapper cycle.
- `monacoEditor({ languages: ['json'] })` retains JSON support. `sql` was dropped because the old
  config listed it without a consumer. The DocumentDB API query language separately loads the
  JavaScript tokenizer on demand in [registerLanguage.ts](../../src/webviews/query-language-support/registerLanguage.ts);
  it does not need Monaco's TypeScript language worker.
- `?worker&url` emits editor and JSON workers as separate files.
  `worker.format: isServe ? 'es' : 'iife'` makes disk-build workers self-contained IIFE scripts
  without static imports/exports. Under the dev server they are unbundled ES modules.

The webview cannot directly construct `new Worker(<cross-origin resource URL>)`, even with CORS.
`MonacoEnvironment.getWorkerUrl` instead returns a same-origin Blob URL whose source is
`import "<absolute worker URL>";`. Monaco 0.52 creates module workers, so the trampoline must
use `import`, not `importScripts`. The IIFE payload runs inside that module worker; the same
trampoline imports development modules with the dev server's CORS headers. Production module
fetches use VS Code's webview resource service.

Rejected approaches:

- `?worker&inline`: base64 payloads inflated the chunk (about 870 KB in the Stage 4 experiment),
  and its fallback is a `data:` worker the CSP forbids.
- Direct cross-origin `new Worker`: the browser rejects worker construction before CORS can help.

L1 checks packaged worker URL targets and constrains Monaco's unused nonliteral module loaders
through `monacoModuleLoaderImports`. L2 proves editor-originated round-trips: Unicode
highlighting in Collection View and JSON validation in Document View. L2's ordinary browser
origin is not proof of the real `vscode-webview://` construction path; keep the installed-VSIX
worker check.

### Development server and dependency identity

| Setting / plugin                                                            | Reason                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `define`                                                                    | Disk builds explicitly replace `process.env.NODE_ENV` with `'production'` or `'development'`. `vite build --mode development` would otherwise still use production `NODE_ENV`, removing dev-only diagnostics. Serve mode leaves this to Vite (`define: {}`).                                                                                                                                                                         |
| `react()`                                                                   | Transform React sources and enable React Refresh in development.                                                                                                                                                                                                                                                                                                                                                                     |
| `server.host: '127.0.0.1'`, `server.port: 18080`, `server.strictPort: true` | `npm run watch:views` binds locally at the fixed port expected by the host. A busy port must fail, not silently move to a URL outside the development CSP.                                                                                                                                                                                                                                                                           |
| `server.origin: 'http://localhost:18080'`                                   | Match `WebviewController`'s `DEFAULT_DEV_SERVER_HOST` exactly for absolute asset and worker URLs, even though the listener binds to `127.0.0.1`.                                                                                                                                                                                                                                                                                     |
| `server.cors: { origin: allowedDevOrigins }`                                | Allow module fetches from `vscode-webview://` pages and Vite's local-machine origins, including Blob-worker fetches, without accepting arbitrary origins.                                                                                                                                                                                                                                                                            |
| `optimizeDeps.include`                                                      | Pre-bundle Fluent UI/Griffel, React (including JSX runtimes), SlickGrid, the Monaco React wrapper, and `monaco.optimizeDepsInclude` (all feature/API/language imports plus the JavaScript tokenizer) together. Avoid first-editor re-optimization, page reloads and split Monaco identities.                                                                                                                                         |
| `server.warmup.clientFiles`                                                 | Transform the entry and `./src/webviews/**/*.tsx` early to reduce first-panel latency; this is not a production eager-import boundary.                                                                                                                                                                                                                                                                                               |
| [webview-dev-entry.mjs](./webview-dev-entry.mjs)                            | Serve `/views.js` without a prebuilt disk entry. Its first import is a separate React Refresh preamble module, then it re-exports the source entry's `render`. plugin-react normally injects the preamble into `index.html`, which this host does not use; a separate allowed-origin module avoids adding an inline script/nonce to the template. The middleware supplies CORS itself because it runs before Vite's CORS middleware. |
| [webview-scenarios.mjs](./webview-scenarios.mjs)                            | Serve-only L2-dev index, typed scenario pages and runner endpoints via `ssrLoadModule`. Unknown routes return 404; source/HMR/asset requests pass to Vite. Nothing is added to production bundles.                                                                                                                                                                                                                                   |
| `resolve.alias` (`/^bson$/` to `bsonBrowserEntry`)                          | Pin bson's browser `bson.mjs` so a future view import cannot mix implementations through different resolution routes. The config fails if that file disappears. Today's views contain no BSON; L1 permits zero or one implementation per view graph, never two.                                                                                                                                                                      |

The [watch task](../../.vscode/tasks.json) waits for Vite's ready line, not a disk-build event.
Its diagnostic pattern intentionally never matches; development errors appear in the browser
overlay. [Launch configurations](../../.vscode/launch.json) start `Watch` and include `.mjs`/`.cjs`
in extension-host `outFiles`.

Use the [L2-dev recipe](../verification/README.md#l2-dev-source-scenarios):
`/<view>/<scenario>/<theme>` paths, no query strings, and `/scenarios/run-all.js` executed outside
the page with a Playwright `page`. It drives typed steps and checks `data-ready`, assertions,
errors and host calls. It does not replace packaged L2 or the real F5/HMR check.

## Extension host

### Two output formats, one build command

The root manifest declares `"type": "module"` and `"main": "./main.mjs"`.
`builder.buildApp` builds `host`, then `tsPlugin`:

| Environment | Inputs and output                                                                                                                                                                                                    | Why                                                                                                                                                                            |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `host`      | [main.ts](../../main.ts) and [playgroundWorker.ts](../../src/documentdb/playground/playgroundWorker.ts); `output.format: 'es'`, `output.entryFileNames: '[name].mjs'`, `output.chunkFileNames: '[name]-[hash].mjs'`. | Ship `main.mjs`, `playgroundWorker.mjs` and flat shared ESM chunks. `rolldownOptions.preserveEntrySignatures: 'strict'` preserves VS Code's `activate` / `deactivate` exports. |
| `tsPlugin`  | [tsPlugin/index.ts](../../src/documentdb/playground/tsPlugin/index.ts); `output.format: 'cjs'`, `output.entryFileNames: '[name].cjs'`, `output.exports: 'default'`.                                                  | TypeScript requires a callable plugin factory, not an ESM namespace or `{ default: factory }`. Emit `playgroundTsPlugin.cjs` with `module.exports = pluginModuleFactory`.      |

Rolldown emits one format per output, so the CommonJS plugin cannot share the host output.
Two environments keep shared settings and watchers under one CLI invocation. A second config
file would duplicate settings; two CLI runs would require separately coordinated watchers.
`consumer: 'server'` and `resolve.noExternal: true` bundle server dependencies in both
environments, except for the explicit `rolldownOptions.external: isExternal` policy below.

[main.ts](../../main.ts) is intentionally thin: initialize `perfStats`, top-level
`await import('./src/extension')`, then delegate activation/deactivation. VS Code cannot call
`activate` before the awaited implementation evaluates. A static/hoisted import ran before
timing began in the old loader and made `mainFileLoad` misleadingly zero. L1 requires the unique
extension implementation facade to be a direct dynamic child and keeps the Kubernetes SDK
outside the combined loader/implementation static closure. L3 checks installed activation,
late command registration and clean logs; cold-start URI ordering still needs an editor check.

### CommonJS globals inside host ESM

The host's `output.banner` declares only:

```javascript
const __documentdbFilename = import.meta.filename;
const __documentdbDirname = import.meta.dirname;
```

Host-only `define` maps free `__filename` / `__dirname` references to those bindings. All host
chunks are flat at the extension root, preserving the directory meaning bundled CommonJS code
previously received. Declaring `__dirname` itself in the banner collided with dependencies
such as `open`, which declare their own binding. The prefixed names avoid that collision.
The CommonJS `tsPlugin` environment has neither this banner nor these replacements; its native
`__dirname` locates shipped declarations.

There is **no `require` banner**. With Vite's server build on Rolldown `platform: 'node'`,
Rolldown already rewrites free `require` calls, `require.resolve` and `typeof require` to its
own helper backed by `createRequire(import.meta.url)`. Adding another binding is dead code
and can collide with modules declaring their own `require`. L3 catches startup/global failures;
it does not exercise every optional loader.

### Defines, names and resolution

| Setting                                                   | Reason and guard                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `define['process.env.NODE_ENV']`                          | `'development'` only for development mode, otherwise `'production'`; preserve environment-dependent behavior and dead-code elimination.                                                                                                                                                                                                                                                                                                                                                                 |
| `define['process.env.IS_BUNDLE']`                         | String `'true'` selects the bundled webview layout.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `define['process.env.DEVSERVER']`                         | String `'true'` in development, `''` otherwise; production never switches to the dev server. L1 rejects `DEVSERVER` and `127.0.0.1:18080` in packaged JavaScript.                                                                                                                                                                                                                                                                                                                                       |
| `output.keepNames: true` (both environments)              | Runtime code compares/reads `constructor.name`; mangling changes behavior and telemetry classification. L1's `keptClassNames` invariant locates `_isUserCancelledError` and requires the runtime name `UserCancelledError`; `keepnames-class-name-lost` proves rejection. This is deliberately different from views.                                                                                                                                                                                    |
| `resolve.alias` (`/^bson$/` to `require.resolve('bson')`) | Force the driver's CommonJS `bson/lib/bson.cjs` for every bare `bson` import. Mixing CommonJS and ESM copies creates different `ObjectId` constructors and breaks cross-route `instanceof`. L1 requires exactly one implementation in `main` and `playgroundWorker`, at most one in the plugin. The [bson-identity probe](../verification/README.md#bson-identity-runtime) tests constructor identity through driver, source-like, ESM and shell-parser routes, with an alias-removed negative control. |

There is no `resolve.conditions` override. Vite's server defaults are
`['module', 'node', 'development|production']`; dependencies use ESM builds where available
rather than reproducing webpack's CommonJS resolution globally. The `module` condition selects
`tslib.es6.mjs`, so no `tslib` alias is needed. Treat resolution changes as runtime changes,
not just size optimizations.

One targeted exception is `resolve.alias` for `/^@azure\/arm-resources-subscriptions$/`, pointing
to `require.resolve('@azure/arm-resources-subscriptions')`, its CommonJS `dist/index.js`.
**G5-I01:** azureauth uses `Promise.resolve().then(() => require('x'))`, TypeScript's lowered
dynamic import. When `x` resolved to ESM, Rolldown 1.0.3 emitted a call to its ESM initializer
that returned `undefined`, not the module namespace; reading `SubscriptionClient` then failed.
Pinning this package to CommonJS restores the expected result without rewriting dependencies.
`TODO(#990)` tracks upgrading azureauth to real `import()` and removing the alias in
[#990](https://github.com/microsoft/vscode-documentdb/issues/990). There is no dedicated L1
invariant for this lowering bug, and L3 does not call Azure discovery; re-test discovery and
both azureauth subscription-provider paths when removing the workaround.

### Externals: deliberate runtime requests

The VSIX ships no dependency tree. `isExternal` is an explicit policy, not a general
`node_modules` exclusion. Keep guarded optional requests external even if a build happens to
leave them unresolved: an empty bundler stub can turn the guard into a false success.
**Never mark a type-only module external** to fix resolution; a compile-time-only dependency
must remain erased, not become an unshipped runtime request.

These are exactly the current external categories:

| Reason                                                           | Specifiers                                                            | Runtime behavior                                                                                                                                                                           |
| ---------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Host-provided API                                                | `vscode`                                                              | Supplied by VS Code, never bundled.                                                                                                                                                        |
| Node runtime                                                     | Every `node:` specifier and members of `builtinModules`               | Supplied by Node.                                                                                                                                                                          |
| DocumentDB API driver's optional native/compression dependencies | `kerberos`, `@mongodb-js/zstd`, `snappy`, `mongodb-client-encryption` | Guarded driver/devtools loaders; do not manufacture a stub when unavailable.                                                                                                               |
| Guarded driver authentication loaders                            | `@aws-sdk/credential-providers`, `gcp-metadata`                       | Preserve the previous external behavior instead of adding optional auth stacks to the bundle.                                                                                              |
| `ws` optional native accelerators                                | `bufferutil`, `utf-8-validate`                                        | Guarded loads with Node/JavaScript fallbacks.                                                                                                                                              |
| Optional OIDC browser opener                                     | `electron`                                                            | Guarded request; falls back to bundled `open`.                                                                                                                                             |
| Optional devtools DNS loader                                     | `os-dns-native`                                                       | Guarded request.                                                                                                                                                                           |
| Shell SSH proxy                                                  | `ssh2`                                                                | Lazy proxy-only request, **not** a try/catch fallback; preserved external behavior does not promise packaged SSH support.                                                                  |
| `system-ca` platform certificate loaders                         | `win-export-certificate-and-key`, `macos-export-certificate-and-key`  | Guarded platform-specific requests.                                                                                                                                                        |
| Babel `.cts` configuration loader                                | `@babel/preset-typescript*`                                           | `id.startsWith('@babel/preset-typescript')` also matches its package metadata request. The shell rewriter disables configuration files, so these paths do not execute in normal rewriting. |
| Diagnostic color detection                                       | `supports-color`                                                      | Guarded `debug` probe.                                                                                                                                                                     |

The audit removed dead entries `aws4`, `cpu-features`, `pg-native` and `vs`; they are not part
of this policy. L1 verifies packaged graph edges and permits runtime built-ins/`vscode` in the
host ESM graph; it is not a behavioral proof of optional authentication/proxy paths. L3 covers
normal activation, while native-auth/proxy behavior needs its own installed-VSIX exercise.

`caniuse-lite` is **not** an explicit external. The recorded worker-size reduction came from
Rolldown not expanding browserslist's computed region/feature `require` requests into webpack's
large dynamic-require contexts. Those requests are guarded; the shell rewriter sets
`configFile: false`, `babelrc: false`, `browserslistConfigFile: false` and supplies no targets.
The Stage 5 worker rewrite probe succeeded without `node_modules`. This does not promise
arbitrary Babel/browserslist configuration support: re-test worker execution if that policy changes.
L1 also narrowly allows Babel's native-ESM configuration helper via `babelConfigFileImports`,
not arbitrary nonliteral imports.

### Runtime assets, the TS plugin and watch readiness

[copy-assets.mjs](./copy-assets.mjs) runs only for `host` and replaces `CopyWebpackPlugin`.
It writes files next to the bundles rather than emitting them into the bundle report:
packaging legitimately edits the manifest and drops `.vscodeignore`. Missing required sources
fail the build.

- Targets include the manifest, resources, base localization manifest, language configuration,
  grammars, marketplace/legal/support documents, shell `typeDefs`, and three Azure Tools icons.
- `supportedLanguages` is empty, so no translated `bundle.l10n.<language>.json` or
  `package.nls.<language>.json` ships yet.
- The README transform removes `exclude-from-marketplace` regions outside development mode.
  L1 requires manifest-declared files plus its explicit `runtimeAssets` list; informational
  file drift alone is not the missing-asset guard.

The plugin bundle ships at `dist/playgroundTsPlugin.cjs`, not inside packaged `node_modules`:
vsce ignores that directory. At runtime, [tsPluginStub.ts](../../src/documentdb/playground/tsPluginStub.ts)
creates `<extension>/node_modules/documentdb-playground-ts-plugin/{package.json,index.cjs}`.
Its manifest sets `"type": "commonjs"` and `main: index.cjs`; its entry forwards with
`require("../../playgroundTsPlugin.cjs")`. This satisfies the TypeScript plugin name despite
the extension's ESM package type. Changed stub files are atomically replaced, entry before
manifest, and the legacy `index.js` is removed. L1 requires the shipped `.cjs` and forbids
`import.meta` in CommonJS; completions/hover and upgrade/read-only-install behavior need a
real TS-server check, not just L3 activation.

In watch mode `builder.buildApp` receives independent watchers, not completed builds. Its
readiness hook removes an environment on `BUNDLE_START` / `ERROR`, adds it on `BUNDLE_END`,
and prints **`[vite-ext] host and tsPlugin ready.`** only when both are ready. The
[watch:ext problem matcher](../../.vscode/tasks.json) ends on that exact line and captures
Rolldown transform error locations. Waiting for only the first watcher would let F5 start
without the TS plugin. Rapid-save readiness and source-map breakpoints are F5 checks.

## Bundle reports and verification

[bundle-report.mjs](./bundle-report.mjs) runs **only in production builds**. Reports describe
chunks, static/dynamic edges, normalized module IDs and byte sizes, and hash the files actually
written to disk, including the CSS-modified entry, worker scripts and fonts.

| Build      | Report behavior                                                                                                         |
| ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| Views      | Write `build/verification/reports/views.json`, after CSS processing.                                                    |
| `host`     | Start `build/verification/reports/host.json`.                                                                           |
| `tsPlugin` | Use `append: true` to merge its files into the same host report; refuse a missing/stale report from a previous process. |

The report's `chunkFormat` is `module`; L1 recognizes `.cjs` as CommonJS even in the combined
host report. Reports are verification artifacts, not VSIX contents. Use the matching reports
for a downloaded VSIX; unrelated local reports cannot establish provenance.

### How the checks guard this

See [verification commands and limits](../verification/README.md) for complete recipes.

| Setting / boundary                                               | Guard                                                                                                                                                                                                      |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `views.js`, `preserveEntrySignatures`, relative chunk/asset URLs | L1 named `render`, packaged literal imports / `new URL(..., import.meta.url)` targets, report hashes; L2 network, CSP and preload diagnostics.                                                             |
| `cssCodeSplit`, CSS injection, fonts-as-files                    | L2 computed styles, font requests and marked-CSS removal negative control; L1 literal asset targets.                                                                                                       |
| `React.lazy`, group priority, no catch-all vendor                | L1 registry-backed lazy chunks and lightweight-view exclusions; L2 fetched chunks and grid interop.                                                                                                        |
| Monaco worker format and Blob trampoline                         | L1 worker targets / constrained loader allowance; L2 actual editor worker responses; installed-VSIX real-origin check.                                                                                     |
| Dev origin, preamble, optimization/warmup, readiness hooks       | L2-dev source scenarios; F5/HMR/rapid-save checks. L1 rejects the production dev-server strings; it does not test HMR.                                                                                     |
| Host ESM loader, strict exports, banner/global handling          | L1 required entries, extension dynamic boundary and Kubernetes startup exclusion; L3 activation, late commands, clean logs and activation-error proof.                                                     |
| Host `keepNames`                                                 | L1 `keptClassNames` / `UserCancelledError` and `keepnames-class-name-lost` negative control.                                                                                                               |
| BSON aliases                                                     | L1 implementation count per graph; runtime `bson-identity` probe with alias-removed control.                                                                                                               |
| Azure alias / optional externals / default resolution conditions | L3 normal startup only; targeted discovery, auth, proxy and worker tests for paths it does not exercise. G5-I01 has no dedicated automated invariant.                                                      |
| CommonJS plugin and copied assets                                | L1 required `.cjs`, CommonJS `import.meta` rejection, manifest paths and `runtimeAssets`; TS-server completions/hover check separately.                                                                    |
| Bundle-report ownership / `append`                               | L1 report-to-VSIX hashes and host-owned graph closure; proof controls reject missing/unowned chunks.                                                                                                       |
| Overall loading cost                                             | Hard [size budget](../verification/size-budget.json): full host graphs, `mainStartup`, views entry/per-view static closures, each worker and compressed VSIX. A smaller entry alone is not a smaller view. |

L2 and L2-dev use fixture backends and ordinary browser origins. L3 is installed-VSIX activation,
not discovery, playground execution or a complete editor workflow suite. Do not weaken the CSP
or broaden an import allowance to make a check pass.

### Changing a setting

1. Change the config/plugin and this rationale together. Re-check consumers of entry names,
   formats, asset paths and aliases; a resolution-only change can still break runtime behavior.
2. Rebuild with `npm run package` (not only `npm run build`).
3. Run `npm run verify:vsix -- <vsix>` and `npm run prove:vsix -- <vsix>` with that build's reports.
   Run the BSON probe when changing dependency identity/resolution.
4. Run packaged L2 and L3 (including `prove:activation`) using
   [the verification recipes](../verification/README.md). Exercise L2-dev/F5 for serve/watch
   changes and real editor paths for gaps called out above.
5. Review graph-size deltas. Update the size budget **only for an intentional size change**,
   from the freshly packaged artifact, and commit it with the cause. Do not regenerate it merely
   to hide a regression.
