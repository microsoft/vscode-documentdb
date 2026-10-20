---
feature: query-insights
kind: plan
status: active
created: 2026-10-20
branch: dev/tnaum/query-insights-next
---

# Query Insights Next (POC): model picker, local prompt, explore without a connection

> **Proof of concept.** Dirty code is acceptable. The aim is to experiment with an internal
> prompt and with different models, with and without a live connection. Anything that graduates
> gets cleaned up and re-planned. This file is the source of truth while the work runs.
> Progress, time spent and deviations are recorded inline.

## Goals

1. **Local, uncommitted prompt.** Run Query Insights Stage 3 with an internal prompt that lives
   only on the developer's machine.
2. **Model picker.** Choose the Copilot model for Query Insights in the existing tab and in the
   new view. `copilot-utility` stays selectable.
3. **Explore without a connection.** A wizard webview: Welcome → Configure (paste explain plan,
   collStats, indexes; pick a model) → Analyze (the existing Query Insights layout, straight
   into Stage 2 + Stage 3).

## Operator decisions (2026-10-20)

| # | Topic | Decision | Changed from the proposal? |
| --- | --- | --- | --- |
| D1 | Where the prompt and code live | The prompt is a **local file only** (`._local/prompts/`, gitignored), loaded through the existing `documentDB.aiAssistant.indexAdvisor*PromptPath` settings. Code goes on a public branch. No private repo. | No (option 1A) |
| D2 | Output format | The operator adapts the internal prompt to emit our JSON contract (`{educationalContent, analysis, improvements[]}`). **No format suffix message.** | Yes. The proposal was "contract suffix + markdown fallback". |
| D3 | Default model | Saved choice → **first model in the list**. The org default would be preferred, but it isn't reachable (see F1). | Yes. The proposal was `copilot-utility` by default. |
| D4 | Model preference scope | **One shared** `globalState` key for the tab and the standalone view. | No |
| D5 | Webview reuse | Reuse **as much as possible, including the existing layout** (left column: AI cards; right column: efficiency analysis + query plan). | Strengthened: the proposal reused only the cards. |
| D6 | Entry points | A command + an **"Explore with your own input…" link in the Query Insights tab** (pre-filled from the session) + an **item in Help and Feedback** (labelled as a POC). No new "Tools" view. | Yes. The proposal was a Connections view title-bar action. |

## Findings

- **F1: the organization default model isn't available to extensions.** In `microsoft/vscode`
  (`extHostLanguageModels.ts`), the default (`metadata.isDefaultForLocation[Chat]`) is only used by
  `getDefaultLanguageModel` / `getLanguageModelForRequest`, which hand the model to **chat
  participants** as `request.model`. The `LanguageModelChat` returned by
  `vscode.lm.selectChatModels` has no `isDefault`, and the list comes back in provider
  registration order. Only workarounds: a chat participant, which can't feed a webview, or a
  proposed API, which can't ship on the Marketplace.
- **F2: custom prompt files already work** (`PromptTemplateService`). The templates are cached
  by default (`documentDB.aiAssistant.enablePromptCache`, not contributed, default `true`), so
  edits only apply after a reload. WI-1 fixes that for custom files.
- **F3: Stage 2 is pure.** `ExplainPlanAnalyzer` + `StagePropertyExtractor` +
  `transformStage2Response` already run on a debug JSON file with no connection
  (`readQueryInsightsDebugFile` in `queryInsightsRouter.ts`).
- **F4: `QueryInsightsMain` is loosely coupled.** It depends on `CollectionViewContext`
  (`queryInsights` pipeline state and `isLoading`), `useConfiguration` (`clusterId`,
  `databaseName`, `collectionName`), and about six tRPC calls
  (`mongoClusters.collectionView.queryInsights.{getQueryInsightsStage1, getQueryInsightsStage2, streamStage3, executeQueryInsightsAction}`,
  `common.openUrl`, `common.explainOperationFailure` / `displayErrorMessage`). A small adapter
  can make it mountable outside the Collection View.
