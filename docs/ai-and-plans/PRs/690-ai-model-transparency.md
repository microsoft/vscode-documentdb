# PR #690: AI model transparency for Query Insights panel

**Branch:** `dev/tnaum/query-insights-model-transparency`
**Base:** `main`
**Date:** 2026-05-28
**PR URL:** https://github.com/microsoft/vscode-documentdb/pull/690
**Commits:** 15 on top of `main`

---

## Why

The Query Insights panel uses GitHub Copilot to generate AI-powered performance recommendations for DocumentDB queries. Before this PR, users had no visibility into:

1. **Which model** was used to generate the response.
2. **Whether the feature costs credits** from their GitHub Copilot quota.

Both concerns surfaced during a review of the Query Insights UX. GitHub Copilot's billing model distinguishes between _premium_ requests (which consume per-seat credit from a monthly quota) and _utility_ requests (which are documented as not counting against the quota). Users running this feature would reasonably worry about unexpected costs, and the extension provided no signal either way.

Additionally, the engineering team wanted better diagnostic visibility into:

- **Model selection outcomes** — which models were requested, accepted, rejected.
- **Token utilization** — how much of the model's context window is consumed per request, as a proxy for prompt health.

---

## What was done

### 1. Model ID surface to webview

`copilotService.ts` was extended so that `CopilotResponse` carries the `modelUsed` field — the `id` of the `vscode.LanguageModelChat` instance that was actually used. This flows through:

```
copilotService.sendMessage
  → indexAdvisorCommands.ts (OptimizationResult.modelUsed)
    → QueryInsightsAIService.ts (AIOptimizationResponse.modelUsed)
      → transformations.ts (transformAIResponseForUI)
        → QueryInsightsStage3Response.modelUsed (webview type)
          → collectionViewRouter.ts (Stage 3 tRPC result + telemetry)
            → QueryInsightsTab.tsx (rendered in byline)
```

The Stage 3 tRPC router also emits `aiModelDisclosed` as a telemetry property so model usage is visible in the telemetry pipeline.

### 2. Pre-invocation cost-neutral disclosure row

`GetPerformanceInsightsCard` gained a persistent info row (always rendered — during idle, loading, and error states) beneath the action buttons:

> _No additional cost for most GitHub Copilot subscribers._ [Learn more about the utility model used.]

The "Learn more" link opens `https://aka.ms/vscode-documentdb-copilot-utility-model` via `onLearnMoreUtilityModel` callback, separate from the general `onLearnMore` (index-advisor docs) so the two pages can differ.

The `modelHint` prop that was added in an earlier iteration (to show a static `"GPT-4o"` label in the disclosure text before the response was available) was removed: the simplified wording does not need a model name pre-invocation, and the hint was always speculative (the actual model is only known after `vscode.lm.selectChatModels` resolves).

### 3. Post-response byline (two lines)

After a successful Stage 3 response, a byline appears beneath the AI suggestions list:

- **Line 1** (identical to the pre-invocation row): cost-neutral disclosure + utility model link — so users who scrolled past the card still see the billing context alongside the results.
- **Line 2**: `Powered by {modelId} via GitHub Copilot` — concrete attribution with the actual model ID returned by the API.

The byline is only rendered when `stage3Data.modelUsed` is present (i.e. when the model ID was successfully surfaced).

### 4. Token usage tracking

`copilotService.sendMessage` now calls `countTokens` (a stable VS Code LM API method) in parallel for each message in the request and for the response text. The results are aggregated into a `CopilotTokenUsage` object:

```typescript
interface CopilotTokenUsage {
  promptTokens?: number;
  responseTokens?: number;
  totalTokens?: number;
  maxInputTokens?: number; // from model metadata
  promptUtilizationPct?: number; // promptTokens / maxInputTokens * 100
}
```

All five measurements are emitted to:

- The trace output channel (`formatTokenCount` helper: compact K/M notation via `Intl.NumberFormat`).
- The `indexOptimization` telemetry event (as numeric measurements).

`CopilotTokenUsage` flows through the same pipeline as `modelUsed` (`OptimizationResult`, `AIOptimizationResponse`, `transformations.ts`, `QueryInsightsStage3Response`) for completeness, but the values are **not rendered in the UI**.

