# Local Quick Start — second layout iteration

> Branch: `dev/tnaum/quickstart-brainstorm-2nd`
>
> Open **DocumentDB Prototypes: Local Quick Start: Recommended (2nd Iteration)**
> directly, or use **Local Quick Start: Compare Layouts…** to compare it with the
> current view and first-round A/B/C prototypes.

## What the complete Atlas flow teaches us

The Atlas credentials view has two different progress systems. They solve different
problems and should not be conflated:

1. The top breadcrumb maps user decisions and pages.
2. The inner verification list maps work performed by the extension host.

### Choose method

```text
┌─ scrollable content ───────────────────────────────────────────────┐
│  ☁  Add a MongoDB Atlas connection                               │
│                                                                  │
│  ✔ Choose method › ○ Enter details › ○ Verify › ○ Done           │
│                                                                  │
│  Choose an authentication method                                 │
│  ┌────────────────────────┐  ┌────────────────────────┐          │
│  │ Service Account     ◉  │  │ API Key             ○  │          │
│  │ Recommended            │  │ Legacy, simplest       │          │
│  └────────────────────────┘  └────────────────────────┘          │
└──────────────────────────────────────────────────────────────────┘
┌─ pinned footer ───────────────────────────────────────────────────┐
│  [ Continue ]  [ ← Back (disabled) ]                             │
└──────────────────────────────────────────────────────────────────┘
```

The cards represent a real branch in the journey. That makes a breadcrumb useful.
The cards collapse from two columns to one below 640px.

### Enter details

```text
│  ✔ Choose method › ● Enter details › ○ Verify › ○ Done           │
│                                                                  │
│  Provide your MongoDB Atlas Service Account                      │
│  Client ID      [                                           ]    │
│  Client Secret  [                                      ][ eye ]  │
│  ▸ Where do I find these values?                                 │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│  [ Verify & Save ]  [ ← Back ]                                   │
```

The form supports Enter-to-submit, accessible secret reveal, a contextual help
accordion, and a different edit mode that removes the method step and locks the
credential identity field.

### Verify — two progress levels at once

```text
│  ✔ Choose method › ✔ Enter details › ● Verify › ○ Done           │  top breadcrumb
│                                                                  │
│  Verify your MongoDB Atlas Service Account                       │
│  We check your credentials before saving your connection.       │
│                                                                  │
│  ┌─ Credential check progress ─────────────────────────────────┐ │
│  │  ◌  Signing in to MongoDB Atlas                            │ │  inner stage list
│  │  ○  Checking access to your projects                       │ │
│  │  ○  Saving the credential                                  │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│  [ Verify & Save (disabled) ]  [ ← Back (disabled) ]             │
```

The stage list does not fake progress. The router does not stream intermediate Atlas
events, so only the first row spins until a result is known. API keys show two rows;
service accounts show three because sign-in and project access are separate operations.

### Verify failure

```text
│  ✔ Choose method › ✔ Enter details › ● Verify › ○ Done           │
│                                                                  │
│  ┌─ Credential check progress ─────────────────────────────────┐ │
│  │  ✔  Signing in to MongoDB Atlas                            │ │
│  │  ✖  Checking access to your projects                       │ │
│  │  ○  Saving the credential                                  │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  [error] We couldn't verify this credential.                     │
│          [ Open access settings ] [ Retry ] [ Show details ]     │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│  [ Verify & Save (disabled) ]  [ ← Back ]                        │
```

This is the strongest reusable pattern in the Atlas flow:

- the row that failed is explicit;
- completed rows remain completed and later rows remain pending;
- a no-projects result uses warning rather than error;
- retry, remediation, and diagnostics live beside the explanation;
- the global Back action unlocks only after failure;
- the primary footer target stays in place and disabled while recovery is local.

### Done

```text
│  ✔ Choose method › ✔ Enter details › ✔ Verify › ✔ Done           │
│                                                                  │
│  Credential added                                                │
│  ┌─ Completed credential checks ───────────────────────────────┐ │
│  │  ✔  Signing in to MongoDB Atlas                            │ │
│  │  ✔  Checking access to your projects                       │ │
│  │  ✔  Saving the credential                                  │ │
│  └─────────────────────────────────────────────────────────────┘ │
│  [success] All set. The credential is ready to use.              │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│  [ Close ]  [ ← Back (disabled) ]                                │
```

Repeating the same list on success provides closure: the visualization that narrated
the wait becomes the receipt for what completed.

