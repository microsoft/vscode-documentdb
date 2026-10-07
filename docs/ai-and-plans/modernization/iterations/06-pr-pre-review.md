---
kind: review
status: active
---

# PR #880 AI pre-review (CONTRIBUTING.md §6)

- **Reviewer:** Claude Opus 5.5, step 1 of
  [CONTRIBUTING.md §6.1](../../../../CONTRIBUTING.md#61-stage-1-ai-review-pass-run-by-the-contributor)
  (initial edge-case review). Steps 2 to 4 are left for later passes.
- **Range:** `v0.11.0..ec7c7ff1` on `dev/tnaum/modernization` (541 files changed). The branch is
  based on the `v0.11.0` tag by operator decision and does not merge `main`. The local head is
  four commits ahead of the pushed PR head `ece5acf8` (the S6-F01/S6-F02 fixes and the Stage 6
  review record).
- **Method:** read `git diff v0.11.0..HEAD --stat` and the non-lockfile diff selectively (root and
  package manifests, CI and ADO pipelines, launch/tasks, `.vscodeignore`, Vite/Vitest configs,
  `main.ts`, the ESM product fixes in `src/`, CONTRIBUTING, Copilot instructions and skills, the
  feature docs). For `package-lock.json`, only the direct dependency delta. Validated with cheap
  local commands: `npm run build` (pass, 31.5 s), `npm run test --workspaces --if-present` as the
  ADO npm pipeline runs it (6 packages, 576 tests, pass), targeted `npx vitest run` on the runtime
  paths (7 files, 139 tests, pass), `npm pack --dry-run` for all six workspaces,
  `npx prettier --list-different` on `build/`, repository-wide `git grep` for removed tooling, and read-only
  `gh` queries against PR #880 and `main`. Not re-run: packaging, L1/L2/L3 and the `prove:*`
  controls (recorded as passing for this head; CI run 37509399673 green at `ece5acf8`). No
  Windows, macOS or ADO run was available.
- **Relation to the stage reviews:** each stage has its own review
  ([00](./00-stage0-review.md) to [06](./06-stage6-review.md)). This pass does not repeat them.
  It looks only at the final state of the whole PR: cross-stage leftovers, release risk for the
  extension and the six npm packages, CI/ADO after merge, developer workflow, and the new runtime
  paths. Where a finding touches a stage finding, the stage finding is cited.

- **Steps 3 and 4:** GPT-6.1 Sol (OpenAI), 2026-10-06, standard context; independent of the
  Claude step 1 pass. Reviewed local `ec7c7ff1` against `v0.11.0`, without changing branches,
  source, manifests or lockfiles. Step 1's original text and severities below are preserved;
  the validation blocks give the current judgments.

## Step 1: edge-case review (Claude Opus 5.5)

### PR-F01: the validated tree cannot merge as is; resolving the lockfile conflict changes shipped inputs or reverts `main`

- **Severity:** medium
- **Where:** [package-lock.json](../../../../package-lock.json); PR #880 against `main`.
- **What is wrong.** PR #880 is `CONFLICTING` with `main`. Since `v0.11.0`, `main` has 12 commits
  touching three files: the two ADO release pipelines (pipeline source names, #988; the PR does
  not touch these, so they merge cleanly) and `package-lock.json` (five Dependabot bumps: #983
  `markdown-it`, #984 `@xhmikosr/decompress`, #985 `brace-expansion`, #987 `undici`, #989
  `browserslist`). The branch lockfile still has the `v0.11.0` versions of four of them. Any
  resolution of the lockfile conflict either drops `main`'s bumps or changes resolved versions
  after all artifact evidence was gathered. One of them reaches the shipped VSIX: `browserslist`
  is bundled into `playgroundWorker.mjs` (through the `@babel/core` that
  `@mongosh/async-rewriter2` uses), and [build/vite/README.md](../../../../build/vite/README.md)
  ties the recorded worker-size result to how Rolldown treats `browserslist`'s dynamic `require`
  requests. `markdown-it` and `undici` are
  used by `vsce`, which produces the VSIX. The L1 baseline and size budgets, the 25 `prove:vsix`
  controls, L2 and L3, and CI run 37509399673 all describe the pre-merge lockfile. Because the PR
  conflicts, GitHub cannot create a merge ref, so no `pull_request` CI run has ever tested the
  merged tree (also noted in the Stage 6 review's sweep).
- **Evidence:**
  - `gh pr view 880 --json mergeable,mergeStateStatus` → `CONFLICTING`, `DIRTY`; PR head
    `ece5acf8`, local head `ec7c7ff1` (`git status -sb`: ahead 4).
  - `gh api repos/microsoft/vscode-documentdb/compare/v0.11.0...main` → 12 commits ahead, 0
    behind; files: `.azure-pipelines/release-npm-packages.yml`, `.azure-pipelines/release.yml`,
    `package-lock.json`.
  - Lockfile comparison (`v0.11.0` / `main` / branch): `node_modules/browserslist` 4.28.2 /
    4.29.3 / 4.28.2; `node_modules/markdown-it` 14.1.1 / 14.3.2 / 14.1.1; `node_modules/undici`
    7.28.0 / 7.30.0 / 7.28.0; `node_modules/brace-expansion` 2.1.4 / 2.1.7 / 2.1.4 (and the
    nested 1.1.18 copies, 1.1.21 on `main`). `@xhmikosr/decompress` is no longer in the branch
    lockfile.
  - `build/verification/reports/host.json`: the `playgroundWorker.mjs` chunk's `moduleIds`
    include four `browserslist` modules (`index.js`, `node.js`, `parse.js`, `error.js`), seven
    `@mongosh/async-rewriter2` modules and 51 `@babel/core` modules. `npm ls @babel/core` shows
    `@mongosh/shell-evaluator` → `@mongosh/async-rewriter2` → `@babel/core` (deduplicated with
    the `eslint-plugin-react-hooks` copy); `npm ls browserslist` resolves a single 4.28.2.

- **Validation (step 3):**
  - **Result:** partly valid. **Final severity:** medium (merge/release integration risk, not
    a defect in choosing the tag base).
  - **Verified:** read-only GitHub queries still show `CONFLICTING` / `DIRTY`, draft,
    remote `ece5acf8`; the comparison still has 12 commits and those three files. `git show`
    confirms the listed lockfile versions, and the host report contains the four worker
    `browserslist` modules. The release-pipeline edits are absent from this branch's diff.
  - **Correction:** Stage 1 explicitly overrides pre-gate `main` merges. G6 already requires
    publication/build from `main`, then L1/L2/L3 on the signed VSIX and approval for its digest.
    The old artifact evidence is not evidence for future merged bytes, but that is an anticipated
    gate, not an omitted release sequence. No merge or rebase is required during this review.
    `@xhmikosr/decompress` was removed from this dependency graph; restoring it is not necessary.
  - **Solutions:**
    1. At the authorized merge-integration point, take one lockfile side and regenerate using
       `.nvmrc`'s Node/npm; inspect the resolved delta and respect the 7-day feed quarantine.
       Run merged-tree CI and the affected artifact/package checks, then follow G6 for the
       signed release file. **Pros:** retains deliberate dependency updates and verifies the
       shipped inputs. **Cons:** feed waits and renewed verification.
    2. Explicitly retain the branch's dependency resolutions when regenerating and record any
       deferred `main` bumps with reasons and follow-up work. **Pros:** less dependency churn.
       **Cons:** postpones accepted updates; still needs merged-tree and G6 verification.
  - **Recommended:** 1, at the operator-authorized integration point, not a premature `main`
    merge. Keep the existing baseline as a comparison; do not silently re-baseline changed inputs.
- **Author decision (operator, 2026-10-07):** "we'll merge remove our overrides. we'll accept
  the risk of ADO failing, we had to take are of it during the pipeline development, now we can
  relax this while we're working on the rest." `main` is merged into the branch, with the lockfile
  regenerated, not hand-merged. The overrides are removed, and the 7-day feed quarantine is
  relaxed. The merged tree then needs a new CI run and L1/L2/L3 before #880 merges.

### PR-F02: the ESM package checks run in no pipeline, including both publish paths

- **Severity:** medium
- **Where:** [package.json](../../../../package.json) (`verify:packages`, line 80);
  [npm-publish-documentdb-js.yml](../../../../.github/workflows/npm-publish-documentdb-js.yml);
  [build-npm-packages.yml](../../../../.azure-pipelines/build-npm-packages.yml);
  [pack-npm-packages.ps1](../../../../.azure-pipelines/scripts/pack-npm-packages.ps1);
  [main.yml](../../../../.github/workflows/main.yml);
  [build/verification/README.md](../../../../build/verification/README.md) (line 393).
- **What is wrong.** This PR makes all six published packages ESM-only, adds `exports` maps and
  `engines`, and bumps their versions (G3). Their correctness is checked by
  `npm run verify:packages`: the packed-test rejection, `publint --strict`,
  `@arethetypeswrong/cli`, the top-level-`await` scan and the CommonJS/ESM/Vitest consumer
  probes. That script is invoked only by hand. `main.yml` runs `probe:host-unbundled` in the L3
  job but not `verify:packages`. The two publish paths build from a fresh checkout and publish
  without it: the GitHub workflow runs `npm ci`, `npm run build --workspaces`, `npm publish`; the
  ADO pipeline runs `npm ci` (internal feed), build, `npm run test --workspaces`, then `npm pack`
  on a Windows agent, and `release-npm-packages.yml` ships that tarball. The tarball that is
  published is therefore never the one the checks ran on. The Stage 6 decision on S6-F01 rests on
  the check ("the assertion already guards the published bytes"), and G6 step 2 ("Publish the
  package versions decided at G3, from `main`") lists no verification step. The README says
  `publint` and ATTW run "through `npx`; they are not dependencies", so the check also needs
  network access, which matters for where it can run.
- **Evidence:** `git grep -n 'verify:packages\|check-packages'` outside the modernization
  iterations matches only `package.json`, `build/verification/README.md`, the check's own files
  and the plan. Read both publish workflows and `pack-npm-packages.ps1` in full. Plan line 2991
  (G6 step 2); [06-stage6-review.md](./06-stage6-review.md) line 84.
  `npm pack --dry-run --json` for each workspace currently shows clean tarballs (no `*.test.*`,
  no `tsconfig.tsbuildinfo`), so this is a missing gate, not a present defect.

- **Validation (step 3):**
  - **Result:** valid. **Final severity:** medium.
  - **Verified:** read all three workflows/pipelines and the packing script; no pipeline invokes
    `verify:packages` or its checker. GitHub publishes workspace contents after building; ADO
    builds/tests, packs the two `@microsoft` packages, and releases those archives. The release
    tarball scan rejects sensitive filenames, not tests, export/type failures or top-level await.
    All six dry-run payloads are currently clean after `npm run build`.
  - **Correction:** Fluent UI was already ESM with an export map before this PR; five packages
    change format. The issue is lack of enforcement on future publication, not proof that
    today's clean-checkout tarballs differ from locally checked ones. G6's manual sequence is
    explicit, but does not make the S6-F01 assertion run in either publishing path.
  - **Solutions:**
    1. Gate package changes in CI and both publication paths. Let the shared verifier accept
       already-packed archives, and publish those checked bytes. Pin/provision the validators
       through the approved feed/cache, respecting quarantine, rather than requiring live public
       `npx` downloads in ADO. **Pros:** enforces checks on actual release inputs and closes
       S6-F01's automation gap. **Cons:** verifier/pipeline work and validator provisioning.
    2. Add an explicit G6 package-verification checkpoint, retaining reports and hashes and
       checking the final publication archives against them. **Pros:** smaller immediate change.
       **Cons:** operator-dependent; ordinary CI and later publishes remain unguarded.
  - **Recommended:** 1. Option 2 is a possible explicitly accepted interim release procedure.
- **Author decision (operator, 2026-10-07):** "the reveiw finigs will be addressed befre we
  mare the PR." To be fixed before #880 merges. Since this review,
  `npm-publish-documentdb-js.yml` gates its publish job on `verify:packages` (`c0fd83c8`,
  `dd5b767d`); the ADO path for the two `@microsoft` packages remains.

### PR-F03: three `@documentdb-js` packages ship the same breaking changes as `schema-analyzer` 2.0.0 with no release note

- **Severity:** low
- **Where:** [operator-registry package.json](../../../../packages/documentdb-js-operator-registry/package.json),
  [shell-api-types package.json](../../../../packages/documentdb-js-shell-api-types/package.json),
  [shell-runtime package.json](../../../../packages/documentdb-js-shell-runtime/package.json);
  compare [schema-analyzer CHANGELOG.md](../../../../packages/documentdb-js-schema-analyzer/CHANGELOG.md)
  and [vscode-ext-webview MIGRATION.md](../../../../packages/vscode-ext-webview/MIGRATION.md).
- **What is wrong.** `operator-registry`, `shell-api-types` and `shell-runtime` go from 0.8.1 to
  0.9.0 with `"type": "module"`, a new `exports` map (so deep imports such as
  `@documentdb-js/operator-registry/dist/queryOperators` now fail with
  `ERR_PACKAGE_PATH_NOT_EXPORTED`), and a new `engines.node` `>=22.18.0`. `schema-analyzer`
  documents exactly these changes as breaking in its 2.0.0 changelog, and `vscode-ext-webview`
  has a migration guide. The other three have no changelog, and their READMEs (the npm page) do
  not mention ESM, the `exports` map or the Node floor. The plan records that they "have no
  changelog file" but no note was added elsewhere. npm users of 0.8.x see only a minor bump.
- **Evidence:** package manifest diffs (`git diff v0.11.0..HEAD -- packages/*/package.json`);
  `npm pack --dry-run` file lists (no `CHANGELOG.md` or migration note in these three tarballs);
  `grep -n -E 'ESM|CommonJS|require\(|engines' packages/*/README.md` matches only the two
  `@microsoft` packages; the only README change in the three packages is a Jest → "unit test"
  wording fix in `operator-registry`.

- **Validation (step 3):**
  - **Result:** valid. **Final severity:** low.
  - **Verified:** the three manifests add ESM, export restrictions and Node `>=22.18.0`.
    Their READMEs have no migration section, and their dry-run archives contain no changelog
    or migration guide. The schema-analyzer changelog documents precisely these changes.
  - **Correction:** the `0.9.0` bumps are the G3 decision, not a semver error: all three READMEs
    warn of pre-1.0 minor-version changes, and `^0.8.1` does not admit `0.9.0`. CommonJS
    `require(esm)` works on the supported Node version; it is older runtimes and deep-import
    users that need migration guidance.
  - **Solutions:**
    1. Add a short `0.8.x -> 0.9.0` README section to each package: Node floor, public entry
       points, blocked deep imports and CommonJS/TypeScript guidance. **Pros:** visible on npm
       and automatically packed as README. **Cons:** three small sections to maintain.
    2. Add changelogs or migration guides and include them in each `files` list. **Pros:** durable
       release history. **Cons:** additional files and packaging maintenance.
  - **Recommended:** 1; retain the operator-approved versions.
- **Author decision (operator, 2026-10-07):** "all release notes will be updaetd before the
  merge." Addressed with the release notes before #880 merges.

### PR-F04: leftovers of the removed CommonJS dev layout and webpack tooling

- **Severity:** low
- **Where:** [tsconfig.json](../../../../tsconfig.json) (`outDir: "out"`) with
  [package.json](../../../../package.json) (`"build": "tsc"`, line 63);
  [configuration.ts](../../../../src/webviews/_integration/configuration.ts) (line 60);
  [main.yml](../../../../.github/workflows/main.yml) (line 349);
  [.vscodeignore](../../../../.vscodeignore) (line 35).
- **What is wrong.**
  - `npm run build`, the documented type-check step, still emits the whole project as JavaScript
    with source maps into `out/`. At `v0.11.0`, `main.js` loaded `./out/src/extension`, so `out/`
    was the unbundled development runtime. This PR deleted `main.js`; F5 now runs from `dist/`,
    and nothing reads `out/` any more.
  - `WEBVIEW_CONFIG.bundle.dev` still points at `out/src/webviews/index.js`. Every Vite host build
    defines `process.env.IS_BUNDLE` as `'true'` (`vite.config.ext.mjs` line 146), so this layout
    is only reachable where `IS_BUNDLE` is unset (unit tests). It now names a `tsc` output that
    is not a browser bundle.
  - `BUNDLE_ANALYZE: 'true'` is set on the `npm run package` step in `main.yml`; nothing reads it
    since `webpack-bundle-analyzer` was removed (bundle reports are written in every production
    Vite build).
  - `.vscodeignore` still lists `.swcrc`, which this PR deleted.
- **Evidence:** `npm run build` rewrote 1,997 files (18 MB) under `out/`
  (`find out -newer <marker> | wc -l`); `git show v0.11.0:main.js` (the `require('./out/src/extension')`
  line); `grep` for `out/`, `IS_BUNDLE` and `BUNDLE_ANALYZE` across `src`, `packages/*/src`,
  `build`, the Vite configs and the workflows finds no other reader.

- **Validation (step 3):**
  - **Result:** partly valid. **Final severity:** low.
  - **Verified:** `npm run build` passes but root `tsc` emits JavaScript/maps into `out/`
    (1,997 files, 12,961,732 logical bytes observed). F5 uses `dist/`; the host defines
    `IS_BUNDLE=true`. The dev fallback, unused `BUNDLE_ANALYZE` variable and `.swcrc` exclusion
    remain as described.
  - **Correction:** root output is now ESM, not CommonJS. No production failure was reproduced:
    the fallback is not used by the supported launch/build paths, and the unused variable and
    ignore entry are harmless. Workspace composite builds still need to emit `dist/`; this is
    only about root type-check output and obsolete configuration.
  - **Solutions:**
    1. Make the root type-check non-emitting, preserving workspace/API builds, and remove or
       update the obsolete configuration together. Validate build and F5 behavior.
       **Pros:** avoids unused output and misleading paths. **Cons:** must check any external
       developer scripts relying on `out/`.
    2. Keep root emission as an explicit developer option and document that F5 uses only
       `dist/`; defer harmless leftovers. **Pros:** preserves undocumented tooling.
       **Cons:** continued unnecessary output and stale configuration.
  - **Recommended:** 1 after confirming no supported consumer of root `out/`; this is cleanup,
    not a reason to claim the current extension is broken.
- **Author decision (operator, 2026-10-07):** "the reveiw finigs will be addressed befre we
  mare the PR." To be fixed before #880 merges.

### PR-F05: the formatting gate does not cover the new `build/` tooling tree

- **Severity:** low
- **Where:** [package.json](../../../../package.json) (`prettier` and `prettier-fix`, lines 74 and
  75); [build/verification/](../../../../build/verification/).
- **What is wrong.** The PR adds most of `build/` (verification tooling for L1/L2/L3, the package
  checks, the browser harness, the Vite plugins). The `prettier` and `prettier-fix` globs are
  unchanged from `v0.11.0` (`(src|test|l10n|grammar|docs|packages)/**` plus root
  `*.@(js|ts|jsx|tsx|json|md)`), so neither the CI Prettier gate nor the Case 2 `prettier-fix`
  step touches `build/**` or root `.mjs`/`.cjs` files. ESLint does lint `build/`. The plan
  already recorded format-only commits for four such files in Stage 3; the drift has since grown.
- **Evidence:** of 78 tracked `build/**` and root `vite.config.*.mjs` files with Prettier-handled
  extensions, `npx prettier --list-different` reports 21, all under `build/verification/` (for
  example `activation/checks.cjs`, `activation/runner.cjs`, `baseline.json`,
  `browser/scenarios.ts`, `browser/tsconfig.json`). `eslint.config.mjs` ignores do not include
  `build/`.

- **Validation (step 3):**
  - **Result:** valid. **Final severity:** low (gate coverage, not runtime correctness).
  - **Verified:** both formatting scripts omit `build/**` and root `.mjs`/`.cjs`.
    Explicit `prettier --list-different` over the 78 tracked tooling/config paths reports the
    same 21 files; Prettier exits nonzero. ESLint coverage does not replace formatting coverage.
  - **Solutions:**
    1. Extend both shared formatting globs to tracked tooling and `.mjs`/`.cjs`, excluding
       generated reports; format the newly covered files when preparing for review.
       **Pros:** CI and Case 2 cover the maintained tooling consistently.
       **Cons:** a one-time formatting diff.
    2. Add a separate tooling-format command and call it from CI and Case 2.
       **Pros:** isolates the tooling scope. **Cons:** another command/checklist can drift.
  - **Recommended:** 1. This review does not format tooling or run repository-wide formatting.
- **Author decision (operator, 2026-10-07):** "the reveiw finigs will be addressed befre we
  mare the PR." To be fixed before #880 merges.

### PR-F06: after merge, the knowledge base does not lead to the build-stack rationale, and one active feature design states the opposite

- **Severity:** low
- **Where:** [docs/ai-and-plans/modernization/](../); [docs/ai-and-plans/README.md](../../README.md);
  [webview-ext-package/design.md](../../features/webview-ext-package/design.md) (lines 655 to 680
  and 1237).
- **What is wrong.**
  - The PR adds `docs/ai-and-plans/modernization/` as a root-level folder. It is not under
    `features/`, has no `README.md`, and is not in the feature index. Its two main documents,
    `build-and-test-stack.md` and `e2e-testing-strategy.md`, have no front matter, so no `kind`,
    `status` or `code:` globs. CONTRIBUTING §5.1 and the Copilot instructions direct readers to
    the feature index and to `code:` globs as the route from source to rationale; neither reaches
    these documents. `build/vite/README.md` and `build/verification/README.md` do link to them.
  - `features/webview-ext-package/design.md` (`status: active`, `code:` glob
    `packages/vscode-ext-webview/**`) describes the package as emitting CommonJS and concludes
    "stay on **webpack + `swc` (bundles)**" and "**No Vite.**". This PR makes the package ESM-only
    and moves both consumers' bundles to Vite.
  - The feature index lists `webview-fluentui-package` as "1.1.0 prepared"; the PR sets 1.1.1.
- **Evidence:** `git ls-tree -r v0.11.0 docs/ai-and-plans/modernization` is empty; `head -1` of
  each file in the folder; `grep -i modernization docs/ai-and-plans/README.md` has no match;
  `grep -rln 'ai-and-plans/modernization'` outside the folder finds only the two `build/` READMEs
  and `webview-fluentui-package/decisions.md`.

- **Validation (step 3):**
  - **Result:** partly valid. **Final severity:** low.
  - **Verified:** the feature index has no modernization entry, the folder has no README,
    and both main documents lack frontmatter. The active webview design's "Today" table still
    describes CommonJS/webpack; the Fluent UI index entry says `1.1.0` while the manifest is
    `1.1.1`. The two build READMEs do provide working links into the plan.
  - **Correction:** the dated "No Vite" decision concerns the earlier API refactor; it explicitly
    permits a separate bundler modernization. It is not an operator prohibition violated by
    this PR. Historical rationale should remain; the missing current-state signpost and stale
    descriptions are the actionable documentation gap.
  - **Solutions:**
    1. Index the existing modernization folder, add a short README and document status, and
       annotate the affected active design with the new ESM/Vite state and a link to this plan.
       Update the Fluent UI version entry. **Pros:** restores discoverability without erasing
       history or moving links. **Cons:** retains the nonstandard root-folder placement.
    2. Move the durable documents under a feature folder and update all inbound links.
       **Pros:** follows the current knowledge-base layout. **Cons:** broader link churn and
       history/intent separation work.
  - **Recommended:** 1; do not rewrite historical decisions or sweep unrelated feature docs.
- **Author decision (operator, 2026-10-07):** "the reveiw finigs will be addressed befre we
  mare the PR." To be fixed before #880 merges.

### Checked without a finding

These were read or exercised and gave no evidence of a problem. They are listed so later steps
can skip or deliberately re-check them.

- **Removed tooling references:** `git grep` for webpack, Jest, Mocha, `ts-node`, `jesttest`,
  `extension.bundle`, `.vscode-test.js`, `xvfb.init` and deleted test helpers. Outside historical
  feature notes and iterations, the only hits are the ones in PR-F04, the backport skill (which
  correctly keeps `npm run jesttest` for release branches cut before Vitest), and explanatory
  "replaces webpack's …" comments. `npm run compile` still exists (`tsc -watch`), so the
  Copilot instructions' warning is still accurate.
- **CI after merge:** the temporary PR-head checkout (S1-F01) is gone; all `main.yml` checkouts
  use the default ref. Job conditions, artifacts and permissions are consistent. The build-size
  cache keeps its key prefix and the new report handles a legacy `{vsixSize, webviewSize}` base
  (`build-size-report.cjs`, "Legacy baseline"). The ADO `build.yml` runs L1 offline before
  signing; L1 normalizes Windows separators in module IDs. `release.yml` and
  `release-npm-packages.yml` are unchanged and contain no version- or layout-specific
  assumptions affected by this PR.
- **Developer workflow:** `npm run build` passes; `npm test` = workspace build + `vitest run`;
  `npm run package` → `build-prod` (Vite) → `vsce` in `dist/`; F5 uses
  `--extensionDevelopmentPath=${workspaceFolder}/dist` with the `Watch` task (`watch:ext` +
  `watch:views`); the package `test` scripts point at the root Vitest config and pass when run
  per workspace. CONTRIBUTING §3.2 and §4 match the scripts. The views dev server still binds
  `127.0.0.1:18080`, as webpack-dev-server did.
- **Package contents and versions:** versions match the Stage 3 table decided at G3
  (operator-registry 0.9.0, schema-analyzer 2.0.0, shell-api-types 0.9.0, shell-runtime 0.9.0,
  vscode-ext-webview 0.11.0, fluentui 1.1.1). `npm pack --dry-run` shows only `dist`, `typeDefs`
  where declared, README/LICENSE/CHANGELOG/MIGRATION; source maps embed their sources
  (`inlineSources`). Only devDependencies changed in the root manifest; no runtime dependency
  changed.
- **Runtime paths:** `main.ts` awaits the extension chunk at top level and only then exports
  `activate`/`deactivate`; host code contains no `__dirname`, `__filename`, `require` or
  `import.meta` outside the TS plugin, and the ESM banner supplies the extension root for bundled
  CommonJS dependencies. `WorkerSessionManager` resolves `playgroundWorker.mjs` from
  `ext.context.extensionPath`, which is `dist/` under F5 and the install root in a VSIX.
  `ensureTsPluginStub` writes `index.cjs` and a `type: commonjs` manifest atomically, removes the
  CommonJS-era `index.js`, and its errors (read-only installs, Windows `EPERM`/`EBUSY`) are
  caught by the bootstrap with `suppressDisplay`. Each extension version installs into its own
  folder, so an upgrade does not reuse an older stub. `SecretIndex` keeps its numeric slots.
  Targeted Vitest for these files passes. Behavior on real Windows/macOS paths was not run.

## Step 2: GitHub Copilot reviewer comments

None to merge (coordinator, 2026-10-06). PR #880 is a draft, and GitHub's Copilot reviewer has
not reviewed it: `gh api repos/microsoft/vscode-documentdb/pulls/880/comments` returns 0
review comments, and `gh pr view 880` lists 0 reviews (3 issue comments, none from the
Copilot reviewer). **Outstanding:** when the operator requests the Copilot review, its
comments must be merged here, with links, and reassessed before human review.

## Step 3: validation gate

Completed by GPT-6.1 Sol (OpenAI), 2026-10-06. Inline validation blocks above are authoritative
for final severity and recommendations; step 1's text is unchanged.

| Finding | Validation   | Final severity | Scope after validation                         |
| ------- | ------------ | -------------- | ---------------------------------------------- |
| PR-F01  | partly valid | medium         | Authorized merge integration and renewed proof |
| PR-F02  | valid        | medium         | Missing package publication/check automation   |
| PR-F03  | valid        | low            | Missing consumer migration notes               |
| PR-F04  | partly valid | low            | Unused root output and obsolete configuration  |
| PR-F05  | valid        | low            | Formatting-gate coverage                       |
| PR-F06  | partly valid | low            | Current-state documentation/discoverability    |

**Commands and results:**

- `npm run build`: pass, local Node `v22.21.1`, npm `10.9.3`. `.nvmrc` reads `22.18`;
  this checks a supported Node version, not the exact ADO-pinned runtime.
- `npm pack --dry-run --json --workspace <name>` for all six workspaces, combined in one
  invocation: pass; no packed tests, source directories or `tsconfig.tsbuildinfo`.
- `git ls-files -z <tooling/config globs> | xargs -0 npx --no-install prettier --list-different`:
  78 paths, 21 differences, expected nonzero (`xargs` exit 123), confirming PR-F05.
- Read-only `gh pr view 880`, `gh api .../compare/v0.11.0...main`, and PR reviews/comments:
  draft/conflicting, 12-commit delta, zero reviews and zero review comments.
- `git show` lockfile comparisons, targeted `git diff`/`git grep`/`rg`, export-target existence
  checks, and `npm ls browserslist @babel/core --all --depth=5`: confirmed the cited evidence.
- Local Node `require()` plus `import()` probes: pass for all four `@documentdb-js` roots,
  `vscode-ext-webview` root/webview/react and Fluent UI's `monaco` entry. The shell declaration
  read returns 30,307 characters. These are local built-workspace probes, not a substitute for
  packed-consumer checks or the real extension-host `/host` probe.
- Final `npx prettier --check` on this review file: pass after formatting only this file.

**Limits:** no dependency installs, pipeline dispatches, full unit suite, packaging or L1/L2/L3
rerun; no Windows/macOS, ADO or exact Node `22.18` execution. Previously recorded artifact checks
were read as evidence, not claimed as rerun. This is Case 1: the PR is still draft. Full Case 2 checks,
including repository-wide `prettier-fix`, remain deferred until ready-for-review preparation.

## Step 4: independent sweep

Completed against the final local tree. Skimmed all Stage 0-6 finding titles and used their
records where relevant; no additional reproducible defect outside those findings and
PR-F01-PR-F06 was established. **No PR-F07 is allocated.** In particular:

| Surface                                | Evidence and disposition                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADO release and npm pipelines          | Both release files, the npm build and packing script, and the GitHub npm publisher are unchanged against the tag. Artifact selection/version validation still matches the output layout. `main`'s source-name edits belong to the eventual integration (PR-F01). Package-check enforcement is PR-F02; Windows Vitest evidence was already S2-F01.                                                     |
| CommonJS consumers and type resolution | Public export/type targets exist, and the local Node probes above load the supported entries. The checker deliberately accepts ATTW `CJSResolvesToESM` for node16 CommonJS consumers; it is not evidence that declarations are missing. The real `/host` synchronous-require deadlock and Fluent loading limitations are documented and already covered by S3-F02 and later stage reviews.            |
| Published `files`                      | All six dry-run archives have the declared JavaScript, declarations and intended docs; shell `typeDefs` is included. No test output or build-info file is packed in this build. Incremental stale-test exposure is already S6-F01/PR-F02, not a new finding.                                                                                                                                          |
| `engines` and the separate API project | The extension's VS Code floor is `1.109.0`; the five newly ESM packages declare Node `>=22.18.0`. Fluent UI was already ESM and remains browser-oriented. `api/` is unchanged, has its own package/lockfile and CommonJS compiler settings; its helper awaits VS Code activation rather than synchronously requiring the new ESM extension entry. No new format incompatibility was found.            |
| Localization and VSIX filtering        | The localization `.mjs` scripts and imports already exist in the tag and are unchanged. The Vite host copies selected runtime assets, not the tooling tree; `.vscodeignore` still excludes source/build/API/package trees. The `views.js` production entry and dev-server shim match the controller's configured name. Harmless stale entries remain PR-F04.                                          |
| Vitest                                 | The seven projects retain explicit source-test selectors and timeouts; workspace test scripts name their projects. The VS Code alias/setup and Azure reset-module inlining remain explicit. The earlier isolation/mock limitations and type-check gaps were already S2-F03/S2-F07; no new selector that silently loses tests was found.                                                               |
| New CI steps                           | New Actions references are SHA-pinned; the new size-comment step passes base-ref/artifact metadata through environment variables rather than interpolating it into executable script. No new `pull_request_target` or credential-bearing publish path was introduced. The earlier write-token hardening gap is S1-F07, not a new finding. This was a scoped code read, not an executed security test. |
| Signed release proof                   | G6 explicitly requires the merged `main` packages, quarantined ADO build, signed-VSIX SHA-256, L1/L2/L3 on that file and approval only for that digest. Those later operator steps are outstanding release work, not missing steps to invent or substitute with unsigned local results.                                                                                                               |

## Summary

After validation: three valid, three partly valid, zero fully false-positive findings, and no
new sweep findings. Partly valid findings retain only the narrowed risks described above.

| Final severity | Count | Findings                       |
| -------------- | ----- | ------------------------------ |
| high           | 0     | None                           |
| medium         | 2     | PR-F01, PR-F02                 |
| low            | 4     | PR-F03, PR-F04, PR-F05, PR-F06 |
| total          | 6     | All author decisions pending   |

**Before marking ready for human review:**

- Author decisions under CONTRIBUTING §6.2 are pending for every finding. Decide fixes,
  justified acceptance or follow-up issues; this pass does not make those decisions.
- The Copilot reviewer pass (step 2) has not happened: zero reviews/comments as of this pass.
  Request it, merge its comments with links, and validate any additional findings.
- Resolve the merge-integration plan and PR-F02's release-check gap explicitly. Do not violate
  the tag-base decision, hand-merge the lockfile, bypass quarantine or treat pre-merge reports
  as proof of merged/released bytes.
- Run and record all Case 2 checks and the remaining pre-merge G6 manual platform checklist.
  This draft review did not run that suite. The coordinator committed this file
  (`00bc1337`); the author's decisions are recorded in it later.

After merge, carry out G6's package publication, ADO build and exact signed-file verification
before release approval. Steps 3 and 4 are complete; neither ready-for-review nor release
approval is claimed.