### 5. Model selection tracing

`selectBestModel` now emits per-candidate trace lines:

```
[AI] Model requested: gpt-4.1 -- accepted (id: copilot-gpt-4.1)
[AI] Model requested: gpt-4o -- rejected (not available)
```

`sendMessage` records four telemetry properties: `modelPreferenceChain`, `modelsAvailable`, `modelSelectionOutcome`, `modelsAvailableCount`.

`dumpModelMetadata` was added for diagnostics: it traces all stable fields on `LanguageModelChat` (`id`, `vendor`, `family`, `version`, `name`, `maxInputTokens`) plus any additional own enumerable non-function properties.

### 6. copilot-utility fallback

`FALLBACK_MODELS` in `promptTemplates.ts` was extended with `copilot-utility` as the last resort. The model selection order is now: `gpt-4.1` -> `gpt-4o` -> `copilot-utility`.

### 7. Link font-size fix

Fluent v9 `<Link>` does not inherit `font-size` from its parent `<Text size={200}>` container (the `fui-Link` CSS class sets 14px unconditionally). Both disclosure row `<Link>` instances — in `GetPerformanceInsightsCard` and in the `QueryInsightsTab` byline — now carry:

```tsx
style={{ fontSize: tokens.fontSizeBase200, lineHeight: tokens.lineHeightBase200 }}
```

---

## Key decisions and rationale

### Why credits used are NOT shown

The user specifically explored surfacing Copilot credit usage alongside query results. The investigation found:

- **The stable VS Code LM API** (`vscode.LanguageModelChat`, `vscode.lm`) does not expose pricing or credit data. The only cost-related surface is `countTokens`, which measures token volume — not credits.
- **A proposed API** (`vscode.proposed.languageModelPricing.d.ts`) exists in the VS Code source tree and exposes `inputCostPerToken` / `outputCostPerToken`. However:
  - Proposed APIs can be broken or removed at any VS Code release without a deprecation period.
  - Using them requires opting in via `enabledApiProposals` in `package.json`, which is not permitted for extensions published to the VS Code Marketplace without explicit Microsoft sign-off.
  - The `languageModelPricing` proposed API had not yet been validated as production-ready at the time of this work.

**Decision**: credits are not surfaced. The extension remains entirely on stable VS Code APIs. The `countTokens` measurements flow to telemetry and traces — not the UI — as a cost-awareness proxy that does not make billing promises to users.

A GitHub issue was drafted to track the feature request for showing credits once the pricing API stabilises (no issue number assigned at time of writing — issue creation via MCP was not available because the `github-pull-request` MCP server only supports PR/search operations, and the `gh` CLI auth token had expired).

### Why token counts are not in the UI

`countTokens` returns a token count, not a cost. Displaying raw numbers risks confusion: tokens ≠ credits, the conversion ratio is model-dependent, and it may change across model versions. The appropriate consumer of token numbers is telemetry dashboards and diagnostic traces, not end users. Keeping them out of the UI avoids support tickets like "why did this use 2,400 tokens?".

### Why "most GitHub Copilot subscribers" not "all"

Copilot's public documentation describes utility model requests as included in the standard subscription. However, enterprise agreements, custom billing, and educational accounts may differ. "Most" is an intentional hedge — accurate without overpromising to edge-case users.

### Why the disclosure wording iterated several times

The initial iteration used: _"Uses a utility model, intended to be cost-neutral for GitHub Copilot subscribers."_

Several problems:

- "Intended to be cost-neutral" is hedged but passive — it sounds uncertain rather than reassuring.
- The word "free" was considered but rejected because pricing deals vary.
- "Included in your subscription" (Option A in the chat exploration) was considered but "subscription" vs "plan" naming varies across Copilot SKUs.
- Final choice: _"No additional cost for most GitHub Copilot subscribers."_ — leads with the user benefit (no extra charge), uses "most" as an honest hedge, and matches the phrasing GitHub uses in its billing documentation.

### Why `modelHint` was removed

An earlier commit added a `modelHint?: string` prop to `GetPerformanceInsightsCard` to allow the parent to pass a static hint like `"GPT-4o"` for use in the pre-invocation disclosure text. The prop was removed because:

1. The simplified disclosure wording no longer interpolates a model name.
2. Any static model name would be speculative — the actual model is only known after the VS Code LM API resolves (post-click).
3. Dead props add maintenance surface and mislead future contributors.

### Why `aka.ms/vscode-documentdb-copilot-utility-model` rather than the existing index-advisor URL

The existing `onLearnMore` callback (and `aiInsightsDocsUrl`) already points to `https://learn.microsoft.com/azure/documentdb/index-advisor`, which covers the full Query Insights feature. That page does not explain the utility model tier or its billing implications. A dedicated `aka.ms` redirect:

- Allows the docs team to point the link at the most relevant page without a code change.
- Follows the pattern already established by `https://aka.ms/vscode-documentdb-copy-and-paste`.

⚠️ **The slug `https://aka.ms/vscode-documentdb-copilot-utility-model` must be registered at https://aka.ms/admin before this PR ships.**

---

## Files changed (significant)

| File                                                                                                                                    | Change                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `src/services/copilotService.ts`                                                                                                        | `CopilotTokenUsage` interface; token measurement; model selection tracing; `dumpModelMetadata`; `formatTokenCount` import |
| `src/utils/formatTokenCount.ts`                                                                                                         | New utility — compact K/M number formatter for token counts                                                               |
| `src/commands/llmEnhancedCommands/indexAdvisorCommands.ts`                                                                              | Thread `modelUsed` + `usage` through `OptimizationResult`; emit token telemetry                                           |
| `src/commands/llmEnhancedCommands/promptTemplates.ts`                                                                                   | Add `copilot-utility` to fallback chain                                                                                   |
| `src/services/ai/types.ts`                                                                                                              | `AIOptimizationResponse.modelUsed` + `.usage`                                                                             |
| `src/services/ai/QueryInsightsAIService.ts`                                                                                             | Propagate `modelUsed` + `usage` from optimization result                                                                  |
| `src/documentdb/queryInsights/transformations.ts`                                                                                       | Surface `modelUsed` + `usage` in UI transform                                                                             |
| `src/webviews/documentdb/collectionView/types/queryInsights.ts`                                                                         | `QueryInsightsStage3Response.modelUsed` + `.usage`                                                                        |
| `src/webviews/documentdb/collectionView/collectionViewRouter.ts`                                                                        | Emit `aiModelDisclosed` telemetry; thread token measurements to Stage 3 telemetry event                                   |
| `src/webviews/documentdb/collectionView/components/queryInsightsTab/components/optimizationCards/custom/GetPerformanceInsightsCard.tsx` | `onLearnMoreUtilityModel` prop; revised disclosure row text + link                                                        |
| `src/webviews/documentdb/collectionView/components/queryInsightsTab/QueryInsightsTab.tsx`                                               | `utilityModelUrl` + `handleLearnMoreUtilityModel`; two-line post-response byline                                          |
| `l10n/bundle.l10n.json`                                                                                                                 | Regenerated with all new strings                                                                                          |

---

## Related issues and references

- **GitHub Copilot utility model billing docs**: https://docs.github.com/copilot/managing-copilot/monitoring-usage-and-entitlements/about-copilot-usage-data (background research)
- **VS Code proposed languageModelPricing API**: intentionally not used — see design decisions above
- **Feature issue for credits UI** (to be filed): expose Copilot credit usage in Query Insights once `vscode.proposed.languageModelPricing` graduates to stable
- **PR #676** (`dev/tnaum/webview-api-package`): the webview transport hardening that preceded this work; established the tRPC/telemetry patterns used here

---

## Model selection rationale (background research)

The following comparison was used to decide which model to set as the primary preference for the index recommender. It is recorded here so the choice of `gpt-4.1` as `PREFERRED_MODEL` (with `gpt-4o` and `copilot-utility` as fallbacks) has a written rationale.

If cost is irrelevant (all are utility models), choose **GPT-4.1** for the index recommender unless speed is the top constraint. It should be the most dependable of these for explain-plan reasoning and following precise instructions.

