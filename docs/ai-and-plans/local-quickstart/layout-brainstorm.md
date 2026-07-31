# Local Quick Start — layout brainstorm

> Experimental branch `dev/tnaum/quickstart-brainstorm`. Three runnable layouts, one
> shared state machine. Nothing here is a decision; it exists to be clicked through.
>
> Open them with **DocumentDB Prototypes: Local Quick Start: Compare Layouts…** in the
> command palette, or the **Compare layouts (prototype)** row under the
> _DocumentDB Local - Quick Start_ tree node.

---

## 1. What the Atlas credentials wizard actually does

`src/webviews/documentdb/atlasCredentials/AtlasCredentialsView.tsx`

```
┌─ main (height:100vh, flex column, overflow hidden) ────────────────────────┐
│ ┌─ scrollArea (flex:1, overflow-y:auto) ─────────────────────────────────┐ │
│ │  ┌─ content (max-width 760px, padding 24, gap 20) ──────────────────┐  │ │
│ │  │                                                                  │  │ │
│ │  │  ☁   Add a MongoDB Atlas connection            ← hero, size 700  │  │ │
│ │  │      Connect MongoDB Atlas to browse, open, …  ← muted subtitle  │  │ │
│ │  │                                                                  │  │ │
│ │  │  ✔ Choose method › ○ Enter details › ○ Verify › ○ Done           │  │ │
│ │  │  └──────────────── Breadcrumb + Overflow ──────────────────┘     │  │ │
│ │  │                                                                  │  │ │
│ │  │  ── one step's content only ──────────────────────────────────   │  │ │
│ │  │  Choose an authentication method            ← <h2>, focus target │  │ │
│ │  │  Pick how we sign in to MongoDB Atlas.                           │  │ │
│ │  │  ┌───────────────────────┐ ┌───────────────────────┐             │  │ │
│ │  │  │ 👤 Service Account  ◉ │ │ 🔑 API Key          ○ │  ← Card +   │  │ │
│ │  │  │    Recommended        │ │    Legacy, simplest   │    Radio    │  │ │
│ │  │  │    OAuth2 client id…  │ │    Public/private…    │             │  │ │
│ │  │  └───────────────────────┘ └───────────────────────┘             │  │ │
│ │  │                                                                  │  │ │
│ │  └──────────────────────────────────────────────────────────────────┘  │ │
│ └────────────────────────────────────────────────────────────────────────┘ │
│ ┌─ footer (pinned, flex-shrink 0) ───────────────────────────────────────┐ │
│ │  [ Continue ]  [ ← Back ]              ← primary always leftmost,      │ │
│ │                                          gains a shadow only while     │ │
│ │                                          the content is scrollable     │ │
│ └────────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────┘
```

The rules worth stealing, in order of value:

| # | Rule | Why it works |
|---|------|--------------|
| 1 | **Pinned footer, primary first, position never changes.** `Verify & Save` stays `Verify & Save` (disabled) while verifying, so nothing shifts under the pointer. | The action is always reachable without scrolling, and muscle memory survives state changes. |
| 2 | **Breadcrumb doubles as a map and a back-button.** Completed steps carry a green check and stay bold; unreachable steps are `disabledFocusable`. | You always know how many steps remain and which are behind you. |
| 3 | **The current step has overflow priority `n+1`** so it is the last thing collapsed into the `…` menu. | The breadcrumb degrades gracefully in a narrow editor group instead of hiding where you are. |
| 4 | **Steps lock once an irreversible thing happened** (`stepsLocked` while verifying / after save); a failure unlocks them. | No "back" into a state the host has already left. |
| 5 | **The failure stays on the step that failed**, with `Retry` inside the `MessageBar` next to `Show details` — not in the footer. | Recovery actions live next to their explanation. |
| 6 | **Focus moves to the new step's `<h2>` on every step change.** | Keyboard and screen-reader users don't get dumped on `<body>`. |
| 7 | **A vertical `StageRow` checklist** (✔ / spinner / ✖ / ○) narrates the host's real work. | Progress that maps to something true, rather than a fake bar. |

And one anti-pattern to _not_ copy: the `USER-TEST PROTOTYPE` "Footer experiment" `Switch`
+ `PREVIEW` badge floating over the top-right corner. It is scaffolding.

---

## 2. Where Quick Start is today

`src/webviews/documentdb/localQuickStart/LocalQuickStart.tsx`

