---
kind: review
status: active
---

# Stage 3 AI review: our packages to ESM

- **Reviewer:** Claude Opus 5.5 (GitHub Copilot agent). The largest context variant was requested;
  the runtime exposes no context-tier identifier, so the variant cannot be confirmed.
- **Model-family note:** Stage 3 was authored entirely by Claude Opus 5.5, the reviewer's own
  family, which departs from ground rule 7 by operator choice. To compensate, the review rebuilt the
  artifact, read the shipped bundles, and ran throwaway probes against the shipped webpack config
  instead of relying on the record.
- **Range reviewed:** `875ad255..811b33b5`, 21 commits (verified with `git rev-list --count`).
  `811b33b5` only makes the plan Markdown Prettier-stable.
- **Method:** CONTRIBUTING.md §6.1 steps 1 to 4, read-only.

## Checks run by the reviewer

All at `811b33b5` (Node 22.21.1, npm 10.9.3; `.nvmrc` says 22.18).

| Check                                                                          | Result                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gh run view` 37068033773 (dispatch, `enforce_full_run`)                       | Green on all four jobs. Log: five `PASS: … rejected for the expected reason` lines including `import-meta-in-commonjs`; `L3 PASS` and `L3 PROOF PASS` on VS Code 1.109.0; `test:verification` `# tests 35 # pass 35` including both `bson` identity tests; Vitest 296 files. |
| PR #880 review comments and reviews                                            | **0 review comments, 0 reviews** (draft PR). Nothing to merge in step 2.                                                                                                                                                                                                     |
| `npm run package`                                                              | Pass: 124 files, 9,566,329 bytes. `views.js` 6,379,817, `main.js` 4,719,092, `playgroundWorker.js` 7,438,855, `playgroundTsPlugin.js` 6,654, `package.json` 95,918: identical to the Phase B record.                                                                         |
| `npm run verify:vsix` and `npm run prove:vsix`                                 | Pass; five `PASS` lines.                                                                                                                                                                                                                                                     |
| `npm run test:verification`                                                    | 35 Node tests and 3 files / 45 Vitest tests pass.                                                                                                                                                                                                                            |
| `npm run verify:packages -- --no-build`                                        | All checks pass; publint clean; ATTW reports only `CJSResolvesToESM (node16-cjs)`; fluentui's two expected Node failures present.                                                                                                                                            |
| `npm run prepare:browser-check` on the packaged VSIX (temp output)             | Five view pages and the broken-CSS page generated from the real `WebviewController.ts`. Not served, not opened in a browser.                                                                                                                                                 |
| `npm run build`, `npm run lint`, `npm run prettier`, `npx vitest run`          | Pass; 296 files / 4,588 tests.                                                                                                                                                                                                                                               |
| Fresh-dependency scan                                                          | 0 fresh (root 1,635 locked versions; `api/` 116).                                                                                                                                                                                                                            |
| Lockfile diff `875ad255..811b33b5`                                             | 28 added (`tsx`), 13 removed (`ts-node`), 7 changed: `@types/vscode` 1.105.0 to 1.109.0 and the six workspace versions. Matches the record.                                                                                                                                  |
| Shipped bundles read directly (`dist/` from the package above)                 | See S3-F01 and S3-F05.                                                                                                                                                                                                                                                       |
| Throwaway probes outside the repo, built with the real `webpack.config.ext.js` | Dynamic `await import('bson')` route (S3-F04); `import.meta.url`/`dirname`/`filename` handling (S3-F03).                                                                                                                                                                     |
| `npm pack --dry-run` per package; dependency-declaration scan of `dist/`       | See S3-F06.                                                                                                                                                                                                                                                                  |
| `curl` of the three upstream URLs used by `scrape` and `verify`                | All return 404, including `https://github.com/MicrosoftDocs/nosql-docs`.                                                                                                                                                                                                     |

**Side effects:** `npm run package` regenerated the git-ignored `dist/`, `build/verification/reports/`
and `vscode-documentdb-0.11.0.vsix`. The previous local VSIX (an ignored file of the same size,
SHA-256 `162aaf3e…`) was overwritten; the new one is `fba997b8…`. Probe output stayed in `/tmp`. The
working tree is clean.

