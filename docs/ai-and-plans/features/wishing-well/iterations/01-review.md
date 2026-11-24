---
feature: wishing-well
kind: review
status: active
prs: [1122]
created: 2026-11-24
---

# AI review rounds and what was decided

The Wishing Well is a proof of concept, so this records what the reviews found and what the
operator chose, not a hardening plan. Three rounds ran on 2026-11-23 and 2026-11-24. Severities are
the reviewers' where they gave one, otherwise the session lead's.

| Round              | Reviewers                                                                                                      | Looked at                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 1. Product review  | Gemini 4 Neon (xhigh), GPT-6.2 Astra (max)                                                                     | UI/UX and agent experience of the first build |
| 2. User journeys   | The same two, given live evidence                                                                              | What users will try; no AI; small models      |
| 3. Break the fixes | Three Claude Opus reviewers, one lens each (query text, honesty, keyword mode), then one more on the follow-up | The round 2 fixes                             |

Live evidence behind round 2: 50 wishes with no Copilot; the well's real prompt sent one-shot to a
small model (Claude Haiku) for 32 wishes at two scopes; Claude Haiku, Claude Sonnet and Copilot CLI
on GPT-6 Luna doing seven tasks over MCP. The real `copilot-utility` reader and the in-editor
Copilot tools were never run: the test profile had no Copilot sign-in.

## Findings and outcomes

| Finding                                                                              | Severity | Evidence                                                      | Decision and outcome                                                                                                            |
| ------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Keyword mode guessed a `deleteMany` for "remove the tag from all orders"             | P0       | Round 1, reproduced                                           | Operator: fix. Without Copilot the well only launches tools and never drafts a write.                                           |
| A shell wish opened tabs and stole focus from the terminal                           | P1       | Round 1                                                       | Operator: fix. A shell wish prints its card; `wish open` opens it.                                                              |
| An agent's wish could raise a sign-in prompt the agent cannot see                    | P1       | Round 1                                                       | Operator: fix. Agents get "needs sign-in"; links, Copilot hand-offs and non-DocumentDB commands ask the user first.             |
| Date and id filters in find and the collection view returned nothing or were refused | P0       | Round 2: `{"$date":…}` gave 0 rows shown as an answer         | Operator: fix. Filters are converted to the shell syntax the query parser reads.                                                |
| A read's card hid the query and dropped the reader's own caveat                      | P0       | Round 2: "does not filter by gold yet" never reached the user | Operator: fix. Read cards show the query that ran and the reader's note, on every surface.                                      |
| Granting export, import or create blocked until the user finished                    | P0       | Round 2: agents timed out after 60 s; cancel read as granted  | Operator: fix. These grants return at once as "opened, not done".                                                               |
| The prompt promised CSV export                                                       | P1       | Round 2: export writes JSON and always the whole collection   | Operator: fix. Prompt, hints and messages say so.                                                                               |
| Plain answers described themselves                                                   | P1       | Round 2: 3 of 6 in the simulation                             | Operator: fix. One prompt line; 0 of 11 after.                                                                                  |
| One-shot reader guessed field names                                                  | P1       | Round 2: 8 of 29 reads wrong, none flagged                    | Operator: fix. Field hints for the collections a wish names, and for every collection of a small database; 0 of 27 wrong after. |
| Keyword mode knew only a fixed list of nouns                                         | P1       | Round 2: "show me the wishes" refused on the demo database    | Operator: fix. Real collection names, plus routes for create, health check and help.                                            |
| 29 defects in the round 2 fixes, 2 of them P0                                        | P0 to P2 | Round 3                                                       | Fixed in the same pass, each with a test.                                                                                       |

## Left open on purpose

On 2026-11-24 the operator steered the work away from implementation polish and towards the idea
and its prototype. These are for the team to discuss, not decided:

- Should "Make a Wish" sit in the side-bar menus by default, or behind a setting?
- Should the well keep generic VS Code commands (theme, zoom, Zen Mode)? Both reviewers would cut them.
- Should outside agents see clusters found through discovery, not only saved connections?
- Should agents get read-only explain and index spells, so "why is this slow" can be answered instead of opened?
- Without Copilot the well answers no data question. Is a launcher enough, or should it run a plain count?

## Not done

- GitHub Copilot's reviewer comments are not merged here: that review starts when the PR leaves draft.
- No run against the real `copilot-utility` model, a large database, or a slow remote cluster.