- **F5: the cosmosdb model picker** (`vscode-cosmosdb/src/utils/aiUtils.ts`, `MigrationAssistant.tsx`):
  `selectChatModels({vendor:'copilot'})` minus `auto`, `{id,name,family,vendor,maxInputTokens}`,
  saved id in `globalState`, and a Fluent `Dropdown` showing the name + "N tokens" (a recommended
  group first, then an "Others" `OptionGroup`).

## Rules for the implementing agent

1. Work **WI by WI**, in order. Don't produce one giant changeset.
2. **Commit per WI** on `dev/tnaum/query-insights-next` (conventional message, e.g.
   `feat(query-insights): model picker RPCs (WI-2)`, with the `Co-authored-by: Copilot` trailer).
   **Do not push.** Never `git add -f`. Never commit anything under `._local/`.
3. After each WI, update this file: tick the box, add a one-line `_Outcome:_`, and fill the
   **Time log** row (wall-clock start/end from `date -u +%H:%M`, and minutes).
4. Record any divergence from this plan in the **Deviation log** with its rationale. If
   confidence in a non-obvious decision is below 80 %, stop and report instead of guessing.
5. **Verification is batched** (operator request): don't build or test after every WI. Run
   only the listed **checkpoints** (Case 1: `npm run build` + targeted `npx vitest run <paths>`).
   Fix failures before moving on. No `lint`, `prettier-fix`, `l10n` or `package` (POC, Case 1).
6. Terminology: "DocumentDB" / "DocumentDB API", never "MongoDB" alone. User-facing strings use
   `vscode.l10n.t()` (host) / `l10n.t()` (webview).
7. Keep the shipped behaviour of the Collection View intact apart from the additions listed here.
8. Skills to consult as needed: `.github/skills/webview-trpc-messaging`,
   `.github/skills/react-webview-architecture`, `.github/skills/fluentui`.

## Work items

### Phase A: model picker and local prompt in the existing tab

- [x] **WI-0: Model selection host plumbing** _(started before the review; finish it)_
    - Done: `src/services/ai/modelSelection.ts` (list the models minus `auto`, ensure
      `copilot-utility` is listed, shared key `documentDB.queryInsights.selectedModelId`, resolve
      explicit → saved → first). `CopilotService.{sendMessage,streamMessage}` options
      `modelSelection: 'utility' | 'user'` + `modelId`, plus a private `selectModel()`. Query
      Insights (`optimizeQuery*`) passes `modelSelection: 'user'`. Query generation is unchanged
      (utility). `QueryOptimizationContext` gets `modelId?` and `providedData?: { clusterInfo }`.
      The availability check is "any Copilot model".
    - To do: implement `buildProvidedDataRequest(context, queryContext, clusterInfo)` in
      `indexAdvisorCommands.ts`. It is the connectionless branch of `prepareOptimizationRequest`:
      it uses `queryContext.executionPlan` / `collectionStats` / `indexStats` as given (all
      optional except the plan), calls `fillPromptTemplate`, and builds the same three messages.
      Factor the message-building tail so both branches share it. Record telemetry
      `connectionless='true'`.
    - _Acceptance:_ compiles. The existing behaviour is unchanged apart from the model choice.
    - _Outcome:_ Completed provided-data prompt construction and shared three-message tail; added selection and connected/connectionless regression tests (verification batched at Checkpoint A).

- [x] **WI-1: Prompt iteration without a reload**
    - In `PromptTemplateService.getIndexAdvisorPromptTemplate`, don't read from or write to the
      cache when a custom template path is configured. Replace the per-run info toast with
      an `ext.outputChannel.trace` line (with the cache off it would fire on every run).
    - Add an exported helper `getIndexAdvisorPromptSourceInfo(commandType)` →
      `{ source: 'built-in' | 'custom-file'; path?: string }` (reads the setting only) for the UI.
    - _Acceptance:_ editing the custom file applies on the next "Get AI Performance Insights"
      click. The built-in path still uses the cache.
    - _Outcome:_ Custom files bypass cache reads/writes and log only to trace; exported settings-only source info and added edit/retry/source regression tests.