## Findings

### S3-F01: `getShellApiDtsContent()` looks for the `.d.ts` outside the installed extension

- **Severity:** medium. **Validation:** confirmed by reading the shipped `dist/main.js`.
- **Where:** `packages/documentdb-js-shell-api-types/src/index.ts` line 38; commit `22512691`
  (`__dirname` to `import.meta.dirname`) and the webpack parser rule in `webpack.config.ext.js`
  lines 99 to 106.
- **What is wrong.** The production `main.js` contains:
  `function getShellApiDtsContent(){…E.join(__dirname,"..","typeDefs","documentdb-shell-api.d.ts")…}`.
  The webpack rule did its job (`import.meta.dirname` became `__dirname`), and the function was
  **not** tree-shaken out of the production bundle. But in the bundle `__dirname` is the directory of
  `main.js`, which in the installed VSIX is the extension root. `..` therefore points at the
  extensions directory, while `CopyWebpackPlugin` puts the file at `<extension root>/typeDefs/`. A
  host caller would get `ENOENT` in the installed VSIX only; the workspace, the unit tests and
  `verify:packages` all pass, because there the package's own layout (`dist/../typeDefs`) holds.
  Nothing calls the function today, and the same wrong path existed with CommonJS `__dirname`
  before this stage, so this is latent, not a regression.
- **Why it matters now.**
  - Stage 3 changed exactly this line and its record says the rewrite keeps the bundle working
    "the moment someone does" call it. Only the syntax problem is fixed.
  - G1-3 hands-on check 2 says it tests "TS plugin (`shell-api-types` reading its `.d.ts`)". The TS
    plugin does not import the package: `src/documentdb/playground/tsPlugin/index.ts` line 42 reads
    `path.join(__dirname, 'typeDefs', …)` itself. A pass there says nothing about
    `getShellApiDtsContent()`. The Stage 3 package table repeats the "playground TS plugin" claim.
- **Solutions:**
  1. Let the caller supply the directory (`getShellApiDtsContent(baseDir?: string)`), and have any
     host caller pass the extension's `typeDefs` path, as the TS plugin already does. Pros: correct
     in every layout. Cons: an API addition in a published package.
  2. Remove `getShellApiDtsContent` from the main entry and expose the file only through the
     `./typeDefs/*` export. Pros: no path logic in the bundle. Cons: breaking for package consumers
     (needs a minor bump in 0.x).
  3. Add a probe like `bson-identity/` that bundles a call to it with the real config and runs it
     from a VSIX-shaped directory. Pros: proves whichever fix is chosen. Cons: more harness.
  4. Correct the G1-3 hands-on item 2 label and the package table now.
- **Recommended:** 4 before G1-3; 1 plus 3 before any host code calls the function.
- **Copilot comment:** none.
- **Author decision:** _pending_

### S3-F02: unbundled consumers of the published `@microsoft/vscode-ext-webview/host` are untested

- **Severity:** medium (published-package risk; this extension is not affected).
- **Validation:** confirmed for the test gap; the runtime behavior is **unverified**.
- **Where:** `packages/vscode-ext-webview` (ESM since `74a627f9`; `./host` imports `vscode`
  statically); `build/verification/package-checks/check-packages.mjs` lines 173 to 178; MIGRATION.md
  `0.10.x → 0.11.0`.
- **What is wrong.** This extension bundles the package with `vscode` as a webpack external
  (`commonjs vscode`), which works (L3 green). Another extension that does **not** bundle would load
  `/host` through `require(esm)`, and the ESM file's `import … from 'vscode'` would then be resolved
  by Node's ESM loader, not by the CommonJS `Module._load` interception VS Code uses to provide
  `vscode`. Whether VS Code 1.109's extension host resolves that is not checked anywhere: the Node
  probes create a fake `node_modules/vscode` package, and the Vitest probe aliases it. MIGRATION.md
  says "Bundlers resolve it as before" but does not say that unbundled use is unsupported or
  untested.
