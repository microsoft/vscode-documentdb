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
- **F6: non-find applicability (lead-agent evaluation, checked against installed code).**
  Stage 2 and plan rendering were designed for find; accepting another command in the wizard
  does not make its static rules applicable. Inspection of the installed
  `@mongodb-js/explain-plan-helper/dist/get-execution-stats.js` corrects two lead hypotheses:
  the helper **replaces cursor `nReturned` with the last pipeline stage's `nReturned`**, and
  **prefers cursor `executionTimeMillis`**, falling back to the last stage's estimate. It also
  collects `indexesUsed` from later pipeline stages. Therefore the old efficiency ratio can
  mix final pipeline output with initial cursor examination; it is not already a valid
  `$match` selectivity ratio. Normalizing to the initial cursor before analysis avoids that.

  | Element | find | aggregate | count |
  | --- | --- | --- | --- |
  | Docs/keys examined, exec time | Valid | Cursor docs/keys; helper prefers cursor time, otherwise last-stage estimate | Valid |
  | Docs returned + efficiency ratio | Valid | Helper uses final-stage returns with cursor examination; use cursor returns and relabel "Documents passed to pipeline" | COUNT `nReturned=0` is not a match count; use execution-stage `nCounted`, never infer no matches from zero returned documents |
  | Selectivity / coverage advisories | Valid | Initial cursor / pushed-down filter only, explicitly scoped | Not applicable; suppress |
  | In-memory sort detection | Valid | Only cursor SORT is detected; a later `$sort` must not be labelled "No" | Not applicable |
  | Index usage, bitmap, low-cardinality, multikey | Valid | Cursor portion (helper can additionally report later-stage indexes) | Applicable; COUNT_SCAN is recognized as indexed |
  | Plan visualization / extended stage info | Valid | Current transformer/extractor only read top-level fields; normalize `stages[0].$cursor` first | COUNT/COUNT_SCAN trees can be shown; numeric result remains `nCounted` |

  A further coupling was found while checking F6: QueryPlanSummary's raw-explain button calls
  a Collection View session RPC directly. The standalone must supply its own raw-plan action.
  Optimized single-plan aggregates containing transformations may not expose an initial cursor
  boundary; those initial-return/selectivity/rating fields must be unavailable rather than
  relabelling final output as cursor throughput. If cursor timing is missing, a last-stage
  estimate describes the whole pipeline, not cursor-only time; it cannot justify a fast
  initial-stage rating.

- **F7: model pricing metadata (lead research, verified against `microsoft/vscode`).**
  `selectChatModels` returns plain frozen objects with additional runtime properties:
  `pricing?: string` (display label), `priceCategory?: string` (`low`, `medium`, `high`,
  `very_high`), `category?: string` (`lightweight`, `versatile`, `powerful`, or others),
  `capabilities?: { supportsImageToText, supportsToolCalling, ... }`, and numeric
  `inputCost`, `outputCost`, `cacheCost`, `cacheWriteCost`, `longContextInputCost`,
  `longContextOutputCost`, `longContextCacheCost`, `longContextCacheWriteCost`.
  Costs are **AI credits per 1M tokens**. Typings are proposed
  (`vscode.proposed.languageModelPricing.d.ts`), but property reads are not proposal-gated.
  Copilot populates these from endpoint metadata in
  `extensions/copilot/src/extension/conversation/vscode-node/languageModelAccess.ts`
  (around line 375). The POC uses an `unknown`-typed, field-by-field defensive reader.
