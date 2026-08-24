---
feature: cluster-dashboard
kind: iteration
status: active
prs: [823]
created: 2026-08-24
---

# 01-poc — AI pre-review (CONTRIBUTING §6)

> The §6.1 pre-review for the Cluster Dashboard POC. Two independent cold reviews, cross-validated
> against the code, merged with the GitHub Copilot reviewer's comments, and dispositioned.
>
> **Author decisions on the deferred items are outstanding** — see
> [Outstanding author decisions](#outstanding-author-decisions). §6.2 is the author's to complete.

## Method

| Stage                         | What was done                                                                                                                                                                     |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §6.1.1 Initial review         | **Claude Opus 5**, max reasoning, cold — given the diff, the repo's binding instruction files, and no framing from the author. 13 findings (F1–F13).                              |
| §6.1.2 Merge Copilot reviewer | The 5 GitHub Copilot review comments merged below and re-assessed.                                                                                                                |
| §6.1.3 Validation gate        | **GPT-5.6 Sol**, max reasoning, cold — a different vendor, identical prompt, run in parallel rather than after, so it could not anchor on the first review. 14 findings (S1–S14). |
| §6.1.4 Independent sweep      | Both reviews were asked for a "checked and sound" list as well as findings, which is where the two disagreements surfaced.                                                        |
| Cross-validation              | Every finding re-checked against the code by the operator's agent before disposition. Verdicts below are that check, not the reviewers' claims.                                   |

Running the two in parallel rather than in sequence was deliberate: a validation gate that reads the
first review inherits its blind spots. The cost is duplicated effort on the findings they share; the
benefit is the four places they disagree, which is where the real defects were.

**Both reviews were run against commit `1d47dabe`.**

## Where the reviews disagreed — the highest-signal part

| Theme               | Opus 5                                                                                         | GPT-5.6 Sol                                                                                    | Verdict after checking the code                                                                                                                               |
| ------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Command redaction   | "Checked and sound" for the auth handshake; the payload issue raised separately as F1 (Medium) | **S1, High — the denylist misses `password`, `accessToken`, `clientSecret`**                   | **Sol.** `pwd` is denied, `password` is not. Opus's "sound" was true but narrowly scoped, and the narrow scope is what made it read as reassuring.            |
| Fan-out concurrency | "Bounded fan-out with per-item failure isolation… limit 8 — correct"                           | **S6, High — the limit is per invocation; 20 expanded rows give 20 × 8**                       | **Sol.** `expanded` is a `Set<string>`, and each `CollectionsPanel` issues its own query.                                                                     |
| React row keys      | "History rows key on `opid:namespace:firstSeenMs` which is unique by construction"             | **S4, High — keying live rows on `opid` alone retargets an open menu when the id is recycled** | **Sol.** Opus checked uniqueness; Sol checked what identity _means_ when the server reuses an id. Preserving the open menu is the stated purpose of that key. |
| Disposal            | "cleared on panel disposal with an identity guard"                                             | **S5 — an in-flight poll re-creates the entry after the clear**                                | **Sol.** The identity guard protects the _clear_, not against a later _write_.                                                                                |
| Overall verdict     | "Mergeable as a POC, with caveats"                                                             | "**Not mergeable** in its current form"                                                        | **Sol is closer.** S1, the disposal leak, and S6 are real. All three are now fixed or explicitly deferred with reasoning.                                     |

Opus was not wrong so much as narrower: each "sound" claim was literally true of what it checked.
The lesson for future rounds is that a "checked and sound" list is only as good as the question it
asked, and that the two vendors should be run cold and in parallel.

## Findings and disposition

Severity is the reviewer's; **Verdict** is the cross-check against the code.

### Fixed in this round — commits `a13674ad`, `668994ad`

| ID                 | Finding                                                                                                                                                                                                                   | Sev          | Verdict                                                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S1** / F1        | Redaction was an exact-name denylist of wire-protocol fields, so application data under names like `password`, `accessToken`, `clientSecret` reached the webview, clipboard, diagnostics export and Copilot Chat verbatim | High         | **Confirmed.** Fixed by adding substring matching for secret-shaped names, plus an honest doc comment. See the limits note below.                                           |
| **F9**             | `key` was redacted at any depth of any command, hiding the index specification of `createIndexes` — the one field that says what the index is                                                                             | Low          | **Confirmed.** `authenticate`/`getnonce` already blank their whole body one branch earlier, so the entry was redundant _and_ harmful. Removed.                              |
| **F6**             | A poll whose every attempt failed reports no operations; that was folded in as "nothing is running", flipping every history entry to `Ended`                                                                              | Low          | **Confirmed.** `listCurrentOperations` returns `operations: []` with `errors` populated. Recording now takes a `pollSucceeded` flag.                                        |
| **S5** (part)      | Disposal cleared the history, but a poll in flight at that moment resolved afterwards and wrote it back — retaining up to 200 command previews for the extension host's lifetime and showing them to the next session     | High         | **Confirmed.** `recordObservedOperations` ends with `historyByCluster.set(...)`. Recording is now gated on an open session.                                                 |
| **S3** / F2 (part) | The pre-kill re-check treated "could not reach the server" as permission to kill anyway                                                                                                                                   | High         | **Confirmed** — `if (!stillRunning && current.errors.length === 0)` falls through to the kill. Now fails closed with its own `unverified` outcome and its own announcement. |
| **F7** / S7 (part) | `activeOperations` silently switched to the caller's own operations when the privileged `currentOp` form was unavailable; the Activity tab presented that as the cluster's                                                | Low / Medium | **Confirmed.** `ClusterHealthSample` now carries `activeOperationsScope` and the chart retitles to "Your active operations".                                                |
| **F13**            | Two comments used "MongoDB" as a bare product name, which `.github/copilot-instructions.md` forbids                                                                                                                       | Low          | **Confirmed.** Fixed in three places (two comments plus a test comment).                                                                                                    |

**What the redaction fix does not do.** It is defence in depth, not a guarantee. A denylist cannot
establish that a command document is safe — an application may call its secret `q7`, and query
filter values are customer data under arbitrary names. The structural fix both reviewers proposed
(drop scalar literals by default, keep field names and types) is a design change, recorded as
deferred below.

### Deferred — architectural, and appropriate for a POC to carry

Each of these is real. They are deferred because they need a design decision rather than a patch,
and because shipping a half-version of any of them would be worse than the current honest state.

| ID            | Finding                                                                                                                                                               | Sev    | Why deferred                                                                                                                                                                                                                                                                                            |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S1** (rest) | Structural command summary: drop scalar literals, keep shape                                                                                                          | High   | Changes what the Operations tab is _for_. The tooltip's value is seeing the actual query. Needs a product decision, possibly a second confirmed action for raw literals.                                                                                                                                |
| **F3** / S5   | Two independent `$currentOp` polls; the fallback chain is re-walked every 5 s, producing repeated authorization failures on least-privileged connections              | Medium | Already recorded as the first post-POC task in [decision 0001](../../decisions.md#0001--poll-from-the-webview-not-trpc-subscriptions-reconstructed). Needs the polling coordinator, not a patch.                                                                                                        |
| **F4** / S5   | Polling never pauses while the panel is hidden (`retainContextWhenHidden: true`)                                                                                      | Medium | Already a stated known limitation in the PR description. Belongs with the coordinator above.                                                                                                                                                                                                            |
| **S6**        | `STATS_CONCURRENCY = 8` is per invocation; 20 expanded databases give up to 160 concurrent `collStats`                                                                | High   | Needs a per-cluster semaphore shared by `dbStats` and `collStats`, and cancellation on collapse. A real design change to the collector's contract.                                                                                                                                                      |
| **S4**        | Live rows key on `opid` alone, so a recycled id retargets an already-open Actions menu to a different operation                                                       | High   | Needs a host-issued immutable occurrence fingerprint carried in the row key and revalidated host-side. Compounds with F2/S3 — the host check cannot recover the original intent either. **Highest-value deferred item.**                                                                                |
| **F8**        | No procedure reads `ctx.signal`; fan-outs of up to 101 commands run to completion after the client aborts                                                             | Low    | Convention violation — `webview-trpc-messaging` says "Always check `myCtx.signal?.aborted` in long-running loops". Threading a signal through the collectors is mechanical but touches every procedure; belongs with the coordinator work.                                                              |
| **F5** / S8   | The headline tiles sum a list capped at 20 databases (in server order, not by size) and silently drop databases whose `dbStats` failed, then label the result a total | Medium | The caveat exists on the Data tab but the strip stays visible above it. Needs `omittedDatabaseCount` plumbed into the strip and a lower-bound presentation.                                                                                                                                             |
| **S9**        | One transient `serverStatus` failure removes the Activity tab                                                                                                         | Medium | Interacts with [decision 0008](../../decisions.md#0008--a-tab-exists-only-when-the-server-can-answer-it-reconstructed) — "a tab exists only when the server can answer it" deliberately has no hysteresis. Distinguishing "unsupported" from "failed once" is a change to that decision, not a bug fix. |
| **S10**       | Ended history entries can be revived and merged with a recycled occurrence                                                                                            | Medium | Same root cause as S4: occurrence identity. Fix together.                                                                                                                                                                                                                                               |
| **S11**       | A `listCollections` failure renders as an empty database                                                                                                              | Medium | Same class as F6, one level down. Worth fixing; needs the error to reach the panel.                                                                                                                                                                                                                     |
| **S12**       | One-shot RPC failures leave a permanent loading state                                                                                                                 | Medium | UI polish; no data-correctness consequence.                                                                                                                                                                                                                                                             |
| **S13**       | Dashboard failures bypass `ConnectionDiagnosticsService`, so infrastructure causes are not translated                                                                 | Medium | Real convention gap against the `error-translation` skill. Mechanical but wide.                                                                                                                                                                                                                         |
| **S2**        | The diagnostics export includes raw host metadata alongside a comment claiming metadata is sanitized                                                                  | Medium | Folded into the S1 export decision — the export needs one coherent answer, not two partial ones.                                                                                                                                                                                                        |
| **F10**       | Up to 200 history entries × 2 000-char previews re-serialized every 5 s                                                                                               | Low    | Performance; needs a watermark protocol.                                                                                                                                                                                                                                                                |
| **F11**       | Expanded collection figures never refresh and can contradict the row above                                                                                            | Low    | Needs the panel to join the storage refresh.                                                                                                                                                                                                                                                            |
| **F12**       | `commandPreview` is interpolated into a fenced block in the Copilot prompt without delimiter handling                                                                 | Low    | Genuine injection surface, low impact here (no privileged tools). Cheap to fix; grouped with the S1 export decision because both concern what leaves the panel.                                                                                                                                         |

### Out of scope

| ID      | Finding                                                                                     | Why                                                                                                                                                                              |
| ------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S14** | `nodeCount` is populated from `properties.sharding.shardCount` in `VCoreBranchDataProvider` | **Pre-existing on `main`**, introduced in `659b9b5b`, untouched by this PR. The repo's rule is not to fix unrelated pre-existing issues in a feature PR. Worth a separate issue. |

## GitHub Copilot reviewer comments (§6.1.2)

All five were posted 2026-08-04 and are now resolved. Re-assessed here rather than taken at face
value: **all three that were still open had already been fixed in `89769b50`, 27 minutes after the
review landed, and were simply never marked resolved.**

| Comment                                                                                       | Finding                                                                           | Re-assessed        | Outcome                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [r3712936648](https://github.com/microsoft/vscode-documentdb/pull/823#discussion_r3712936648) | History not cleared on panel dispose                                              | Valid when written | Fixed in `89769b50`. **Sol's S5 later showed the fix was incomplete** — the clear happened, but an in-flight poll could undo it. Now fully closed.                                                                         |
| [r3712936734](https://github.com/microsoft/vscode-documentdb/pull/823#discussion_r3712936734) | `role="button"` on a non-actionable span; `aria-label` replacing the visible name | Valid when written | Fixed in `89769b50`, and **solved better than proposed**: the Fluent `Tooltip` switches `relationship` between `label` and `description`, so the visible value stays the accessible name without an `aria-hidden` wrapper. |
| [r3712936792](https://github.com/microsoft/vscode-documentdb/pull/823#discussion_r3712936792) | Totals row rendered `0` for "not reported"                                        | Valid when written | Fixed in `89769b50` via `formatSum`. **F5/S8 above is the remaining half** — individual cells are honest, the _sums_ are still presented as complete.                                                                      |
| [r3712936844](https://github.com/microsoft/vscode-documentdb/pull/823#discussion_r3712936844) | "DocumentDB/MongoDB" as a combined product name                                   | Valid              | Fixed. F13 found two further instances the reviewer missed.                                                                                                                                                                |
| [r3712936874](https://github.com/microsoft/vscode-documentdb/pull/823#discussion_r3712936874) | Redundant `aria-label` overriding a visible button label                          | Valid              | Fixed.                                                                                                                                                                                                                     |

## Checked and sound (both reviews independently)

Recorded so a later round does not re-litigate them:

- **Dual-identity contract.** `clusterId` is used for every cache, client, panel and history key, and
  for the serialized webview context. `treeId` is used only to infer `viewId`. No `this.id` keying
  anywhere in the diff. Now covered by a regression test using a cluster whose `treeId` differs from
  its `clusterId`.
- **No connection string or password leaves the host.** `getClusterInfo` uses the password-free
  connection string and passes only `host:port` onward.
- **`opid` type fidelity.** `opidIsNumeric` is carried rather than re-derived; `killOp` verified end
  to end.
- **Kill confirmation.** Host-side, inherits the user's configured style, cancellation mapped to
  `cancelled` rather than surfacing as failure, wording claims only that a request was sent.
- **`null` is never rendered as `0`** in individual cells, across every tab. `sizeOnDisk: 0` with
  `empty: false` is correctly distinguished from a genuine zero.
- **Same-mount overlap guards.** Health, storage and operations each guard against overlapping
  requests within one mounted instance, and all polled state writes are guarded by `disposedRef`.
- **No HTML injection path.** Server strings go through normal React text/attribute paths.

## Outstanding author decisions

§6.2 is the author's, and it is the part that matters most. What needs a decision from
@guanzhousongmicrosoft before this PR is marked ready for review:

1. **The export/Copilot data question (S1 rest, S2, F12).** Does the Operations tab keep showing
   real query literals? If yes, the diagnostics export needs either its own redaction pass or a
   modal that states what the file contains. These three should get one answer, not three.
2. **Occurrence identity (S4, S10, F2 rest).** Is a host-issued fingerprint per live occurrence
   worth building now, or does the Kill action stay best-effort for the POC with the fail-closed
   behaviour just added? This is the highest-severity deferred item.
3. **The polling coordinator (F3, F4, S5 rest, S6, F8).** Five findings share one fix. Is that this
   PR's scope or the next iteration's?
4. ~~Whether F5/S8 blocks the POC.~~ **Answered: yes.** Fixed in `668994ad`, along with S9, ahead
   of the maintainer demo.

Once those are recorded here with their reasoning, §6.2 is satisfied and the Case 2 gate in
`prepare-pull-request` §2.3 is met.