- **Solutions:**
  1. Before publishing at G6, run a minimal unbundled probe extension that `require`s the packed
     `/host` under `@vscode/test-electron` (L3 already has the machinery). Pros: real answer.
     Cons: harness work.
  2. Document in README and MIGRATION.md that `/host` must be bundled with `vscode` external. Pros:
     cheap. Cons: may exclude real consumers.
  3. Ship `/host` as a CommonJS build alongside the ESM entries. Pros: works everywhere. Cons:
     contradicts the ESM-only goal and reintroduces dual instances.
- **Recommended:** 2 now, 1 before the G6 publish.
- **Copilot comment:** none.
- **Author decision:** _pending_

### S3-F03: `import.meta.url` in an ES module would be baked to the build machine's path

- **Severity:** low (latent; no package uses `import.meta.url` today).
- **Validation:** confirmed by a probe that builds `export const url = import.meta.url; …` with the
  real `webpack.config.ext.js` in production mode.
- **Where:** `webpack.config.ext.js` lines 99 to 106 (only `__dirname`/`__filename` are configured).
- **What is wrong.** The probe's output is
  `const o="file:///tmp/s2probe/dyn/metaProbe.mjs",t=__dirname,n=__filename`. `import.meta.dirname`
  and `filename` become runtime values, but `import.meta.url` becomes a string literal of the
  **build-time** absolute path. In CI that would be `file:///home/runner/work/…`, wrong on every
  user's machine, and L1's new check cannot see it because no `import.meta` syntax remains. Common
  ESM idioms (`fileURLToPath(import.meta.url)`, `createRequire(import.meta.url)`,
  `new URL('./x', import.meta.url)`) would all break this way when a package adopts them.
- **Solutions:**
  1. ESLint `no-restricted-syntax` on `MetaProperty` with `property.name='url'` in
     `packages/*/src`, pointing at `import.meta.dirname`. Pros: stops it at authoring time. Cons:
     packages lose a standard idiom until Stage 5.
  2. Extend L1 to reject `file:///` literals that contain a build path (for example
     `/home/runner/work/` or the checkout directory recorded in the bundle report). Pros: guards the
     artifact. Cons: heuristic.
  3. Set `importMeta: false` for `javascript/esm` so `import.meta.url` stays syntax and L1's
     `MetaProperty` check fails. Pros: reuses the existing guard. Cons: must be verified not to undo
     the `dirname` rewrite.
- **Recommended:** 1 now; revisit at Stage 5 when the host becomes ESM.
- **Copilot comment:** none.
- **Author decision:** _pending_

### S3-F04: the `bson` identity check does not exercise the route that caused #933

- **Severity:** low. **Validation:** confirmed by reading the probes and by a throwaway probe.
- **Where:** `build/verification/bson-identity/hostProbe.ts`, `workerProbe.ts`,
  `esmConsumer.mjs`; commit `089afba3`.
- **What is wrong.** The check covers `mongodb`, static `bson` from swc-compiled TypeScript, `bson`
  and `mongodb` from an ES module, and a `shell-bson-parser` value. It does not cover
  `await import('bson')` from TypeScript, which the swc rule leaves as a real dynamic import
  (`ignoreDynamic: true`) and which is the exact failure in #933. A probe built with the real config
  shows the alias does cover it: with the alias, one constructor and only `bson/lib/bson.cjs`;
  without it, two constructors with `bson.node.mjs` and `bson.cjs`. So the product is safe today, but
  the check would not catch a future config change that breaks only this route (for example an
  alias applied to static requests only). The three source comments that say
  `await import('bson')` "resolves the package's ESM entry" (`feedResultToSchemaStore.ts`,
  `PlaygroundEvaluator.ts`, `playgroundWorker.ts`) now describe the unaliased behavior; the rule they
  state is still good defense.
- **Other alias questions, answered.** No `bson/…` subpath import exists in `src/` or `packages/`;
  the shipped host graph contains exactly one `bson` module (`bson/lib/bson.cjs`; the other
  `bson`-named modules are `mongodb/lib/bson.js` and the `@mongosh/shell-bson` and
  `shell-bson-parser` wrappers). The views alias points at `bson/lib/bson.mjs`, which matches the
  `browser` condition of bson 7.2.0's `exports` map.
