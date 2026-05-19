# Local Quick Start — UX Design Reference

> **What this is:** A user-facing design specification for the proposed
> _Local Quick Start_ feature — "install and try DocumentDB locally from
> inside VS Code". ASCII flows show what the user sees at every step.
>
> **Audience:** Maintainers, reviewers, QA, technical writers. Not an
> implementation plan.
>
> **Scope:** End-to-end user experience and lifecycle. Implementation details
> (process orchestration, Docker SDK calls, container labels, retries) are
> intentionally omitted.
>
> **Related docs:**
>
> - User manual entry that will replace the current
>   `docs/user-manual/local-connection-documentdb-local.md` page once shipped.
> - `docs/user-manual/local-connection.md` — manual connection wizard that
>   continues to exist side-by-side.

---

## 0. UX references from adjacent database extensions

### 0.1 Azure Cosmos DB emulator flow

The closest in-repo-adjacent reference is the Azure Cosmos DB extension's
emulator flow. It is useful mostly as a baseline to improve on: it helps
users **attach** to an emulator, but it does not install, start, stop, or
clean up the emulator for them.

```
Azure Cosmos DB extension today

v Cosmos DB Accounts
  v Local Emulators
      o New Emulator Connection...
          |
          v
      Select emulator type
          |
          v
      Enter or confirm port
          |
          v
      Save attached emulator connection
          |
          v
      User can browse only if emulator was already installed and running
```

Observed UX patterns worth keeping:

| Pattern from vscode-cosmosdb                      | Keep / adapt for DocumentDB Local Quick Start                                                                |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Dedicated `Local Emulators` tree section          | Keep a dedicated `DocumentDB Local` section so local resources are visually separate from cloud connections. |
| "New Emulator Connection..." helper row           | Keep a simple helper row, but add a stronger `Quick Start` primary action before manual attach.              |
| Preconfigured vs custom connection choices        | Keep manual `New Local Connection...` for users who already run their own container.                         |
| Port is visible and configurable                  | Keep port visible in the review screen and tree description; never hide fallback ports.                      |
| Secrets stored outside tree IDs                   | Keep connection strings and generated passwords out of labels, IDs, telemetry, and logs.                     |
| Newly attached connection is revealed in the tree | After Quick Start succeeds, expand the `Quick Start` group and focus the managed instance row.               |
| Learn-more escape hatch                           | Keep a `Learn more...` entry, but it must not be the main path.                                              |

The UX gap this design closes:

```
Cosmos DB attach flow:
  "I already installed and started the emulator. Help me connect."

DocumentDB Local Quick Start:
  "I do not have anything installed. Give me a safe local DocumentDB I can use now."
```

Design implication: Quick Start owns the **local lifecycle** (download image,
create container, start, connect, stop, reset), while the existing manual
connection wizard remains the attach-only path.

### 0.2 PostgreSQL local Docker server flow

The PostgreSQL extension already lets users create a local Docker PostgreSQL
server from the extension. Its flow is closer to the DocumentDB Quick Start
goal than the Cosmos DB emulator flow:

```
PostgreSQL extension local Docker flow

Create local Docker PostgreSQL server
        |
        v
Home page: benefits of local Docker server
        |
        v
Prerequisite checks
  [ ] Docker installed
  [ ] Docker service running
        |
        v
Create form
  required: connection name, container name, user, password, database
  advanced: port, registry, image name, image version, platform
        |
        v
Run detached container
        |
        v
Wait for database readiness
        |
        v
Save connection, connect, reveal in Object Explorer
```

Observed UX patterns worth adapting:

| Pattern from vs-code-postgresql                                       | Keep / adapt for DocumentDB Local Quick Start                                                                  |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Starts with a benefit-oriented home page                              | Do not force this into the happy path, but use the welcome card / Review screen to state the value clearly.    |
| Runs prerequisite checks before asking for container details          | Keep Docker readiness checks before any image pull or container creation.                                      |
| Separates common fields from advanced image / port / platform fields  | Keep Quick Start simple and hide image tag, alias, credentials, port, and sample-data options behind Advanced. |
| Auto-generates or derives connection/container names                  | Use a stable default alias, and only expose naming when the user opens Advanced.                               |
| Validates duplicate connection and container names before launch      | Detect conflicts before pull/create so errors are explained before side effects.                               |
| Allocates a fallback host port when the requested port is unavailable | Keep the visible port-fallback banner and make the actual port persistent in the tree.                         |
| Connects and reveals the created connection after readiness succeeds  | Keep "success means opened/revealed usable connection," not merely "container exists."                         |

### 0.3 MSSQL local container deployment flow

The MSSQL extension has the most complete local-container UX reference. It
uses a wizard with distinct information, prerequisite, form, and provisioning
pages:

```
MSSQL extension local container wizard

Info page
  Instant setup / simple management / choose version / docs
        |
        v
Prerequisite page
  [ ] Check Docker installed
  [ ] Start Docker Desktop if needed
  [ ] Check Docker engine configuration
        |
        v
Form page
  version, password, save password, profile group
  advanced: container name, port, hostname
  required: EULA acceptance
        |
        v
Provisioning page
  [ ] Pull image
  [ ] Create/start container
  [ ] Wait for readiness from container logs
  [ ] Save connection and connect
        |
        v
Object Explorer shows a connected local container
```

Observed UX patterns worth adapting:

| Pattern from vscode-mssql                                           | Keep / adapt for DocumentDB Local Quick Start                                                                                                |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Uses visible step cards for prereqs and provisioning                | Keep the compact notification, but add "Show Details" with the same step-card model for long pulls or failures.                              |
| Offers to start Docker Desktop when Docker is installed but stopped | Offer an explicit `Start Docker Desktop` action where supported; never start it silently.                                                    |
| Checks Docker engine/platform details before pulling                | Add platform-specific readiness results for Linux permissions, Windows engine mode, Apple Silicon image support, and remote extension hosts. |
| Validates container name and port before provisioning               | Keep preflight validation and resolve defaults before side effects.                                                                          |
| Shows full error text behind an expandable link                     | In failure UI, show a friendly summary first and full Docker output only on demand.                                                          |
| Uses log/readiness monitoring before connecting                     | UX should say "Waiting for DocumentDB to accept connections," not merely "container started."                                                |
| Adds lifecycle commands for start, stop, restart/delete             | Keep tree-row lifecycle actions after the managed connection exists.                                                                         |

### 0.4 Design updates after comparing all three references

The final direction is a hybrid:

```
Cosmos DB teaches: keep local resources visually separate and preserve manual attach.
PostgreSQL teaches: create, connect, and reveal can be one managed flow.
MSSQL teaches: long Docker work needs visible steps, retry, and full-error details.

DocumentDB Quick Start should therefore be:
  attach-compatible like Cosmos DB,
  creation-capable like PostgreSQL,
  and step-transparent like MSSQL.
```

---

## 1. What the user can do

Local Quick Start gives a developer who has never used DocumentDB a working
local instance and an open Collection View from one entry point, one
one-screen review, and one progress flow — without leaving VS Code and
without touching a terminal.

Key capabilities:

- **Install, run, and connect** to an official DocumentDB local container by
  clicking _Quick Start_ in the Connections view.
- **Review before action.** A single one-screen interstitial summarizes what
  the extension is about to do to the user's machine (image, port, data
  persistence, security, lifetime) before anything is downloaded or started.
- **Manage** the resulting instance directly from the tree — start, stop,
  restart, view logs, copy connection string, copy password, update the
  image, delete the container, or reset everything.
- **Recover** from common breakage: existing container with the same name,
  port already in use, Docker not installed or not running, missing
  credentials, multi-window conflicts.
- **Coexist** with the existing _New Local Connection..._ wizard. Users who
  prefer to run Docker themselves can still attach a manual local
  connection; both paths show up in the same `DocumentDB Local` section
  with clear "managed" vs "manual" badges.

Prerequisite promise:

- Quick Start installs and starts the **DocumentDB local container image**.
- Quick Start does **not** install Docker.
- If Docker is installed but stopped, Quick Start may offer an explicit
  `Start Docker Desktop` / `Start Docker` action on platforms where that can
  be done without privilege escalation. It never starts Docker silently.
- If Docker is missing or stopped, the user gets a readiness screen with
  next actions instead of a failed mystery operation.

Local Quick Start is **opt-in**. The extension never installs, starts, or
modifies a container without an explicit user gesture.

---

## 2. Entry-point map

```
+------------------ DocumentDB activity bar ------------------+
|                                                             |
|  Connections view                                           |
|         |                                                   |
|         v                                                   |
|   v DocumentDB Local                                        |
|     |                                                       |
|     +-- (empty section)                                     |
|     |     | "Try DocumentDB locally" welcome card           |
|     |     |   [Quick Start] [New Local Connection...]       |
|     |     |   [Don't show again]                            |
|     |     v                                                 |
|     |   Empty-state child rows:                             |
|     |     o Quick Start - Install & try DocumentDB locally  |
|     |     o New Local Connection...                         |
|     |     o Learn more...                                   |
|     |                                                       |
|     +-- (populated section)                                 |
|           Inline icon on "DocumentDB Local" header:         |
|             [rocket]  Quick Start - Install local instance  |
|           Right-click menu on header:                       |
|             - Quick Start - Install & try DocumentDB ...    |
|             - New Local Connection...                       |
|             - Learn more...                                 |
|                                                             |
|  Command Palette:                                           |
|    > DocumentDB: Quick Start - Install Local DocumentDB     |
|                                                             |
|  Walkthrough / Welcome (first activation only):             |
|    Card "Try DocumentDB locally"                            |
|      [Quick Start]  [Open docs]  [Skip]                     |
|                                                             |
+-------------------------------------------------------------+
```

All four entry points open the **same Review & Start interstitial** described
in section 4. They differ only in where the user enters from.

The welcome card and the empty-state copy share a single dismissal flag —
dismissing in one place dismisses both. Re-installing the extension does
**not** revive the dismissed state.

---

## 3. Tree shape (before and after)

### 3.1 Before Quick Start exists (today)

```
v Connections
  v DocumentDB Local
      > New Local Connection...
```

### 3.2 After Quick Start exists, before user ever ran it

```
v Connections
  v DocumentDB Local                              [rocket]  [+]
    +-- (empty area)
        o Quick Start - Install & try DocumentDB locally
        o New Local Connection...
        o Learn more...
```

Inline icons on the `DocumentDB Local` header row, left to right:

| Icon       | Action                  | Surfaces                  |
| ---------- | ----------------------- | ------------------------- |
| `[rocket]` | Quick Start             | inline + right-click menu |
| `[+]`      | New Local Connection... | inline + right-click menu |

### 3.3 After a successful Quick Start

```
v Connections
  v DocumentDB Local                              [rocket]  [+]
    v Quick Start                                 [group header]
      v vscode-documentdb-local                   Running . localhost:10260
        | description: Quick Start . official local image . v1.2.3
        | inline:      [open]  [stop]  [...]
        v admin
          > _vscode_quickstart_seed (optional)
    v Manual connections                          [group header]
      > my-laptop                                 Manual . localhost:27017
      > local-dev                                 Manual . same target as Quick Start
      > New Local Connection...                   [+]
```

Per-row glossary:

| Node                      | Label                                | Description suffix                              | Icon                                   |
| ------------------------- | ------------------------------------ | ----------------------------------------------- | -------------------------------------- |
| Section header            | `DocumentDB Local`                   | n/a                                             | DocumentDB icon                        |
| Group: Quick Start        | `Quick Start`                        | n/a                                             | `rocket`                               |
| Group: Manual connections | `Manual connections`                 | n/a                                             | `plug`                                 |
| Managed instance          | `vscode-documentdb-local` (or alias) | `<state> . <host>:<port> [. update available]`  | colored disk state icon (see sec. 8.1) |
| Manual connection         | user name                            | `Manual . <host>:<port> [. same target as ...]` | existing connection icon               |
| New Local Connection...   | `New Local Connection...`            | n/a                                             | `plus`                                 |

The two groups (`Quick Start`, `Manual connections`) appear only when there
is at least one child of either kind. With no children of either kind, the
section falls back to the **empty-state child rows** in section 3.2.

If the user runs Quick Start more than once with different aliases (advanced
flow), every managed instance is listed under the `Quick Start` group.

### 3.4 Duplicate-target indicator

When a manual connection points at the same `host:port` as a managed Quick
Start instance, the manual row gets a soft description suffix:

```
> local-dev          Manual . same target as Quick Start
```

The Quick Start row does **not** get a reverse marker — Quick Start is the
authoritative actor for that endpoint.

---

## 4. First-time happy path

The first time a user clicks Quick Start, they see **one confirmation
screen** and then **one compact progress surface**. There is no required
multi-page wizard in the happy path, but the user can open detailed step
cards when the pull is slow or something fails.

```
[Quick Start clicked anywhere]
              |
              v
+--------------------- Review & Start ---------------------+
|                                                          |
|  Start DocumentDB Local?                                 |
|                                                          |
|  Docker          Required; start offered if stopped      |
|  Runs on         This machine                            |
|  Image           ghcr.io/documentdb/...:latest           |
|                  version shown after pull                |
|  Port            10260                                   |
|                  same default as New Local Connection    |
|  Data            Persistent local volume                 |
|                  (kept until you choose "Reset")         |
|  Security        TLS with self-signed local certificate  |
|  Credentials     Auto-generated and stored securely      |
|  Lifetime        Keeps running after VS Code closes      |
|  Sample data     Optional after start                    |
|                                                          |
|        [Start DocumentDB Local]   [Advanced]   [Cancel]  |
+----------------------------------------------------------+
              |
              v
+----------- Background progress notification -------------+
|                                                          |
|  Starting DocumentDB Local...                            |
|                                                          |
|   [x] Checking Docker                                    |
|   [x] Reserving port 10260                               |
|   [>] Pulling official image                       42%   |
|   [ ] Creating container                                 |
|   [ ] Starting container                                 |
|   [ ] Waiting for the database to accept connections     |
|                                                          |
|          [Show Details]                       [Cancel]   |
+----------------------------------------------------------+
              |
              v
+------------------ Success notification ------------------+
|                                                          |
|  DocumentDB Local is running on localhost:10260.         |
|                                                          |
|   [Open Connection]  [Load Sample Data]                  |
|   [Copy Connection String]  [Logs]                       |
|                                                          |
+----------------------------------------------------------+
              |
              v
     Tree refreshes, Quick Start group is expanded,
     focus lands on the new managed instance row.
```

If the user clicks `[Open Connection]`, the standard Collection View opens.
If the database is empty, the Collection View shows a first-run callout:

```
+-------------------- Empty local database --------------------+
|                                                             |
|  DocumentDB Local is ready.                                 |
|                                                             |
|  Create your first database, or load sample documents to    |
|  try queries immediately.                                   |
|                                                             |
|       [Load Sample Data]   [Create Database]   [Learn More] |
|                                                             |
+-------------------------------------------------------------+
```

The "first delightful query" (sample data) is **not** auto-loaded in v1,
but it is one action away from the success card and empty Collection View.

If the user clicks `[Cancel]` from the progress notification, the extension
rolls back: the container is removed and the port reservation is released.
Generated credentials are kept in storage so a retry can reuse them or
discard them at the user's choice.

### 4.1 The Advanced panel

`[Advanced]` opens a single inline expansion on the Review screen — not a
new dialog — so the user never loses the original review context.

```
+--------------------- Review & Start ---------------------+
|                                                          |
|  ... summary unchanged ...                               |
|                                                          |
|  v Advanced                                              |
|     Container name      [vscode-documentdb-local      ]  |
|     Port                [10260                        ]  |
|     Data volume         Persistent local volume          |
|     Credentials         (*) Generate strong password     |
|                         ( ) Use these:                   |
|                             user [admin     ]            |
|                             pass [..........] [show]     |
|     Image tag           [latest                       ]  |
|     Seed sample data    [ ] Load sample documents on     |
|                             first start                  |
|                                                          |
|        [Start DocumentDB Local]   [Advanced ^]  [Cancel] |
+----------------------------------------------------------+
```

The Advanced panel is sticky per workspace — if the user opens it once, the
next Review screen opens with it expanded.

Ephemeral data volumes are out of scope for v1. The only v1 data mode is a
persistent local volume that survives Stop, Restart, Update Image, Move Port,
and Delete Container, and is removed only by Reset.

### 4.2 Remote-session review banner

When VS Code is connected to SSH, WSL, a dev container, or another remote
extension host, "local" means local to that remote context. The Review screen
adds a banner before the user starts:

```
! This will run DocumentDB Local on: ssh://devbox-01
  It will not run on your laptop unless Docker is available in this remote
  environment.

      [Start on devbox-01]   [Cancel]
```

The tree row continues to show the reachable endpoint from the extension's
point of view, but the tooltip includes the remote context.

---

## 5. Subsequent starts (true one-click after setup)

Once a managed instance exists (even if currently stopped), the entry
points change behavior:

- `[Quick Start]` rocket icon on the section header turns into a **direct
  start** of the existing instance, no Review screen.