- [x] **WI-2: Model RPCs**
    - A new small router `queryInsightsModels` mounted in `appRouter` (e.g. `ai: { ... }`):
      `getAvailableModels` (query → `AvailableModelsResult`), `setSelectedModel` (mutation,
      `{ modelId: string | null }`), and `getPromptSourceInfo` (query, `{ commandType }`).
      Usable from any webview.
    - _Acceptance:_ typed client calls compile from both webviews.
    - _Outcome:_ Mounted connection-independent `ai` discovery/preference/prompt-source procedures with validated inputs and RPC regression tests.

- [x] **WI-3: Shared `ModelPicker` component**
    - `src/webviews/documentdb/queryInsightsShared/ModelPicker.tsx` (or similar). A Fluent
      `Dropdown` modelled on cosmosdb: option = name + muted "N tokens". The utility model comes
      first, then the rest in list order. Below it, a muted hint: which model is used and why
      ("Saved choice" / "First available model"), and for non-utility models "May use premium
      requests". It loads through `ai.getAvailableModels` and persists through
      `ai.setSelectedModel`. It also shows a one-line "Prompt: built-in / custom file
      `<basename>`" from `ai.getPromptSourceInfo`.
    - Compact variant for the tab card, full-width variant for the wizard.
    - _Outcome:_ Added compact/full-width Fluent picker, utility-first options with token counts, persisted-choice/premium hints, basename-only prompt source, and refresh/error/empty states with UI tests.

- [x] **WI-4: Tab integration**
    - `GetPerformanceInsightsCard`: add optional slots `modelPicker?: ReactNode` and
      `secondaryLink?: ReactNode`. Render the picker in the actions row next to the primary
      button. When the effective model isn't the utility model, the cost-disclosure line reads
      "The selected model may use premium requests." instead of "No additional cost…".
    - Apply the same conditional to the post-response byline in `QueryInsightsTab.tsx`.
    - Add the **"Explore with your own input…"** link (wired in WI-7; until then it may call a
      no-op or be hidden behind `false`).
    - **Checkpoint A** (bundled verification): `npm run build`;
      `npx vitest run src/services src/commands/llmEnhancedCommands src/documentdb/queryInsights src/webviews/documentdb/collectionView`.
    - _Outcome:_ Integrated the compact picker and optional secondary-link slot (explorer hidden until WI-7); disclosures use the selected model before invocation and actual response identity afterward. Checkpoint A passed: build successful, 63 test files / 1,330 tests passed, zero failures; stopped before Phase B.

### Phase B: explore without a connection (standalone wizard)

- [x] **WI-5: Make `QueryInsightsMain` mountable outside the Collection View** (D5, F4)
    - Introduce a `QueryInsightsDataSource` interface + React context
      (`queryInsightsTab/QueryInsightsDataSourceContext.tsx`). It exposes: `getStage1()`,
      `getStage2()`, `streamStage3(callbacks) → unsubscribe`, `executeAction(...)`, plus flags
      `actionsEnabled` (index actions), `isQueryLoading`, and an identity
      (`{ clusterId?, databaseName, collectionName }`).
    - The default provider in `CollectionView` wraps today's tRPC calls, so the behaviour is
      identical. `QueryInsightsMain` reads from the context instead of calling `trpcClient`
      directly. Its pipeline state may stay on `CollectionViewContext` for the tab; the
      standalone view provides its own state holder (hook / `useReducer`) via the same
      adapter. Pick whichever needs fewer changes and log the choice.
    - Stage 1 in standalone mode: synthesize from the explain (`queryPlanner` /
      `executionStats` basics) or skip it and let Stage 2 fill the panel. Log the choice.
    - With `actionsEnabled: false`, the improvement cards show only "Copy command" (no
      create/drop/hide).
    - _Acceptance:_ the Collection View tab behaves exactly as before (manual smoke in
      Checkpoint B).
    - _Outcome:_ Shared data-source context now drives the unchanged layout and pipeline; Collection View supplies the existing session calls/state, standalone cards can be copy-only. Verification deferred to B.