- **F8: per-request credits are observable (lead research, verified against `microsoft/vscode`).**
  At response completion Copilot emits a stable `LanguageModelDataPart` with MIME `usage`
  containing UTF-8 JSON `APIUsage`: `prompt_tokens`, `completion_tokens`, `total_tokens`,
  optional `prompt_tokens_details.{cached_tokens,cache_creation_input_tokens}`,
  `completion_tokens_details.{reasoning_tokens,...}`, and
  `copilot_usage.total_nano_aiu`. Credits = `total_nano_aiu / 1_000_000_000`
  (Copilot's `nanoAiuToCredits`). `response.stream` forwards text/data/thinking/tool-call
  parts; `response.text` drops non-text parts. `LanguageModelDataPart` is stable in this
  repo's `@types/vscode` 1.109. Real token counts and exact billed credits therefore need
  **no proposed API**.

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

- [x] **WI-6: Standalone host**
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
    - _Outcome:_ Registered connectionless panel/router with explain/query validation, synthesized Stage 1, shared pure Stage 2 and cancellable parser-driven Stage 3; service accepts supplied data, command type and model. Wizard placeholder replaced in WI-7.

- [x] **WI-7: Standalone wizard UI + entry points**
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
    - _Outcome:_ Welcome/Configure/Analyze wizard reuses `QueryInsightsMain`, auto-starts Stage 3 and preserves inputs on Back; command, prefilled tab link and beaker Help item are wired. Checkpoint B passed: build, 130 files / 2,191 tests passed (1 skipped), plus 9/9 mocked L2 routes across three themes including copy-only actions.

- [x] **WI-8: Wrap-up**
    - Fill in the time log totals, the deviation log, and a short "How to use" section below
      (settings + prompt path + entry points).
    - Do not touch the feature `README.md` beyond adding this iteration to its timeline
      table as "POC, not shipped".
    - _Outcome:_ Added local-prompt/model/entry-point instructions, exact manual smoke steps, Phase B verification and wall-clock totals; linked this iteration as POC, not shipped.

### Phase C: command-aware analysis and explicit preview scope (operator follow-up)

Same per-WI commits, time logging, deviation rules and Case 1 restrictions apply. Verification
is bundled once at Checkpoint C after WI-11; do not build/test after WI-9 or WI-10.

- [x] **WI-9: Command-type-aware Stage 2 (analysis profile)**
    - Thread find/aggregate/count into the shared pure Stage 2 path. Find remains unchanged.
    - Count uses `nCounted`, suppresses find selectivity/coverage/no-match/sort assumptions, and
      rates index usage plus examined documents versus collection size.
    - Aggregate normalizes the initial `$cursor` for metrics, plan and extended properties;
      scopes the returned-document metric/diagnostics to the cursor and explains which later
      pipeline stages are not rated. Never claim no sort when a pipeline `$sort` is present.
    - Return profile/applicability metadata; add small aggregate (both explain formats) and count fixtures/tests.
    - _Outcome:_ Added aggregate cursor normalization, pipeline-scope diagnostics/applicability, count `nCounted` extraction and count-specific index/scan-work ratings; shared helper accepts profiles while the find response remains unchanged. Added seven profile contract tests; checks deferred to C.

- [x] **WI-10: UI applicability and preview badges**
    - Standalone Analyze always shows "Feature preview".
    - Non-find efficiency and plan cards show "Preview · tuned for find queries".
    - Relabel aggregate/count metrics and hide or explicitly mark inapplicable cells.
      Connected find tab appearance and behavior stay unchanged.
    - _Outcome:_ Standalone Analyze has a Feature preview badge; non-find efficiency/plan cards carry the tuned-for-find preview. Aggregate throughput is relabelled and scope notes are visible; count-only-inapplicable cells are explicit and count plan details suppress misleading Returned counters. Added three presentation tests; checks deferred to C.

- [x] **WI-11: Standalone correctness + Checkpoint C**
    - Apply `fixupDocumentDbExplain` to supplied Azure DocumentDB plans, including cursor plans,
      with synthesized `domainInfo_isAzure='true'` / `domainInfo_api='vCore'` metadata.
    - Non-find static summaries tell the model which rules were skipped and why.
    - Make the wizard's forward action primary, not Back; confirm the Analyze scenario lands
      on Analyze. Give the standalone raw-explain button a connectionless action.
    - **Checkpoint C:** `npm run build`;
      `npx vitest run src/documentdb/queryInsights src/webviews/documentdb/queryInsightsStandalone src/webviews/documentdb/collectionView src/services/ai`.
    - Update Phase C results, minutes, deviations and manual smoke steps.
    - _Outcome:_ Applied Azure explain fixups to top-level/cursor plans, made non-find model summaries scope-aware, added a connectionless raw-plan action, corrected footer emphasis, and verified Analyze really renders Analyze. Checkpoint C passed: build, 21 files / 231 tests, and 15/15 L2 routes; real host/model smoke remains manual.

### Phase D: wizard polish (operator follow-up)

Operator verdict on Phase C: the wizard works but is "very basic". Bring it to the level of
`LocalQuickStart.tsx` (the gold standard) and `AtlasCredentialsView.tsx`. Same per-WI commits,
time logging, deviation rules and Case 1 restrictions apply. Verification is bundled once at the
end of WI-13 (Checkpoint D). L2 runs use the agent's **own headless Playwright**, never a shared
or interactive browser.

- [x] **WI-12: Prompt fallback hardening (small)**
    - Keep the built-in fallback through `getIndexAdvisorPromptSourceInfo` /
      `PromptTemplateService`. Treat a whitespace-only path as "not configured" (trim it), so
      both pickers show "Prompt: built-in" and the built-in template is used. Unit test.
    - _Outcome:_ The source helper trims the setting; blank/whitespace/null paths report `built-in`, load the built-in template (cacheable, no file read, no warning), and custom paths are trimmed. Two service tests added; the existing picker test already covers the "Prompt: built-in" line. Checks deferred to D.

- [x] **WI-13: Wizard UI revision + Checkpoint D**
    - **Welcome:** `ContainerHeader` (title, subtitle, Feature preview badge), a value statement,
      a "What you'll need" list (required explain output; optional collection stats / indexes,
      each with a reason), copyable `explain("executionStats")` snippets for find / aggregate /
      count (DocumentDB shell or mongosh) using `common.copyToClipboard`, and a privacy note.
    - **Configure:** sections **Explain plan** (required), **Optional context**, **AI model &
      prompt**. Live explain validation (parsed / error with position, detected command badge,
      namespace, extracted query preview, "Load sample plan" for find / aggregate / count).
      Optional inputs use the LocalQuickStart summary-row → editor pattern with `Collapse`.
      Monospace editors. Full `ModelPicker` with cost hint and prompt line. Inline validation;
      the forward button is disabled with a visible reason until the plan is valid.
    - **Analyze:** compact input summary bar (command, namespace, model, prompt source; "Edit
      inputs" and "Re-run", with an inline model change). Remove the nested scroll: the page
      scrolls once. `QueryInsightsMain` and the Collection View tab stay unchanged.
    - **Overall:** theme tokens only; focus to step heading; Announcer live regions;
      keyboard-only flow; `l10n.t()` strings; "DocumentDB shell or mongosh" terminology.
    - **Checkpoint D:** `npm run build`;
      `npx vitest run src/webviews/documentdb/queryInsightsStandalone src/webviews/documentdb/collectionView src/webviews/documentdb/queryInsightsShared src/services`;
      L2 scenarios updated/added and run headless in three themes; before/after screenshots
      saved outside the repo.
    - _Outcome:_ Rebuilt the wizard on LocalQuickStart patterns: `ContainerHeader` with Feature preview, sticky navigation, "What you'll need" list (Required/Optional/Prefilled), copyable DocumentDB shell or mongosh snippets, privacy note; Configure has Explain plan / Optional context / AI model & prompt sections, live non-throwing `inspectInput` validation (line/column, command badge, namespace, plan chain, extracted query, sample plans), summary-row editors with `Collapse`, and a disabled-with-reason forward action; Analyze has an input summary bar with inline compact picker, Edit inputs and Re-run, and a single page scroll. Checkpoint D passed (see Phase D verification outcome).

### Phase E: usage transparency, richer models and slimmer JSON-input workflow

Same per-WI commits, time logging and deviation rules apply. Verification is batched **once**
at Checkpoint E. No push, lint, prettier-fix, l10n or package; nothing under `._local/` committed.

- [x] **WI-14: Per-run usage and credits (host + UI byline)**
    - Read text and defensively decoded `usage` data parts from the shared `response.stream`.
      Prefer provider token counts/total over estimates; preserve fallback, add cached/reasoning
      tokens, credits and usage source. Measure credits/reported tokens on buffered and streaming
      telemetry, trace one summary, and retain usage through both Stage 3 routers/reducer.
    - Append known billed credits (up to two decimals, `< 0.01` for tiny positive values) and
      input/output tokens to the completion byline; retain the utility disclosure.
    - Test provider usage, malformed usage and missing usage with fake streamed parts.
    - _Outcome:_ Shared buffered/streamed primitive consumes stable text/data parts; valid provider
      usage wins, malformed/missing data falls back to estimates. Credits/reported counts reach
      telemetry and both Stage 3 completions/reducer/byline; formatting and stream tests added.
      Verification deferred to E.
- [x] **WI-15: Richer model info in the picker**
    - Defensive F7 metadata + version on `AvailableModelInfo`. Utility first; other models
      grouped by category when present. Name left, price/context and rounded tint badge right.
    - Full selected-model details; compact summary + information tooltip with the same details.
      Only present prices/costs/context/capabilities/identity appear. Retain choice/prompt/premium
      hints; theme tokens only, all three themes.
    - _Outcome:_ Added guarded runtime price/cost/category/capability metadata, utility-first
      category groups, muted option metadata/tint badges and selected-model details (full panel
      or compact summary/info tooltip). Added malformed/frozen metadata and picker tests;
      enriched the synthetic L2 utility fixture. Checks deferred to E.
- [ ] **WI-16: Slim Analyze header**
    - One wrapping muted facts row: Reconfigure back arrow (inputs kept), command tint badge,
      monospace namespace, cluster type, model and prompt. No dropdown or Re-run; reconfigure
      to change a model. Keep heading focus and single page scroll.
- [ ] **WI-17: Monaco for JSON inputs + Checkpoint E**
    - Repo Monaco wrapper for explain (~16 lines), query/stats/indexes (~8 lines): JSON,
      line numbers, no minimap, no wrapping, folding, automatic layout, VS Code theme,
      accessible labels and Escape exit. Add parse-error markers at reported positions.
      Adapt textarea-based scenarios to Monaco.
    - **Checkpoint E:** `npm run build`;
      `npx vitest run src/services src/commands/llmEnhancedCommands src/webviews/documentdb/queryInsightsStandalone src/webviews/documentdb/queryInsightsShared src/webviews/documentdb/collectionView build/verification`.
      Stop on any failing `TDD:` suite; do not edit its contract.
    - Own headless Playwright against the **existing** port 18080 watcher; never restart/kill it.
      Run `/scenarios/run-all/queryInsightsStandalone/<theme>.js` in all three themes;
      save `phase-e-` dark screenshots (marker, picker details, slim header) in the session
      wizard-ui directory. If needed use gitignored local libraries and `en-US`, then remove
      the libraries. Bound headless setup attempts to ~10 minutes.

## How to use (filled in at WI-8)

1. Keep the internal prompt outside git, for example
   `<repo>/._local/prompts/query-insights-find.prompt.md`. Set the appropriate absolute file
   paths in VS Code's settings:
   ```json
   {
     "documentDB.aiAssistant.indexAdvisorFindPromptPath": "<repo>/._local/prompts/query-insights-find.prompt.md",
     "documentDB.aiAssistant.indexAdvisorAggregatePromptPath": "<repo>/._local/prompts/query-insights-aggregate.prompt.md",
     "documentDB.aiAssistant.indexAdvisorCountPromptPath": "<repo>/._local/prompts/query-insights-count.prompt.md"
   }
   ```
   Replace `<repo>` with this checkout's absolute path. Configure only the command types you
   want to override; clear a setting to use the built-in template. Custom files are read on
   every run, with no reload needed. The prompt must emit
   `{ "educationalContent": "...", "analysis": "...", "improvements": [] }` in the existing
   JSON contract; the extension does not append a format suffix.
2. Pick a Copilot model in the existing Query Insights card (compact picker), or on the
   explorer's Configure page (full picker). One saved choice is shared across both surfaces.
   The picker shows the prompt source/basename and premium-request warning where applicable.
3. Open through any of the three entry points:
   - Command Palette → **DocumentDB: Query Insights: Explore with Your Own Input (POC)**.
   - **Help and Feedback → Query Insights Explorer (POC)** (beaker icon).
   - Query Insights tab → **Explore with your own input…**, before requesting AI insights:
     carries the session query, raw explain, optional statistics/indexes and collection identity.
4. In the explorer select **Continue**, paste the `explain("executionStats")` result, optionally
   add collStats and a `getIndexes()` / `$indexStats` array, and validate/extract the query or
   edit it yourself. Choose/override find, aggregate or count and the cluster type, then
   **Analyze**. Stage 2 and Stage 3 start automatically; the Analyze step uses the same
   two-column component as the connected tab. Recommendations offer **Copy command**, never
   database-changing actions. **Back** preserves all text for another run with a changed model/prompt.

   Phase D (UI revision): the Welcome page lists what you need and has copy buttons for the
   `explain("executionStats")` commands (DocumentDB shell or mongosh). Configure checks the plan
   as you type (line/column on errors), shows the detected command, namespace, plan and extracted
   query, and offers **Load a sample plan: find · aggregate · count**. Optional context rows
   ("Not provided" / "Provided · N indexes") open their editors with the pencil button. The
   forward button is **Analyze query**; while it is disabled the footer says why. On Analyze,
   the summary bar shows command, namespace, cluster type and the model picker; change the model
   and select **Re-run**, or **Edit inputs** to return with everything kept.

   Phase C adds explicit preview scope: every standalone Analyze page says **Feature preview**;
   aggregate/count efficiency and plan cards say **Preview · tuned for find queries**.
   Aggregate counters describe the initial cursor, not final pipeline output. A folded
   single-plan pipeline without a recoverable cursor boundary shows unavailable initial
   returns/selectivity/rating rather than a guessed score. Count reads `nCounted` and marks
   selectivity, fetch overhead and sorting inapplicable. Select **Azure DocumentDB** to apply
   the same explain-counter workarounds as the connected path. **View Raw Execution Stats**
   opens the supplied, corrected explain without a session.

### Manual smoke still required (real VS Code + Copilot)

1. Open the command from the palette with no connection. Continue, paste a real executionStats
   explain, validate/extract, pick a model and Analyze. Confirm metrics, plan and streaming cards.
2. Copy a recommendation; verify clipboard contents and absence of Create/Drop/Hide actions.
   Cancel an in-flight run, then retry; close the panel while streaming and confirm cancellation.
3. Back → change the model and edit the local prompt file → Analyze again. Confirm inputs
   survive, the new prompt is used without reload, and the response byline names the new model.
4. Open via the Help and Feedback beaker item; confirm the same empty wizard.
5. Run a real Collection View find query. Open Query Insights, confirm the existing metrics,
   right-column plan and opt-in AI behavior are unchanged, then use the explorer link and check
   the prefilled query, raw explain, database/collection and available stats/indexes.
6. In the connected tab request AI recommendations, verify real index actions still work, then
   refresh/change the query and switch tabs during streaming to check reset/cancel behavior.

### Additional Phase C manual smoke (real plans, not the mocked L2 fixtures)

1. In Configure paste a count explain with `nReturned: 0` and a COUNT stage with `nCounted: 80`,
   backed by COUNT_SCAN; supply collStats with `count: 100`. Select **count**, choose a model,
   Analyze. Confirm **Documents counted = 80**, no false "No matching documents" badge, an
   index-aware rating, and **Not applicable to count queries** for selectivity/fetch/sort.
   An explain without `nCounted` must show an unavailable count, not zero.
2. Back, clear the old query text, and paste an aggregate `stages[]` explain whose initial
   `$cursor` returns 35 documents but `$group` returns one, followed by `$sort`. Select
   **aggregate**, validate/extract, Analyze. Confirm **Documents passed to pipeline = 35**,
   a populated cursor plan, a scope note naming `$group`/`$sort`, and no false "No" sort claim.
   Query inference from explain-only data can be partial; review the editable pipeline.
3. Repeat with a single-plan aggregate containing only pushed-down match/sort, then one with
   a folded GROUP. The first supports normal initial metrics; the second must not invent
   initial throughput/selectivity/rating from its final `nReturned`. Remove cursor time and
   leave only a last-stage estimate: it must be labelled overall/estimated, not a fast cursor.
4. Paste an Azure DocumentDB SORT→COLLSCAN explain with top-level docs/keys of 2 and a deeper
   scan count of 100. Select **Azure DocumentDB** and Analyze: expect 100 documents examined and
   0 keys for COLLSCAN. **View Raw Execution Stats** must open the corrected read-only input.
   Back → select **Other** → rerun: the Azure-only fixups must not apply.
5. On Configure confirm **Analyze** is the filled forward action and **Back** is secondary.
   The connected find tab must have its original labels/layout/actions and no new preview badges.
   Every standalone Analyze page has Feature preview; non-find cards have the two tuned-for-find badges.
6. With real Copilot, compare count/aggregate recommendations: they must receive the summary's
   skipped-rule/scope explanation, not a find-only assertion that zero count output means no
   matches or final grouped output is filter selectivity. Cancel/back/close during streaming
   and retry with a new model/local prompt as in Phase B.

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
| WI-6 | Coding agent (gpt-6.1-sol) | 11:46 | 11:48 | 2 | Host plumbing; checks deferred to B. |
| WI-7 + Checkpoint B | Coding agent (gpt-6.1-sol) | 11:48 | 14:33 | 165 | Includes ~150 minutes waiting on integrated browser/tools (11:56–14:26); final build/tests and 9 L2 routes passed. |
| WI-8 | Coding agent (gpt-6.1-sol) | 14:33 | 14:34 | 1 | Usage, manual checks, timeline and Phase B totals. |
| WI-9 | Coding agent (gpt-6.1-sol) | 14:34 | 14:38 | 4 | Verified/corrected F6 against installed helper; checks deferred to C. |
| WI-10 | Coding agent (gpt-6.1-sol) | 14:38 | 14:41 | 3 | Preview/applicability UI; checks deferred to C. |
| WI-11 + Checkpoint C | Coding agent (gpt-6.1-sol) | 14:41 | 15:03 | 22 | Correctness/summary refinements, Checkpoint C and 15 themed L2 routes. |
| Phase C scoping (lead): find-only evaluation (F6) + steering message | Lead agent | 14:30 | 14:40 | 10 | Read ExplainPlanAnalyzer / explain-plan-helper / fixup; screenshot of the L2 page |
| Phase B+C review (lead) | Lead agent | 15:05 | 15:12 | 7 | Commits, plan log, count L2 page rendered and inspected |
| Phase D setup + WI-12 | Coding agent (claude-opus-5.5) | 15:16 | 15:21 | 5 | Read plan/wizards/skills, headless L2 driver + "before" screenshots, Phase D section, prompt trim + tests; checks deferred to D. |
| WI-13 + Checkpoint D | Coding agent (claude-opus-5.5) | 15:21 | 15:42 | 21 | Inspection RPC, wizard rewrite, scenarios, unit tests, build, Vitest, 21 headless L2 routes, screenshots, plan. |
| Phase D review (lead) | Lead agent | 15:43 | 15:47 | 4 | Screenshots reviewed; count cells shortened to "Not applicable" (full text kept in tooltip) because the long value clipped in the right column; build + 143 targeted tests passed |
| Badge style + Required tag (lead) | Lead agent | 16:22 | 16:27 | 5 | Operator feedback; build + 143 targeted tests passed; Welcome + Analyze checked in the L2 browser |
| WI-14 | Coding agent (gpt-6.1-sol) | 16:35 | 16:37 | 2 | Plan/F7/F8, stable usage data parts, telemetry and byline; checks deferred to E. |
| WI-15 | Coding agent (gpt-6.1-sol) | 16:37 | 16:39 | 2 | Rich metadata, grouped options, details panel/tooltip and tests; checks deferred to E. |

## Deviation log

| WI | Deviation | Rationale |
| --- | --- | --- |
| WI-14 | Both routers and the reducer already forward the entire usage object, so only the intervening shared usage shapes needed extending. Client-side counting runs only for missing provider counts. | Avoids disturbing the existing streaming lifecycle or adding redundant count requests; provider totals (including reasoning/overhead) remain authoritative. |
| WI-15 | POC deliberately reads pricing properties that the shipped code avoided (see `copilotService.ts` comments); no proposal is enabled. Shipping this requires API finalization or enabling `languageModelPricing`. `version` was already in `AvailableModelInfo`. Unknown categories are grouped as Other; unknown price tiers remain visible as text. | F7 establishes plain property access but not a stable API contract. Defensive optional reads let the POC explore metadata without pretending it is ready to ship. |
| — | Coding started (WI-0, partial) before the operator had reviewed the plan. | Autopilot over-reach. Stopped on request; the partial work is kept and finished in WI-0. |
| WI-5 | Keep the existing `QueryInsightsState` union and transition helpers; expose pipeline + dispatch on the adapter. Standalone synthesizes Stage 1 from the supplied explain. | Avoids moving Collection View state/prefetch or duplicating the layout. The standalone holder can use ordinary `useState`; synthesizing Stage 1 preserves all existing sequencing/plan-summary behaviour instead of special-casing a skipped stage. Common URL/error/model RPCs remain shared directly; only data/session operations move behind the adapter. |
| WI-6 | The standalone subscription reuses the parser/service/event types but has a small separate streaming loop; no connected completion-event telemetry or survey activity. | Extracting the connected loop would disturb its detailed session telemetry/timing instrumentation. Copying the essential event lifecycle is lower risk for a POC; all cancellation paths still abort the model and both inputs are analyzed with one shared pure Stage 2 helper. |
| Checkpoint B | Updated the registry test's exhaustive view-name list and browser fixture/runtime/scenario tables for the new registered view. Added Welcome, Configure and Analyze fixtures in all three themes. No existing snapshots or TDD contracts changed. | The build makes these tables exhaustive over `WebviewName`; leaving them unchanged fails compilation. Browser smoke additionally caught ambiguous forward-button names and missing mutation acknowledgement values; both were corrected. The integrated runner needed a supplied timer shim (`page.waitForTimeout`) because its external execution context has no global `setTimeout`; the repository runner was not changed. |
| WI-7 | Session prefill reads optional collStats/indexStats/metadata with a 1.5-second best-effort bound per parallel call. | They are not cached on `ClusterSession`; bounded lookups provide useful prefill without blocking opening the explorer when optional metadata is unavailable. |
| WI-9 | Corrected F6's aggregate-return/time assumptions against the installed helper, normalize to the cursor before invoking it, and leave profile metadata absent on the connected find path. Count results without `nCounted` are explicitly unavailable. | The helper mixes final pipeline returns with initial cursor examination and can mutate cursor counters; retaining that behavior would make selectivity misleading. Preserving the find response shape avoids fixture/shipped-behavior churn. Missing count evidence must not become a fabricated zero. |
| WI-11 | Optimized aggregates without a separate cursor boundary suppress initial returns/selectivity/rating; missing cursor timing is unavailable or explicitly a whole-pipeline estimate, and does not produce a fast-cursor rating. | Inspecting both explain formats exposed cases where relabelling the top-level counters would still mix final output or pipeline time with initial-stage rules. Hiding unsupported conclusions is safer than guessing; small fixtures exercise these boundaries. |
| WI-11 | Count rating is an explicit preview heuristic: no document reads is excellent; indexed reads below 10% / 50% of known collection size are excellent / good; larger indexed scans are fair, while unindexed broad/unknown scans are poor. | Count does not return matching documents, so the find efficiency score cannot be reused. Index access plus scan work is the operator-requested basis; this POC heuristic is not a shipped count-rating design. |
| WI-11 | Added an optional raw-explain action to the adapter; standalone uses its own read-only JSON RPC. Inferred aggregate queries include available cursor filter/stage operators and warn that extraction can be partial. | The reused plan component still contained a hidden session-only raw-plan action. Keeping its connected fallback preserves find behavior while avoiding a broken standalone button. Explain-only input cannot always recover the exact original command. |
| Checkpoint C | Corrected only new test fixtures: the find-equivalence baseline now includes existing extended-stage enrichment, and the negative "No" assertion matches a full line rather than the prefix of "Not rated". No existing snapshots or TDD contracts changed. | These failures were test-setup/assertion mistakes, not intentional changes to find behavior. Source L2 readiness also waits for completed Analyze content, not merely profile labels that can appear before Stage 2 finishes. |
| WI-12 | No picker change needed: `ModelPicker` already renders "Prompt: built-in" for any non-custom source and its existing test covers it; the fix is the trim in `getIndexAdvisorPromptSourceInfo`, which both the pickers and `PromptTemplateService` read. | The helper is the single source of truth, so one change covers the Configure picker, the tab picker and template loading. |
| WI-13 | Added a non-throwing `inspectInput` query (plain `publicProcedure`, no telemetry) returning per-field results with 1-based line/column from the shell parser; `validateInput` stays for compatibility but the wizard no longer calls it. Analyze re-inspects once before switching steps. | Live validation runs on every debounced edit: a throwing RPC can only carry a message, cannot report several fields at once, and would emit a telemetry event per keystroke. |
| WI-13 | Analyze actions (Edit inputs, Re-run) live in the summary bar as requested; the Analyze footer carries only the copy-only note, and the indicator never navigates to Analyze (`navigable={false}`). Re-run remounts the reused panel with a new key and the currently selected model. | Duplicating the same actions in the footer would put two "back to Configure" buttons on one page. Remounting reuses the existing Stage 1→3 pipeline and cancellation without touching `QueryInsightsMain`. |
| WI-13 | Nested scroll fixed by a scoped wrapper (`.queryInsightsExplorer-analysis > .container / > .contentArea`) that removes the tab's fixed height and inner `overflow-y: scroll` only inside the wizard. Added `body { padding: 0 }` like LocalQuickStart. | `QueryInsightsMain` and the tab stylesheet are unchanged, so the Collection View keeps its own scroll area. Production inlines one stylesheet for all views, and LocalQuickStart already ships the identical body rule, so other views see no change. |
| Checkpoint D | Updated stale harness counts (`scenarios.test.ts` 42→63 routes; `harness.test.ts` registry keys now include `queryInsightsStandalone`). The view fixture's style probe moved from the removed `.queryInsightsStandalone` wrapper to `body padding-top`. | The route and key counts had been stale since Phase B (57 routes vs 42 expected); my two new scenarios change the same numbers. Not TDD suites; no snapshots changed. |
| Checkpoint D | Headless L2 used Playwright 1.54 from the local npx cache with `chromium_headless_shell-1181`; WSL lacked six system libraries and sudo needs a password, so the `.deb`s were fetched with `apt-get download` and extracted under `._local/` (gitignored, removed afterwards) via `LD_LIBRARY_PATH`. The page locale was set to `en-US`. | No interactive or shared browser was used. With the inherited POSIX locale, `navigator.language` was `en-US@posix`, which `Intl` rejects inside `formatTokenCount` and crashes the picker. That is a harness artefact (VS Code always supplies a BCP 47 tag) and was not changed in product code. |
| WI-3 | Made `formatTokenCount` browser-safe with an optional locale argument; host logging passes the VS Code locale explicitly. | The existing utility imported `vscode` at runtime, which cannot ship in a webview bundle. Reusing a pure helper avoids duplicating formatting while preserving host output. |
| Checkpoint A | Restored lockfile dependencies with `npm ci` after the initial commands could not start due to missing packages. | This worktree had no installed dependency set; no dependency manifests or lockfile changed. |
| Checkpoint A | The new picker selection test replaces only Fluent's floating dropdown/option layer with a native test stand-in. | Opening the real popup in jsdom (no layout engine) timed out; picker state, RPC calls, ordering, token labels, hints, and disclosure tests remain exercised. Also isolated the new host test's cancellation-error mock. No existing snapshots or TDD contracts changed. |
| Operator feedback (16:22) | Welcome: the explain output always shows **Required**; when supplied, a green "Prefilled from your session" note appears below it instead of replacing the tag. All wizard and preview badges use the house style `appearance="tint" shape="rounded" size="small"` (as in the Indexes tab and the plan summary). | "Prefilled" replacing "Required" read like a stale state; the rounded-square tint badge is the convention across the other webviews. |

## Phase A verification outcome

- Case 1 only: `npm run build` passed; the exact Checkpoint A Vitest selector passed
  **63 files, 1,330 tests, zero failures** (final run 2026-10-20, 11:41 UTC).
- Total Phase A coding/checkpoint time: **16 minutes** (WI-0 2 + WI-1 2 + WI-2 1 + WI-3 3 + WI-4 8).
- No push; no lint, formatting, localization generation, packaging, live model request, or manual UI smoke performed.
- At the Phase A handoff, Phase B remained untouched and the standalone link was hidden;
  Phase B is now implemented as recorded below.

## Phase B verification outcome

- Case 1 only: final `npm run build` passed (2026-10-20, 14:33 UTC).
- Exact Checkpoint B Vitest selector passed: **130 files, 2,191 passed, 1 skipped, zero failures**
  (final test run 14:31 UTC). No TDD suite failed; no snapshots were changed.
- Mocked source L2 smoke passed **9/9 routes**: Welcome, Configure and Analyze in dark, light
  and high-contrast. Analyze rendered the shared left/right-column layout and the copy-only
  recommendation; clipboard RPC assertions passed. Back preserved supplied inputs without errors.
- Real host/Copilot/manual Collection View smoke remains outstanding; see the exact steps above.
  No live model request was sent. No lint, formatting, localization generation, packaging, extra
  `node build/verification/...` checks or pushes were performed.
- Total Phase B elapsed time: **170 minutes** (WI-5 2 + WI-6 2 + WI-7/checkpoint 165 + WI-8 1).
  This includes approximately 150 minutes of integrated browser/tool waiting, not active coding.
- Total recorded coding/checkpoint time for Phases A + B: **186 minutes** (16 + 170).

## Phase C verification outcome

- Case 1 only: final `npm run build` passed (2026-10-20, 15:00 UTC).
- Exact Checkpoint C selector passed: **21 files, 231 tests, zero failures/skips**
  (final run started 14:59 UTC). The find-equivalence test includes its existing extended-stage
  enrichment; all existing find rating, advisory, transformation and summary tests passed.
- Mocked source L2 smoke passed **15/15 routes**, zero harness/late errors: Welcome, Configure,
  Analyze/find, Analyze/aggregate and Analyze/count in dark, light and high-contrast.
  Clipboard and standalone raw-explain RPC assertions passed. Readiness requires actual Analyze
  content, including completed recommendation cards, rather than a Configure/loading state.
- Explicitly checked `/queryInsightsStandalone/analyze/dark` after Continue → Analyze: the active
  heading was Query Insights, Feature preview was visible, readiness was true and no errors were
  recorded. The browser was left on Analyze, not on the Back-persistence smoke state.
- Explicitly measured Configure footer styles in dark mode: Analyze's filled background was
  `rgb(0, 103, 184)` / white text, versus Back's secondary `rgb(31, 31, 31)` / neutral text.
- The dev server was stopped. No live database/model request, installed-extension smoke, lint,
  formatting, localization generation, packaging, extra verification scripts or push was performed.
  The exact real-plan/real-Copilot smoke steps remain above; mocked UI fixtures are not backend proof.
- Phase C time: **29 minutes** (WI-9 4 + WI-10 3 + WI-11/checkpoint 22).
- This task's Phases B + C total: **199 elapsed minutes**, including approximately 150 minutes
  of integrated-browser/tool waiting in Phase B (approximately **49 minutes excluding that wait**).
  All recorded coding/checkpoint time including the earlier Phase A: **215 minutes**.

## Phase D verification outcome

- Case 1 only: `npm run build` passed (2026-10-20, 15:38 UTC).
- Exact Checkpoint D selector
  (`npx vitest run src/webviews/documentdb/queryInsightsStandalone src/webviews/documentdb/collectionView src/webviews/documentdb/queryInsightsShared src/services`)
  passed: **60 files, 1,231 tests, zero failures**. No TDD suite failed; no snapshots changed.
  Because the L2 scenario tables changed, the harness's own unit tests
  (`vitest run --config build/verification/browser/vitest.config.ts`) also ran: **6 files, 79 tests**
  after the stale counts were corrected.
- Headless L2 (own Playwright, no shared browser): **21/21 routes passed** in dark, light and
  high-contrast, with zero harness errors: `default`, `configure`, `configure-invalid` (new),
  `configure-context` (new), `analyze`, `analyze-aggregate`, `analyze-count`. Assertions passed for
  Welcome snippet copy, copy-only recommendation, connectionless raw explain, and Re-run (Stage 2
  called again with identical inputs, recommendations streamed again).
- Keyboard-only run: Tab reaches the step list, each copy button and Continue; Enter moves focus
  to the Configure heading; Tab then reaches the explain editor, the three sample links, command
  type, Edit query, the four row editors, the model picker and **Analyze query**; Enter lands on
  the Analyze heading. At 900 × 600 the Analyze page has exactly one scroll container (the
  wizard body); before, the reused panel added its own `overflow-y: scroll` area.
- Light-theme review caught and fixed an invisible "Optional" badge (`subtle` outline) and two
  privacy-note sentences that ran together.
- Before/after dark screenshots: `~/.copilot/session-state/<session>/files/wizard-ui/`
  (`before-{default,configure,analyze}-dark.png`, `after-{default,configure,configure-invalid,configure-context,analyze,analyze-count}-dark.png`), not in the repo.
- Dev server stopped. No lint, formatting, localization generation, packaging, live model
  request or push. The real-Copilot/manual smoke steps above remain outstanding.
- Phase D time: **26 minutes** (setup + WI-12 5, WI-13 + checkpoint 21).

## Lead review notes (2026-10-20, 15:12 UTC)

- **Time planning takeaway:** coding work for WI-0..WI-11 was about **65 agent-minutes**
  (16 A + ~20 B + 29 C). The ~150-minute gap in WI-7 was the agent blocked on the integrated
  browser tool, not coding. Next time, run L2 scenarios through the agent's own Playwright, or
  share the browser page up front.
- Lead-side L2 check: `/queryInsightsStandalone/analyze-count/dark` renders "Feature preview",
  "Preview · tuned for find queries" on both right-column cards, "Not applicable to count
  queries" for Selectivity / Fetch Overhead / In-Memory Sort, "Documents counted 80", and a
  `COUNT_SCAN → COUNT` plan. (The `run-all.js` helper can't run inside the lead's browser tool:
  `setTimeout is not defined` in that sandbox, which is a tooling limit and not a product bug.)
- **Open follow-ups (not done):**
    - ~~The Analyze step has a nested scroll area (the panel's own scrollbar inside the wizard page).~~
      Fixed in WI-13.
    - Manual smoke with a real connection, real Copilot models and the local prompt (steps above).
