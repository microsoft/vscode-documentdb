---
feature: connectivity-troubleshooter
kind: plan
status: active
created: 2026-11-05
updated: 2026-11-05
---

# Iteration 03 — Rename to connection diagnostics

Rename the internal names of the connectivity troubleshooter to **connection diagnostics**, and
the existing error-translation layer (`ConnectionDiagnosticsService`) to **error explanation**, so
that the two no longer collide. Recorded as decision 0051. Draft PR #1066.

This file holds the accepted plan (below) and a done note under each work item.

## Operator decisions (binding)

1. **Full rename now.** Operator: "I'll do the full rename now, as it's cheap only now." Nothing
   has shipped: the package is not on npm, the feature is not on `main` or in any release tag.
2. **Feature vocabulary is "diagnostics"** (`connection-diagnostics`, `connectionDiagnostics`,
   `Diagnostics…`). The command stays `diagnoseConnection`.
3. **Rename the existing error-translation layer** (`ConnectionDiagnosticsService` and its
   providers) so its name no longer collides with the feature. Target vocabulary: **error
   explanation** (it already exposes `explain()`, `ConnectionExplanation`,
   `explainOperationFailure`).
4. **Its shipped telemetry is renamed too.** Operator: "we don't evaluate the telemetry yet so we
   can ignore the old data it just shipped recently."
5. **The feature's own telemetry events use the `diagnoseConnection.` prefix**, so they do not share
   a namespace with any other event.
