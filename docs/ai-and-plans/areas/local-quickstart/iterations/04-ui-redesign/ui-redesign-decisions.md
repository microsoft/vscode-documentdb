---
area: local-quickstart
kind: iteration
status: historical
created: 2026-08-04
---

# Local Quick Start UI redesign decisions

> **Read _Finalization_ (the last chapter) first.** It records the shipped design and supersedes any
> detail it contradicts in the chapters below, which are kept as the reasoning trail.

## Selected design

**Status:** Selected (2026-08-03). This supersedes the finalist comparison below.

- **Concept F — Docker is verified as the first setup stage.** No readiness page, no readiness band, no readiness row, and no readiness section on the Introduction. Docker has exactly one reporting surface: stage 1 of the Set up stage list, which is where every other setup failure is already reported.
- **Flow:** `Introduction → Configure → Set up → Done`. Four steps, fixed breadcrumb shape, no page whose presence depends on a check result.
- **Introduction** shows the heading, the lead sentence, the sentence `Nothing is downloaded or created on your machine until you choose to start.`, and the full `What will happen` plan with all four details. Nothing is checked here.
- **Configure** shows settings only, plus the **note above the footer** as the pre-launch expectation setter:

  > Starting downloads the official image if needed, then creates and starts one container named documentdb-local. Nothing else on your machine is changed.

  Rejected alternatives at this point: no note at all (nothing reassures a cautious user), a repeated plan panel (redundant with the Introduction and costly in vertical space), and a confirm popover on Start (adds a click to every run for an action that is not hard to undo).

- **Set up** runs the five existing provisioning stages, with **inline detail lines** on the stage rows. See _Stage detail lines_ below.
- **Docker failure** is a Set up failure: heading `Setup did not finish`, sub-copy `Setup stopped at the first stage. Nothing was created on your machine.`, stage 1 in error with its detail line, stages 2-5 pending, remediation beside the list, then `More details` and `Last checked` as the final line. Footer primary is `Retry setup`, secondary is `Back` to Configure.

**Accepted cost:** the user configures before learning Docker is unusable, so a failure wastes the Configure step. This is deliberate — it optimizes the common case and keeps exactly one failure surface, one vocabulary for "something went wrong", and no readiness UI to place, size, or keep in sync.

## Webview chrome baseline

**Status:** Established convention, not a new decision.

`src/webviews/documentdb/atlasCredentials/AtlasCredentialsView.tsx` is the reference implementation for wizard-style webviews in this extension. The Local Quick Start redesign adopts its chrome wholesale; the design lab prototype is a copy of it. Where the two disagree, the Atlas view wins.

- Full-height flex root, a single scrollable content area, and a sticky footer that never scrolls away.
- Content column capped at `760px`, `24px` padding, `20px` between major sections, `12px` within a section, `4px` between a heading and its subtitle.
- Footer is `16px 24px` with `8px` between buttons, primary first then secondary, and it gains a top border plus `0 -2px 6px rgba(0, 0, 0, 0.08)` only when the content actually overflows — tracked with a `ResizeObserver`.
- Step indicator is a Fluent `Breadcrumb` inside `Overflow` with `minimumVisible={1}`, `BreadcrumbButton` with `current` and `aria-current="step"`, `disabledFocusable` for steps that cannot be navigated to, and a `MoreHorizontal` overflow menu for collapsed steps.
- One `h1` in a stable hero (icon, title, subtitle) that never changes between steps; each step owns an `h2`; focus moves to that `h2` on step change and never on first render.
- `Announcer` from `src/webviews/components/accessibility/Announcer.tsx` for status announcements, assertive for errors.
- Fluent v9 throughout, styled with `makeStyles` and `tokens`; SCSS is used only to remove VS Code's default body padding.

## Stage detail lines

**Status:** Selected (2026-08-03)

Each stage row in the Set up list can carry a secondary, muted detail line under its label. The detail is **evidence, not narration** — it states what was actually observed, and it **persists after the stage completes** so the list reads as a receipt rather than a transient log.

This matters most for stage 1, `Checking Docker`:

- **Success path.** A bare checkmark tells the user the check passed but not _what_ passed. The detail line reassures them that the extension found the Docker they expect — the right provider, the right version, the right architecture, on the right machine. Users with several Docker installations, a remote or WSL setup, or Docker Desktop alongside Docker Engine need this to trust the result.

  Shape: provider and version, then platform and architecture, then where it runs. Prototype string: `Docker Engine 27.5.1 · Linux amd64 · runs on this machine`.

- **Failure path.** The detail line must state what _was_ discovered before the failure, not only that something failed. This is what makes the remediation text actionable and what a user pastes into a bug report. A CLI that was found but a daemon that was unreachable is a different problem from no CLI at all, and the row must say which.

  Shape: the facts that were established, then the point of failure. Prototype string: `Docker needs attention · access denied`, which is the minimum; the real implementation should include the established facts as well, for example `Docker CLI 27.5.1 found · daemon unreachable`.

- **While active,** the detail line carries the live status (`Checking…`) and is replaced by the result when the stage settles.

Rules:

- Facts come from the readiness result. Never invent, guess, or fill placeholders when a field is unknown — drop that segment instead.
- Use `·` as the segment separator, sentence case, no trailing period.
- Keep it to one line at normal width; it may wrap at narrow width but must not become a paragraph.
- The detail line is a summary. The full fact list stays in the collapsed `More details` accordion, and `Last checked` remains the last line of the status content.
- The same mechanism is available to the other stages (for example the resolved image tag, the container name, the bound port). Use it where a fact reassures or aids diagnosis; leave the detail empty otherwise.

## Introduction copy

**Status:** Accepted for the current design direction (2026-08-03)

**Header**

- Title: `DocumentDB Local`
- Subtitle: `Set up DocumentDB locally for development and testing with Docker.`

**Introduction page**

- Heading: `Develop and test locally`
- Body:

  > DocumentDB Local gives you an open-source, fully MongoDB-compatible database for development and testing on your machine.

- In F only, a second sentence is added because nothing has been verified yet:

  > Nothing is downloaded or created on your machine until you choose to start.

- A `What will happen` section follows the body. See _What will happen_ below.

**Rationale**

- Leads with the local development and testing use case.
- States the open-source and MongoDB-compatibility claims without marketing language.
- Keeps Docker in the stable subtitle.
- Deliberately avoids claims about data persistence because that behavior may change.
- The earlier sentence `Continue to set up DocumentDB Local. This wizard will check Docker, let you review the setup, and show progress while it creates and starts the database.` was **removed**. It described the wizard rather than the outcome, and a prose list of steps is harder to scan than the steps themselves. The `What will happen` list replaces it.

## What will happen

**Status:** Accepted for the current design direction (2026-08-03)

The Introduction earns its place only if it removes uncertainty before the user commits. It should answer "what is about to be done to my machine?" rather than "what is this product?". A numbered plan does that better than a paragraph.

- Sub-heading: `What will happen`
- An ordered list of four items, each with a label and a one-line detail:

| #   | Label                          | Detail                                                               |
| --- | ------------------------------ | -------------------------------------------------------------------- |
| 1   | Verify your Docker setup       | Confirms Docker is installed and can run containers on this machine. |
| 2   | Download the official image    | Downloaded once, then reused for later setups.                       |
| 3   | Create and start the container | One container named documentdb-local, using the settings you choose. |
| 4   | Save the connection            | The connection appears in the Connections view, ready to open.       |

- The list mirrors the wizard's own sequence, so the user recognizes it again on the Set up page.
- Details are scoped to what changes on the machine: one image, one container, one saved connection.

**How each concept uses the list**

- **E** renders the list with step 1 live: spinner and `Checking…` while the check runs, a checkmark and the detected engine line on success, an error icon and `Docker needs attention · access denied` on failure. Details on steps 2-4 stay hidden so the live step remains the focus. The verified plan replaces both the removed prose sentence and any dedicated readiness surface.
- **F** renders the full list with all four details and no live state, because nothing has been checked yet. The detail text carries the entire expectation-setting burden.

## Active flow exploration

**Current finalists (2026-08-03): E and F.** A, B, C, D, and G were removed from the lab. The comparison that produced this narrowing is retained below for the record.