- **Solutions:**
  1. Add a `bson (dynamic import)` route to `hostProbe.ts` and `workerProbe.ts` (make
     `objectIdRoutes` async). Pros: covers the historical failure; the negative control already
     removes the alias. Cons: the probe gains a lazy chunk.
  2. Leave it. Cons: the one route with a real incident behind it is unguarded.
- **Recommended:** 1.
- **Copilot comment:** none.
- **Author decision:** _pending_

### S3-F05: L1's `import.meta` check can be bypassed by an unowned or non-`.js` file

- **Severity:** low (no false pass today). **Validation:** confirmed by reading `inspect.cjs` and a
  probe over the packaged VSIX.
- **Where:** `build/verification/inspect.cjs` lines 53 to 84; commit `dd8202bd`.
- **What it does well.** It parses with acorn and rejects a `MetaProperty`, so the five textual
  `import.meta` occurrences in today's `main.js` and `playgroundWorker.js` (acorn and Babel error
  messages inside strings) correctly pass. The JS checks run before the report-hash check, which is
  why the fifth negative control fails for the expected reason instead of a hash mismatch.
- **Gaps.** A file is treated as CommonJS only if a report with `chunkFormat: 'commonjs'` owns it
  (`assetHashes`). A `.js` file owned by no report is silently skipped, and `.cjs`/`.mjs` files are
  skipped by the `.endsWith('.js')` filter. Today all 36 packaged JS files are owned and none has
  another extension, so there is no false pass.
- **Solutions:** fail on any packaged `.js`/`.cjs`/`.mjs` file that no report owns, and parse
  `.cjs` as CommonJS. Pros: closes the hole before Stage 4/5 add outputs. Cons: copied JS assets
  would need explicit ownership.
- **Recommended:** do it in Stage 4, when new outputs appear.
- **Copilot comment:** none.
- **Author decision:** _pending_

### S3-F06: three published tarballs ship compiled tests that import an undeclared `vitest`

- **Severity:** low. **Validation:** confirmed with `npm pack --dry-run`.
- **Where:** `@documentdb-js/operator-registry` (24 of 87 files are `*.test.*`),
  `@documentdb-js/shell-api-types` (4 of 21), `@documentdb-js/shell-runtime` (16 of 47). Their
  `tsconfig.json` includes `src/**/*`, so tests compile into `dist/`; `files: ["dist", …]` ships them.
- **What is wrong.** Pre-existing layout, but since Stage 2 these files `import … from 'vitest'`,
  which is not a dependency of the packages. Nothing imports them, so consumers are not broken, but
  they bloat the packages and would fail if a consumer's tooling loads every file in `dist/`.
  `declarationMap` files also point at `../src/…`, which is not shipped (pre-existing).
- **Solutions:**
  1. Exclude `src/**/*.test.ts` from the package `tsconfig.json` (as `vscode-ext-webview` and
     fluentui already do); type-check tests through the root project. Pros: clean tarballs. Cons:
     tests leave the package build's type-check (the root `tsc` still covers them).
  2. Add `"!dist/**/*.test.*"` to `files`. Pros: one line. Cons: still compiled.
- **Recommended:** 1, before publishing at G6.
- **Copilot comment:** none.
- **Author decision:** _pending_

### S3-F07: stale and inaccurate statements in the Stage 3 record