- Right-click on the managed row offers `Start`.
- Command palette gains `DocumentDB: Start Local DocumentDB` and
  `DocumentDB: Stop Local DocumentDB`.

```
Managed instance is "Stopped"
   |
   click rocket / Start
   |
   v
+--- Background progress (compact, status-bar) ---+
|  Starting DocumentDB Local...   [Cancel]        |
+--------------------------------------------------+
   |
   v
  Tree row flips to "Running . localhost:10260".
  No notification toast on routine start/stop.
```

The Review screen is **never re-shown** during routine start/stop. It only
re-appears when:

1. The user explicitly creates a **new** managed instance via Command
   Palette `DocumentDB: Quick Start - Install Local DocumentDB`.
2. The existing managed instance no longer exists at the Docker level (it
   was removed outside the extension) and the user clicks any Start
   action — the Review screen returns in "recreate" mode (see section 9.5).

---

## 6. Lifecycle states and the action matrix

### 6.1 Six states

Each managed instance occupies exactly one of these states. The state is
shown by an icon color and an inline status word in the description.

```
   +---------------+              +---------------+              +---------------+
   |  NotInstalled |   click QS   |  Provisioning |   success    |    Running    |
   |   (no row)    | -----------> |  (spinner)    | -----------> |   (green dot) |
   +---------------+              +---------------+              +---------------+
                                       |                              |    ^
                                       | failure                      |    |
                                       v                              v    |
                                  +---------------+              +---------------+
                                  |    Error      | <- error --- |   Stopping    |
                                  | (red dot)     |              | (yellow dot)  |
                                  +---------------+              +---------------+
                                       ^                              |
                                       |                              v
                                  +---------------+              +---------------+
                                  |   Starting    | <-- start -- |    Stopped    |
                                  | (yellow dot)  |              |  (gray dot)   |
                                  +---------------+              +---------------+
```

A seventh "soft" badge — `UpdateAvailable` — overlays Running / Stopped
without changing the state itself.

### 6.2 Action matrix

`v` = action exposed for that state. Inline columns are always shown in
the same position so icons never shift under the cursor (see review finding
R10).

| Action                  | NotInstalled | Provisioning | Running | Stopping | Stopped | Starting | Error | Where it shows       |
| ----------------------- | :----------: | :----------: | :-----: | :------: | :-----: | :------: | :---: | -------------------- |
| Quick Start             |      v       |              |         |          |         |          |       | rocket inline + menu |
| Open Connection         |              |              |    v    |          |         |          |       | inline `[open]`      |
| Start                   |              |              |         |          |    v    |          |   v   | inline `[start]`     |
| Stop                    |              |              |    v    |          |         |          |       | inline `[stop]`      |
| Cancel                  |              |      v       |         |    v     |         |    v     |       | inline `[cancel]`    |
| Restart                 |              |              |    v    |          |         |          |   v   | overflow `[...]`     |
| View Logs               |              |      v       |    v    |    v     |    v    |    v     |   v   | overflow `[...]`     |
| Copy Connection String  |              |              |    v    |          |    v    |          |       | overflow `[...]`     |
| Copy Password           |              |              |    v    |          |    v    |          |       | overflow `[...]`     |
| Reveal in Docker        |              |      v       |    v    |    v     |    v    |    v     |   v   | overflow `[...]`     |
| Check for Image Update  |              |              |    v    |          |    v    |          |   v   | overflow `[...]`     |
| Rename Alias...         |              |              |    v    |          |    v    |          |   v   | overflow `[...]`     |
| Delete Container...     |              |              |         |          |    v    |          |   v   | overflow `[...]`     |
| Reset DocumentDB Local… |              |              |    v    |          |    v    |          |   v   | overflow `[...]`     |

Inline icons reserve fixed positions so the layout is stable across state
transitions:

```
Position 1: primary action      ([open] when Running, blank otherwise)
Position 2: power action        ([start] or [stop] or [cancel])
Position 3: overflow            ([...])
```

`Delete Container` is intentionally **not** offered while the instance is
running — the user must `Stop` first. This avoids an accidental delete on a
hover misclick.

---

## 7. Detailed screens

### 7.1 Docker readiness diagnosis (shown only if a check fails)

```
+------------------ Docker readiness ----------------------+
|                                                          |
|  Local Quick Start needs Docker to run DocumentDB on     |
|  your machine.                                           |
|                                                          |
|   [x] Docker CLI found              v1.27.0              |
|   [!] Docker daemon reachable       stopped              |
|   [!] Image registry not reached    (proxy or offline?)  |
|   [?] Image architecture            unknown until pull   |
|                                                          |
|  How to fix                                              |
|   - Start Docker Desktop and sign in                     |
|   - Check your corporate proxy settings                  |
|   - Test reachability:  ghcr.io                          |
|                                                          |
|        [Start Docker Desktop]  [Troubleshooting] [Retry] |
|                                                          |
+----------------------------------------------------------+
```

The diagnosis screen replaces the Review & Start screen when any _blocking_
check fails. Non-blocking warnings (e.g., insufficient free disk) appear as
a yellow banner **inside** the Review screen instead, and the user can
proceed.

Categorized failure messages cover, at minimum:

| Symptom                                 | Action surfaced                                                           |
| --------------------------------------- | ------------------------------------------------------------------------- |
| Docker CLI not on PATH                  | "Install Docker" link, "Already installed? Open settings" link            |
| Daemon socket not reachable             | "Start Docker Desktop" where supported; otherwise platform-specific setup |
| Linux user not in `docker` group        | "Open setup guide for Linux"                                              |
| Windows engine is Windows containers    | "Switch to Linux containers?" confirmation, or setup guide                |
| Windows Home / WSL2 missing             | "Open WSL2 setup guide"                                                   |
| Apple Silicon, but image lacks arm64    | "Use x86_64 emulation? (slower)" choice                                   |
| Authenticated proxy blocks registry     | "Configure registry credentials" link                                     |
| Docker Desktop resource limits too low  | "Open Docker resources" link                                              |
| Remote VS Code session, no local daemon | Explanation + "Use SSH-host Docker" link                                  |