- **A: Separate readiness page** keeps environment verification separate from setup configuration.
- **B: Status in Configure** keeps compact Docker evidence above configuration and disables settings when Docker needs attention.
- **C: Wizard status band** moves readiness into wizard chrome so Configure contains settings only.
- **D: Exception-only page** sends healthy users directly to Configure and inserts a dedicated System check page only when Docker needs attention.
- **E: Check on the Introduction** runs the check on the page the user already reads, so no step and no chrome are added.
- **F: Check as the first setup stage** removes the readiness surface entirely and reports Docker through the existing stage list.
- **G: Readiness row in Configure** treats readiness as the first row of the settings inventory.

E and F frame the remaining question: verify before the user invests effort (E), or keep exactly one failure surface (F). Every other concept added a step, added chrome, or created a second place for the same failure to appear.

> The compact three-card Docker treatment recorded under _A: Selected System check presentation_ is not used by either finalist. Neither E nor F has a dedicated readiness surface to host it. E expresses the same evidence as one live plan step plus `More details`.

### A: Selected System check presentation

**Status:** Selected for the current design direction (2026-08-03)

- Breadcrumb and page name: `System check`.
- Three compact cards appear first: Docker, Platform, and Runs on.
- The `Docker is ready` or `Docker needs attention` statement follows the cards.
- Remediation appears next when Docker needs attention.
- Full detected facts live in a collapsed `More details` accordion.
- `Last checked: just now` is always a dedicated final line in the status content.

The cards adapt the earlier prototype treatment but deliberately reduce the happy path to three facts.

### Selected settings interaction

**Status:** Selected for the current design direction (2026-08-03)

- Use inline actions for editable settings.
- Address shows `localhost:10260`; only the port can be edited.
- Image shows the full official image reference and offers an inline Edit action.
- Credentials show the active mode with `Use custom` / `Use generated` inline actions.
- Sample data uses an inline toggle.

### Additional flow concepts

**C: Wizard status band**

- Keeps readiness outside the Configure page.
- Uses little vertical space and keeps settings conceptually pure.
- Introduces persistent wizard chrome whose visibility on Set up and Done needs a clear rule.
- **Finalist:** yes. Compare new alternatives against its compactness and its separation of readiness from Configure content.

**D: Exception-only page**

- Healthy flow remains `Introduction → Configure → Set up → Done` with a small completed-check receipt.
- Failure dynamically becomes `Introduction → System check → Configure → Set up → Done`.
- Minimizes happy-path ceremony, but a breadcrumb whose shape changes after a check may feel less predictable.

## Fresh alternatives (2026-08-03)

Three new concepts were built to attack the same information-architecture problem from directions A and C do not cover. A and C both assume readiness is a _topic_ that needs somewhere to live — a page of its own or a persistent band. E, F, and G each reject that assumption in a different way.

| Concept | Where readiness lives            | Steps | Chrome added | Breadcrumb shape |
| ------- | -------------------------------- | ----- | ------------ | ---------------- |
| A       | Its own page                     | 5     | none         | fixed            |
| C       | Wizard band above the page       | 4     | persistent   | fixed            |
| E       | Bottom of the Introduction page  | 4     | none         | fixed            |
| F       | First stage of the Set up list   | 4     | none         | fixed            |
| G       | First row of the Configure table | 4     | none         | fixed            |

### E: Check on the Introduction

**Idea:** The Introduction already promises `This wizard will check Docker…`. Run the check while the user reads that sentence and show the result under a `System check` sub-heading on the same page.

- Flow: `Introduction → Configure → Set up → Done`.
- Introduction gains three states: checking (spinner, `Continue` disabled), ready (compact cards + `Docker is ready` + `More details` + `Last checked`), needs attention (same block plus remediation, primary becomes `Check again`).
- Configure contains settings only, exactly as in A and C.

**Compared with A:** one fewer step and no page whose entire purpose is to say "everything is fine". The user reads the introduction anyway, so the check costs no additional interaction on the happy path. A is still cleaner if the check is slow enough that a dedicated page with its own progress feels warranted.

**Compared with C:** no persistent chrome, so there is no rule to invent about whether the band shows during Set up and Done. The readiness statement appears once, at the moment it is decided, and then stops competing for attention. C keeps the evidence visible while the user configures; E assumes that is not needed once the check passes.

**Cost:** the Introduction page carries two topics, and a slow check delays `Continue`. The failure state keeps the introduction copy above the error.

### F: Check as the first setup stage

