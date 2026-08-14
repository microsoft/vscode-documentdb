---
area: documentation
kind: plan
status: active
created: 2026-08-13
---

# Restructuring `docs/ai-and-plans/` — analysis, decisions, and migration plan

> **Who this is for:** a fresh agent or contributor picking this up cold, with no
> memory of the discussion that produced it. Everything needed to execute the
> migration is in this document.
>
> **Status:** **executed 2026-08-14.** §1–§8 and §10 have landed; see the
> execution record below for what was done and where the execution deviated.
> §8A (skills) is still open.
>
> **How to use this document:** read §1–§4 to understand _why_, §5–§7 for the
> target shape and templates, §8–§10 to execute. §11 lists what was explicitly
> rejected — do not re-open those without new evidence.

---

## 0. Execution record (2026-08-14)

The migration landed in four commits: a pure-rename commit, a link-repair commit,
a frontmatter-plus-pilot commit, and a READMEs commit, followed by the policy
updates in §8.1–§8.4.

**Result:** 92 documents moved into 11 areas plus `cross-cutting/` and
`practices/`; every document carries frontmatter; every area has a README; the
pilot acceptance test in §10 passes (all seven questions answerable from
`features/local-quickstart/README.md`, and zero broken links or anchors inside that
area). Repo-wide, broken links in `docs/ai-and-plans/` fell from 322 to 219, and
**zero** of the remainder were caused by the migration — they are dead paths left
by earlier source refactors, from before this work.

**Deviations from the plan, and why:**

| §         | Plan said                                                                           | What was done                                                                                                                                                                                          | Why                                                                                                                                                                                                                                                                                           |
| --------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §4 rule 2 | "One file per iteration"; folder only at ~3+ documents or a >1000-line merge        | An iteration with exactly two documents (a plan and its review) keeps both as adjacent flat files, `NN-slug.md` + `NN-slug-review.md`. Folders are still used at 3+ documents or >1000 combined lines. | Merging would have rewritten content in a commit meant to be mechanical, destroyed `git log --follow` for the second document, and gained nothing: two adjacent flat files sort together and produce no mostly-empty directory, which is what rule 2 exists to prevent. Affects 5 iterations. |
| §7.1      | `PRs/714-…` "(2 files, merged into one iteration)"                                  | Kept as a flat pair, like the other two-document iterations                                                                                                                                            | Consistency with the rule above. It was the only explicit merge instruction in the plan.                                                                                                                                                                                                      |
| §5        | `cross-cutting/decisions.md` for extension-wide calls (dual-ID scheme, terminology) | Not created                                                                                                                                                                                            | No source document for those decisions exists in the corpus. Writing entries with no recorded options or rationale would have manufactured evidence. Create it when a real extension-wide decision needs recording.                                                                           |
| §7.1      | Per-area `future-work.md` replaces the central `future-work/` folder                | `query-playground` and `completions-and-schema` each keep two: `future-work.md` and `future-work-<topic>.md`                                                                                           | Both areas inherited two distinct future-work lists. Folding them into one file needed heading surgery that would have broken existing anchors, for no navigational gain: both areas stay well under the ~6-root-file threshold in rule 5.                                                    |
| §9.2      | Three commits; link repairs cover intra-document links                              | Four commits, and the link-repair commit also updates three `@see` comments in `src/`                                                                                                                  | Those comments were the only reverse index from code back to design rationale, which §6.1 calls the highest-value optional metadata. Leaving them broken would have defeated the point. The fourth commit separates the pilot from the remaining areas.                                       |
| §9.1      | Do not start until 0.10.0 is merged                                                 | Executed on a branch off `main` at 0.10.0                                                                                                                                                              | Operator instruction.                                                                                                                                                                                                                                                                         |
| §7.4      | Rebase PR #886 and relocate `managed-identities/` into `features/`                     | Not done                                                                                                                                                                                               | Operator instruction: open PRs update themselves to the new structure after this lands.                                                                                                                                                                                                       |
| §8A       | Skills work                                                                         | Not done                                                                                                                                                                                               | The plan marks §8A "OPEN FOR DISCUSSION" and says not to implement without confirming.                                                                                                                                                                                                        |

**One bonus repair**, outside the plan's scope but made while the link paths were
already being touched: 102 markdown links written root-relative (`src/foo/Bar.ts`
rather than `../../../src/foo/Bar.ts`) never resolved from their own directory,
before or after the move. They now resolve.

### Post-migration change: `areas/` → `features/` (2026-08-14)

The directory level §5.1 named `areas/` was renamed to `features/` on operator
decision, immediately after the migration landed. §5.1's original reasoning —
that not everything under it is a user-facing feature, `webview-ext-package`
being the example — is still true and is still the strongest argument against
the name. It was outweighed by `features/` being the word a contributor reaches
for first. §5.1 is annotated rather than rewritten, so the argument the reversal
had to answer stays on the record.