```
┌─ div.root (max-width 880px, margin auto, no pinned anything) ───────────────┐
│                                                                            │
│  🚀  DocumentDB Local                                       ← <h2>, 600    │
│      Get a working local DocumentDB instance in one click.                 │
│                                                                            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   ← 4 metric cards,   │
│  │ Docker   │ │ Port     │ │ Data     │ │ Security │     auto-fit grid     │
│  │ ✓ Ready  │ │ 10260    │ │ Persist… │ │ TLS·self │                       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘                       │
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ What we'll do                                                        │  │
│  │ ──────────────────────────────────────────────────────────────────── │  │
│  │ Image        ghcr.io/documentdb/…/documentdb-local:latest            │  │
│  │ Port         10260 (auto)                                            │  │
│  │ Runs on      This machine (Docker)                                   │  │
│  │ Credentials  Auto-generated, stored securely                         │  │
│  │ Lifetime     Keeps running after VS Code closes                      │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                            │
│  ▸ Advanced (optional)                                                     │
│                                                                            │
│                                    [ Cancel ] [ 🚀 Start DocumentDB Local ]│
│                                    ← right-aligned, scrolls off-screen     │
└────────────────────────────────────────────────────────────────────────────┘
```

Six phases, each returning an **entirely different page** from the same component:

```
                    ┌──────────┐
                    │ loading  │  full-page spinner
                    └────┬─────┘
             ready? ┌────┴────┐ no
                ┌───┘         └───┐
        ┌───────▼──────┐   ┌──────▼─────────┐
        │   review     │   │ dockerNotReady │  3 cards + How to fix + Retry
        │ (page above) │   └──────┬─────────┘
        └───────┬──────┘          │ retry
         Start  │   ◄─────────────┘
        ┌───────▼──────┐
        │ provisioning │  hero + 7-row checklist + Cancel
        └───┬──────┬───┘
      done  │      │ error
   ┌────────▼─┐ ┌──▼─────────────────────────┐
   │ success  │ │ failed                     │
   │ green box│ │  timedOut → Wait longer /  │
   │ + 3 btns │ │             Start over     │
   └──────────┘ │  else     → Edit settings /│
                │             Retry          │
                └────────────────────────────┘
```

What's actually wrong with it:

- **The primary action is below the fold** and right-aligned, after ~500px of content the
  user did not ask for. The one thing 80% of people want is the hardest thing to find.
- **Four metric cards restate four constants.** `Data: Persistent volume` and
  `Security: TLS · self-signed` are not decisions, not status, and never change.
- **The summary card restates the metric cards**, then the Advanced accordion restates
  the summary card. Three passes over the same six facts.
- **Every phase repaints the whole page.** Nothing is stable between review →
  provisioning → success, so there is no visual thread to follow.
- **The 7-row checklist shows `done` and `error` as rows**, which are bookkeeping, not steps.
- No progress affordance until you press Start, and no persistent action bar after.

The flow itself is good. The layout is a specification rendered as a page.

---

## 3. Proposals

### A — "Express": one page, one slot, no navigation

```
┌────────────────────────────────────────────────────────────────────┐
│                                                                    │
│   🚀   DocumentDB Local                                            │
│        A real DocumentDB running on this machine, in about a min.  │
│                                                                    │
│   ✓ Docker ready · localhost:10260 · Data persists · TLS self-signed│
│   └────────── one fact strip; read, not scanned ──────────┘        │
│                                                                    │
│   ╔════════════════ THE SLOT (only thing that changes) ══════════╗ │
│   ║                                                              ║ │
│   ║     ┌────────────────────────────────┐                       ║ │
│   ║     │  🚀  Create DocumentDB Local   │  ← size="large"       ║ │
│   ║     └────────────────────────────────┘                       ║ │
│   ║     Pulls the official image, starts a container, and saves   ║ │
│   ║     the connection for you. Usually under a minute.           ║ │
│   ╚══════════════════════════════════════════════════════════════╝ │
│                                                                    │
│   ▸ Customize (optional)                                           │
└────────────────────────────────────────────────────────────────────┘
        │  press
        ▼   ...the slot swaps in place. The page does not move.
┌────────────────────────────────────────────────────────────────────┐
│   🚀   DocumentDB Local                                            │
│   ✓ Docker ready · localhost:10260 · Data persists · TLS self-signed│
│   ╔══════════════════════════════════════════════════════════════╗ │
│   ║  ◌  Setting up… 00:23                                        ║ │
│   ║  ┌────────────────────────────────────────────────────────┐  ║ │
│   ║  │ ✔ Checking Docker                                      │  ║ │
│   ║  │ ◌ Pulling official image                               │  ║ │
│   ║  │ ○ Creating container                                   │  ║ │
│   ║  │ ○ Starting container                                   │  ║ │
│   ║  │ ○ Waiting for DocumentDB to accept connections         │  ║ │
│   ║  └────────────────────────────────────────────────────────┘  ║ │
│   ║  [ Cancel ]   View Docker output                             ║ │
│   ╚══════════════════════════════════════════════════════════════╝ │
└────────────────────────────────────────────────────────────────────┘
        │  done
        ▼
┌────────────────────────────────────────────────────────────────────┐
│   ╔══════════════════════════════════════════════════════════════╗ │
│   ║  ✔  DocumentDB Local is running.                             ║ │
│   ║     `localhost:10260`                                        ║ │
│   ║  [ Open Connection ] [ Copy Connection String ] [ Close ]     ║ │
│   ║  Next steps                                                   ║ │
│   ║  • Open Connection: browse your databases in the Connections… ║ │
│   ╚══════════════════════════════════════════════════════════════╝ │
└────────────────────────────────────────────────────────────────────┘
```