- **Severity:** low (ground rule 8). **Validation:** confirmed line by line.
- **Where and what:**
  - Plan line 1781, the known issue: "The webpack fix above currently has no automated guard beyond
    this record." Confirmed stale; the next line marks it "Done in Phase B (`dd8202bd`)", so a reader
    is not misled, but the sentence itself is now false. Plan line 1510 ("L1 has no check for
    `import.meta` in CommonJS bundles") has the same pattern, annotated below it.
  - Plan lines 1422 and 1828: "CI: pending". Run 37068033773 is green on the head; not recorded.
  - Plan lines 1507 to 1508: the tree-shaking rejection implies production drops
    `getShellApiDtsContent` ("a development build keeps it"). Production keeps it (S3-F01), so the
    webpack rule is load-bearing in the shipped `main.js` today. The decision is right; the stated
    reason understates it.
  - Plan line 1552: "`MicrosoftDocs/nosql-docs` is now private". The 404s are confirmed, but an
    anonymous 404 cannot distinguish private from renamed or deleted. State the observation, not the
    cause.
  - The Stage 3 package table and G1-3 hands-on item 2 attribute the TS plugin to
    `shell-api-types` (S3-F01).
  - Task 9 says "Rerun L2 before G3"; the integrated-browser part has not run on the Stage 3 VSIX
    (Phase B left it to the orchestrator; the operator now runs it). The record should list it as
    pending for G1-3, not only as "left to the orchestrator".
- **Solutions:** one record-correction commit covering the six items. Pros: the G1-3 reader gets
  accurate facts. Cons: none.
- **Recommended:** do it before G1-3.
- **Copilot comment:** none.
- **Author decision:** _pending_

### S3-F08: running the identity check on probe bundles instead of the VSIX is an acceptable gap

- **Severity:** info. **Validation:** reasoning checked against the code.
- **Evidence.** The check builds with the real `webpack.config.ext.js` (production mode, same
  aliases, rules, parser settings and externals), replacing only entries, output and two plugins.
  L1 counts `bson` modules in the hash-bound reports of the shipped artifact, offline. Together they
  cover "the config pins one entry" and "the shipped graph has one copy". What neither covers: a
  vendored copy under another path that only the real graph reaches. The record's reason for not
  running the shipped bundles (no module registry, executing `main.js` runs the whole extension) is
  correct. Stage 4/5 should revisit when Vite's output makes a module-level check practical.
- **Copilot comment:** none.
- **Author decision:** _pending_

### S3-F09: version bumps follow semver; `engines` are consistent

- **Severity:** info. **Validation:** confirmed.
- **Evidence.**
  - `schema-analyzer` 1.0.0 to 2.0.0: 1.0.0 announced a stability commitment, and adding an
    `exports` map blocks deep imports, so a major bump is required. Its CHANGELOG states both.
  - `operator-registry`, `shell-api-types`, `shell-runtime` 0.8.1 to 0.9.0 and `vscode-ext-webview`
    0.10.1 to 0.11.0: minor bumps are the breaking-change signal in 0.x.
  - fluentui 1.1.0 to 1.1.1: already ESM; only `inlineSources` changed; a patch is right.
  - `engines.node >=22.18.0` on five packages is stricter than `require(esm)` needs (20.19/22.12);
    that is the recorded decision. fluentui has no `engines` (browser-only), also recorded.
  - `engines.vscode ^1.109.0` with `@types/vscode` 1.109.0: the build type-checks against 1.109
    typings, so no newer API can be in use; L3 ran on 1.109.0 in CI. Users on 1.105 to 1.108 stop
    receiving updates: an operator decision at G1-3.
- **Copilot comment:** none.
- **Author decision:** _pending_

### S3-F10: removing the two Vitest interop settings is safe in CI too

- **Severity:** info. **Validation:** confirmed.
- **Evidence.** npm workspaces always link `node_modules/@documentdb-js/*` and
  `node_modules/@microsoft/vscode-ext-webview*` to `packages/*`, under both `npm install` and
  `npm ci`, so Vitest inlines them in CI as it does locally. Run 37068033773 used `npm ci` and passed
  296 files. The record's control (forcing fluentui external fails exactly the two `StatusStrip`
  files) shows the setting would matter for a registry-installed copy, which the config comment now
  says.
- **Copilot comment:** none.
- **Author decision:** _pending_

### S3-F11: the L2 template still loads the real `WebviewController`

- **Severity:** info. **Validation:** confirmed.
- **Evidence.** `build/verification/browser/template.ts` transpiles
  `packages/vscode-ext-webview/src/host/WebviewController.ts` with `transpileModule` and evaluates it
  with a `require` that knows exactly `vscode`, `./attachTrpc.js`, `./middleware/logging.js`, `path`
  and `crypto`, and throws on anything else. Nothing is copied. `prepare:browser-check` generated all
  six pages from the packaged VSIX in this review.
- **Copilot comment:** none.
- **Author decision:** _pending_

### S3-F12: package manifests and checks are sound