**Idea:** Setup already has a five-stage list whose first stage is `Checking Docker`, and every other stage failure is reported there. Delete the readiness concept entirely and let the existing stage list own it.

- Flow: `Introduction → Configure → Set up → Done`; no readiness surface exists before Set up.
- On Docker failure the Set up page shows `Setup did not finish`, stage 1 failed, stages 2-5 pending, the remediation message bar beside the failed list, then `More details` and `Last checked`.
- Sub-heading states that nothing was created on the machine.
- Footer primary becomes `Retry setup`; `Back` returns to Configure.

**Compared with A and C:** the strongest simplification. There is exactly one failure surface instead of two, one vocabulary for "something went wrong", and no readiness UI to place, size, or keep in sync. Both A and C must design a healthy-state readiness display that the great majority of users will glance at once and never act on.

**Cost:** the user configures before learning that Docker is unusable, so a failure wastes the configuration step. This is the clearest trade in the set: F optimizes the common case and accepts a longer path in the uncommon one. It also drops the reassurance that A and C provide before any work starts.

### G: Readiness row in Configure

**Idea:** Configure is already an inventory of facts about the setup: address, image, credentials, sample data. Docker readiness is another fact about the same setup, so make it the first row rather than a separate topic.

- Flow: `Introduction → Configure → Set up → Done`.
- Row value merges evidence and statement: status icon, `Docker is ready` / `Docker needs attention`, then `Engine 27.5.1 · Linux amd64 · this machine`.
- Inline `Check again` action matches the inline `Edit` actions of every other row.
- On failure the remediation message bar spans the table directly under the row, followed by `More details` and `Last checked`; the four editable rows are disabled while the `Check again` action stays enabled; the footer primary is a disabled `Start DocumentDB Local`.

**Compared with B:** B stacks a separate status block above the settings table, so the page reads as two components. G has one component, so the compact-card grid disappears and the page gets shorter.

**Compared with A and C:** no extra step and no chrome, and the disabled-settings behavior reads naturally because the blocking fact sits in the same table as the things it blocks. Against C specifically, G costs slightly more vertical space in Configure but removes the persistent-band visibility rule.

**Cost:** it deviates from the documented card treatment, since the row replaces the three compact cards. The `More details` and `Last checked` lines sit between the Docker row and `Address`, which visually splits the inventory on the happy path.

### Recommendation

- **F** if the goal is the smallest possible information architecture and the Docker failure rate is low.
- **E** if failures must be caught before the user invests effort, without adding a step or chrome.
- G superseded B; A, C, and D were dropped along with it. A and C are still the reference points for anyone who later argues that readiness needs a stable, addressable location or must stay visible across pages.

## Before Start: setting expectations at the commit point

**Status:** Under evaluation (2026-08-03)

The Introduction plan is read minutes before the user presses `Start DocumentDB Local`, and in E it is a page the user may skip past. The Configure page is the actual commit point, so the same question — "what happens when I press this?" — has to be answerable there. Four options are implemented in the lab under the `Before Start` control.

| Option                    | What it is                                                                                      | Cost                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **None**                  | The button label is the only signal.                                                            | Nothing to read, but nothing to reassure a cautious user.   |
| **Note above the footer** | One muted sentence with an info icon, directly above the footer.                                | Two lines of vertical space. Prose again instead of a list. |
| **Plan panel**            | A bordered panel titled `When you select Start` containing the same four-step plan.             | Repeats the Introduction. Largest vertical cost.            |
| **Confirm on Start**      | A popover on the primary button: `Start setup now?`, the four steps, then `Start` and `Cancel`. | Adds a click to the happy path.                             |

**Copy**

- Note: `Starting downloads the official image if needed, then creates and starts one container named documentdb-local. Nothing else on your machine is changed.`
- Plan panel heading: `When you select Start`
- Confirm popover: `Start setup now?` / `Four steps run in order. You can cancel while they run.`

**Density is complementary, not repeated**

- In **E**, the Introduction showed a dense plan (details hidden). The Configure plan panel therefore shows all four details, with step 1 already carrying its verified result — the user sees a plan that is partly complete rather than a duplicate.
- In **F**, the Introduction already showed all four details, so the Configure plan panel is dense: labels only, as a recap.
- The confirm popover is always a plain, dense, unverified list of four steps, so its title and content agree regardless of concept.

