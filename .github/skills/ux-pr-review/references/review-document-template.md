# Review document template

Copy this skeleton verbatim into `docs/ai-and-plans/features/{area}/iterations/NN-{slug}.md`
(or `.../iterations/NN-{slug}/ux-review.md` when that iteration already holds several
documents) and fill the `{{…}}` placeholders during the pre-assessment. Keep the section
order. Sections marked _(seed now)_ are produced during **Prepare**; the P0–P3 item bodies
are filled during the **Live review**.

The file needs frontmatter, as every document under `features/` does:

<!-- prettier-ignore -->
```yaml
---
feature: {{feature-slug}}
kind: ux-review
status: historical
prs: [{{pr-number}}]
created: {{date}}
---
```

---

````markdown
# {{Feature}} — UX Review Pack

> **Who this is for:** anyone about to do a hands-on UX review of the **{{Feature}}**
> feature, or anyone triaging the findings.
> **What this is:** a single catch-up document that captures a round of runtime UX
> feedback, states what the code _actually does today_ (verified against the current
> branch), and — for each item — offers a **suggestion** and a **status**. Items are
> **sorted by priority** (P0 → P3).

- **Feature area:** {{source folders that implement the surface}}
- **PR / branch:** [{{owner/repo#NNN}}]({{pr url}}) · `{{branch}}`
- **Related design docs:** {{links, if any}}
- **Scope:** the UX-facing surface (tree structure, wording, icons, webviews, lifecycle
  actions, error recovery). Backend internals appear only where they explain a
  user-visible symptom.
- **Review date:** {{YYYY-MM-DD}}

## How this review was run

A person exercised the real feature and dictated observations; an AI assistant did the
code-checking, root-cause tracing, and write-up. Each finding is backed by the exact code
path that produces the behavior, so a later implementation pass doesn't have to re-derive
it. Items are grouped and ordered **by priority**; each carries an **Observation** (what
the reviewer saw), a **Finding** (what the code does and why), a **Suggestion**, and a
**Status**. Heavier design questions with real trade-offs are pulled into
[Open ideas](#open-ideas--options-pros--cons).

## Legend

### Priority

| Priority | Meaning                                            |
| -------- | -------------------------------------------------- |
| **P0**   | Blocking — the user gets stuck                     |
| **P1**   | Broken / misleading, or a consistency & safety gap |
| **P2**   | Polish, expectation, or a smaller feature gap      |
| **P3**   | Nice-to-have / cosmetic / acknowledged             |

### Status

| Status             | Meaning                                                                  |
| ------------------ | ------------------------------------------------------------------------ |
| 🟠 **Open**        | Recorded + analyzed; carries a recommendation but stays a _suggestion_   |
| 🟡 **Open (soft)** | Open, but depends on an investigation or is a soft "leave as-is"         |
| ✅ **Implemented** | Changed on this branch and verified (Decision + commit link recorded)    |
| 🚫 **Closed**      | Won't fix — with a mandatory one-line reason                             |
| 🔗 **Tracked**     | Deferred to a repo issue (linked); dropped from the active priority list |

> **Items are worked in iterations.** Anything still 🟠 Open at the end of an iteration
> **moves to the next one** — an item leaves this ledger only as ✅ Implemented, 🚫 Closed,
> or 🔗 Tracked. Each fix records **why it was chosen** (Decision) and **how it was done**
> (Implemented + commit link).

### Markers (inline)

| Marker            | Meaning                                                 |
| ----------------- | ------------------------------------------------------- |
| ⚠️ **Flag**       | Confirmed gap or bug                                    |
| 💡 **Suggestion** | A design/wording recommendation to react to             |
| 🔍 **Answered**   | A "how does this work?" question answered from the code |

> **For the operator:** items below are **Open** by default — each records a recommendation
> ("… leans towards … because …") that is a **suggestion, not a final decision**. Disagree
> freely; where there are real trade-offs, see [Open ideas](#open-ideas--options-pros--cons).

---

## User interaction map _(seed now)_

Where every user action **starts** and where it **terminates**. Divergent terminations
(modal vs. non-modal vs. silent) are flagged here and re-checked live.

**ASCII flow**

```text
{{compact state / branch map — entry points on the left, terminal states on the right}}
```

**Mermaid**

```mermaid
flowchart TD
    {{action}} --> {{decision}}
    {{decision}} -- {{case}} --> {{terminal state, e.g. success toast}}
    {{decision}} -- {{case}} --> {{([SILENT no-op ⚠️])}}
    {{decision}} -- {{case}} --> {{([Modal error])}}
```

**Interaction inventory**

| #     | User action (entry) | Where it lives | Terminal state(s)                | Surface                         | ⚠️                     |
| ----- | ------------------- | -------------- | -------------------------------- | ------------------------------- | ---------------------- |
| {{1}} | {{Click 'Start'}}   | {{file}}       | {{Running badge / silent no-op}} | {{tree / modal / toast / none}} | {{⚠️ if inconsistent}} |

---

## The story in one paragraph

{{2–5 sentences: what the feature does, the journey, and the headline findings by
priority.}}

---

## Priority index

| #   | Priority | Item     | Status  |
| --- | -------- | -------- | ------- |
| 1   | **P0**   | {{item}} | 🟠 Open |
| 2   | **P1**   | {{item}} | 🟠 Open |
| …   |          |          |         |

---

## P0 — Blocking (the user gets stuck)

### 1. {{Title}} ⚠️

**Priority:** P0 · **Status:** 🟠 Open

> **{{Reviewer}} leans towards {{direction}}** — {{one-line rationale}}. _Because {{why}}._

**Observation:** {{what the reviewer saw}}

**Finding:**

- ⚠️ {{what the code does, with a file reference}}
- 🔍 {{answered question, if any}}

💡 **Suggestion:** {{recommended direction; link to an Open idea if there are trade-offs}}

> **Decision (Iteration {{N}}):** {{what the operator chose}}. **Reason:** {{their rationale —
> ask for it; this is the review's value for future maintainers}}.

> ✅ **Implemented (Iteration {{N}}):** {{what was done}}. Files: {{links}}. Commit:
> [`{{sha}}`]({{commit url}}). Verified via {{lint / tests / build}}.

---

## P1 — Broken / misleading, or consistency & safety

{{### items …}}

## P2 — Polish, expectation, or feature gap

{{### items …}}

## P3 — Nice-to-have / cosmetic / acknowledged

{{### items …}}

## Implemented

{{### items that already shipped on this branch, with ✅}}

---

## Iteration log

A running record of each fix pass. Items still 🟠 Open at the end of an iteration roll into
the next one; nothing is dropped without a terminal status.

### Iteration {{N}}

| #     | Item     | Decision (why)      | Outcome                                |
| ----- | -------- | ------------------- | -------------------------------------- |
| {{1}} | {{item}} | {{chosen + reason}} | ✅ Implemented — [`{{sha}}`]({{url}})  |
| {{2}} | {{item}} | —                   | 🟠 Open → carried to Iteration {{N+1}} |

---

## Open ideas — options, pros & cons

Genuinely open design questions with real trade-offs. Recommendations are suggestions to
react to, not decisions.

### O1. {{Question}} (item {{n}})

| Option       | Pros  | Cons  |
| ------------ | ----- | ----- |
| **A. {{…}}** | {{…}} | {{…}} |
| **B. {{…}}** | {{…}} | {{…}} |

> 💡 **Suggested:** {{option + why}}

---

## Appendix A — current flow (reference)

{{Full ASCII phase/flow diagram of the webview or wizard state machine, plus a
phase-by-phase description. This is the detailed version of the User interaction map.}}
````

---

## Notes on filling it in

- **Seed the Flags first.** After Step 4 of Prepare, every pre-discovered inconsistency
  becomes a stub item in the right priority section with status `🟠 Open` and an `⚠️` marker,
  and a row in the Priority index. The operator confirms/adjusts them live.
- **One item = one `###` heading** with the `**Priority:** · **Status:**` line, an optional
  `>` recommendation blockquote, then **Observation / Finding / Suggestion**.
- **Keep the Priority index and the todo list in sync** as items are added or resolved.
- **File references** use workspace-relative links to the exact file (and line where useful).
- **Fix in iterations.** When the operator starts fixing, add each pass to the **Iteration
  log**. Every item still `🟠 Open` at the end of an iteration is carried to the next one —
  an item only leaves the ledger as `✅ Implemented`, `🚫 Closed` (with a reason), or `🔗
Tracked` (issue link).
- **Always record the _reason_ for a decision.** Ask the operator why they chose a fix and
  write it in the item's **Decision** block. This rationale is the primary value of the
  review for future maintainers and contributors.
- **Document every fix with a commit link.** On completion, flip the status to `✅
Implemented` and add the **Implemented** block (what changed, files, commit SHA link,
  verification).