- **Severity:** info. **Validation:** confirmed with `verify:packages`.
- **Evidence.** Every package has `"type": "module"` (fluentui already had it) and an `exports` map
  with `types` before `default` plus `./package.json`; shell-api-types also exports `./typeDefs/*`
  and ships `typeDefs` in `files`. `main`, `types` and `typesVersions` remain for the root project's
  node10 resolution. All packages use NodeNext with `.js` relative specifiers except fluentui
  (`bundler`). `inlineSources` is on. publint is clean. ATTW's only finding, `CJSResolvesToESM` for
  node16-cjs, is inherent to ESM-only packages: TypeScript CommonJS consumers on `module: node16`
  get TS1479, while `module: nodenext` on TypeScript 5.8 or later accepts `require` of ESM. Worth one
  sentence in MIGRATION.md and the schema-analyzer CHANGELOG. The top-level-await scan has a
  mutation proof in the record. A scan of each `dist/` for undeclared bare imports found only doc
  comments and `vscode` (provided by the host).
- **Copilot comment:** none.
- **Author decision:** _pending_

### S3-F13: `tsx` replaces `ts-node` cleanly; the dead URLs affect no test

- **Severity:** info. **Validation:** confirmed.
- **Evidence.** `git grep ts-node` finds no use outside documentation and the lockfile history.
  `scrape` and `verify` are the only users of the dead URLs; no test references them. The 404s were
  reproduced with `curl`.
- **Copilot comment:** none.
- **Author decision:** _pending_

## Record check

- **Tasks and commits.** Phase A lists 12 commits and Phase B 8 plus one follow-up; with
  `811b33b5` that is the 21 in `git log`. Every task is marked done with hashes; the `template.ts`
  breakage is recorded honestly as handed from Phase A to Phase B.
- **Deviations.** The root `tsconfig` change, the webpack parser rule, the `import.meta` L1 check,
  the template loader fix and the fluentui inline removal each name real alternatives and why they
  were rejected. The tree-shaking reason is understated (S3-F07).
- **`TDD:` changes.** None claimed; `git log` shows no Stage 3 commit touching a `TDD:` file.
- **Dependency scans and pins.** Recorded per change: 0 fresh, no overrides; `tsx` added, `ts-node`
  removed. The lockfile diff matches. `publint` and ATTW run through pinned `npx`, not as
  dependencies.
- **Claimed checks.** Local sizes, L1 lines, `test:verification` counts and `verify:packages`
  results were all reproduced in this review. The playground-worker smoke test against
  `documentdb-local` is a throwaway claim with no artifact; it was not reproduced. CI and L2 status
  are stale (S3-F07).

## Independent sweep

- **The webview bundle shrank as predicted** (`views.js` minus 110,504 bytes), and `main.js` lost
  42 KB. Nothing grew.
- **`webpack.config.views.js` throws at load if `bson.mjs` is missing.** That makes a future `bson`
  layout change fail the build loudly, which is the right failure mode.
- **Root `tsconfig.json` excludes `packages/*/scripts`.** The scripts are type-checked by each
  package's `build` (`tsc -p scripts --noEmit`), so nothing lost coverage.
- **No new runtime dependency on `require(esm)` inside this extension.** All six packages are bundled
  into CommonJS output by webpack; Node's `require(esm)` matters only to external consumers
  (S3-F02).

## Verification limits

- **L2 in a browser** was not run (pages were generated only). The operator runs it.
- **L3** was not run locally (no display); CI ran it on VS Code 1.109.0.
- **Hands-on VSIX checklist** (playground worker against a real cluster, TS plugin, schema
  completions, webviews, interactive shell) is the operator's. Note S3-F01 before reading a pass of
  item 2 as evidence for `shell-api-types`.
- **ADO** builds (extension and npm packages) are operator-run; see S2-F01 for the package tests.
- **Unbundled consumption of `/host` in a real VS Code** is untested (S3-F02).

## Summary for G1-3

| Severity | Count |
| -------- | ----- |
| critical | 0     |
| high     | 0     |
| medium   | 2     |
| low      | 5     |
| info     | 6     |

No blocker for G1-3 from Stage 3: the shipped extension's behavior is covered by L1, L3, the
identity check and the package checks, all green on `811b33b5`. Before G1-3 closes, correct the
record and the mislabeled hands-on item (S3-F01 option 4, S3-F07). S3-F02 and S3-F06 must be
resolved before the packages are published at G6.
