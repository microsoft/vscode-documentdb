# Pre-discovery inconsistency checklist

Sweep the feature's code for these during **Prepare, Step 4**, before the operator touches
the UI. These are the gaps UX reviews repeatedly catch that ordinary code review misses —
they are only visible when you compare _sibling flows against each other_, not when reading
one diff in isolation. Seed every hit as a `🟠 Open` item with an `⚠️` marker and a file
reference.

## 1. Error / feedback surface asymmetry (the big one)

The same _class_ of event is surfaced differently across the feature. Grep for each surface
and list every occurrence side by side:

- **Modal** — `showErrorMessage(…, { modal: true })`, `showWarningMessage(…, { modal: true })`
- **Non-modal toast** — `showErrorMessage(…)`, `showWarningMessage(…)`, `showInformationMessage(…)`
- **Passive tree row** — an error/status node with **no command and no context menu** (exists
  only to display a string; truncates in the tree, can't be copied)
- **Silent** — a `catch { return undefined }` / early-`return` that produces **no UI**, with
  detail only in the output channel

**Flag when:** one branch of the _same feature_ ends in a modal, another in a toast, another
in a passive row, and another in nothing. Decide one rule and apply it feature-wide.

**House style (verified across shipped discovery providers):** errors → **modal + output
channel**; tree rows are **actions only**; a single canonical **"Click here to retry"**
node — never a passive in-tree error-summary row.

## 2. Silent no-ops on user actions

Lifecycle actions (start/stop/restart/connect/delete) that can **early-return with no
feedback** when state drifted (container/resource deleted externally, session expired, item
not found). The stale row persists; the user clicks and nothing happens. Flag every
action-handler guard that can short-circuit before showing anything.

## 3. Destructive-action consistency

- Does every destructive command route through the **shared confirmation**
  (`getConfirmationAsInSettings()`), honoring the user's `confirmationStyle`? Flag any
  destructive action that calls a bespoke confirm (e.g. `getConfirmationWithClick()`) or
  none at all.
- Does a delete leave **orphans** (volume, secret, cached credentials, stored records)?
- Is there a **hard precondition** that we only delete resources the extension created
  (label/ownership re-check immediately before removal)?

## 4. Consent before sensitive operations

Reading the clipboard, copying a **password / connection string** to the clipboard, or
storing secrets should be **consented and/or offer a "without password" choice** — not
silent. Flag any path that puts a plaintext secret on the clipboard without a prompt when a
sibling command does prompt.

- **Preview before apply.** Whenever the user accepts **content from an external source** to
  be applied/stored (clipboard, a dropped/opened file, pasted text — e.g. the K8s
  "paste kubeconfig from clipboard" flow), they should be able to **review the content
  before it takes effect**. Generalize: any "apply what I just handed you" action offers a
  **Preview / Review** affordance (open it in an untitled doc, show a diff, or a confirm
  dialog that displays what will be applied) and only proceeds on explicit confirmation.
  Flag any import/apply path that consumes external content **blindly**.

## 5. Empty state & first-run dead ends

- Does the empty state offer an **actionable** row ("Click here to…"), or a passive
  message? Passive-only states with no action are dead ends.
- After a failed/leftover state, is there **always a way out** (Delete / Recreate / Retry)?
  A state that shows a warning but exposes **no command** is stuck.
- Are prerequisites (e.g. Docker) revealed **before** the user commits to the click, or only
  after?

## 6. Icon / label stability

- **Stable provider-identity icons** vs. **state-driven icons** that flip on every refresh.
  The house style is a fixed identity icon; transient state goes in `description` / tooltip.
  Flag any tree node whose icon changes with lifecycle state.
- **Wording drift:** the same concept named two ways (e.g. product name in the root vs. the
  auth prompt); jargon labels ("Add kubeconfig source") vs. field-standard verbs; **em
  dashes** and other punctuation in user-facing strings that need a sweep.

## 7. Header / hero carrying state it shouldn't

Webview headers that **change with phase** and can get **stuck** (e.g. success/failed reuse
the "Setting up…" title). Prefer a **static header**; state lives in the body / a
content-area card. Flag any hero that swaps per phase or doesn't branch on success/failure.

## 8. Progress & long-wait honesty

Long operations (image pull, readiness wait) that show a **static spinner + fixed label**
for minutes with no live signal. Flag stages that can sit silent past ~10s; note whether a
real progress signal (bytes, N-of-M) exists to surface.

## 9. Wizard / quick-pick dead ends

A wizard step that **throws and closes** when a precondition isn't met (not signed in, no
session) instead of keeping the user in flow with an inline "Sign in…/Add…" affordance.

## 10. Command / menu parity

A bespoke node that **fully replaces** its base `contextValue` and thereby loses genuinely
useful, storage-independent commands (e.g. "Open in Shell", "New Query"). Flag missing
parity and note which commands are safe to opt back in.

## 11. Accessibility of state changes

Tree rows that change only `description` + icon on state transition with **no live-region
announcement**, so screen-reader users don't hear the change. (Webviews often use
`aria-live`; trees usually don't.) Record as a sequenced a11y item.

## 12. Surprising / automatic actions ("no magic")

**General rule: never surprise the user with actions happening "by magic."** When the
extension does things on the user's behalf, it should be visible and, where consequential,
reviewable.

- **Automatic multi-step flows.** When several steps run automatically (e.g. the URL
  handler that opens a connection: parse → add → reveal → connect), ask whether the user
  is **told what is about to happen** and/or what **was** done. Consider a **confirmation /
  summary notification** before or after the automatic sequence (the `vscodeUriHandler`
  flow is the reference example). Flag any chain of side effects that fires with no
  before/after signal.
- **Consequential or irreversible auto-actions** (creating/removing resources, writing
  storage, connecting to a target) warrant an **explicit confirm** or at minimum a clear
  after-the-fact notice — not a silent side effect.
- **Actions that complete too fast to notice.** When an automatic action finishes so
  quickly the user can't tell it happened (or the UI flickers past a state), consider a
  **short intentional delay** or a **transient progress/toast** so the change is
  perceivable. A UI that snaps instantly through states reads as "nothing happened." Flag
  spots where a small delay or a lingering confirmation would make an automatic action
  legible.
- **Where the review should decide:** for each automatic behavior, the operator picks one
  of — (a) silent (only for trivial, reversible, expected actions), (b) after-the-fact
  toast/summary, or (c) up-front confirmation — and the choice + reason is recorded as a
  Decision. Consistency across sibling flows matters as much as the individual choice.

---

**Output of the sweep:** a list of concrete, code-referenced Flags grouped by suspected
priority (P0–P3), ready to drop into the seeded document's priority sections and Priority
index. The single highest-value output is the **error-surface asymmetry table** (item 1):
every user-facing failure in the feature, and how it is surfaced today.