### Cross-page details worth preserving

| Atlas behavior | Why it matters |
|---|---|
| Current breadcrumb step has highest overflow priority | Narrow editor groups never hide the user's location. |
| Earlier pages lock while verification runs and after success | Users cannot navigate into invalid or irreversible state. |
| Focus moves to each new `h2` | Keyboard and screen-reader users land on changed content. |
| Phase and error announcements use live regions | Visual state changes are also perceivable non-visually. |
| Footer is pinned and primary action is always first | The action remains reachable and spatially stable. |
| Footer shadow appears only when content continues below | The separator communicates hidden scroll content without permanent chrome. |
| Error recovery stays in the `MessageBar` | Actions are read in the context that explains them. |

## Why Local should not copy the breadcrumb

Atlas asks the user to choose a method and enter credentials. Local's happy path asks
only whether to start. Docker probing and container provisioning are host work, not
pages the user should navigate.

```text
Atlas:  choose method  →  enter details  →  verify  →  done
        user decision     user input        host work   result

Local:  press Start    →  provision container         →  ready
        one decision      host work                      result
```

Presenting `Check Docker › Configure › Set up › Done` as navigation overstates Local's
complexity. Presenting the real container stages as a verification list is accurate.

## Recommended second iteration

```text
┌─ scrollable content ───────────────────────────────────────────────┐
│  🚀  DocumentDB Local                                            │
│      A local DocumentDB instance, ready in about a minute.        │
│                                                                  │
│  ✓ Docker ready · localhost:10260 · Data persists · TLS           │
│                                                                  │
│  Ready when you are                                               │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ One-click setup                                             │ │
│  │ The extension starts the image and saves a connection.      │ │
│  └─────────────────────────────────────────────────────────────┘ │
│  ▸ Customize (optional)                                          │
└──────────────────────────────────────────────────────────────────┘
┌─ pinned footer ───────────────────────────────────────────────────┐
│  [ 🚀 Start DocumentDB Local ]  [ Cancel ]                        │
└──────────────────────────────────────────────────────────────────┘
```

During setup, the page uses Atlas's inner verification pattern rather than a breadcrumb:

```text
│  Setting up DocumentDB Local                                     │
│  This usually takes about a minute. Elapsed time: 00:23           │
│                                                                  │
│  ┌─ Setup progress ────────────────────────────────────────────┐ │
│  │  ✔  Checking Docker                                        │ │
│  │  ◌  Pulling official image                                 │ │
│  │  ○  Creating container                                     │ │
│  │  ○  Starting container                                     │ │
│  │  ○  Waiting for DocumentDB to accept connections           │ │
│  └─────────────────────────────────────────────────────────────┘ │
│  View Docker output                                               │
├──────────────────────────────────────────────────────────────────┤
│  [ Setting up… (disabled) ]  [ Cancel ]                           │
```

Failure keeps recovery with the failed row's explanation:

```text
│  ┌─ Setup progress ────────────────────────────────────────────┐ │
│  │  ✔  Checking Docker                                        │ │
│  │  ✔  Pulling official image                                 │ │
│  │  ✖  Creating container                                     │ │
│  │  ○  Starting container                                     │ │
│  │  ○  Waiting for DocumentDB to accept connections           │ │
│  └─────────────────────────────────────────────────────────────┘ │
│  [error] Port 10260 is already in use.                           │
│          [ Retry ] [ View Docker output ]                         │
├──────────────────────────────────────────────────────────────────┤
│  [ Start DocumentDB Local (disabled) ]  [ Edit settings ]         │
```

Success repeats the completed list before showing connection actions in the footer.

## What changed from the first round

| First-round idea | Second-iteration decision |
|---|---|
| A — Express: one page and compact fact strip | Kept as the content model. |
| A — actions inside the changing card | Replaced with Atlas's pinned footer. |
| B — top breadcrumb | Removed because Local has no page-level decision sequence. |
| B — stable primary footer slot | Kept. |
| C — three-step status rail | Removed because it resembles clickable navigation and hides technical detail. |
| C — pinned footer | Kept. |
| Shared five-row checklist | Elevated to the main setup, failure, and success visualization. |
| Recovery buttons in footer | Moved beside the error, following Atlas Verify. |
| Advanced settings | Kept collapsed and absent while provisioning. |

The existing Local router and provisioning service are unchanged. All four prototypes
use the same `useQuickStartMachine` and real tRPC operations; this branch changes only
presentation and experiment entry points.