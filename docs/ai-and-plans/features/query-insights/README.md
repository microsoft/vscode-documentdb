---
feature: query-insights
kind: notes
status: active
prs: [616, 690, 711]
verified: 2026-08-14
code:
    - src/documentdb/queryInsights/**
    - src/services/ai/**
    - src/webviews/documentdb/collectionView/queryInsights/**
    - src/webviews/documentdb/collectionView/queryInsightsTab/**
---

# Query Insights

**Status:** shipped · **Verified:** 2026-08-14

> Why the Query Insights panel rates queries the way it does, and why the AI stage streams.

Query Insights explains what a query actually did. It runs in stages: collect execution
statistics, derive a static performance rating with badges and a score, then ask an AI model for
recommendations. The static and AI stages must agree, and the AI stage must stay responsive while
the user waits.

## Code map

- `src/documentdb/queryInsights/**` — the analysis pipeline and rating logic
- `src/services/ai/**` — the AI service and prompt construction, including model transparency
- `src/webviews/documentdb/collectionView/queryInsights/**` and `.../queryInsightsTab/**` — the panel
- `src/webviews/documentdb/collectionView/queryInsightsReducer.ts` — the streaming state machine

## User docs

- [docs/user-manual/collection-view-querying.md](../../../user-manual/collection-view-querying.md)
- [docs/user-manual/ai-utility-model.md](../../../user-manual/ai-utility-model.md)

## Related skills

- [.github/skills/telemetry-instrumentation](../../../../.github/skills/telemetry-instrumentation/SKILL.md)

## Architecture (intent — code is authoritative for behavior)

- **Stage 2 is deterministic, Stage 3 is not.** The static analysis produces the badges and score
  without a model. The AI stage refines and explains, and it is fed the static verdict so the two
  cannot contradict each other without saying why.
- **The AI stage streams.** Stage 3 renders progressively rather than blocking on a single response,
  because the goal is _perceived_ responsiveness — the earlier design left the user with a blank
  spinner for roughly fifteen seconds.
- **The model in use is visible to the user.** Which model answered is part of the panel, not an
  implementation detail.

## Timeline

| Date       | PR   | What changed                                        | Docs                                                                                    |
| ---------- | ---- | --------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 2026-04-27 | —    | Performance rating: plan and implementation notes    | [iterations/01-performance-rating.md](./iterations/01-performance-rating.md)             |
| 2026-04-27 | #616 | AI analysis aligned with the static analysis         | [iterations/02-ai-static-analysis-alignment.md](./iterations/02-ai-static-analysis-alignment.md) |
| 2026-05-28 | #690 | AI model transparency in the panel                   | [iterations/03-ai-model-transparency.md](./iterations/03-ai-model-transparency.md)       |
| 2026-06-01 | #711 | Progressive streaming for Stage 3 recommendations    | [iterations/04-streaming-stage-3/](./iterations/04-streaming-stage-3/)                   |

## Decisions

No separate `decisions.md` yet. The load-bearing decisions are recorded inside the iterations,
most usefully in
[iterations/04-streaming-stage-3/review-and-resolutions.md](./iterations/04-streaming-stage-3/review-and-resolutions.md),
which is severity-sorted and records alternatives, verification status, and the operator's calls.
Start a `decisions.md` the next time a choice here needs to outlive its iteration.

## Open gaps

Tracked inside the iteration documents rather than centrally. The streaming work has a deviation log
in [iterations/04-streaming-stage-3/original-plan.md](./iterations/04-streaming-stage-3/original-plan.md).

## Reading order for newcomers

1. This README
2. [iterations/04-streaming-stage-3/description.md](./iterations/04-streaming-stage-3/description.md)
   — the most recent narrative of how the panel works end to end
3. Older iterations only for provenance