- Hero and fact strip **never move**. Only the slot's contents change.
- Docker-not-ready is also just the slot, so there is still no navigation.
- 4 cards → 1 line. 3 restatements of the config → 1 line + a collapsed section.
- Advanced is labelled `Customize (changed)` once dirty, so a customization can't hide.

**Cost:** on a short editor group the CTA can still scroll out of view (no pinned footer),
and the failure path has to fit in the slot or the page grows.

### B — "Wizard": the Atlas layout, applied literally

```
┌─ main (100vh, pinned footer) ──────────────────────────────────────────────┐
│ ┌─ scrollArea ───────────────────────────────────────────────────────────┐ │
│ │  🚀  DocumentDB Local                                                  │ │
│ │      Run a real DocumentDB on this machine in a Docker container…      │ │
│ │                                                                        │ │
│ │  ✔ Check Docker › ● Configure › ○ Set up › ○ Done                      │ │
│ │  └─────────── same Breadcrumb + Overflow as Atlas ──────────┘          │ │
│ │                                                                        │ │
│ │  Review what will be created                        ← <h2>, focused    │ │
│ │  These defaults work for most people. Change them only if you need to. │ │
│ │  ┌──────────────────────────────────────────────────────────────────┐  │ │
│ │  │ What we'll do                                                    │  │ │
│ │  │ Image / Port / Runs on / Credentials / Lifetime                  │  │ │
│ │  └──────────────────────────────────────────────────────────────────┘  │ │
│ │  ▸ Advanced (optional)                                                 │ │
│ └────────────────────────────────────────────────────────────────────────┘ │
│ [ Start DocumentDB Local ]  [ Cancel ]      ← pinned, primary first        │
└────────────────────────────────────────────────────────────────────────────┘

  step ↔ phase mapping
  ─────────────────────────────────────────────────────────────
  check      ← dockerNotReady      primary: Check again
  configure  ← review              primary: Start DocumentDB Local
  set up     ← provisioning        primary: Setting up… (disabled) │ 2nd: Cancel
             ← failed              primary: Retry / Wait longer    │ 2nd: Edit settings / Start over
  done       ← success             primary: Open Connection        │ 2nd: Copy · Close
```

- Reuses the chrome extracted to `src/webviews/components/wizard/WizardShell.tsx`
  (`WizardShell` + `WizardBreadcrumb`), so Atlas and Quick Start would be identical
  by construction rather than by review.
- The `Check Docker` step **only ever appears when Docker is broken** — a healthy machine
  opens on `Configure` with the first step already checked, exactly like Atlas's
  pre-satisfied "Choose method".

**Cost:** it dresses a one-decision flow as a four-step process. Steps that are never
visited still occupy the breadcrumb, and the breadcrumb promises navigation that mostly
isn't there. Honest about the wait, dishonest about the complexity.

### C — "Guided": wizard chrome, one page