### 7.2 Progress notification

Always rendered as a single VS Code progress notification (not a modal) so
the user can keep working. Cancel is always available and rolls back.

```
+--------- Starting DocumentDB Local ---------+
|                                             |
|   [x] Checking Docker                       |
|   [x] Reserving port 10260                  |
|   [>] Pulling official image          42%   |
|   [ ] Creating container                    |
|   [ ] Starting container                    |
|   [ ] Waiting for connection                |
|                                             |
|   Elapsed 00:18     [Show Details] [Cancel] |
+---------------------------------------------+
```

`[Show Details]` opens a lightweight details panel with the same step list,
friendly error summaries, and expandable full Docker output:

```
+---------------- Quick Start details ----------------+
|                                                      |
|  Setting up vscode-documentdb-local                  |
|                                                      |
|   [x] Checking Docker                                |
|   [x] Reserving port 10260                           |
|   [>] Pulling official image                         |
|       This might take a few minutes.                 |
|   [ ] Creating container                             |
|   [ ] Starting container                             |
|   [ ] Waiting for DocumentDB to accept connections   |
|                                                      |
|       [View logs]                         [Cancel]   |
+------------------------------------------------------+
```

On failure, the current step expands automatically:

```
+---------------- Quick Start details ----------------+
|                                                      |
|  Pulling official image                 Failed       |
|                                                      |
|  We couldn't pull the image from ghcr.io.            |
|  Check your network connection or proxy settings.    |
|                                                      |
|      [Show full Docker output]                       |
|      [Retry]  [Troubleshooting]  [Cancel]            |
+------------------------------------------------------+
```

Cancel rules:

- Cancel during pull -> abort pull, no container created.
- Cancel after pull but before container start -> no container created.
- Cancel during start -> container is created, then stopped and removed,
  port released. Generated credentials are kept in storage; the user is
  told they will be reused on retry or can be discarded.
- Cancel during "Waiting for connection" -> same as above, plus surface
  the most recent connection error in the failure toast.

### 7.3 Success card

```
+---- DocumentDB Local is running on localhost:10260 -----+
|                                                          |
|   [Open Connection]  [Copy Connection String]            |
|                                                          |
|   [Logs]  [Load Sample Data]  [Don't show again]         |
|                                                          |
+----------------------------------------------------------+
```

`[Load Sample Data]` is offered only when the Advanced panel had
_Load sample data on first start_ unchecked. If the user opted in, the
seed is already loaded and this button is hidden.

`[Don't show again]` mutes the success card for routine starts (it
already isn't shown for non-first starts; this is for users who installed
multiple managed instances).

### 7.4 Visible port fallback

When port 10260 is busy and the extension picks a fallback, the user sees
it explicitly in two places:

1. A yellow banner in the Review screen:

   ```
   ! Port 10260 is in use. We'll use port 10261 instead.
     [Change port...]  [Use 10261]
   ```

2. A persistent description on the tree row:

   ```
   v vscode-documentdb-local       Running . localhost:10261
       description: 10260 was already in use
   ```

The connection string everywhere always reflects the **actual** port.

---

## 8. Managed-instance presentation

### 8.1 Status icons and colors

| State        | Icon glyph       | Color  | Tree row example                              |
| ------------ | ---------------- | ------ | --------------------------------------------- |
| NotInstalled | n/a              | n/a    | (no row, empty state instead)                 |
| Provisioning | `loading~spin`   | yellow | `Provisioning... . localhost:10260`           |
| Starting     | `loading~spin`   | yellow | `Starting... . localhost:10260`               |
| Running      | `circle-filled`  | green  | `Running . localhost:10260`                   |
| Stopping     | `loading~spin`   | yellow | `Stopping... . localhost:10260`               |
| Stopped      | `circle-outline` | gray   | `Stopped . localhost:10260`                   |
| Error        | `warning`        | red    | `Error . click for details . localhost:10260` |

A small `UpdateAvailable` badge on Running / Stopped:

```
v vscode-documentdb-local       Running . localhost:10260 . update available
```

### 8.2 Description format

```
<state> . localhost:<port> [. <secondary note>]
```

`<secondary note>` is reserved for the most important contextual fact:

- `update available`
- `10260 was already in use`
- `same target as a manual connection`
- `stopped from another VS Code window` (transient, see section 9)

Only one secondary note at a time. Tooltip lists all applicable notes.

Tooltip example for the managed row:

```
vscode-documentdb-local

State: Running
Endpoint: localhost:10260
Image: ghcr.io/documentdb/...:latest
Resolved version: v1.2.3
Resolved image: sha256:12ab...90ef
Data volume: vscode-documentdb-local-data
Runs on: This machine
```

The tree row keeps the UI simple; the tooltip carries the detailed image
version/digest so users are not forced to reason about what `latest` meant
at the time of install.

---

## 9. Conflict resolution

### 9.1 An existing container with the same name

When the user clicks Quick Start but a Docker container already exists
under the planned name (`vscode-documentdb-local`), the extension first
decides whether it is a recognized DocumentDB Local Quick Start resource.
Only recognized containers can be adopted as managed Quick Start instances.

Recognized container:

```
+----- Existing container 'vscode-documentdb-local' found -----+
|                                                              |
|  We found a recognized DocumentDB Local container.           |
|                                                              |
|  Container name      vscode-documentdb-local                 |
|  Image               ghcr.io/documentdb/...:latest           |
|  Recognized as       DocumentDB Local Quick Start            |
|  Port binding        0.0.0.0:10260 -> 10260                  |
|  Status              Exited 12 days ago                      |
|  Volume              vscode-documentdb-local-data            |
|                                                              |
|  What would you like to do?                                  |
|                                                              |
|   ( ) Adopt as managed Quick Start instance                  |
|       Existing data and credentials are kept where possible. |
|   ( ) Reset and recreate                                     |
|       Removes the container and its data volume.             |
|   ( ) Cancel                                                 |
|                                                              |
|         [Continue]                              [Cancel]     |
+--------------------------------------------------------------+
```

Unrecognized container:

```
+---- Container name 'vscode-documentdb-local' is already used ----+
|                                                                  |
|  A container already uses the Quick Start name, but we cannot    |
|  verify that it is a DocumentDB Local Quick Start container.     |
|                                                                  |
|  Container name      vscode-documentdb-local                     |
|  Image               unknown-or-custom-image                     |
|  Status              Running                                    |
|                                                                  |
|  To avoid taking over the wrong container, Quick Start will not  |
|  adopt it automatically.                                         |
|                                                                  |
|   ( ) Create a manual local connection to this endpoint          |
|   ( ) Reset and recreate as DocumentDB Local                     |
|       Removes this container and its data volume.                |
|   ( ) Cancel                                                     |
|                                                                  |
|         [Continue]                                  [Cancel]     |
+------------------------------------------------------------------+
```

Adopt path resolves credentials in this order:

1. Local SecretStorage entry from a previous Quick Start.
2. If missing, the user is offered:
   ```
   We can't find the saved credentials for this container.
     ( ) Reset credentials and recreate the container
     ( ) Delete the container and start fresh
     ( ) Cancel
   ```
   "Adopt without credentials" is intentionally not offered because the
   resulting row could not actually open a connection.

### 9.2 Same-target manual connection already exists

When the new managed instance points at the same `host:port` as an existing
manual connection, the Review screen shows a soft warning, not a block:

```
i  You already have a manual connection to localhost:10260.
   After Quick Start finishes, both will appear in the tree.
   The Quick Start instance owns lifecycle actions.
```

Tree presentation rule from section 3.4 then applies.

### 9.3 Multi-window coordination

The container is **shared machine state**. The extension never assumes a
window "owns" it.

UX rules:

- All windows reflect state changes within a few seconds (polling +
  Docker event subscription).
- Every destructive action (Stop, Delete, Reset) re-checks the live state
  immediately before executing. If the state changed under the user, the
  confirmation dialog is replaced:
  ```
  ! The instance is now Stopping (from another VS Code window).
    The action is no longer available.
       [OK]
  ```
- A transient secondary note appears for ~10 seconds when an action was
  initiated by a different window:
  ```
  vscode-documentdb-local   Running . stopped from another VS Code window
  ```

### 9.4 Image is outdated

Discovery is **passive**: the extension does not check for image updates on
activation, and does not show a toast. The check runs when:

- The user opens the overflow menu on the managed row (lazy).
- The user clicks `Check for Image Update` explicitly.
- The user restarts the instance after at least 7 days.

If an update is found, the `update available` badge appears (section 8.1)
and the overflow menu offers:

```
Overflow menu
  Update Image...        opens a Review-style dialog with diff
  View Current Version
  Ignore This Version
```

The Update dialog is the only place the user is asked to confirm an image
change. It restates the data implications:

```
Update DocumentDB Local Image?

  Current image     ghcr.io/documentdb/...:latest
  Current version   v1.2.3  sha256:12ab...90ef
  New image         ghcr.io/documentdb/...:latest
  New version       v1.3.0  sha256:45cd...67ab
  Container         will be recreated
  Data volume       will be kept
  Credentials       will be kept

        [Update]                                        [Cancel]
```

### 9.5 Container disappeared outside the extension

If the user removed the container in a terminal, the tree row enters the
`NotInstalled` state and changes label to:

```
v vscode-documentdb-local       Missing . click to recreate
```

Click triggers the Review screen in **recreate** mode (pre-filled with the
last known port, alias, persistence choice).

### 9.6 Port already in use after a Quick Start once worked

The same rules as section 7.4 apply. Additionally, the overflow menu gains
a one-shot `Move to a different port...` action that:

```
+-------- Move DocumentDB Local to a different port --------+
|                                                           |
|  Current port    10260                                    |
|  New port        [10261                                ]  |
|                                                           |
|  The container will be recreated. Data is kept.           |
|  The saved connection string will be updated.             |
|                                                           |
|        [Move]                                  [Cancel]   |
+-----------------------------------------------------------+
```

---

## 10. Error and edge cases

| Category                                             | What the user sees                                                                                                            |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Docker not installed                                 | Docker readiness screen (sec. 7.1)                                                                                            |
| Docker not running                                   | Docker readiness screen with "Open Docker Desktop"                                                                            |
| Permission denied (Linux group)                      | Docker readiness screen with platform-specific guidance                                                                       |
| Apple Silicon, no arm64 image                        | Readiness warning + opt-in to amd64 emulation                                                                                 |
| Disk space below 2 GB                                | Yellow banner in Review screen, not a block                                                                                   |
| Network offline / proxy blocked                      | Readiness "Image registry not reached" + retry                                                                                |
| Pull aborted mid-way                                 | Failure toast: "Pull failed. [Retry] [View logs]"                                                                             |
| Container fails to start                             | Failure toast: "Container failed to start. [Logs] [Reset]"                                                                    |
| Health check timeout (default 60s)                   | Failure toast: "Database didn't accept connections in time. [Wait longer] [Logs] [Reset]"                                     |
| SecretStorage cleared                                | Adopt flow with credential-reset path (sec. 9.1)                                                                              |
| Quick Start invoked on an unsupported OS             | Toast: "Local Quick Start is supported on Windows, macOS, and Linux." (Same gate as the manual emulator wizard already uses.) |
| User clicks Open Connection while still Provisioning | Action is hidden until Running                                                                                                |
| Remote VS Code (SSH / WSL / dev container)           | Readiness explains where the container will live and asks the user to confirm                                                 |