- [ ] **WI-6: Standalone host**
    - `src/webviews/documentdb/queryInsightsStandalone/queryInsightsStandaloneRouter.ts`:
        - `getPrefill` (query): the initial values passed through the webview config (empty, or
          taken from a session when opened from the tab: query, explain plan, collStats,
          indexes, db/collection names, cluster type).
        - `validateInput` (query, optional): parse EJSON/relaxed JSON via the existing helpers,
          detect the command type (find / aggregate / count) and extract the query from
          `explain.command` / `queryPlanner.parsedQuery`.
        - `getStage2({ explain, totalDocs?, filter? })`: the pure Stage 2 path (the same code
          as `getQueryInsightsStage2` after explain). Factor out a shared
          `analyzeExplainForStage2(explain, totalDocs, filter)` instead of copy-pasting if
          it's cheap.
        - `streamStage3(input)` subscription: the same event loop as
          `queryInsightsEventsRouter.streamStage3` (parser → `QueryInsightsStreamEvent`), but
          it calls `QueryInsightsAIService.getOptimizationRecommendationsStreaming` with
          `providedData` (WI-0) and `modelId`. Factor out the loop if that's practical,
          otherwise copy it (POC) and log the deviation.
    - `queryInsightsStandaloneController.ts`: `openAppWebview({ webviewName: 'queryInsightsStandalone', title: 'Query Insights (POC)' })`.
      Register it in `WebviewRegistry.ts` and `appRouter.ts`, and add the view name to the
      `openFeedback` allow-list only if needed.

- [ ] **WI-7: Standalone wizard UI + entry points**
    - `QueryInsightsStandalone.tsx`, built on the `Wizard` / `WizardStep` pattern from
      `LocalQuickStart.tsx`:
        1. **Welcome:** what it does, what to paste (`explain("executionStats")` output), and
           that the data is sent to the selected Copilot model.
        2. **Configure** (one page): explain plan (required; Monaco JSON editor if cheap,
           otherwise `Textarea`; validated), query (pre-filled, editable), command type
           (auto, overridable), collStats (optional), indexes (`getIndexes()` and/or
           `$indexStats`, optional), cluster type (Azure DocumentDB / DocumentDB / other),
           `ModelPicker` (full variant) with the prompt-source line.
        3. **Analyze:** mounts `QueryInsightsMain` through the WI-5 data source, so it gets the
           **same layout** as the tab. Stage 3 auto-starts. "Back" keeps every input, so you
           can re-run with another model or prompt.
    - Command `vscode-documentdb.command.queryInsights.exploreWithOwnInput` — title
      "Query Insights: Explore with Your Own Input (POC)", category "DocumentDB". It takes an
      optional prefill argument.
    - **Help and Feedback** tree item (`HelpAndFeedbackBranchDataProvider.ts`):
      "Query Insights Explorer (POC)", icon `beaker`, runs the command.
    - Tab link "Explore with your own input…" → the same command, pre-filled from the current
      session (query, cached raw explain, collStats/indexes if cached or quickly fetchable,
      db/collection names, cluster type). Fetch the prefill on the host through a new
      `collectionView.queryInsights.getExplorePrefill` procedure.
    - Respect the manifest-ID rule from `.github/copilot-instructions.md` (no single-dot
      standalone IDs). Add new commands to `LAZY_COMMANDS` only if they're intentionally
      unregistered.
    - **Checkpoint B** (bundled verification): `npm run build`;
      `npx vitest run src/services src/commands src/documentdb/queryInsights src/webviews src/tree/help-and-feedback-view`;
      L2 scenario smoke of the new view, if a scenario is cheap to add (optional).

- [ ] **WI-8: Wrap-up**
    - Fill in the time log totals, the deviation log, and a short "How to use" section below
      (settings + prompt path + entry points).
    - Do not touch the feature `README.md` beyond adding this iteration to its timeline
      table as "POC, not shipped".

## How to use (filled in at WI-8)

_TBD_

