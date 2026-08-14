# PR #732 — Index Management tab (Index Dashboard)

**PR:** [microsoft/vscode-documentdb#732](https://github.com/microsoft/vscode-documentdb/pull/732)
· **Branch:** `dev/khelanmodi/index-management-ui` · **Base:** `main`

This folder is the working archive for PR #732 (adds an **Indexes** tab to the
CollectionView). The documents accumulated over several stages — a design intro, a
CollectionView chrome redesign, wildcard/vector index support, two rounds of UX review,
and a code review. This index exists so a reviewer can find the right document without
reading all of them.

> **Nothing here has been rewritten or merged.** The files were only renamed into the
> category-prefixed scheme below (and their cross-links updated) to make navigation easier.
> Each document remains the source of truth for its own topic and history.

---

## How the work unfolded (reading order)

1. **Feature intro & final design** — the overview and the decisions that shipped
   ([feature-01](./design.md)).
2. **CollectionView chrome redesign** — moving the tab strip first and scoping the action
   bar per tab ([feature-02](./design-collectionview-toolbar.md)).
3. **Wildcard & vector index support** — the later index-family work
   ([feature-03](./design-vector-index-support.md)).
4. **UX review, iterations 1–2** — the first hands-on review pass and its fixes
   ([ux-review-iteration-1-2](./iterations/01-index-dashboard/ux-review-iteration-1-2.md)).
5. **UX review, iteration 3** — the follow-up review of the redesigned create drawer
   ([ux-review-iteration-3](./iterations/01-index-dashboard/ux-review-iteration-3-create-index-redesign.md)).
6. **Code review** — the technical/correctness review and its resolutions
   ([code-review-2026-07-20](./iterations/01-index-dashboard/code-review-2026-07-20.md)).

Reference material ([reference-01](./reference-supported-indexes.md),
[reference-02](./reference-operator-registry-scraper.md)) underpins the index metadata
used throughout and can be read on demand.

---

## Files at a glance

### Feature discussions

| File                                                                                             | What it covers                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [feature-01-index-management-overview.md](./design.md)             | Consolidated design log: what shipped (index list/metrics, create drawer, advanced editors, confirmations, row status, previews), the **tried-and-abandoned** decisions, the dev-tooling `ResizeObserver`/CSP discovery, and follow-ups. Start here.                 |
| [feature-02-collectionview-toolbar-redesign.md](./design-collectionview-toolbar.md) | The CollectionView chrome redesign — tab strip first, contextual per-tab action bar, layout/responsive plan, implementation progress, and the full-bleed chrome + SCSS refactor.                                                                                     |
| [feature-03-vector-index-support.md](./design-vector-index-support.md)                       | Wildcard and vector index support — vector index concepts, service algorithms (IVF / HNSW / DiskANN), shared settings, commands, the proposed Vector drawer and typed model, validation rules, implementation progress, and the Atlas Search Index future reference. |

### UX reviews (by iteration)

| File                                                                                               | Iteration(s)                                                                                                                                                    | Date       |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| [ux-review-iteration-1-2.md](./iterations/01-index-dashboard/ux-review-iteration-1-2.md)                                         | Iterations 1–2 — the original UX review pack (findings 1–8 + J1), operator decisions, and the fixes implemented across both iterations.                         | 2026-07-22 |
| [ux-review-iteration-3-create-index-redesign.md](./iterations/01-index-dashboard/ux-review-iteration-3-create-index-redesign.md) | Iteration 3 — follow-up review of the redesigned Standard / Wildcard / Vector create drawer, plus a carry-forward reconciliation of the earlier review's items. | 2026-07-27 |

### Code review

| File                                                     | What it covers                                                                                                                                                                                                    |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [code-review-2026-07-20.md](./iterations/01-index-dashboard/code-review-2026-07-20.md) | Technical/correctness review with an independent verifier re-assessment. Findings HIGH-1, MEDIUM-1…4, LOW-1…5, plus deeper-pass items NEW-1…4, each with severity, options, and a resolution (with commit links). |

### Reference

| File                                                                                           | What it covers                                                                                                   |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [reference-01-documentdb-supported-indexes.md](./reference-supported-indexes.md) | DocumentDB-supported index types and properties (from documentation scraping) and how they map to the extension. |
| [reference-02-operator-registry-scraper.md](./reference-operator-registry-scraper.md)       | The operator-registry scraper migration and the index type/property metadata it exposes to the webview.          |

---

## Finding things fast

- **Why a decision was made (and what was rejected):** the "Tried and abandoned" section of
  [feature-01](./design.md#tried-and-abandoned-and-why).
- **A specific UX finding and its fix:** the priority index in
  [ux-review-iteration-1-2](./iterations/01-index-dashboard/ux-review-iteration-1-2.md#priority-index) (findings 1–8) or
  [ux-review-iteration-3](./iterations/01-index-dashboard/ux-review-iteration-3-create-index-redesign.md#priority-index)
  (create-drawer redesign).
- **A correctness/severity concern and its resolution:** the severity summary in
  [code-review-2026-07-20](./iterations/01-index-dashboard/code-review-2026-07-20.md#severity-summary).
- **Vector index behavior and open decisions:**
  [feature-03](./design-vector-index-support.md#open-decisions).