All errors render in the same shape: a single VS Code toast with at most
three actions, and never block the editor.

---

## 11. Lifecycle vocabulary (definitions the UI strictly follows)

Wording mistakes here cause data loss. The UI uses these exact verbs and
never mixes them.

| Verb                            | Effect on container | Effect on data volume | Effect on credentials | Effect on tree row                   |
| ------------------------------- | ------------------- | --------------------- | --------------------- | ------------------------------------ |
| **Start**                       | starts existing     | unchanged             | unchanged             | -> Running                           |
| **Stop**                        | stops               | unchanged             | unchanged             | -> Stopped                           |
| **Restart**                     | stop + start        | unchanged             | unchanged             | -> Running                           |
| **Update Image...**             | recreate            | kept                  | kept                  | -> Running                           |
| **Move to a different port...** | recreate            | kept                  | kept                  | -> Running                           |
| **Delete Container...**         | removes container   | kept                  | kept                  | -> Missing (re-create available)     |
| **Reset DocumentDB Local...**   | removes container   | **dropped**           | dropped               | -> NotInstalled (row removed)        |
| **Forget Quick Start**          | unchanged           | unchanged             | dropped               | row converted to a manual connection |

Confirmation phrasing:

- _Stop_ — no confirmation. Reversible.
- _Restart_ — no confirmation. Reversible.
- _Delete Container_ — one-line confirm: "Delete the container? Your data
  is kept and will be re-attached if you Quick Start again."
- _Reset DocumentDB Local_ — two-step confirm. User must type the
  container alias to confirm. Names the volume that will be deleted and
  warns "Data cannot be recovered."
- _Forget Quick Start_ — one-line confirm: "Stop managing this container
  from the extension? The container keeps running. You can re-attach it
  with Quick Start later."

---

## 12. Telemetry hints (informational; no PII)

Per the existing telemetry conventions of the extension. Listed here for
UX completeness so reviewers can see what we plan to measure.

```
event: quickstart.review_shown        prop: source=tree|menu|command|welcome
event: quickstart.review_advanced     prop: opened_first_time=bool
event: quickstart.docker_readiness    prop: result=ok|cli_missing|...|unknown,
                                            os=win|mac-x64|mac-arm|linux|...
event: quickstart.start_begin         prop: source=...
event: quickstart.start_stage         prop: stage=pull|create|start|connect,
                                            duration_ms, success=bool
event: quickstart.start_end           prop: result=success|cancelled|failed,
                                            elapsed_ms,
                                            port_fallback=bool,
                                            recreate=bool, adopted=bool
event: quickstart.lifecycle           prop: action=start|stop|restart|delete|reset|move|update,
                                            initiated_by=user|other_window,
                                            duration_ms, success=bool
event: quickstart.error               prop: stage=..., reason=...
event: quickstart.dismiss_welcome     prop: from=welcome_view|empty_state
```

Container name, image tag, hostnames, and ports are never sent. Whether
the user opted into sample data IS sent.

---

## 13. Cross-cutting rules

- **Opt-in only.** The extension never installs Docker, never starts Docker
  silently, and never modifies a container that wasn't created by Quick Start
  unless the user explicitly chooses Adopt.
- **Explicit Docker start.** If Docker is installed but stopped, the extension
  can offer `Start Docker Desktop` / `Start Docker` as a user-clicked action
  where supported. It does not invoke `sudo` or perform privileged daemon
  setup.
- **No background pulls.** Image is pulled only inside a user-initiated
  Quick Start or Update Image flow.
- **Canonical local port.** Quick Start and the manual `New Local
Connection...` DocumentDB Local path use `10260` by default. If existing
  code still uses another default, that is a pre-ship bug, not a UX variant.
- **No nag toasts.** Updates and warnings stay in the tree row description
  unless the user opens the overflow menu.
- **Reversibility.** Stop, Restart, and Cancel are always safe.
- **Symmetry with the manual wizard.** Manual connections continue to work
  exactly as today. Nothing is removed.
- **Uninstalling the extension does not remove the container.** A separate
  "Clean Up Quick Start Resources..." command is offered for that, before
  uninstall, in the command palette and in the overflow menu.

---

## 14. Non-goals for v1

