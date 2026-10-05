---
kind: review
status: active
---

# Stage 5 AI review: extension host to ESM and Vite

- **Reviewer:** GPT-6 Astra (GitHub Copilot agent), designated by the operator in a fresh
  session with no involvement in Stage 5 implementation.
- **Model-family note:** Claude Opus 5.5 authored the architecture/core and coordinated the
  implementation; GPT-6.1 Sol subagents authored tooling, L1, the externals audit and the
  development loop. This reviewer is from a different family than the core author, as the
  plan requests, but the tooling review is partly same-family. Steps 1, 3 and 4 below were
  performed by this reviewer, not by an additional different-vendor validation agent.
- **Range reviewed:** `1bb1c316..f22c0278`, **9 commits**, all with `S5:` subjects, verified
  with `git rev-list --count` and `git log --oneline`. HEAD remained
  `f22c0278def0957ceb0bf4116d322616f32341a9` on `dev/tnaum/modernization`. Read the complete
  3,357-line diff, including the deleted webpack host config. The initial worktree was clean.
  During review, the coordinator separately added an **uncommitted** Stage 5 execution record
  to the plan; its explanations were read, but that change is not part of the commit range
  and was not edited by this reviewer.
- **Method:** [CONTRIBUTING.md](../../../../CONTRIBUTING.md#61-stage-1-ai-review-pass-run-by-the-contributor)
  section 6.1 steps 1 to 4: edge-case review; fetch PR review comments with `gh`; validate
  findings against code and artifact/runtime probes; then an independent sweep. Draft
  PR #880 had **0 review comments and 0 reviews**. Read the plan's ground rules, L0-L3,
  Stage 4 hand-over context and Stage 5/G5; S1-F06, S2-F03/F04, S3-F01/F03/F05/F08 and
  S4-F01/F02; the supplied check results and raw externals evidence; and the Cosmos DB
  Vite host reference. Probes and mutations used copies under `/tmp`, not product files.
  This review file is the reviewer's only repository edit; no commit, push or branch change.

## Checks run by the reviewer

Linux/WSL, Node **22.21.1**, npm **10.9.3**, VS Code **1.109.0**. L3 used the supplied
Xvfb environment on `:97`; the reviewer did not start or stop Xvfb.
The reviewed production VSIX has **202 files**, **8,492,474 bytes**, SHA-256
`fc9e21d1e0d4f02505c7fde525f863f8d8b88f3d078d913f6b5a2c9fd319e97b`.
The supplied `host.json` and `views.json` were byte-identical to the checkout's reports.

| Check                                                                                                                                             | Result                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Range, branch, worktree and PR metadata                                                                                                           | Nine `S5:` commits at the requested tip; draft #880; no review comments/reviews. Coordinator-only plan edits appeared during review, without changing HEAD.                                                                                                                                                                                                       |
| `npm run build`                                                                                                                                   | Pass: all six workspace builds and root TypeScript build.                                                                                                                                                                                                                                                                                                         |
| `npm run test:verification`                                                                                                                       | Pass: **83 Node tests**, **6 browser test files / 82 Vitest tests**.                                                                                                                                                                                                                                                                                              |
| `npx vitest run --no-coverage src/documentdb/playground/WorkerSessionManager.test.ts src/documentdb/playground/tsPluginStub.test.ts`              | Pass: **2 files / 31 tests**. VS Code's test tool first reported no tests found, so the repository's Vitest CLI was used.                                                                                                                                                                                                                                         |
| `node_modules/.bin/tsc --noEmit -p build/verification/browser/tsconfig.json`                                                                      | Pass.                                                                                                                                                                                                                                                                                                                                                             |
| `npm run verify:vsix -- /tmp/s5-final/vscode-documentdb-0.11.0.vsix`                                                                              | Pass. Host graph bytes: **main 9,875,774**, **playgroundWorker 5,362,758**, **playgroundTsPlugin 6,175**. These are full reachable graphs, not startup-only bytes.                                                                                                                                                                                                |
| `npm run prove:vsix -- /tmp/s5-final/vscode-documentdb-0.11.0.vsix`                                                                               | Pass: **19 PASS lines**, no skipped controls. S5-F01 identifies an additional case those controls miss.                                                                                                                                                                                                                                                           |
| `node build/verification/bson-identity/check.cjs --prove`                                                                                         | Pass: main's **5 routes** and worker's **4 routes** share their respective ObjectId constructor; alias-removed control rejects the second BSON build.                                                                                                                                                                                                             |
| `source /tmp/s5-xvfb/env.sh && npm run test:vsix -- /tmp/s5-final/vscode-documentdb-0.11.0.vsix`                                                  | **L3 PASS**: installed artifact, late commands, one extension-host log and two DocumentDB output logs, no attributed errors.                                                                                                                                                                                                                                      |
| `source /tmp/s5-xvfb/env.sh && npm run prove:activation -- /tmp/s5-final/vscode-documentdb-0.11.0.vsix`                                           | **L3 PROOF PASS**: activation/late-command receipt succeeds, but actual logs reject the injected swallowed error.                                                                                                                                                                                                                                                 |
| `npm run measure:activation -- <vsix> --runs 5 --json <temporary-file>` for each artifact, sequentially on the same machine                       | Baseline webpack host: code-load median **428 ms** (392-459), activate **67 ms**, total **496 ms**, mainFileLoad **0 ms**. Stage 5: code-load median **288 ms** (265-316), activate **52 ms**, total **334 ms**, mainFileLoad **269 ms**. All ten launches passed L3 and parsed a successful DEBUGTELEMETRY activation event.                                     |
| Packaged thin-loader probes outside the checkout                                                                                                  | Pass: substituted extension-chunk fixture is awaited; activate receives the measured interval; deactivate delegates; a chunk evaluation exception rejects the main module import. This is a loader-boundary probe, not an injected failure in the real extension's initialization.                                                                                |
| Actual packaged ESM worker, outside the checkout, against a local wire-protocol fixture                                                           | Pass: init, shell/Babel evaluation of `1 + 2`, ObjectId construction/hex conversion, `db.items.findOne({})`, and shutdown. Result assertions decoded the worker's canonical EJSON. No database credentials or real backend were used.                                                                                                                             |
| Actual packaged CommonJS TS plugin through the real runtime stub writer                                                                           | Pass: package-name `require` returns a callable factory under an ESM extension manifest; the declaration path is inside the extracted extension; prefix length **30,308**; `db.` returns **168 completions**, including `getCollection`; hover returns its typed method signature. This uses a real TypeScript language service, not VS Code's TS-server process. |
| Stub filesystem and interleaving probes                                                                                                           | Current stub is not rewritten; an unprivileged read-only first install propagates **EACCES**; a complete read-only stub returns `existed`. A controlled two-writer/one-reader interleaving reproduces **ERR_INVALID_PACKAGE_CONFIG**: S5-F02.                                                                                                                     |
| Eager-Kubernetes mutation of the packaged extension chunk, with copied matching report hashes and byte sizes                                      | **Unexpected L1 pass**, despite the awaited implementation's static closure now containing the SDK: S5-F01. The original artifact has no such eager edge.                                                                                                                                                                                                         |
| `npm run prepare:browser-check -- --vsix /tmp/s5-final/vscode-documentdb-0.11.0.vsix --output /tmp/s5-review-l2 --prefix /s5-review --port 18089` | Pass: exercises the changed ESM CLI entry check, not merely an imported test helper.                                                                                                                                                                                                                                                                              |
| Generated L2 `integrated-all-checks.js`, headless Chromium with existing Playwright Core 1.54.2                                                   | Pass: **five positive views**, zero errors, both rendered-editor worker round-trips; CSS-negative control verifies **exactly seven CSS/layout failures**. Non-root URL prefix, production CSP, no `bypassCSP`.                                                                                                                                                    |
| Real Vite builder/watch hook with temporary input/output fixtures                                                                                 | Pass with 1.5-second edit spacing: both environments must build before ready; a host-only rebuild signals ready; a syntax error does not; repair does. Earlier faster-edit fixture runs timed out waiting for subsequent events; see limits below.                                                                                                                |
| Asset parity against the supplied webpack-host VSIX                                                                                               | No added/removed non-JavaScript runtime asset, excluding webpack's extracted license-comment files. Three debug JSON files differ only in formatting and parse to identical values. Manifest changes are expected; licenses are retained inline in emitted JavaScript.                                                                                            |

The worker probe initially expected plain JSON rather than canonical EJSON, then initially
failed to handle the fixture server's socket reset during worker shutdown. Both failures were
in the temporary test fixture, corrected before the successful full run; neither is a product
test failure. No `npm run package` was run and no default VSIX/report was overwritten.

## Findings

### S5-F01: the Kubernetes laziness guard stops at the thin loader, before the code it awaits

- **Severity:** medium (verification gap; not a demonstrated current eager-load regression).
  **Validation:** confirmed, high confidence, by a full L1 run over mutated packaged bytes
  with matching copied report hashes, edges and chunk sizes.
- **Where:** [inspect.cjs:717](../../../../build/verification/inspect.cjs#L717), particularly
  the static closure rooted at `main` on line 727; the new control in
  [prove-inspection.cjs](../../../../build/verification/prove-inspection.cjs);
  [main.ts:22](../../../../main.ts#L22). Introduced in `770446c2`.
- **What is wrong.** `main.mjs` is intentionally a thin loader. Its static imports contain
  only `chunk-B91zb93r.mjs`; it then **top-level-awaits**
  `extension-D6RjgaLh.mjs`. Everything statically imported by that implementation is loaded
  before the extension can activate, even though it is outside `main.mjs`'s imports-only
  closure. The new SDK guard checks only the latter. It therefore does not establish its
  documented purpose, "keep the SDK behind a dynamic import."

  The reviewer added `import './dist-D-9mhZ5s.mjs';` to the actual extension implementation
  chunk, added that edge to its copied `imports`, and refreshed the copied SHA-256 and
  chunk byte count. That target contains `@kubernetes/client-node`. The implementation's
  imports-only closure then included the SDK, but **full `inspect()` still passed**.
  The existing negative control attaches the SDK directly to the thin loader's `imports`;
  it misses the realistic regression of an eager import in extension code.

  The original implementation's static closure was separately checked and excludes this SDK.
  Do not read this finding as evidence of today's activation measurements being wrong.

- **Solutions:**
  1. Identify the extension implementation by its facade/module identity, require that the thin
     loader imports it as expected, and check the imports-only union of the loader and
     implementation closures.
     **Pros:** tests the startup boundary this architecture actually has; retains legitimate
     lazy discovery chunks. **Cons:** introduces an explicit relationship between L1 and the
     thin-loader design; needs a fixture for a missing/changed implementation boundary.
  2. Add a real-host module-load assertion that the Kubernetes chunk is not evaluated during
     an activation with no discovery sources.
     **Pros:** observes execution rather than just metadata. **Cons:** slower and more
     intrusive; depends on a controlled profile and is not an offline L1 replacement.
- **Recommended:** option 1, plus a full-VSIX negative control for an eager SDK edge from
  the awaited implementation, not just from `main.mjs`. Do not traverse every dynamic
  child for this check: that would also reject the intended lazy discovery graph.
- **Copilot comment:** none.
- **Author decision:** _pending_

### S5-F02: concurrent windows can expose a truncated TS-plugin stub manifest to a reader

- **Severity:** low (rare first-install/replacement race; no data loss).
  **Validation:** confirmed, high confidence for the filesystem interleaving; occurrence
  frequency in real multi-window VS Code sessions was not measured.
- **Where:** [tsPluginStub.ts:57](../../../../src/documentdb/playground/tsPluginStub.ts#L57),
  especially the snapshot at line 61 and in-place `writeFileSync` at line 77;
  [ClustersExtension.ts:397](../../../../src/documentdb/ClustersExtension.ts#L397).
  Introduced/expanded by the new manifest and replacement writer in `776f3a87`.
- **What is wrong.** Writing `index.cjs` before `package.json` is correct for a single
  writer, but does not make publication atomic across windows. Each window reads the
  files once before writing. If both see absence or old contents, one can complete setup
  while the other later rewrites the same final filenames from its stale snapshot.
  `writeFileSync(path, content)` opens with truncation; it is not an atomic replace.

  A deterministic probe used the actual writer transpiled without product changes:
  window A read absent files and paused at directory creation; window B completed the
  writer; A resumed and opened the final `package.json` with `w`. Before A's write, a
  fresh Node process resolving the package by name failed with
  **`ERR_INVALID_PACKAGE_CONFIG`**. A then finished, and the next writer check returned
  `existed`. The final disk contents being correct does not repair a TS server that
  already failed to load the plugin. Truncating `index.cjs` has the analogous incomplete
  module-read risk.

  The per-window `tsRestarted` flag and two-second restart delay are not cross-process
  synchronization. The broader single-file stub had an in-place-write risk before this
  stage; Stage 5 adds a package manifest reader and content-based replacement to that
  lifecycle. This is not a claim that all ordinary first installs fail.

- **Solutions:**
  1. Write each changed file to a unique sibling temporary file, then atomically rename it
     over the final filename; publish the complete entry before the manifest, and remove
     the legacy entry only after successful publication.
     **Pros:** readers see complete old/new files, including with multiple writers; a small,
     local change. **Cons:** needs temporary-file cleanup and Windows replacement tests;
     filesystem errors must still propagate to the existing read-only-install UX.
  2. Deliver the plugin as a normal packaged dependency, as tracked in #548, eliminating
     runtime mutation of the extension install.
     **Pros:** also addresses read-only installs. **Cons:** separate packaging/release work,
     substantially larger than this stage's stub migration.
- **Recommended:** option 1 here, with a barrier-controlled two-writer/reader regression
  test, including stale-stub replacement. Keep the existing `created`/`replaced`/`existed`
  semantics and explicit EACCES/EROFS handling; option 2 remains the longer-term solution.
- **Copilot comment:** none.
- **Author decision:** _pending_

## Independent sweep

- **Activation, failure and deactivation.** The packaged manifest is `"type": "module"` with
  `"main": "./main.mjs"`. VS Code 1.109.0's
  [ESM loader](https://github.com/microsoft/vscode/blob/1.109.0/src/vs/workbench/api/node/extHostExtensionService.ts)
  awaits the module import; a top-level extension-chunk evaluation exception rejects it,
  rather than returning a successful API or being swallowed by the later activation
  telemetry wrapper. The emitted loader preserves named `activate`/`deactivate` exports and
  runtime `STOP_ON_ENTRY`. `mainFileLoad` now brackets the awaited implementation load,
  not the tiny static runtime import; it is not comparable with webpack's hoisted-require
  zero. Deactivation still delegates to the existing accumulated-telemetry flush.
- **Cold-start URI ordering.** The manifest retains `onUri`. VS Code's pinned
  [ExtensionUrlHandler](https://github.com/microsoft/vscode/blob/1.109.0/src/vs/workbench/services/extensions/browser/extensionUrlHandler.ts#L230)
  buffers the URI **before** `activateByEvent`, and `registerExtensionHandler` drains that
  buffer when registration arrives. In this extension,
  [activateInternal](../../../../src/extension.ts#L75) awaits cluster-support activation
  before registering the URI handler, and
  [activateClustersSupport](../../../../src/documentdb/ClustersExtension.ts#L272) awaits
  Azure Resources registration before installing the trees/commands. A slower awaited
  module import alone does not make that buffered URI disappear. Reviewed
  [microsoft/vscode-cosmosdb#3288](https://github.com/microsoft/vscode-cosmosdb/pull/3288):
  its fix concerns processing a URI before a separately delivered Azure API is ready,
  not proof that any async entry loses a URI. Actual OS URI delivery, trust prompts,
  failure paths and real Azure availability remain G5 checks; no cold-start product
  success is claimed from source reasoning.
- **Worker and CommonJS interop.** The manager now resolves the worker from the stable
  extension root, not from whichever chunk holds its class. The real packaged worker
  loaded its shared chunks without checkout `node_modules`, ran the shell/Babel path and
  performed a loopback query. Rolldown's shared runtime exports a
  `createRequire(import.meta.url)` helper; a second handwritten require banner is not
  needed. The host-only defines and uniquely named dirname/filename bindings avoid
  collisions with dependencies such as `open`; the CJS plugin keeps native `__dirname`.
  Production `keepNames` is set for both environments, and the ObjectId/name-sensitive
  runtime paths exercised here survived minification.
- **Plugin resolution and degraded installs.** The contributed package name matches
  `TS_PLUGIN_PACKAGE_NAME`; its `.cjs` entry forwards to a `.cjs` factory, while the nearer
  manifest explicitly declares CommonJS. Runtime stub creation is a continuation of the
  existing packaging workaround, not a newly shipped `node_modules` tree. The real plugin
  reads the copied shell declarations successfully. Read-only errors are propagated to the
  existing status-bar/retry/telemetry path, not converted to `existed`. Old stub replacement
  and no-op behavior have passing tests; cross-window atomicity is the separate S5-F02.
- **Externals and optional features.** Read the supplied 19 baseline/removal experiments
  and all 24 source-callsite records. The four removed entries (`aws4`, `cpu-features`,
  `pg-native`, `vs`) changed no bytes/modules in those experiments; `supports-color`
  retains a real guarded diagnostic probe. The packaged AST, accounting for minified
  aliases of `createRequire`, contains the expected optional targets plus Node and VS Code,
  not type-only package imports. Guarded missing dependencies remain runtime failures or
  documented fallbacks, not empty bundled modules. `ssh2` is lazy but unguarded; Babel's
  preset package.json read is in its optional config-error path. Neither should be
  described as universally safe just because activation passes.

  The shell rewriter explicitly disables Babel and browserslist configuration. Actual
  isolated worker rewriting passed, supporting omission of webpack's browserslist
  context modules. The audit's PAC/proxy-path limitation remains latent, not newly tested
  here. Native authentication/compression/encryption success was not demonstrated; the
  VSIX still ships no optional native packages, as with the baseline.

- **Dual-package hazards beyond BSON.** The actual report contains both ESM and CommonJS
  Azure identity/core modules; duplication was not assumed absent. The CJS identity
  consumer is the older Azure-auth Azure DevOps credential provider; the extension's
  managed-identity path imports ESM. Their credential boundary is structural, and the
  examined extension error classification does not use cross-copy identity
  `instanceof` checks or register identity plugins in one copy for consumption in the
  other. No concrete broken exchange was established, so duplication alone is not a
  finding. The azext-utils registration/error/reporter modules have one ESM implementation
  in the report, not a second unregistered CJS singleton. Real authentication/discovery
  still needs operator coverage.
- **Telemetry and environment substitution.** The ESM telemetry reporter is present in
  the shipped graph. The ordinary non-debug reporter constructed during L3 with telemetry
  disabled; ten timing launches independently exercised azext-utils' **DebugReporter**
  and parsed activation events. DebugReporter does not send telemetry, so this proves
  local instrumentation, not ingestion by a remote service. Only NODE_ENV, IS_BUNDLE and
  DEVSERVER are defined by the host build; DEBUGTELEMETRY, STOP_ON_ENTRY, KUBECONFIG,
  identity endpoints and proxy environment reads remain runtime inputs. No whole
  `process.env` replacement was found.
- **L1 provenance and allowances.** Host closures follow static and dynamic edges with
  cycle handling, and require their own host hash ownership. `.cjs` is parsed as CJS even
  though the combined report's format is `module`. S3-F05's ownership hole and S4-F01's
  missing-runtime-asset cases stay covered by passing negative controls. S5-F01 is
  specifically the startup-only SDK predicate, not a failure of full-graph BSON counting.

  The Babel exception is narrower than the original S4-F02 Monaco syntax-slot exception:
  it requires the exact owning module ID, named CommonJS declarator/factory, exported
  `import_` function, sole parameter, single return statement, and exactly one occurrence.
  Changed arguments, extra writes, missing helper, extra matching import and non-owning
  chunks are rejected by the passing tests/controls. Its remaining limit is explicit:
  it does not prove interprocedural provenance of every possible future argument.
  The current caller and disabled-config use were inspected; no unvalidated allowlist
  defect is promoted to a finding.

- **BSON and earlier reviews.** S1-F06's obsolete bootstrap references are removed.
  S2-F04's namespace hazard is removed by the typed plain object. S2-F03's test
  ESM/CommonJS mock split is not declared fixed merely because production now uses ESM.
  S3-F03's webpack build-time import-meta rewrite is gone; the emitted ESM keeps runtime
  import-meta semantics. S3-F01's package helper layout assumption remains latent and
  outside this diff; the actual TS plugin has its own correct path. S3-F08's probes now
  reuse the real Vite host environment, but a vendored BSON copy under an unknown module
  path remains outside the detector's stated guarantee.
- **Plan deviations and development tooling.** The plan's literal tsconfig requirement is
  no `baseUrl` and no `"*"` mapping, not a ban on all `paths`. The two precise type-only
  mappings have an inline explanation and preserve declarations for untyped ESM wrappers.
  The concurrently written execution record explains the separate CJS-plugin environment,
  runtime-stub layout, generated require helper and removal of the webpack host fallback;
  the fallback task was conditional. The views fallback is correctly renamed `.cjs`.
  The ESM harness CLI was actually run, and the L3 ESM-import injector was proved in a
  real host. Watch readiness was exercised separately with the real builder hook;
  F5 task integration was not. The coordinator must commit/reconcile the execution and
  verification record and record author decisions before treating the stage as complete.

## Verification limits

- This is **Case 1**, a still-working/draft stage review, not a request to mark the PR ready.
  The full Case 2 suite, **including `prettier-fix`**, was deferred until ready for review.
  No repository-wide lint, full product unit suite, l10n or packaging command was run by
  this reviewer. Requested L1-L3 verification was run in addition to the targeted tests.
- No actual `vscode-webview://` panel, F5 UI, cold-start OS URI, Windows/macOS, native
  optional connection, real Kubernetes/Atlas/Azure backend or ADO/signing run was exercised.
  The loopback worker and standalone TypeScript language-service probes are stronger than
  module-load-only checks, but do not replace the real-editor/backend G5 checklist.
- L2 used existing headless Chromium/Playwright Core and the supplied user-local libraries,
  with host-requirement validation skipped, **not** CSP bypass. It was not an integrated
  browser UI or real workbench run. L2-dev's 42-route matrix was not rerun by this reviewer.
- Earlier watch-fixture runs with immediate/short-spaced edits timed out waiting for
  subsequent change events. Spaced edits exercised all readiness/error/recovery states
  successfully. The cause of the fast-edit event loss was not established; this is not
  evidence that the complete F5/watch loop or rapid-save behavior is verified.
- The TS-stub race uses controlled filesystem scheduling, including a fresh reader process;
  it does not measure real-world frequency. The L1 mutation changes artifact bytes and
  matching copied metadata, not a new source build. Both limits are reflected in severity.
- The exact-tip CI run **37361229466** was not yet complete at the final status check:
  Code Quality & Tests, Build & Package and Installed VSIX activation (L3) succeeded;
  VSIX inspection (L1) had no conclusion yet. A final all-green CI result is not claimed.
  The coordinator's earlier green CI/full-suite results were
  inputs, not substituted for the independent checks above.
- A separate different-vendor validation pass within this review was not supplied.
  All author decisions remain for the coordinator/operator, not the reviewer.

## Summary for G5

| Severity | Count |
| -------- | ----- |
| critical | 0     |
| high     | 0     |
| medium   | 1     |
| low      | 1     |
| info     | 0     |

The packaged ESM host activates, reports debug telemetry, and passes the existing L1/L3
positive and negative checks. Independent artifact probes also exercised the worker's shell
and query path, plugin completions/hover, and all five production webviews. On this machine,
the median measured activation total improved from **496 ms to 334 ms**.

Fix the false assurance in the SDK-laziness gate (**S5-F01**) and decide the small concurrent
stub-publication fix (**S5-F02**). No additional current normal-path runtime regression was
confirmed. The automated results do **not** close G5: complete the installed-VSIX operator
checks, reconcile/commit the execution record and record author decisions before advancing.