```
┌─ main (100vh, pinned footer) ──────────────────────────────────────────────┐
│ ┌─ scrollArea ───────────────────────────────────────────────────────────┐ │
│ │  🚀  DocumentDB Local                                                  │ │
│ │      A real DocumentDB running on this machine, in about a minute.     │ │
│ │                                                                        │ │
│ │  ○ Get image ── ○ Start container ── ○ Connect                         │ │
│ │  └── status rail: NOT clickable, 5 technical stages → 3 human ones ──┘ │ │
│ │                                                                        │ │
│ │  Here's what you'll get                             ← <h2>             │ │
│ │  ┌──────────────────────────────────────────────────────────────────┐  │ │
│ │  │ Address          Credentials       Data            Image         │  │ │
│ │  │ localhost:10260  Auto-generated    Persistent vol  documentdb-…  │  │ │
│ │  └──────────── one card, four facts, one row ──────────────────────┘  │ │
│ │  ▸ Advanced (optional)                                                 │ │
│ └────────────────────────────────────────────────────────────────────────┘ │
│ [ 🚀 Start DocumentDB Local ]  [ Cancel ]                                  │
└────────────────────────────────────────────────────────────────────────────┘
        │  press — page keeps its shape, rail animates
        ▼
│  ✔ Get image ──● Start container ── ○ Connect                              │
│                                                                            │
│  Setting up… 00:23                                                         │
│  You can keep working; this finishes on its own and the connection is saved.│
│  ┌ Address / Credentials / Data / Image ─────────────────────────────────┐ │
│  ▸ Details        ← the full 5-row checklist + View Docker output          │
│ [ Setting up… (disabled) ]  [ Cancel ]                                     │
```

- **The rail is status, not navigation.** There is nothing to go back to in a flow whose
  only decision is "start", so it doesn't pretend otherwise — it answers "how far along
  am I", the only question anyone asks during a one-minute wait.
- Five technical stages collapse into three human ones. `Checking Docker` and
  `Pulling official image` are the same wait from the user's side; the real checklist is
  one `▸ Details` disclosure away and auto-opens on failure.
- Keeps the Atlas pinned footer, so the primary action is reachable at any window height.

**Cost:** a rail that looks like a stepper but can't be clicked may read as broken to some
users; needs the non-interactive styling to be obvious.

---

## 4. Recommendation

**A (Express) for the shipping view, borrowing C's pinned footer.**

The 80% path here has exactly one decision — "yes" — and it was already made when the user
clicked _Quick Start_. A wizard adds a `Continue` to a flow with nothing to continue past.
What the current view actually needs is not steps; it needs to stop restating its own
configuration three times and put the button where the eye lands.

Concretely, if only one thing changes: **collapse the 4 metric cards + summary card into
one fact strip, move the primary action above the fold, and keep the page still between
phases.** The wizard chrome earns its keep in Atlas because that flow has a real branch
(which credential type?) and a real failure surface (Atlas rejected you). Quick Start has
neither — it has a wait, and waits want a progress indicator, not a breadcrumb.

Keep B alive for one reason: if Quick Start ever grows a genuine second decision (choose an
image / choose a runtime / bring your own container), the chrome is already extracted and
the switch is a one-line component swap.

---

## 5. What's on this branch

| File | Purpose |
|------|---------|
| `webviews/documentdb/localQuickStart/prototypes/useQuickStartMachine.ts` | All behaviour — Docker probe, provisioning subscription, cancellation, validation — extracted so the layouts differ *only* in presentation. |
| `webviews/documentdb/localQuickStart/prototypes/QuickStartShared.tsx` | Content shared by all three (checklist, Advanced fields, Docker remediation, next steps). |
| `webviews/documentdb/localQuickStart/prototypes/QuickStartExpress.tsx` | Layout A. |
| `webviews/documentdb/localQuickStart/prototypes/QuickStartWizard.tsx` | Layout B. |
| `webviews/documentdb/localQuickStart/prototypes/QuickStartGuided.tsx` | Layout C. |
| `webviews/components/wizard/WizardShell.tsx` | `WizardShell` + `WizardBreadcrumb`, lifted out of `AtlasCredentialsView` so a second flow can reuse them. |
| `commands/localQuickStart/quickStartPrototypeCommands.ts` | Palette commands + the `Compare Layouts…` picker. |

All three prototypes call the **unchanged** `localQuickStart` tRPC router, so clicking
through them exercises real Docker provisioning, real cancellation, and real failures.

`LocalQuickStart.tsx` is untouched — the shipping view still behaves exactly as it does on
`feature/local-quickstart`.