- Multiple concurrent managed instances per user. (Advanced flow allows it,
  but it's not surfaced in the empty-state copy or the welcome card.)
- Auto-loading sample data by default. The flag is in Advanced; the
  separate `Load Sample Data` command on the managed row remains the
  primary path.
- Ephemeral data volumes. Persistent local storage is the only v1 mode so
  Stop, Restart, Update, Move Port, and Delete Container have predictable
  data behavior.
- Resource usage charts (CPU, memory, disk) in the tree row.
- Authentication beyond username / password. No client certs in v1.
- Bring-your-own-image. The image tag is editable in Advanced, but only
  for the official image. Custom images are deferred.
- Managing non-managed containers as Quick Start. The Adopt path requires
  the container to be recognized as a previous DocumentDB Local Quick Start
  resource; a matching name alone is not enough.

---

## 15. Remaining open questions

1. **Persistent volume naming.** Default `vscode-documentdb-local-data` is
   easy to find in `docker volume ls`. Should the alias the user picks in
   Advanced be reflected in the volume name? Pro: discoverable. Con:
   renaming the instance breaks the link.
2. **Self-signed certificate trust.** Today both wizards either skip TLS
   verification (`tlsAllowInvalidCertificates=true`) or use a global
   `disableEmulatorSecurity` flag. Quick Start uses the same approach.
   Long term, the official image's local CA could be auto-trusted in the
   user's Node trust store, which would let the connection string drop
   the allow-invalid-certs flag. Out of scope for v1; worth tracking.
3. **Welcome card scope.** Should the welcome card appear only when the
   Connections view is empty _overall_, or whenever the DocumentDB Local
   section is empty? Current draft says the latter; some reviewers may
   prefer the former to avoid showing the card to users who already have
   many cloud connections.
4. **Linux + sudo Docker.** Linux machines without the user in the docker
   group need `sudo`. Quick Start does **not** invoke sudo. The Docker
   readiness diagnosis surfaces the fix instead. Confirm this matches the
   extension's existing posture on privilege escalation.

---

## 16. Out of scope (for this design doc)

- Choice of orchestration mechanism (Docker SDK vs. `docker` CLI).
- How healthchecks are implemented.
- Specific labels / image filters used to recognize a managed container.
- Telemetry property data types or sampling rules.
- Localization of strings (handled at implementation time via
  `vscode.l10n.t()`, per repo convention).
- Tests, build wiring, or settings keys.

These belong in a companion implementation plan that references this
document.

---

## 17. Design review: comments, findings, and suggestions

### 17.1 Review outcome

**Approve the UX direction for implementation planning.**

The design correctly moves beyond the Cosmos DB extension's attach-only
emulator pattern and aligns with the stronger local-container patterns in the
PostgreSQL and MSSQL extensions. The strongest parts are the explicit Review
& Start screen, visible Docker/readiness steps, the tree as the persistent
control surface, the separation between managed Quick Start and manual
connections, and the careful lifecycle vocabulary for Stop, Delete, Reset,
and Forget.

The initial review findings below have been folded back into this draft. The
remaining open questions are intentionally limited to follow-up product or
implementation decisions that should not block the core v1 workflow.

### 17.2 Findings

| ID  | Severity     | Original finding                                                                | Resolution in this draft                                                                                                                       |
| --- | ------------ | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Must fix     | "One click" could conflict with first-run review.                               | Product copy now uses **Quick Start**; true one-click is scoped to subsequent starts after setup.                                              |
| R2  | Must fix     | Manual DocumentDB Local and Quick Start could disagree on default port.         | `10260` is now a cross-cutting UX rule for both Quick Start and manual local connection; mismatch is called a pre-ship bug.                    |
| R3  | Must fix     | Users could think the extension installs Docker.                                | The Review screen and prerequisite promise say Docker is required and not installed by the extension; if Docker is stopped, start is explicit. |
| R4  | Must fix     | Ephemeral data mode was ambiguous.                                              | Ephemeral volumes are removed from v1; persistent local volume is the only data mode.                                                          |
| R5  | Should fix   | Empty database after success may not feel like "try DocumentDB."                | `Load Sample Data` is promoted on the success card and empty Collection View callout.                                                          |
| R6  | Should fix   | Existing-container adoption could take over the wrong container.                | Adopt is offered only for recognized DocumentDB Local Quick Start resources; name-only matches get manual connection/reset/cancel choices.     |
| R7  | Should fix   | Remote VS Code makes "local" ambiguous.                                         | Remote-session Review banner names the actual target context before start.                                                                     |
| R8  | Should fix   | `latest` makes image version hard to reason about.                              | Managed-row tooltip and update dialog show resolved version and image digest.                                                                  |
| R9  | Nice to have | Multi-window coordination may expand v1 implementation scope.                   | User-facing rule remains; implementation planning may phase event subscription after basic polling.                                            |
| R10 | Nice to have | Inline actions should not shift under the cursor.                               | Three fixed action slots are retained as UX contract: primary, power, overflow.                                                                |
| R11 | Nice to have | Welcome card could annoy users with cloud connections but no local ones.        | Empty `DocumentDB Local` section remains the default scope; dismissal is shared with empty-state card.                                         |
| R12 | Should fix   | PostgreSQL and MSSQL show that container setup benefits from step transparency. | The compact progress notification now has `Show Details` with step cards, retry, logs, and expandable full Docker output.                      |
| R13 | Should fix   | MSSQL reduces friction by starting Docker Desktop when possible.                | The design now allows an explicit user-clicked Docker start action where supported, while preserving the no-silent-start rule.                 |

### 17.3 UX principles to carry into implementation planning

1. **Be transparent before side effects.** Downloading an image, creating a
   container, binding a port, and persisting a volume are machine-level
   changes. The Review screen must stay mandatory on first run.
2. **Keep routine actions quiet.** After setup, Start and Stop should update
   the tree and status bar without celebratory toasts.
3. **Keep manual attach first-class.** Quick Start should not replace users
   who already run DocumentDB themselves.
4. **Use the tree as source of truth.** Status, port, update availability,
   and lifecycle actions should be discoverable from the managed instance row.
5. **Prefer reversible defaults.** Persistent data, explicit reset, and no
   automatic cleanup on extension uninstall are the safest defaults.
6. **Avoid terminal language in the happy path.** Docker details belong in
   Review, Advanced, logs, and troubleshooting, not in the main success flow.

### 17.4 Suggested v1 scope cut

For a focused and shippable first version, prioritize this path:

```
Empty DocumentDB Local section
        |
        v
Quick Start clicked
        |
        v
Review & Start
        |
        v
Docker readiness if needed
        |
        v
Pull/create/start/connect progress
        |
        v
Managed row appears as Running
        |
        v
Open Connection / Load Sample Data
```

Defer or phase advanced lifecycle polish if needed: multiple managed
instances, image update ignore rules, resource usage indicators, and
event-subscription-based multi-window updates. The v1 user promise should be
simple: **from empty machine-with-Docker to open local DocumentDB connection,
without leaving VS Code.**