## Finalization

**Status:** Finalized and implemented (2026-08-04). Concept F shipped in `LocalQuickStart.tsx`. Where this chapter disagrees with an earlier one, this chapter wins; the earlier chapters remain as the reasoning trail.

### Chrome is Atlas's, not a variant of it

`AtlasCredentialsView.tsx` remains the reference implementation. The hero markup is now byte-for-byte the Atlas structure — icon, then a plain `div` holding the `h1` with the subtitle in a nested `div` — rather than the flex-column variant the prototype had drifted into. The breadcrumb was extracted to `src/webviews/components/wizard/WizardBreadcrumb.tsx` and both views consume it, so there is one implementation of overflow, `aria-current`, `disabledFocusable`, and the completed-step weight instead of three copies.

### Names come from constants, not from prose

The Introduction plan and the pre-launch note previously said `documentdb-local`; the container the service actually creates is `QUICK_START_CONTAINER_NAME` (`vscode-documentdb-local`). Both strings are now formatted from that constant. A user who runs `docker ps` after setup sees exactly the name the wizard promised, and the promise cannot drift from the code again.

### The plan is scoped to the step it describes

The Introduction sub-heading is `What will happen in the Set up step`, not `What will happen`. The old wording read as "this is about to happen", which is wrong: two more pages sit between the plan and any action. Naming the step ties the list to the breadcrumb and makes it explicit that there is still time to review everything.

### The expectation note lives in the footer

The pre-launch note moved out of the Configure page body and into the footer, directly above the primary button. It is no longer page content that can scroll away from the button it describes — it is part of the commit point. This deliberately increases footer height. The note runs the full footer width rather than being capped to the content column, and its info icon shares the text's first line box so the two align exactly.

The same mechanism now labels the failure page: above `Retry setup` the footer says that retrying runs every step again from the beginning. The full-restart semantics of the big button were previously implicit in the word "Retry"; now they are stated.

### Docker recovery has three explicit scopes

The single-surface rule held, but one action was doing three jobs. `Check again` sat on the `Last checked` line, re-ran the Docker check, and then silently started the whole provisioning run if the check passed. The label described the smallest of those behaviours and the user got the largest.

The three scopes are now separate and each is named for what it does:

| Scope      | Control                                               | Effect                                                                         |
| ---------- | ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| One stage  | `Check Docker again` link inside the failed stage row | Re-runs only the Docker check. Never starts provisioning.                      |
| Continue   | Footer primary, relabelled `Continue setup`           | Runs setup once the check stage is no longer failing.                          |
| Everything | Footer primary, `Retry setup`                         | Runs the whole process again, for users who do not want to reason about scope. |

The recheck link lives in the stage row because that is the stage it re-runs — the same "one fact, one home" principle that put Docker on a single surface. It is deliberately **not** duplicated into the error `MessageBar`: two controls a few pixels apart with identical behaviour is the ambiguity we just removed. The `MessageBar` keeps the actions that _change_ something (`Install Docker`, `Start Docker`, `Copy command`, `Continue anyway`, `View Docker output`).

`Start Docker` followed by successful polling now resolves the same way as a manual recheck: the blocker clears in place and the user chooses when to continue. Nothing auto-starts a run the user did not ask for.

When a recheck passes, the check stage flips to done with its ready evidence line, a `Docker is ready` success bar appears, and the footer becomes `Continue setup`. This is only offered when the check stage was the failure — for a Docker problem hit during `pulling` or `creating` there is nothing to continue from, so the footer stays `Retry setup`.

### `More details` was too generic

The accordion is now `What the Docker check found`. It holds the detected problem, CLI, daemon, provider, platform, endpoint, and execution target — all facts from one check. The old title told the reader there was more without saying more about what.

### The error bar follows the Atlas treatment

The Docker error `MessageBar` takes an explicit `icon={<ErrorCircleFilled />}` and warning bars take `<WarningRegular />`, matching `AtlasCredentialsView`. Success bars keep the Fluent default, as Atlas does.

Inside the bar:

- The recovery command is a real code chip — neutral surface, `colorStatusDangerBorder1` outline, `fontFamilyMonospace`. Previously it inherited a flat grey `code` background that punched a neutral block through the error tint; a danger-tinted fill was tried and read as a second alert nested inside the first.
- Supplementary notes such as `Group membership applies to new login sessions only.` render at the default text size. They were `size={200}` and muted, which stacked a third type size into a bar that already has a title and body.
- The documentation link became an action button with a full label — `Open Linux setup guide` rather than `Linux setup guide` — so every control in the bar is a button and every label says what it does.

### The plan list uses Fluent primitives

The step numbers are Fluent `Badge` (`shape="circular"`, `appearance="tint"`) instead of a hand-rolled CSS circle. The list stays a semantic `<ol>` laid out with `makeStyles`: Fluent v9 has no stable list primitive (only `@fluentui/react-list-preview`, which this repo does not depend on), and the Atlas view lays its own lists out the same way.

### What still needs to be remembered, and what does not

Two different memories were in play; only one of them belonged in the UI.

- **The 2-second readiness memo** (`READINESS_MEMO_TTL_MS`) is kept. It is what lets the webview read back the classification the service just acted on, without probing Docker a second time. It is why the failure evidence on screen is exactly the evidence that caused the failure.
- **Provider memory** (remembering that this machine has Docker Desktop) is kept. It improves classification when the daemon is unreachable — `Start Docker Desktop` instead of a generic message — and that value is independent of where the check surfaces.
- **`getDockerLastCheckedAtMs` was deleted.** It reported `providerRecordedAtMs` for remembered evidence, which made `Last checked` show a possibly days-old timestamp. That was defensible when a readiness page could be rendered from memory. It is wrong now: the check only ever runs because the user pressed `Start DocumentDB Local` or `Check Docker again`, so `checkedAtMs` is always the honest answer.

`Last checked` itself stays as the final line of Docker status content, and earns its place again now that `Check Docker again` exists — it tells the user how stale the evidence in front of them is while they work through the remediation.

### The design lab is gone

`QuickStartDesignLab.tsx`, its controller, its command, its `package.json` contribution, its static preview page, and the handoff document were removed once the design was implemented. This document is the surviving record. Reintroducing a lab is cheap if a future question needs one; keeping a dead one is not free.

**Assessment**

- The **note** is the best value per pixel: it states the two irreversible-looking actions (download, create a container) and the boundary (`Nothing else on your machine is changed`) in one sentence, without repeating the plan structure.
- The **plan panel** is the strongest for a first-time user and the most redundant for a repeat user. It is the right choice only if the Introduction is expected to be skipped.
- The **confirm popover** is the only option that guarantees the user reads the plan, and the only one that costs a click every time. Reserve it for a case where starting is genuinely hard to undo; setup here is not.
- **None** stays viable in E, where the Introduction plan was verified in front of the user moments earlier.

**Decision:** the **note above the footer**, with concept F. See _Selected design_ at the top of this document.

## Known follow-ups

Deferred deliberately — recorded here so they are not rediscovered as new bugs.

### Retry setup is not fully race-free yet

`Retry setup` used to work only on every second click. `QuickStartService.provision` reports every
terminal failure by buffering it into `terminalEvent`, letting `finally` clear the `provisioning`
guard, and yielding it afterwards — but the Docker-readiness failure yielded in place, from inside
the `try`. The generator then sat suspended at that `yield` with `provisioning` still set, while the
webview already showed the failure and re-enabled the button. The next click unsubscribed the old
stream and immediately subscribed a new one, which reached the guard before the old generator had
unwound, and came back with `Setup is already in progress.`. The click after that worked, because by
then the unwind had completed.

Fixed by routing the readiness failure through the same buffered path (a typed `DockerNotReadyError`
caught by the existing `catch`), with a regression test in `QuickStartService.test.ts`.

**Still open:** `runStream` in `LocalQuickStart.tsx` does not await the unsubscribe before sending
the next subscription. Nothing exercises that window today, but the ordering is luck, not design. It
should become an explicit handshake that waits for the previous stream to end.

### The error row in the tree is surprising

When the wizard fails, `LocalQuickStartItem` adds a row under `DocumentDB Local - Quick Start`
carrying the raw error message. It is useful when the failure happened without the wizard being
open, and confusing when the user just closed the wizard that reported the same error. Decide
whether that row belongs at all, and if it does, what it should say.