| Model            | Explain-plan understanding | Instruction following |         Speed | Best use                                                                                                                                                                                                            |
| ---------------- | -------------------------: | --------------------: | ------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GPT-4.1**      |                   **Best** |              **Best** |        Medium | **Primary choice** for DocumentDB index recommendations where correctness matters. Best at reasoning through `winningPlan`, `executionStats`, compound index order, sort coverage, range predicates, and tradeoffs. |
| **GPT-4o**       |                  Very good |             Very good |      **Fast** | Best speed/quality balance. Use if you want quicker interactive recommendations and can tolerate slightly less depth on tricky plans.                                                                               |
| **GPT-4o mini**  |                   Moderate |              Moderate | **Very fast** | Useful for simple triage, summarizing explain plans, extracting query shapes, or flagging obvious missing indexes. Riskier as the final decision-maker.                                                             |
| **GPT-5.4 nano** |             Light/moderate |        Light/moderate |   **Fastest** | Best for routing, formatting, structured extraction, or quick "needs review / doesn't need review" checks. Not my pick for nuanced recommendations.                                                                 |

**Bottom line:** use **GPT-4.1** if you want the best single model. Use **GPT-4o** if you want a noticeably faster assistant and most recommendations are straightforward. Use the mini/nano models only as pre-processors or triage layers, not as the final recommender.

---

## Review-feedback follow-up (post-initial-push)

After the first push, [`docs/analysis/pr-690-review.md`](../../analysis/pr-690-review.md) was used to drive a second round of changes addressing reviewer findings. Items below are **significant** changes only — comment-only / wording-only fixes are recorded in the per-fix PR comments. See [`docs/analysis/pr-690-high-finding-research.md`](../../analysis/pr-690-high-finding-research.md) for the research note that informed the High finding direction.

### `CopilotResponse` now exposes id / family / display-name separately (Medium #2)

`CopilotResponse.modelUsed: string` is removed. The contract now carries three distinct fields:

```typescript
interface CopilotResponse {
  modelId: string; // stable LanguageModelChat.id (telemetry, exact compare)
  modelFamily: string; // stable LanguageModelChat.family (preferred-model check)
  modelDisplayName: string; // human-readable LanguageModelChat.name (byline only)
  // ...
}
```

This propagates through `OptimizationResult`, `AIOptimizationResponse`, `transformations.ts`, `QueryInsightsStage3Response`, and the webview (`QueryInsightsTab` reads `modelDisplayName`). The Stage 3 telemetry property is split into `aiModelDisclosed` (id) and `aiModelFamily`.

The warning toast that used to fire on every Copilot response (because `display name !== preferred id`) now compares against `modelFamily` first, falling back to `modelId` for `copilot-utility`-style entries that aren't expressed as a family.

### Per-feature model constants + telemetry `featureSource` (Medium #4)

The previously shared `PREFERRED_MODEL` / `FALLBACK_MODELS` in `promptTemplates.ts` are split into per-feature constants. The constants are deliberately named after `LanguageModelChat.family` (see "Family-based model selection" below):

- `INDEX_OPTIMIZATION_PREFERRED_FAMILY` / `INDEX_OPTIMIZATION_FALLBACK_FAMILIES`
- `QUERY_GENERATION_PREFERRED_FAMILY` / `QUERY_GENERATION_FALLBACK_FAMILIES`

Values are unchanged (`gpt-4.1` -> `gpt-4o` -> `copilot-utility` for both) but the structure makes it safe to diverge later. `CopilotMessageOptions.featureSource: 'queryInsights' | 'queryGeneration'` is plumbed in so the shared `vscode-documentdb.copilot.sendMessage` telemetry event is now attributable by source via a `featureSource` property.

### Family-based model selection (High #1 follow-up)

`CopilotService.selectBestModel` now matches the preferred-model chain against `LanguageModelChat.family` (the well-known stable name returned by the VS Code Language Model API — `gpt-4.1`, `gpt-4o`, …) rather than `LanguageModelChat.id`. Public `CopilotMessageOptions` fields are renamed in lockstep:

- `preferredModel` → `preferredFamily`
- `fallbackModels` → `fallbackFamilies`
- `getPreferredModels` (helper) → `getPreferredFamilies`

The naming pivot is intentional: `LanguageModelChat.id` is documented as **opaque** and can change between Copilot extension versions or carry date-stamped suffixes like `copilot-gpt-4o-mini-2024-07-18`. `LanguageModelChat.family` is the documented stable surface and is what the official VS Code Language Model API examples use:

```typescript
const [model] = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4o' });
```

#### Why this is safe for `copilot-utility`

`copilot-utility` is not a "real" model family — it's an alias the Copilot extension publishes for whichever endpoint is currently marked `is_chat_fallback`. We verified directly against the Copilot Chat extension source (`microsoft/vscode-copilot-chat`, `src/extension/conversation/vscode-node/languageModelAccess.ts`) that **alias entries are registered with the alias string used as _both_ `id` and `family`**:

```typescript
// Primary model entry: id and family DIFFER
models.push({
  id: endpoint.model, // e.g. "copilot-gpt-4.1"
  family: endpoint.family, // e.g. "gpt-4.1"
  name: endpoint.name, // e.g. "GPT-4.1"
  // ...
});

// Alias entries: id and family are the SAME alias string
const aliases = ModelAliasRegistry.getAliases(model.id);
for (const alias of aliases) {
  models.push({
    ...model,
    id: alias, // e.g. "copilot-utility"
    family: alias, // same alias string for family too
    isUserSelectable: false,
  });
}
```

So every entry in our preferred/fallback chain — `gpt-4.1`, `gpt-4o`, `copilot-utility` — matches by family today, and the matcher does not need an `|| id === preferred` belt-and-braces fallback to handle aliases.

#### Why this was a real bug

Before this change, `selectBestModel` matched on `m.id === preferredId`. With Copilot exposing real model ids like `copilot-gpt-4.1` and `copilot-gpt-4o`, our `'gpt-4.1'` / `'gpt-4o'` chain entries never matched, and the code silently fell through to `availableModels[0]`. The `copilot-utility` entry happened to match (because aliases register the alias string as the id), which masked the bug in casual testing. Family-based matching fixes the silent fallback for the primary entries while keeping `copilot-utility` selectable.

#### Warning-toast check follows the same rule

The "preferred model not used" warning checks in `indexAdvisorCommands.ts` and `queryGenerationCommands.ts` now also compare strictly on family (`response.modelFamily === preferredFamilyToUse`). The earlier defensive `|| modelId === ...` fallback was removed once we confirmed aliases register family alongside id — it added a branch that could never fire in practice for any entry in our chain, and would only matter if we ever pinned a date-stamped snapshot id, which we do not.

### Manual softened: post-response token measurement, not pre-send budgeting (Medium #3, Additional #1)

`docs/user-manual/ai-utility-model.md` previously claimed the extension truncates query plan / statistics pre-send when they exceed `maxInputTokens`. No such truncation exists. The "We target the model's context window" paragraph is rewritten to describe what is actually implemented: `maxInputTokens` is read from model metadata, prompt tokens are counted **after** the response, and `promptUtilizationPct` is surfaced via telemetry and the trace output channel for diagnostics.

The "Which model was actually used?" paragraph is also corrected to match the byline change: the byline shows `LanguageModelChat.name` (e.g. `GPT-4o`), not the opaque id, and the stable id is captured in telemetry / trace for diagnostics.

The fallback-chain advertisement is updated to `GPT-4.1 -> GPT-4o -> copilot-utility` to match the code (Low #5).

### `modelsAvailable` telemetry capped and deduped (Additional Low)

The `modelsAvailable` property used to join every `LanguageModelChat.id` verbatim and routinely exceeded downstream property-size limits. It now uses families (short stable names), dedupes via `Set`, sorts, caps at 8 entries, and appends `+N-more` when truncated.

### `dumpModelMetadata` memoised per model id (Additional Low)

Static metadata for a given `LanguageModelChat.id` is now emitted at most once per extension-host process instead of on every Copilot request, keeping the trace stream readable.

### Consent-missing error message clarified (Additional Nit)

The "No suitable language model found" error now also mentions the VS Code language-model access consent prompt, so users who dismissed it know to re-run the feature to re-trigger it.

### Service-internal trace prefix unified to `[Copilot]` (Additional Nit)

The cancellation trace inside `CopilotService` no longer says `[Query Insights AI]`; service-internal traces are now consistently prefixed `[Copilot]` while caller-side traces keep their feature prefixes (`[Query Insights AI]`, `[Query Generation]`).
