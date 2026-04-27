# PR #616: Align AI Analysis with Static Analysis in Query Insights

**Status:** Open
**Branch:** `dev/tnaum/query-insights-ai-improvement`
**Base:** `next`
**Date:** 2026-04-27

## Problem

The AI-powered query analysis (Stage 3) had no knowledge of what the user was already shown in the static analysis (Stage 2). This caused:

1. **Contradicting assessments** — The AI gave different performance ratings without explaining why they diverged from the static analysis badges and score.
2. **Bad index recommendations** — For boolean queries (e.g., `{isFamilyFriendly: true}`) returning 55% of a 65K collection, the AI recommended HIGH PRIORITY index creation. When the user followed this advice and re-ran the query, the static analysis would then show a "Low-cardinality index" warning, creating a back-and-forth loop.
3. **Missing context** — The AI had no knowledge of selectivity, fetch overhead, performance rating, or diagnostic badges the user already saw.

## Solution Architecture

```
  Stage 2 (Static Analysis)
       |
       v
  transformStage2Response() → QueryInsightsStage2Response
       |                              |
       v                              v
  UI renders badges,             buildStaticAnalysisSummary()
  selectivity, rating                  |
                                       v
                              Compact text summary (~1400 chars)
                                       |
                              Stage 3 Router
                                       |
                                       v
                              fillPromptTemplate()
                                       |
                                       v
                              3 messages to LLM:
                                1. Crafted prompt (instructions)
                                2. User query (data)
                                3. Context data (stats + static analysis)
                                       |
                                       v
                              LLM response acknowledges
                              static analysis, may diverge
                              with explanation
```

## Key Implementation Decisions

### 1. Instruction Positioning Matters for LLM Compliance

The CRITICAL rules for low-cardinality and high-return-ratio were initially placed at positions 21-22 out of 22 instructions. GPT-4o completely ignored them because:
- LLMs weight early instructions much more heavily than late ones
- The strong COLLSCAN→create-index prior from training data overrides late rules
- The role framing as "Index Advisor" biased the model toward always recommending something

**Fix:** Moved to positions 3-4 (right after "do not hallucinate"), added `CRITICAL` prefix, and renamed the role from "Index Advisor assistant" to "Query Performance Analyst".

### 2. Metadata Echo Was Pure Token Waste

The prompt required the LLM to echo back `collectionStats`, `indexStats`, and `executionStats` in a `metadata` field. Investigation showed:
- The `parseAIResponse()` method never extracted the `metadata` field
- The `AIOptimizationResponse` TypeScript type doesn't include `metadata`
- This was consuming ~40% of response tokens for data we already had

**Fix:** Removed the entire `metadata` block from the JSON schema.

### 3. Prettier Mangles Prompt Files

Prettier was reformatting the `.prompt.md` files, collapsing triple backtick references (` ```json ` → `` `json ``) and changing indentation. This broke the LLM's JSON output formatting instruction.

**Fix:** Added `resources/prompts/` to `.prettierignore`.

### 4. Prompt Resource Files vs Inline Constants

Prompt bodies were extracted to `resources/prompts/` for easier editing, but inline constants are kept as fallbacks for when the extension context isn't available (tests, early startup). The `promptSource` telemetry property tracks which source is used, enabling future removal of inline fallbacks once we confirm resource files always load.

### 5. Static Analysis Summary Design

The summary is deliberately compact (~1400 chars for a typical query) to avoid doubling prompt size. It includes:
- Performance rating with explicit scale (`GOOD (scale: Excellent > Good > Fair > Poor)`)
- Collection context (total docs, returned, examined, exec time)
- All 4 summary indicators (selectivity, index used, fetch overhead, in-memory sort)
- All diagnostic badges with type markers (`[+]`/`[-]`/`[i]`) and details
- Concerns when present

## Lessons Learned

1. **LLM instruction compliance is position-dependent** — Critical rules must be in the first 5 positions, not at the end. Use `CRITICAL` prefix for emphasis.
2. **Role framing creates bias** — "Index Advisor" biases toward recommending indexes. "Performance Analyst" is more neutral and allows "no changes needed" outcomes.
3. **Concrete examples in prompts can skew** — A specific example (`isFamilyFriendly: true, 65K docs, 35K returned`) can cause the model to pattern-match too narrowly. Generic descriptions of the anti-pattern work better.
4. **Don't ask for data you don't use** — Removing the metadata echo saved ~40% of response tokens with no functional impact.
5. **Protect prompt files from formatters** — Markdown prompt files have precise formatting that automated tools will break.

## Files Changed

| Area | Files | Purpose |
|------|-------|---------|
| Core | `staticAnalysisSummary.ts` | Builds compact text summary of Stage 2 |
| Core | `collectionViewRouter.ts` | Caches Stage 2, builds summary for Stage 3 |
| Core | `ClusterSession.ts` | Stage 2 response cache |
| Core | `indexAdvisorCommands.ts` | Passes summary through prompt pipeline |
| Core | `QueryInsightsAIService.ts` | Accepts summary parameter |
| Prompts | `resources/prompts/*.prompt.md` | Extracted template bodies |
| Prompts | `promptTemplates.ts` | Resource loading, inline fallbacks, prompt source tracking |
| Prompts | `promptTemplateService.ts` | Resource file loading via `buildIndexAdvisorPrompt()` |
| Config | `.prettierignore` | Excludes prompt files |
| Tests | `promptTemplates.test.ts` | 66 tests for prompt integrity |
| Tests | `staticAnalysisSummary.test.ts` | 16 tests for summary builder |