**Still open:** all of §8A, and the `04.6-collection-view-ux-improvements.md`
placement in §12 (filed under `completions-and-schema` as the plan provisionally
directed; noted as such in that area's README).

---

## 1. Context

`docs/ai-and-plans/` is a committed knowledge base recording how features were
designed and **why**. Its audience is both humans and coding agents. Much of it
is written by AI under human supervision; the decisive content is the operator's
decisions and the reasoning behind them.

The current rule ([CONTRIBUTING.md §5](../../CONTRIBUTING.md)) keys every document
on a PR number. That rule has broken down. This document records the diagnosis,
the external research, the agreed replacement, and the migration plan.

---

## 2. Current state

### 2.1 Inventory

~90 markdown files, ~40,700 lines. Three organizing schemes coexist:

> Counted on 2026-08-13 against `release/0.10.0`. It **excludes** the five
> documents on `dev/tnaum/managed-identities` (PR #886), which is unmerged at
> the time of writing. See §7.4 — that area is not a migration source.

| Scheme                                  | Where                                                                       | Files |
| --------------------------------------- | --------------------------------------------------------------------------- | ----- |
| Numbered step-chain (a _program_, 0→10) | `interactive-shell/`, `shell-autocompletion/`, `shell-syntax-highlighting/` | 23    |
| Topic folder                            | `local-quickstart/`, `future-work/`                                         | 11    |
| PR folder / PR file (the current rule)  | `PRs/`                                                                      | 48    |
| Loose at root                           | —                                                                           | 6     |

### 2.2 What is good and must survive

**The content quality is high and is not the problem.** The recurring pattern is
a full reasoning chain:

> proposal → alternatives → human decision with rationale → implementation →
> validation → reconciliation

Reference exemplars to preserve and imitate:

- `local-quickstart/decision-instance-model.md` — a genuine ADR: status,
  questions, options, decision, rationale, consequences, deferred work.
- `PRs/711-stream-query-insights/review-and-resolutions.md` — severity,
  verification status, alternatives, operator decisions, false positives,
  resolutions.
- `PRs/732-index-dashboard/README.md` — reading order, document categories,
  "where to find why".
- `PRs/621-kubernetes-discovery/bugbash-090-kubernetes-ux-review.md` — UX review
  organized by user journey, reconciled after merge.
- `10-cross-feature-links.md` — work items linked to commits, plus an explicit
  deviations-from-plan section.

### 2.3 Six documented failures of PR-keyed storage

| #   | Failure                                   | Evidence                                                                                                                                                                                    |
| --- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | One feature scatters across 4–6 locations | Local Quick Start: **15 files, 6 locations**. Shell/Playground: 28 files, 8 locations. Query Insights: 7 files, 4. Webview package: 7 files, 4.                                             |
| 2   | PR number is an unstable key              | `PRs/834-atlas-discovery-review/` contains a document titled "PR #765 Code Review". Two folders carry no number at all, violating the rule. PRs also get rebased, squashed, and renumbered. |
| 3   | Reviewers already flagged it              | Finding **N7** in `PRs/798-local-quickstart/code-review-2026-08-04.md`: three folders for one feature. Correct diagnosis, wrong prescribed cure ("consolidate under one PR folder").        |
| 4   | The draft-PR dance is overhead            | §5.3 mandates park-at-root then relocate once the PR number exists, breaking every link written during the draft phase.                                                                     |
| 5   | Links already rot                         | `.github/skills/ux-pr-review/SKILL.md` points at `PRs/documentdb-quickstart/ux-review.md` — does not exist.                                                                                 |
| 6   | Agents cannot discover it                 | `docs/ai-and-plans` is **absent from `.github/copilot-instructions.md`**, the only file always in an agent's context.                                                                       |

Additionally: **no frontmatter anywhere** (nothing is machine-queryable), ~12
competing status vocabularies (`Open`, `DRAFT`, `IMPLEMENTING`, `Selected`,
`Accepted`, `Complete ✅`, …), and ~15 filename styles (`description.md` /
`summary.md` / `README.md` / `review-*` / `code-review-*` /
`review-and-resolutions` / `feature-01-*`).

### 2.4 The measurement that decided the folder shape

Distinct iterations under `PRs/`, by document count:

| Docs per iteration | Count        |
| ------------------ | ------------ |
| 1                  | **12 (55%)** |
| 2                  | 3            |
| 3                  | 4            |
| 4                  | 3            |
| 8                  | 1            |

Median = 2. **Any scheme mandating several subfolders per area produces
mostly-empty directories.** An earlier proposal for `design/ plans/ reviews/
research/` subfolders was tested against this data and withdrawn.

Likewise, explicit decision documents in the entire corpus today: **three**
(125, 270, and 365 lines). That is why decisions live in a single `decisions.md`
per area rather than an ADR folder.

---

## 3. External research

| Source                                                     | Takeaway                                                                                                                                                                                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GitHub Spec Kit                                            | `specs/<feature-slug>/` with fixed filenames. Unit is the **feature**, not the PR. Brownfield loop: update the spec folder when intended behavior changes.                                                                     |
| AWS Kiro                                                   | `.kiro/specs/<feature>/` with exactly three files. Same conclusion, reached independently.                                                                                                                                     |
| Cline Memory Bank                                          | Explicit **mutability gradient** encoded in filenames: stable context vs. frequently-updated active context.                                                                                                                   |
| ADR / MADR / AWS Prescriptive Guidance                     | One decision per record, numbered, immutable once accepted; state machine Proposed → Accepted → **Superseded**; supersede by adding, never editing. Purpose: stop future engineers overruling decisions they were not part of. |
| Anthropic, _Effective context engineering_                 | Progressive disclosure; hold lightweight identifiers, load heavy docs just-in-time. _"Folder hierarchies, naming conventions, and timestamps all provide important signals."_ Context rot is real.                             |
| Claude Code memory / HumanLayer _Writing a good CLAUDE.md_ | Concise entrypoints, topic files on demand, **pointers over copies**.                                                                                                                                                          |
| Diátaxis                                                   | Separate by user need. Keep `docs/user-manual/` (how-to) hard-separated from explanation and history.                                                                                                                          |
| Böckeler, _SDD field report_ (counterweight)               | Elaborate spec systems generate repetitive markdown, impose ceremony on small changes, and leave authority-after-implementation unclear. **Do not over-build.**                                                                |

**Consensus:** feature-local, indexed, concise, progressively disclosed, explicit
about authority and freshness. Not "document everything."

---

## 4. The eight rules

This is the complete rule set. If a situation is not covered, prefer fewer files
and fewer folders.

```
1. An area folder is the unit. PRs are iterations inside it.
2. One file per iteration. Make it a folder only when it gets unwieldy
   (~3+ documents, or a merge that would exceed ~1000 lines).
3. One decisions.md per area. Append entries; update status in place.
4. Durable docs sit flat at the area root. iterations/ is the only subfolder.
5. More than ~6 root files is a smell — consider splitting the area.
   It is a prompt to review the boundary, not an automatic split.
6. Frontmatter: area, kind, status required. Everything else optional.
7. Code wins for behavior. Active docs win for intent. iterations/ is
   evidence only.
8. Agents: start at the README; pull history only for specific provenance.
   No bulk-loading.
```

Supporting conventions, stated once and never numbered:

- No `shared/` tier. Platform work is an area like any other.
- No `archive/` folder. Archive is a **status**, not a location — supersede in
  place.
- No topic described in two places. Where a `.github/skills/` entry exists, the
  area doc links to it; where it does not, the area doc is authoritative. Skills
  should link back to their area for the _why_.
- PR and commit links are kept as **provenance inside documents**, never as the
  navigation key.
- Current design and architecture stay here, next to their rationale. They are
  **not** moved into `.github/skills/`: skill descriptions load into every
  agent request, so that budget is reserved for rules needed frequently
  (`tree-cluster-architecture`, `telemetry-instrumentation`).
- Every document opens with a **one-line purpose statement**. Borrowed from what
  already works: _"Capture the evidence behind X so nobody has to redo this
  investigation"_, _"How to read this log"_. One line, saves a reader a minute.
- **Validation checklists live at the area root, not in `iterations/`.** They are
  re-run whenever the area changes, so they are durable rather than episodic.
  This also avoids a `status: active` file sitting inside a historical folder.

### 4.1 Authority model

| Source                           | Authoritative for                        | Not authoritative for                           |
| -------------------------------- | ---------------------------------------- | ----------------------------------------------- |
| Code and tests                   | actual behavior                          | why it is like this                             |
| Area root files (`design.md`, …) | intent, architecture, constraints        | exact current behavior                          |
| `decisions.md` (active entries)  | why a choice was made, what was rejected | whether still in force — check the status table |
| `iterations/**`                  | what was believed at that date           | anything today                                  |

Documents are described as the **best available account**, never as current
truth. On conflict: **name the doc and the code, report the mismatch, and offer
to correct the doc.** Do not silently pick one.

---

## 5. Target structure

```
docs/ai-and-plans/
├── README.md                          # area index + how this base works. ~100 lines.
├── documentation-restructure-plan.md  # this file
├── cross-cutting/                     # genuinely spans several areas
│   ├── decisions.md                   #   extension-wide calls (dual-ID scheme, terminology)
│   ├── query-surfaces-roadmap.md      #   the 0→10 program history
│   ├── cross-feature-links.md
│   └── multi-connection-behavior.md
├── practices/                         # reusable contributor procedure, not area history
│   ├── live-preview-playwright.md
│   └── webview-ext-migration-manual.md
└── features/
    └── local-quickstart/
        ├── README.md                  # purpose, status, code map, timeline, decision index, reading order
        ├── decisions.md               # status table + append-only entries
        ├── design.md                  # durable, cross-iteration
        ├── design-iteration-1.md      #   status: superseded
        ├── v1-readiness-gaps.md
        ├── future-work.md
        └── iterations/
            ├── 01-initial-design.md
            ├── 02-poc/                # folder because it holds 3 documents
            ├── 03-multi-instance/
            ├── 04-ui-redesign/
            └── 05-error-translation.md
```

### 5.1 Naming

> **Reversed after the migration (2026-08-14).** The directory level is now
> `features/`, not `areas/` — see the execution record in §0. The paragraph
> below is the original reasoning, kept because it is the argument the reversal
> had to answer.

- **Directory level is `areas/`**, matching the required `area:` frontmatter
  field. Chosen over `features/` because not everything is a user-facing feature
  (`webview-ext-package` is a published package).
- **Area slugs are human-recognizable**, never abbreviations or invented
  umbrella terms. A contributor who has never seen the repo should guess what
  `interactive-shell` contains.
- **Iterations are `NN-slug`**, not `<pr-number>-slug`. PR numbers are unstable:
  work often starts before a PR exists, and PRs get rebased, squashed, and
  renumbered. PR references live in frontmatter (`prs:`) and in the area
  README timeline.
- **Where a legacy step number exists, preserve it as the iteration number.**
  The existing `interactive-shell/` chain already sorts correctly inside each of
  the three areas it splits into (see §7.3), so the sequence is retained at zero
  cost.

### 5.2 Classification tests for the secondary buckets

- **Area** — owns product behavior or architecture.
- **Cross-cutting** — one document genuinely governs several areas. Rare.
- **Practice** — a reusable contributor procedure, not area history.

There is no `misc/`. Anything that does not fit goes into the nearest area.

---

## 6. Templates

### 6.1 Frontmatter

Required: `area`, `kind`, `status`. Everything else optional.

```yaml
---
area: local-quickstart
kind: design | decisions | iteration | review | ux-review | research | checklist | practice | plan | notes
status: active | historical | superseded
prs: [798, 876] # optional, provenance only
created: 2026-08-04 # optional
code: # optional but high value: reverse index from source to rationale
  - src/commands/localQuickstart/**
  - src/services/localInstance/**
verified: 2026-08-13 # optional. absent = unverified. no promise of currency.
superseded-by: decisions.md#0003 # optional
---
```

`code:` is the highest-leverage optional field — it is the only way an agent gets
from a source path back to the design rationale. Nothing exists for that today.

### 6.2 Area README

Keep it short. It is the always-read file; everything else is loaded on demand.

```markdown
# Local Quick Start

**Status:** shipped 0.10.0 · **Verified:** 2026-08-13

One paragraph: what it is, what it is not.

## Code map

- src/commands/localQuickstart/\*\*
- src/services/localInstance/\*\*

## User docs

- docs/user-manual/local-quick-start.md

## Related skills

- .github/skills/error-translation/ — infrastructure failure messaging

## Architecture (intent — code is authoritative for behavior)

Durable shape only: the instance state machine, Docker readiness stages,
ownership labels. No UI strings, no exact method names.

## Timeline

| Date       | PR   | What changed                     | Docs                               |
| ---------- | ---- | -------------------------------- | ---------------------------------- |
| 2026-06-15 | #653 | Initial design                   | iterations/01-initial-design.md    |
| 2026-06-22 | —    | POC scope + plan                 | iterations/02-poc/                 |
| 2026-07-06 | —    | Single → multi instance reversal | decisions.md#0002                  |
| 2026-08-04 | #798 | Shipped                          | iterations/04-ui-redesign/         |
| 2026-08-09 | #876 | Error translation                | iterations/05-error-translation.md |

## Decisions → decisions.md

## Open gaps

## Reading order for newcomers

README → design.md → decisions.md
```

### 6.3 `decisions.md`

```markdown
---
area: local-quickstart
kind: decisions
status: active
verified: 2026-08-13
---

# Local Quick Start — Decisions

| #    | Decision                                     | Status              | Changed from the proposal?       | Date       | PR   |
| ---- | -------------------------------------------- | ------------------- | -------------------------------- | ---------- | ---- |
| 0001 | Single managed instance, ownership-bounded   | Superseded by 0002  | Accepted as proposed             | 2026-06-25 | —    |
| 0002 | Multiple managed instances in v1             | Accepted            | Reverses 0001 after owner review | 2026-07-06 | —    |
| 0003 | Concept F — Docker verified as setup stage 1 | Accepted (modified) | Readiness page dropped entirely  | 2026-08-03 | #798 |

> Entries below are **semantically** immutable: append new entries rather than
> rewriting old ones, and record reversals as a new entry plus a status change
> above. Editing for typos, broken links, or added verification metadata is fine.
> Heading text is frozen once written — a retitle means a new decision.
>
> Entries marked **(reconstructed)** were written during the 2026-08 migration
> from earlier plan and design documents. They record what was decided at the
> time, not the original wording; each links to its source evidence.

**Status vocabulary** (closed set of seven):

`Proposed` · `Open` · `Accepted` · `Accepted (modified)` · `Deferred` ·
`Superseded by D#` · `Rejected`

The **"Changed from the proposal?"** column is the highest-signal content in the
whole knowledge base: it records what the human changed about the agent's
proposal, which `CONTRIBUTING.md` §6.2 already calls "the actual contribution".
`Accepted (modified)` plus that column covers "shape changed" and "rescoped"
without inventing further statuses. Both were validated in practice by
`managed-identities/decisions.md` (see §7.4).

---

## 0001 — Single managed instance, ownership-bounded

**Status:** Superseded by 0002 · **Date:** 2026-06-25 · **Raised by:** xgerman
**Evidence:** iterations/… (original document)

### Question

### Options considered

### Decision

### Why

### Consequences

---

## 0002 — Multiple managed instances in v1

...
```

**Rule for large decisions:** the entry stays readable in 60 seconds (question,
options, decision, why, consequences). Long-form evidence lives as a separate
research file and is linked. Example: the 1,194-line
`PRs/733-atlas-mongodb-discovery/multi-credential-poc-plan.md` becomes an
area-root research file referenced from a short decision entry.

### 6.4 Root `README.md` — required content

- What this knowledge base is, and that it is **largely AI-written under human
  supervision**: the durable value is the operator's decisions and the recorded
  reasoning, not the prose.
- The authority model from §4.1, in three lines.
- The area index table: area, one-line purpose, status.
- Where the boundaries are: `docs/user-manual/` for how-to, `.github/skills/`
  for frequently-needed rules, here for why and history.
- A note that the 2026-08 restructure broke old deep links from GitHub PR
  comments (see §9.3).

---

## 7. Migration mapping

### 7.1 Area list (11 areas + 2 buckets)

| Area                     | Absorbs                                                                                                                                                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `local-quickstart`       | `local-quickstart/*` (6), `PRs/653-…`, `PRs/local-quickstart-poc/*` (3), `PRs/local-quickstart-multi-instance/*` (3), `PRs/798-…`, `PRs/876-…`                                                                                          |
| `query-insights`         | `query-insights-implementation-plan.md`, `query-insights-implementation-notes.md`, `PRs/616-…`, `PRs/690-…`, `PRs/711-…/*` (4)                                                                                                          |
| `interactive-shell`      | `interactive-shell/8-*`, `interactive-shell/pr-review-508.md`, `shell-autocompletion/*` (3), `shell-syntax-highlighting/*` (2), `PRs/631-…`, `future-work/terminal-enhancements.md`                                                     |
| `query-playground`       | `interactive-shell/5-*, 6-*, 6.2-*, 7.1.5-*, 7.1.6-*, 7.2-*`, `multi-connection-playgrounds.md`, `multi-connection-playgrounds-review.md`, `PRs/758-…`, `future-work/playground-enhancements.md`, `future-work/aggregation-pipeline.md` |
| `completions-and-schema` | `interactive-shell/2-*, 3-*, 3.5-*, 4-*, 4.5-*, 4.6-*, 6.1-*, 7-*, 7.1-*`, `PRs/717-…`, `future-work/completion-improvements.md`, `future-work/schema-and-infrastructure.md`                                                            |
| `index-management`       | `PRs/732-…/*` (8)                                                                                                                                                                                                                       |
| `atlas-discovery`        | `PRs/733-…/*` (4), `PRs/834-…` (fix the 834/765 mismatch in frontmatter)                                                                                                                                                                |
| `kubernetes-discovery`   | `PRs/621-…/*` (3)                                                                                                                                                                                                                       |
| `webview-ext-package`    | `PRs/676-…`, `PRs/766-…/*` minus the migration manual, `PRs/786-…`, `PRs/795-…`                                                                                                                                                         |
| `connections-tree`       | `PRs/726-…/*` (2), `PRs/714-…` (2 files, merged into one iteration)                                                                                                                                                                     |
| `no-auth`                | `PRs/755-…/*` (3)                                                                                                                                                                                                                       |
| `cross-cutting/`         | `10-cross-feature-links.md`, `interactive-shell/0-high-level-plan.md` (as the query-surfaces program roadmap), `interactive-shell/multi-connection-behavior.md`                                                                         |
| `practices/`             | `live-preview-playwright-future-work.md`, `PRs/766-…/webview-ext-migration-manual.md`                                                                                                                                                   |

Per-area `future-work.md` replaces the central `future-work/` folder; its five
files already map cleanly onto areas.

**Deferred judgment call:** `interactive-shell/4.6-collection-view-ux-improvements.md`
is Collection View UX, not completions. Provisionally filed under
`completions-and-schema`; revisit if a `collection-view` area emerges (it would
also attract parts of `index-management`).

### 7.2 Pilot: Local Quick Start, file by file

| Today                                                                                              | Becomes                                                              | Status             |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------ |
| `local-quickstart/local-quickstart-v2.md`                                                          | `design.md`                                                          | active             |
| `local-quickstart/local-quickstart.md`                                                             | `design-iteration-1.md`                                              | superseded         |
| `local-quickstart/v1-readiness-gaps.md`                                                            | `v1-readiness-gaps.md`                                               | active             |
| `local-quickstart/decision-instance-model.md`                                                      | `decisions.md` entry **0001**                                        | superseded by 0002 |
| header of `PRs/local-quickstart-multi-instance/implementation-plan.md`                             | `decisions.md` entry **0002** _(reconstructed)_                      | accepted           |
| `local-quickstart/ui-redesign-decisions.md` — Finalization chapter                                 | `decisions.md` entry **0003**; remainder stays as iteration evidence | accepted           |
| `PRs/653-local-quickstart-design/description.md`                                                   | `iterations/01-initial-design.md`                                    | historical         |
| `PRs/local-quickstart-poc/*` (3)                                                                   | `iterations/02-poc/`                                                 | historical         |
| `PRs/local-quickstart-multi-instance/*` (3)                                                        | `iterations/03-multi-instance/`                                      | historical         |
| `PRs/798-…/code-review-2026-08-04.md` + `local-quickstart/docker-readiness-implementation-plan.md` | `iterations/04-ui-redesign/` (folder: 3,039 + 1,059 lines)           | historical         |
| `PRs/876-quickstart-error-translation-review.md`                                                   | `iterations/05-error-translation.md`                                 | historical         |

**Before:** 15 files, 6 directories, no entry point.
**After:** 6 root files, 1 subfolder, one README that answers "what happened and
why" in a single read.

### 7.3 Note on the shell step-chain

The 0→10 program splits across three areas. The existing step numbers already
sort correctly **within** each area, so they are preserved as iteration numbers:

- `interactive-shell`: 8, 9, 9.1, plus the syntax-highlighting pair and #631
- `query-playground`: 5, 6, 6.2, 7.1.5, 7.1.6, 7.2
- `completions-and-schema`: 2, 3, 3.5, 4, 4.5, 4.6, 6.1, 7, 7.1

The program-level narrative (`0-high-level-plan.md`) moves to
`cross-cutting/query-surfaces-roadmap.md` and cross-links the three areas. The
areas are kept separate deliberately: an umbrella name like "query surfaces"
is not something a newcomer would recognize or search for.

### 7.4 Incoming work: PR #886 (`managed-identities`)

`docs/ai-and-plans/managed-identities/` exists on `dev/tnaum/managed-identities`
(PR #886) and **will merge after this migration**. It is therefore **not a
migration source** — those files are not in `main` when the migration runs.

It matters for two other reasons.

**It is the reference exemplar.** Written before these rules existed, it
independently satisfies most of them: an area-named folder created before the PR
existed, five flat files and no subfolders, and a `decisions.md` with a status
table, numbered entries (D0–D7), preserved rejected alternatives, and an
explicitly `OPEN` entry. Two conventions in §6.3 are lifted directly from it. It
also settles a design worry: `decisions.md#d0-supported-platforms-azure-vms-only`
is linked from three sibling files and from inline prose, proving anchors into a
single decisions file are good enough and a `decisions/` folder is unnecessary.

What it is missing, and what the follow-up must add: frontmatter, a short
`README.md` (today the 848-line `managed-identities.md` doubles as index and
design), and relocation of `implementation-log.md` into `iterations/`.

**It is the first post-migration conformance check.** Handling:

> After the migration lands, rebase PR #886 onto `main` and `git mv` its
> documents into `features/managed-identities/`, splitting `managed-identities.md`
> into `README.md` + `design.md` and adding frontmatter, **inside that PR**.

The rebase is cheap: the migration touches only `docs/`, and #886's ~102 files
are almost entirely `src/`, so the conflict surface is the five documents it
owns. If slotting it in needs more than a rename plus a README, the layout is
wrong and should be revisited before the remaining areas move.

Target shape:

```
features/managed-identities/
├── README.md                        # new
├── design.md                        # ← managed-identities.md
├── decisions.md                     # as-is + frontmatter
├── research-findings.md             # as-is + frontmatter
├── manual-validation-checklist.md   # area root: it gets re-run (§4)
└── iterations/
    └── 01-initial-implementation/
        ├── implementation-log.md
        └── code-review.md           # the AI-review artifact, still to come
```

> **Known breakage:** the #886 description links
> `docs/ai-and-plans/managed-identities/manual-validation-checklist.md`
> directly. That link dies in the move. A concrete instance of §9.3.

---

## 8. Configuration and policy changes

### 8.1 `.github/copilot-instructions.md` — new section (currently absent entirely)

```markdown
## Feature Knowledge Base

`docs/ai-and-plans/` records how features were designed and **why**. Much of it
is AI-written under human supervision; the durable value is the recorded
operator decisions and their reasoning.

- `docs/ai-and-plans/README.md` — area index. Short and maintained. Read it
  when a task touches an area.
- `features/<name>/README.md` and the flat files beside it are the **best
  available account** of an area's design and intent. They are maintained, but
  they describe intent, not guaranteed current behavior.
- `features/<name>/iterations/**` is **history**. Read only the specific iteration
  needed to resolve provenance, rationale, or a regression. Never bulk-load it.
  Plans and reviews there are evidence of past reasoning, not a description of
  the product today.
- **On conflict, the code wins for behavior; active docs win for intent.** If
  they disagree, do not silently pick one — name the doc and the code, and offer
  to correct the doc.
- Never treat `status: historical` or `status: superseded` as current.
```

### 8.2 `CONTRIBUTING.md` §5 — replacement policy statement

> Durable knowledge belongs to the area that owns it. Iteration files preserve
> the plans, reviews, and implementation history of one round of work. Decisions
> that remain relevant across iterations are recorded in the area's
> `decisions.md`. PR and commit links are kept as provenance; the PR number is
> no longer the navigation key.

- **Delete §5.3** (park-at-root, then relocate once the PR number is known) —
  obsolete, because area slugs exist before PR numbers do.
- **Move §6.1–§6.5** (the AI-review procedure) into a skill alongside
  `ux-pr-review`. It churns faster than contribution policy. Separate PR.

### 8.3 PR checklist — add a sixth line

Next to `npm run l10n` in `.github/copilot-instructions.md`:

> If this PR changes behavior described in an area's current docs, update
> `features/<name>/README.md` (and `design.md` if applicable) in the same PR.

### 8.4 Fix the broken `ux-pr-review` references

Four references across two files, all pointing at
`docs/ai-and-plans/PRs/{pr-number}-{slug}/ux-review.md`:

| File                                                                 | Line | Note                                         |
| -------------------------------------------------------------------- | ---- | -------------------------------------------- |
| `.github/skills/ux-pr-review/references/review-document-template.md` | 3    | the "copy this skeleton into" target         |
| `.github/skills/ux-pr-review/SKILL.md`                               | 26   | worked example — **this path never existed** |
| `.github/skills/ux-pr-review/SKILL.md`                               | 96   | where to create the file                     |
| `.github/skills/ux-pr-review/SKILL.md`                               | 104  | "`PRs/` is tracked" guidance                 |

Retarget to `docs/ai-and-plans/features/<area>/iterations/NN-<slug>.md` (or
`.../ux-review.md` when the iteration is a folder). Replace the dead example on
line 26 with a real one. Line 175 also cross-references `CONTRIBUTING.md` §6.3,
which moves if §8.8 goes ahead.

---

## 8A. Skills — OPEN FOR DISCUSSION

> ⚠️ **This section is not settled.** §8.1–§8.4 above are agreed; everything
> below is a proposal recorded so it is not lost. Shape, naming, and whether
> these are two skills or one are all still open. Do not implement without
> confirming with the maintainer.

**The finding that motivates it:** `.github/copilot-instructions.md` contains
**zero references to `CONTRIBUTING.md`** (verified 2026-08-13). CONTRIBUTING is
not loaded into any agent's context. That means §6's carefully designed
four-stage AI review procedure has never actually been reachable by an agent.

So the proposals below **relocate existing process into a form agents load**.
They add no new procedure; every line is sourced from prose already in the repo.

### 8A.1 Teach `review-external-pr` the area layout

It currently has zero `docs/` path references, so the migration does not break
it — but that is also the gap: an external contributor's PR touching an area has
nowhere to file its review. Add the area-folder convention.

### 8A.2 Back-links from architecture skills to their areas

The §4 convention says skills link back to their area for the _why_. Links are
currently one-directional. Concrete mapping now that §7.1 exists:

| Skill                                                              | Area                  |
| ------------------------------------------------------------------ | --------------------- |
| `tree-cluster-architecture`                                        | `connections-tree`    |
| `error-translation`                                                | `local-quickstart`    |
| `telemetry-instrumentation`                                        | `cross-cutting/`      |
| `react-webview-architecture`, `webview-trpc-messaging`, `fluentui` | `webview-ext-package` |

### 8A.3 Proposed new skill: `prepare-pull-request`

- **Triggers:** "prepare a PR", "ready to open a PR", "check my branch before
  pushing".
- **Sources (all existing prose):** `CONTRIBUTING.md` §4.1–§4.5 (the five
  commands), §5 (document placement, post-migration), the draft-PR rule, §7.1's
  requirement that descriptions be meaningful _because release notes are
  generated from them_, milestone assignment, and the one-commit-per-work-item
  discipline.
- **Does:** verify the area docs exist and are updated, check the description
  carries enough for release notes, confirm milestone and draft status, run the
  gate.
- **Boundary:** the PR checklist in `.github/copilot-instructions.md` stays the
  always-loaded short form. This skill **links to it rather than restating it**,
  and owns only what is not there. Otherwise it violates the §4 "no topic in two
  places" convention.

### 8A.4 Proposed new skill: `self-review-pr` (from `CONTRIBUTING.md` §6.1–§6.5)

- **Triggers:** "AI review pass", "review my PR before humans see it".
- **Sources:** the four stages verbatim — edge-case review (model A) → merge the
  Copilot reviewer threads → validation gate (different vendor, standard
  context) → independent sweep; then author decisions, per-work-item commits,
  author final review, plus the file-an-issue escape hatch.
- **Writes to:** `features/<area>/iterations/NN-<slug>/code-review.md`.

### 8A.5 Open questions for this section

1. Two skills or one? The triggers and timing differ, which is the same reason
   `ux-pr-review` and `review-external-pr` are already separate — but one skill
   with two phases is defensible.
2. Naming: `prepare-pull-request` / `self-review-pr` are placeholders.
3. Sequencing: same PR as the migration, or a follow-up? (Leaning follow-up.)
4. Does converting `CONTRIBUTING.md` §6 to a skill mean deleting it from
   CONTRIBUTING, or leaving a pointer?

> Independent reinforcement: the Copilot reviewer on PR #886 suggested "Add a
> code-review agent skill", reaching §8A.4 from the opposite direction.

---

## 9. Execution

### 9.1 Timing

**Do not start until 0.10.0 is merged.** At the time of writing the repository is
on `release/0.10.0` with WIP PR #820 open; a 75-file move on a stabilization
branch is pure risk. The migration lands as its own PR against `main`.

### 9.2 Commit sequence

Three commits, in this order, so `git log --follow` can track renames:

1. **Pure `git mv`** — no content edits whatsoever.
2. **Link repairs** — fix intra-document relative links (~30 of them).
3. **Consolidation and frontmatter** — merges, decision extraction, README
   authoring, frontmatter backfill.

Never delete-and-recreate a file that is really a move. Never use `git add -f`:
`docs/analysis/` and `docs/plan/` are gitignored local scratch space and must
not be touched by this migration.

### 9.3 Accepted breakage

Deep links from existing GitHub PR comments into `docs/ai-and-plans/PRs/...` on
`main` **will break**. Compatibility stub files were considered and rejected — 75
stubs are worse than the breakage. Document it once in the root README and move
on. No redirect index is maintained; a PR number can be found with `git grep`,
GitHub search, or the area README timelines.

### 9.4 Deliberately not built

No generated index, no `by-pr.md`, no CI validation of frontmatter or links, no
commit-revision tracking in `verified:`. These were all considered. They add
process cost now for value that is speculative until the structure has proven
itself. Revisit only if the structure is still in use in six months and a real
retrieval problem appears.

### 9.5 Rollout order

1. Create root `README.md`.
2. Migrate `local-quickstart` only (the pilot). It is the hardest case — 15 files
   across 6 locations, with decision extraction and a supersession chain — which
   is what makes it a useful test of the templates.
3. Run the acceptance test in §10.
4. If it passes, migrate the remaining ten areas plus `cross-cutting/` and
   `practices/`.
5. Update `CONTRIBUTING.md`, `.github/copilot-instructions.md`, and the
   `ux-pr-review` skill paths (§8.1–§8.4).
6. **After the migration lands:** rebase PR #886 and relocate its documents into
   `features/managed-identities/` inside that PR (§7.4). This doubles as the first
   conformance check on work authored before the rules existed.
7. Revisit §8A (skills) with the maintainer — still open.

---

## 10. Pilot acceptance test

After migrating `local-quickstart`, a human **and** a fresh agent must be able to
answer all of the following **from the area README alone**:

1. What exists today?
2. Why was the current model selected?
3. Which decision superseded which?
4. Which PR introduced a given behavior?
5. Which source paths implement it?
6. Which documents are historical?
7. What remains open?

Plus: no broken internal links in the migrated area.

If fewer than five of seven land, the README template is wrong. Fix the template
before migrating anything else — one area is the cost of finding out.

---

## 11. Rejected alternatives

Recorded so they are not re-opened without new evidence.

| Rejected                                              | Why                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep PR-keyed folders                                 | Six documented failures in §2.3. PR numbers are unstable identifiers.                                                                                                                                                                                                                        |
| Kind subfolders (`design/ plans/ reviews/ research/`) | Median 2 documents per iteration; 55% are single-document. Produces mostly-empty directories.                                                                                                                                                                                                |
| `decisions/` folder of numbered ADR files             | Only three decision documents exist in the whole corpus. A folder for two files is the same over-structuring. **Validated in practice:** `managed-identities/decisions.md` is anchor-linked from three sibling files and from inline prose, so anchors into one file are good enough (§7.4). |
| A `shared/` tier for platform work                    | Forces an unpredictable "is this shared?" judgment at creation time — the same prediction that already failed.                                                                                                                                                                               |
| An `archive/` folder                                  | Archive is a status, not a location. Moving files re-scatters an area and breaks links a second time.                                                                                                                                                                                        |
| One umbrella `query-surfaces` area                    | Technically defensible (the step chain is one program), but no newcomer would recognize or search for the name.                                                                                                                                                                              |
| `<pr-number>-<slug>` iteration filenames              | Work starts before PRs exist; PRs get rebased, squashed, and renumbered.                                                                                                                                                                                                                     |
| Renaming `docs/ai-and-plans/`                         | The name is honest signalling: this is where AI writes a lot, under human supervision. ~40 references would need updating.                                                                                                                                                                   |
| Moving current architecture into `.github/skills/`    | Skill descriptions cost context on every request. That budget is for frequently-needed rules, not quarterly reading.                                                                                                                                                                         |
| Permission gating (`ask before reading, default no`)  | Fails closed for subagents, the GitHub coding agent, and background tasks, making the base human-only. Relevance gating (rule 8) achieves the intent.                                                                                                                                        |
| A five-level authority precedence list                | Ceremony. The three-line rule in §4.1 plus `status:` covers it.                                                                                                                                                                                                                              |
| Compatibility stub files at old paths                 | 75 stubs are worse than the link breakage they prevent.                                                                                                                                                                                                                                      |
| `by-pr.md` redirect / index                           | A hand-maintained global index is guaranteed to rot; a generated one needs tooling and CI. Neither is worth it. Cut.                                                                                                                                                                         |

---

## 12. Open items

1. **All of §8A (skills)** — the largest open block. Shape, naming, count, and
   sequencing are unsettled; see §8A.5.
2. `interactive-shell/4.6-collection-view-ux-improvements.md` placement (§7.1)
   — decide during migration, or when a `collection-view` area emerges.
3. Whether `CONTRIBUTING.md` §6 becomes a skill in this PR or later
   (recommendation: later, separate PR — tracked in §8A.5).