6. **Same PR (#1066)**, the service rename as its own work item.
7. **The feature docs folder is NOT renamed:** `docs/ai-and-plans/features/connectivity-troubleshooter/`
   keeps its name and its `feature: connectivity-troubleshooter` front matter.
8. No user-visible text changes. The UI already says Diagnose Connection / Connection diagnosis /
   Connection diagnostics (decision 0038).

## Keep list (never rename)

- Generic troubleshooting for other features: `dockerTroubleshooting` and the Docker guide label
  and link (`src/webviews/documentdb/localQuickStart/**`), `Links.SrvDnsTroubleshooting` and the URL
  `user-manual/troubleshooting-srv-dns` (`src/constants.ts`, `SrvDnsDiagnosticsProvider` messages),
  the comment in `src/documentdb/ClustersClient.ts` ("local instance" troubleshooting copy), all
  `docs/user-manual/*troubleshooting*` pages, `docs/index.md`, `docs/release-notes/**`,
  `CHANGELOG.md`, `l10n/bundle.l10n.json`.
- `docs/ai-and-plans/features/connectivity-troubleshooter/` (folder name, front matter `feature:`
  id, links to it), all `iterations/**` files in any feature, older decision entries' text and
  headings, `docs/analysis/**`. Only fix links that a move would break.
- The command ID `vscode-documentdb.command.diagnoseConnection` and everything decision 0038 already
  renamed.
- Unrelated "diagnostic" names: `diagnosticCredentialRead.ts`, query insights `diagnosticBadge*`,
  the `[Diagnostics]` dev commands in `package.json`, VS Code `Diagnostic` APIs.

## Rename map — feature (troubleshooter → connection diagnostics)

Paths (`git mv`):

| From | To |
| --- | --- |
| `packages/documentdb-js-connectivity-troubleshooter/` | `packages/documentdb-js-connection-diagnostics/` |
| `src/troubleshooter/` | `src/connectionDiagnostics/` |
| `src/troubleshooter/runTroubleshooter.ts` (+ `.test.ts`) | `src/connectionDiagnostics/runConnectionDiagnostics.ts` (+ `.test.ts`) |
| `src/webviews/documentdb/connectivityTroubleshooter/` | `src/webviews/documentdb/connectionDiagnostics/` |
| `…/ConnectivityTroubleshooter.tsx` (+ `.test.tsx`) | `…/ConnectionDiagnostics.tsx` (+ `.test.tsx`) |
| `…/connectivityTroubleshooter{Types,Router,Controller}.ts` (+ tests) | `…/connectionDiagnostics{Types,Router,Controller}.ts` (+ tests) |
| `…/connectivityTroubleshooter.scss` | `…/connectionDiagnostics.scss` |
| `…/TroubleshooterResultCard.tsx` (+ `.test.tsx`, `.intent.test.tsx`) | `…/DiagnosticsResultCard.tsx` (+ tests) |
| `…/TroubleshooterRowDetails.tsx` | `…/DiagnosticsRowDetails.tsx` |
| `…/troubleshooterPanelSession.ts` | `…/diagnosticsPanelSession.ts` |
| `…/troubleshooterViewState.ts` | `…/diagnosticsViewState.ts` |
| `src/commands/troubleshootConnection/troubleshootConnection.ts` (+ `.test.ts`) | `src/commands/diagnoseConnection/diagnoseConnection.ts` (+ `.test.ts`) |

Package metadata: name `@documentdb-js/connection-diagnostics`; `repository.directory`; `test`
script `--project documentdb-js-connection-diagnostics`; root `tsconfig.json` reference;
`vitest.config.ts` project `name` and `packageRoot(...)`; `build/verification/package-checks/calls.mjs`
key and `load(...)`; `package-lock.json` via `npm install` (do not hand-edit), which also relinks
`node_modules/@documentdb-js/…`; the relative import of `…/src/test/wireResponder` in
`src/troubleshooter/test/fixtures.ts`. Version stays `0.1.0`.

Identifier rules (apply case-preserving):

| Pattern | Becomes | Examples |
| --- | --- | --- |
| `ConnectivityTroubleshooter` / `connectivityTroubleshooter` | `ConnectionDiagnostics` / `connectionDiagnostics` | `ConnectivityTroubleshooterConfiguration` → `ConnectionDiagnosticsConfiguration`, `runConnectivityTroubleshooter` → `runConnectionDiagnostics`, `openConnectivityTroubleshooter` → `openConnectionDiagnostics`, `RunConnectivityTroubleshooterOptions` → `RunConnectionDiagnosticsOptions` |
| `Troubleshooter` / `troubleshooter` as a name part | `Diagnostics` / `diagnostics` | `TroubleshooterRun` → `DiagnosticsRun`, `TroubleshooterSetup` → `DiagnosticsSetup`, `troubleshooterSessionId` → `diagnosticsSessionId`, `troubleshooterHost` → `diagnosticsHost`, `buildTroubleshooterSetup` → `buildDiagnosticsSetup`, `maskTroubleshooterInput` → `maskDiagnosticsInput`, `configureTroubleshooterTelemetry` → `configureDiagnosticsTelemetry`, `troubleshooterCard` (incl. SCSS classes) → `diagnosticsCard`, `troubleshooterScenario` → `diagnosticsScenario` |
| `runTroubleshooter` (package export) | `runDiagnostics` | |
| `TroubleshooterCancelledError` / `TroubleshooterConfigurationError` | `DiagnosticsCancelledError` / `DiagnosticsConfigurationError` | |
| `TroubleshootTarget` | `DiagnosticsTarget` | |
| `troubleshootConnection` | `diagnoseConnection` | command handler function, folder, file |
| Prose in comments, JSDoc, test titles, READMEs | "connection diagnostics" (the feature), "the diagnosis run" / "a diagnostics run" (one run) | "the connectivity troubleshooter" → "connection diagnostics" |

Wire and persisted IDs (all unshipped, change freely):

| From | To |
| --- | --- |
| `callWithTelemetryAndErrorHandling('connectivityTroubleshooter.run' …)` in `runTroubleshooter.ts` | `'diagnoseConnection.run'` |
| `'connectivityTroubleshooter.runStarted'` in `telemetry.ts` | `'diagnoseConnection.runStarted'` |
| telemetry properties `troubleshooterSessionId`, `troubleshooterRunCorrelationId` | `diagnosticsSessionId`, `diagnosticsRunCorrelationId` |
| `telemetrySource: 'troubleshootConnection'` | `'diagnoseConnection'` |
| `SrvResolutionSurface` value `'troubleshooter'` (`src/documentdb/srv/prepareDriverConnectionString.ts`) and every `surface: 'troubleshooter'` | `'connectionDiagnostics'` |
| explanation-service request `source?: 'troubleshooter'` and its users (`contextHints.ts`, tests) | `'connectionDiagnostics'` |
| survey activation source `'connectivityTroubleshooter'` (`surveyTypes.ts`, `surveyTelemetry.ts`, tests) | `'connectionDiagnostics'` |
| `webviewName: 'connectivityTroubleshooter'`, `WebviewRegistry` key, `appRouter` router key and the `viewName !==` check, `trpcClient.connectivityTroubleshooter.*` | `connectionDiagnostics` (automatic `…webview.event.<name>.*`, error and RPC event names follow) |
| `panelViewType: 'vscode-documentdb-connectivity-troubleshooter'` | `'vscode-documentdb-connection-diagnostics'` (no serializer; not persisted) |
| L2-dev route `/connectivityTroubleshooter/…`, scenario keys, `Scenario<'connectivityTroubleshooter'>`, the `reports\/(…|connectivityTroubleshooter)` regex in `build/verification/browser/harness.ts`, `runtime.ts`, fixtures (`'stage0-troubleshooter-session'` → `'stage0-diagnostics-session'`), `troubleshooterListTop` etc. | `connectionDiagnostics` / `diagnostics…` |

## Rename map — error-translation layer (connection diagnostics → error explanation)

| From | To |
| --- | --- |
| `src/services/connectionDiagnosticsService.ts` (+ `.test.ts`) | `src/services/errorExplanationService.ts` (+ `.test.ts`) |
| `ConnectionDiagnosticsService`, `ConnectionDiagnosticsServiceImpl` | `ErrorExplanationService`, `ErrorExplanationServiceImpl` |
| `ConnectionDiagnosticsProvider` | `ErrorExplanationProvider` |
| `ConnectionDiagnosticsRequest` | `ErrorExplanationRequest` |
| `ConnectionDiagnosis` (service result with `providerId`) | `ErrorExplanationResult` |
| `DiagnosisIdentifier`, `DiagnosisIdentifierKind` | `ExplanationIdentifier`, `ExplanationIdentifierKind` |
| `SrvDnsDiagnosticsProvider`, `EntraDiagnosticsProvider`, `KubernetesDiagnosticsProvider`, `QuickStartDiagnosticsProvider`, `AtlasDiagnosticsProvider` (classes and files, + tests) | `SrvDnsErrorExplainer`, `EntraErrorExplainer`, `KubernetesErrorExplainer`, `QuickStartErrorExplainer`, `AtlasErrorExplainer` |
| telemetry event `connectionDiagnostics.explained` | `errorExplanation.explained` |
| telemetry properties `diagnosisProviderId`, `diagnosisSource` (service, `EntraDiagnosticsProvider`, `ClusterItemBase`, `BaseExtendedTreeDataProvider`, tests) | `explanationProviderId`, `explanationSource` |
| local variables such as `diagnosis` holding a service result | `explanation` (only where it reads naturally; do not touch unrelated `diagnosis` wording of the feature) |
| unchanged | `ConnectionExplanation`, `explain()`, `explainOperationFailure`, provider `id` values |

## Work items

Order matters: RN-1 first, so the old `ConnectionDiagnosticsService` never coexists with the new
`connectionDiagnostics` feature names. Every item ends with `npm run build` green.

### RN-1 — Rename the error-translation layer to error explanation

Suggested model: terra (mechanical, about 53 files, compiler-checked).

- Scope: the "error-translation layer" table above, in `src/**`, `packages/**` (if any), and the
  maintained docs `.github/skills/error-translation/SKILL.md` (including its front-matter
  `description`), `.github/skills/tree-cluster-architecture/SKILL.md`, and maintained (non-iteration)
  feature docs that name the service: `docs/ai-and-plans/features/sovereign-clouds/README.md`,
  `…/srv-dns-fallback/README.md`, `…/srv-dns-fallback/future-work.md`,
  `…/connectivity-troubleshooter/README.md` and `design.md`. Leave `decisions.md` files and
  iterations as history.
- The feature's `'troubleshooter'` source value is NOT changed here (RN-5 does it).
- Accept: `rg -w "ConnectionDiagnosticsService|ConnectionDiagnosticsServiceImpl|ConnectionDiagnosticsProvider|ConnectionDiagnosticsRequest|ConnectionDiagnosis|DiagnosisIdentifier|DiagnosisIdentifierKind|diagnosisProviderId|diagnosisSource|[A-Za-z]+DiagnosticsProvider" src packages build .github`
  returns nothing; `connectionDiagnostics.explained` appears nowhere outside history docs.
- Tests: `npx vitest run src/services src/documentdb/srv src/documentdb/auth src/plugins src/tree src/webviews/_integration src/troubleshooter`.

> **Done (2026-11-05), commit `f464b089`** (model: terra): renamed `ConnectionDiagnosticsService` to
> `ErrorExplanationService`, the five providers to `*ErrorExplainer` (files moved with `git mv`),
> the request, result and identifier types, the `errorExplanation.explained` event and the
> `explanationProviderId` / `explanationSource` properties; local `diagnosis` variables holding a
> service result became `explanation`. Maintained docs and the two skills follow. No localized string
> changed. Left unchanged and escalated: the service's `[ConnectionDiagnostics]` Output debug prefix
> (not on the map, and Output text). No tests added; 155 files / 3,299 tests passed, build green.

### RN-2 — Move folders and files; fix paths and the package name only

Suggested model: terra.

- Scope: every row of the feature Paths table and the Package metadata paragraph. Update import
  specifiers (`@documentdb-js/connection-diagnostics`), relative import paths, `vi.mock` paths,
  the `WebviewRegistry` lazy `import(…)` path, SCSS imports, and `src/documentdb/ClustersExtension.ts`.
  Run `npm install` to refresh `package-lock.json` and the workspace symlink; delete the stale
  `dist/` and `tsconfig.tsbuildinfo` of the old package folder if they remain (they are build
  output, not tracked).
- Do **not** rename identifiers, string IDs or prose in this item, so git detects every move.
- Accept: `git diff -M --cached --stat` shows renames, not delete + add; the old folders no longer
  exist; build is green.
- Tests: `npx vitest run src/connectionDiagnostics src/webviews/documentdb/connectionDiagnostics src/commands/diagnoseConnection packages/documentdb-js-connection-diagnostics`.

> **Done (2026-11-05), commit `a2d08bda`** (model: terra): 123 files moved as renames (no delete +
> add); the package is `@documentdb-js/connection-diagnostics`, with `repository.directory`, the
> `test` project, the root `tsconfig.json` reference, the `vitest.config.ts` project,
> `calls.mjs` and `package-lock.json` (through `npm install`) updated. Import specifiers, relative
> paths, `vi.mock` paths, the lazy `WebviewRegistry` import, the source-reading test paths and the
> StatusList README link follow. No tests added; 53 files / 1,517 tests passed, build green.

### RN-3 — Rename the package's public API and internals

Suggested model: terra.

- Scope: in `packages/documentdb-js-connection-diagnostics/**`, all identifiers and prose per the
  identifier rules (`runTroubleshooter` → `runDiagnostics`, `Troubleshooter{Run,Input,Event,Io,Clock,Timeouts,Report,…}`
  → `Diagnostics…`, both error classes, error messages that say "troubleshooter" if any), the
  package `README.md` (title, examples, prose), `CHANGELOG.md` only if it names the package, and
  every consumer's import list and usages in `src/**` and `build/**`.
- Accept: `rg -i troubleshoot packages/documentdb-js-connection-diagnostics` returns nothing.
- Tests: the package tests plus `npx vitest run src/connectionDiagnostics`.

> **Done (2026-11-05), commit `6847c1a7`** (model: terra): `runTroubleshooter` became
> `runDiagnostics`, the `Troubleshooter*` types and both error classes became `Diagnostics*`, and the
> package README follows; consumers in `src/**` updated. Decision (confidence 90%): the
> `knownErrorNames` allowlist in `outputTrace.ts` mirrors the error classes' `name`, so its two
> strings follow the class rename. Review: the subagent added a regression test to
> `outputTrace.test.ts`; removed as outside the item. 484 package and output-trace tests passed,
> build green.

### RN-4 — Rename extension identifiers and prose

Suggested model: sol (largest item, about 750 occurrences; prose needs judgement so comments read
naturally).

- Scope: identifiers, file-local names, JSDoc, comments and test titles in
  `src/connectionDiagnostics/**`, `src/webviews/documentdb/connectionDiagnostics/**`,
  `src/commands/diagnoseConnection/**`, and the peripheral files that mention the feature:
  `src/tree/documentdb/diagnosticCredentialRead.ts`, `src/tree/documentdb/ClusterItemBase.ts`,
  `src/tree/connections-view/DocumentDBClusterItem.ts`, `src/tree/azure-resources-view/**`,
  `src/plugins/**` (Atlas, Azure VM, vCore, RU, Kubernetes items, `portForwardTunnel.ts`,
  `promptForLocalPort.ts`, Kubernetes tests), `src/documentdb/auth/{createAuthHandler,authCallerPolicy}.ts`,
  `src/services/connectionReachabilityService.ts`, `src/webviews/_integration/**` (TypeScript
  names only), `packages/vscode-ext-webview-fluentui/src/components/StatusList/README.md` (the link
  to `TroubleshooterRowDetails.tsx`).
- Do **not** change any string literal that is a wire or persisted ID (RN-5 does those), and do not
  touch the keep list.
- Accept: outside RN-5's ID literals and the keep list, `rg -i troubleshoot src packages` returns
  nothing.
- Tests: `npx vitest run` over every folder and file touched.

> **Done (2026-11-05), commit `1a417221`** (model: sol): renamed the extension's identifiers,
> JSDoc, comments and test titles in 72 files (for example `runConnectionDiagnostics`,
> `openConnectionDiagnostics`, `DiagnosticsOutputTrace`, `DiagnosticsEntryPoint`, the
> `diagnoseConnection` handler), the source-text activation test's regex, and the `nonNullValue`
> file marker. Decision (confidence 85%): `troubleshooterSessionId` and
> `troubleshooterRunCorrelationId` are telemetry property names that also name fields flowing into
> telemetry, so every occurrence moved to RN-5 rather than splitting one name across two commits.
> No tests added; 117 files / 2,391 tests passed, build green.

### RN-5 — Rename wire and persisted IDs

Suggested model: terra.

- Scope: the whole "Wire and persisted IDs" table, including tests that assert them, the survey
  allowlist, the L2-dev harness, scenarios, fixtures and runtime under `build/verification/browser/**`,
  and `build/verification/README.md` (route names and `troubleshooter…` identifiers in its
  text).
- Accept: `rg -i "troubleshoot" src build packages` returns only keep-list hits; the telemetry event
  names in code are exactly `diagnoseConnection.run`, `diagnoseConnection.runStarted`.
- Tests: `npx vitest run build/verification src/services/survey src/webviews/_integration src/connectionDiagnostics src/webviews/documentdb/connectionDiagnostics src/commands/diagnoseConnection src/documentdb/srv src/documentdb/auth`.
  Then the orchestrator runs the L2-dev scenarios for `connectionDiagnostics` in dark, light and
  high-contrast and confirms every scenario passes with no errors.

> **Done (2026-11-05), commit `d37c288b`** (model: terra): every row of the wire and persisted IDs
> table, the L2-dev harness, scenarios, fixtures, runtime and `build/verification/README.md`.
> Telemetry event names in code are exactly `diagnoseConnection.run` and
> `diagnoseConnection.runStarted`. Decision (confidence 85%): the survey design doc's two tables
> listing the `connectivityTroubleshooter` activation-source value were updated to
> `connectionDiagnostics`, since the value changed. No tests added; 67 files / 2,047 tests passed,
> build green. L2-dev: routes are `/connectionDiagnostics/<scenario>/<theme>` (no `/scenarios/`
> prefix); all 28 scenarios in dark, light and high-contrast (84 routes) were ready with no errors
> and every assertion passed at 1280 × 900; the old route returns 404.

### RN-6 — Update maintained feature docs for the new paths and names

Suggested model: luna.

- Scope: `docs/ai-and-plans/features/connectivity-troubleshooter/README.md` and `design.md`:
  front-matter `paths:` globs, the "Key files" lists, package name, folder names, symbol names,
  telemetry event and property names. Add one line to the existing top note: internal names were
  renamed from *troubleshooter* to *connection diagnostics* in RN-1…RN-5 (decision 0051). Leave the
  folder name, `feature:` id, and `docs/ai-and-plans/README.md` index link unchanged. Do not edit
  iteration files or older decision text.
- Accept: every path in those two files exists; `rg -n "src/troubleshooter|connectivityTroubleshooter/|troubleshootConnection/|connectivity-troubleshooter\b" README.md design.md`
  (in that folder) matches only the docs folder's own name.
- No tests (documentation only).

> **Done (2026-11-05), commit `a71a214d`** (model: luna): front-matter `code:` globs, Key files,
> folder tree, package name, symbols, telemetry names and IDs in README and design; the top note now
> says the command ID changed in 0038 and internal names were renamed in RN-1…RN-5 (0051), replacing
> "Source paths and implementation names stay", which had become false (confidence 80%). Also, by
> orchestrator decision (confidence 80%), the "troubleshooter's" sentence in
> `.github/skills/error-translation/SKILL.md`. Links to older decision anchors keep their text. The
> orchestrator re-aligned one folder-tree column.

### RN-7 — Record decision 0051

Orchestrator writes it (no subagent), docs-only commit. Appends decision 0051 to `decisions.md`,
superseding the "Deliberately unchanged" list of 0038 except the docs folder.

> **Done (2026-11-05), commit `a52a4ffb`** (orchestrator): appended 0051 and its index row; 0038's
> status line says "Partly superseded by 0051". Decision (confidence 75%): 0038's index status
> also reads "Partly superseded by 0051", following the file's own rule that a reversal changes the
> status above; I would revert that cell if "edit 0038 only" was meant to exclude the index. The
> index table's column padding is left for `prettier-fix` at handoff.

### RN-8 — Residual audit and final checks

Orchestrator, no subagent. Residual `rg` searches for `troubleshoot` and the old error-explanation
names, then the final checks.

> **Done (2026-11-05)** (orchestrator): the residual `troubleshoot` search matches only keep-list
> files (generic troubleshooting in `src/constants.ts`, `ClustersClient.ts`, `SrvDnsErrorExplainer*`,
> Local Quick Start; `l10n/bundle.l10n.json`; the user manual, release notes and `docs/index.md`; this
> docs folder's id, the old-name note and decision anchors; iteration and decision history; generic
> troubleshooting in other features' docs). Two maintained docs name this feature's work items as
> "connectivity troubleshooter WI-…" (`connections-tree/README.md`, a dated row in
> `webview-fluentui-package/README.md`); left as history. The old explanation-layer names match only
> decisions and iterations. Checks: `npm run typecheck:tests` passed; Vitest over every touched
> folder passed (254 files, 5,633 tests); `npm run l10n:check` fails on drift that predates this
> iteration (`Took`, `in {0}`, `after {0}`, `< {0}`, `Ping {0}` from WI-30/31/33 in `7a1bfddc`; the
> bundle is unchanged by this iteration and no localized string changed), so it was not regenerated.
> Case 2 checks were deferred: PR #1066 is a draft.

## Not in scope

- Renaming the docs folder `docs/ai-and-plans/features/connectivity-troubleshooter/`.
- Any UI wording, l10n string, setting, or command ID change.
- Publishing the package or bumping its version.
- Telemetry dashboards or Kusto queries (none reference these names yet).
- Rewording history: iteration files, older decisions, `CHANGELOG.md`, release notes.