## Time log

Wall-clock UTC, 2026-10-20. Minutes are agent working time, including waiting on builds.

| Step | Who | Start | End | Minutes | Notes |
| --- | --- | --- | --- | --- | --- |
| Plan v1: research (QI pipeline, prompt service, cosmosdb picker) + proposal | Lead agent | 10:46 | 10:58 | 12 | |
| Plan v2: decisions, org-default research (vscode source) | Lead agent | 11:02 | 11:17 | 15 | Includes WI-0 partial (~5 min) |
| Plan v3: this file (CONTRIBUTING format, WIs) | Lead agent | 11:23 | 11:26 | 3 | |
| Phase A review (lead) | Lead agent | 11:43 | 11:45 | 2 | Diff + logs reviewed; Phase B launched |
| WI-0 | Coding agent (gpt-6.1-sol) | 11:26 | 11:28 | 2 | Includes instruction/plan reading; checks deferred to A. |
| WI-1 | Coding agent (gpt-6.1-sol) | 11:28 | 11:30 | 2 | Includes the WI-1 commit; checks deferred to A. |
| WI-2 | Coding agent (gpt-6.1-sol) | 11:30 | 11:31 | 1 | Checks deferred to A; shared RPC tests live under services/ai to join its selector. |
| WI-3 | Coding agent (gpt-6.1-sol) | 11:31 | 11:34 | 3 | Checks deferred to A. |
| WI-4 + Checkpoint A | Coding agent (gpt-6.1-sol) | 11:34 | 11:42 | 8 | Includes restoring missing dependencies and fixing new test fixtures; final build and all 1,330 targeted tests passed. |
| WI-5 | Coding agent (gpt-6.1-sol) | 11:44 | 11:46 | 2 | Shared adapter and copy-only cards; checks deferred to B. |
| WI-6 | | | | | |
| WI-7 + Checkpoint B | | | | | |
| WI-8 | | | | | |

## Deviation log

| WI | Deviation | Rationale |
| --- | --- | --- |
| — | Coding started (WI-0, partial) before the operator had reviewed the plan. | Autopilot over-reach. Stopped on request; the partial work is kept and finished in WI-0. |
| WI-5 | Keep the existing `QueryInsightsState` union and transition helpers; expose pipeline + dispatch on the adapter. Standalone synthesizes Stage 1 from the supplied explain. | Avoids moving Collection View state/prefetch or duplicating the layout. The standalone holder can use ordinary `useState`; synthesizing Stage 1 preserves all existing sequencing/plan-summary behaviour instead of special-casing a skipped stage. Common URL/error/model RPCs remain shared directly; only data/session operations move behind the adapter. |
| WI-3 | Made `formatTokenCount` browser-safe with an optional locale argument; host logging passes the VS Code locale explicitly. | The existing utility imported `vscode` at runtime, which cannot ship in a webview bundle. Reusing a pure helper avoids duplicating formatting while preserving host output. |
| Checkpoint A | Restored lockfile dependencies with `npm ci` after the initial commands could not start due to missing packages. | This worktree had no installed dependency set; no dependency manifests or lockfile changed. |
| Checkpoint A | The new picker selection test replaces only Fluent's floating dropdown/option layer with a native test stand-in. | Opening the real popup in jsdom (no layout engine) timed out; picker state, RPC calls, ordering, token labels, hints, and disclosure tests remain exercised. Also isolated the new host test's cancellation-error mock. No existing snapshots or TDD contracts changed. |

## Phase A verification outcome

- Case 1 only: `npm run build` passed; the exact Checkpoint A Vitest selector passed
  **63 files, 1,330 tests, zero failures** (final run 2026-10-20, 11:41 UTC).
- Total Phase A coding/checkpoint time: **16 minutes** (WI-0 2 + WI-1 2 + WI-2 1 + WI-3 3 + WI-4 8).
- No push; no lint, formatting, localization generation, packaging, live model request, or manual UI smoke performed.
- Phase B (WI-5 onward) remains untouched. The standalone explorer link is intentionally hidden.
