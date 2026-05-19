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

### 0.2 Primary reference: PostgreSQL local Docker server flow

The PostgreSQL extension already lets users create a local Docker PostgreSQL
server from the extension. Its flow is closer to the DocumentDB Quick Start
goal than the Cosmos DB emulator flow because it owns creation, readiness,
connection save, and reveal:

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

| Pattern from vs-code-postgresql                                           | Keep / adapt for DocumentDB Local Quick Start                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Creates the container and connection in one guided flow                   | Quick Start owns create -> wait -> connect -> reveal, so the user never needs to run Docker commands or paste a connection string.                                                                                                                                                                             |
| Starts with value, not Docker mechanics                                   | Welcome / Review copy should say "try DocumentDB locally now"; Docker details stay secondary.                                                                                                                                                                                                                  |
| Keeps common fields separate from advanced image / port / platform fields | The default DocumentDB path should require **zero form fields**; alias, port, image tag, credentials, platform, and sample data live under Advanced.                                                                                                                                                           |
| Defaults most fields before the user acts                                 | Pre-fill alias, port, username, password, image, volume, security mode, and connection name.                                                                                                                                                                                                                   |
| Validates duplicate connection and container names before launch          | Detect conflicts before pull/create so errors are explained before side effects.                                                                                                                                                                                                                               |
| Allocates a free random port when the user did **not** supply a port      | DocumentDB Quick Start goes further: when the default port is busy, also pick a free random port from a small band and show the visible port-fallback banner. (PostgreSQL only allocates a random port when the input is empty/invalid — it does not auto-fall-back from a valid-but-busy port. See sec. 7.4.) |
| Waits for database readiness before connecting                            | Do not declare success at "container started"; success means DocumentDB accepts connections. PostgreSQL uses `pg_isready` inside the container; DocumentDB has no equivalent baked-in CLI we can rely on, so readiness is defined over the wire protocol (see sec. 4 and sec. 7.2).                            |
| Saves the connection and reveals it after readiness succeeds              | Keep "success means opened/revealed usable connection," not merely "container exists."                                                                                                                                                                                                                         |

What **not** to copy literally from PostgreSQL:

```
PostgreSQL has: Home page -> Prereq page -> Create form -> Create

DocumentDB Quick Start should compress this to:
  Quick Start click -> Review & Start -> Progress -> Open connection

No required home page.
No required prerequisite page when Docker is ready.
No required form fields in the default path.
No separate "create connection" step after the container starts.
```

### 0.3 Secondary reference: MSSQL local container deployment flow

The MSSQL extension reinforces a few useful failure and progress patterns, but
its multi-page wizard should **not** become the default DocumentDB Quick Start
shape.

```
Use from MSSQL:
  - explicit Docker start action if Docker is installed but stopped
  - visible provisioning steps for long-running work
  - retry at the failed step
  - expandable full Docker output

Do not copy from MSSQL:
  - mandatory info page
  - mandatory multi-page wizard
  - required version/password/profile form before the user can start
```

### 0.4 Design updates after comparing all three references

The final direction is PostgreSQL-inspired, but simpler:

```
Cosmos DB teaches: keep local resources visually separate and preserve manual attach.
PostgreSQL teaches: create, connect, and reveal can be one easy managed flow.
MSSQL teaches: long Docker work needs optional details, retry, and full-error text.

DocumentDB Quick Start should therefore be:
  attach-compatible like Cosmos DB,
  creation-capable like PostgreSQL,
  but with fewer required screens than both PostgreSQL and MSSQL.
```

> **Scope note.** This design is a **strict superset** of the PostgreSQL Docker
> creation slice. PostgreSQL only implements create -> wait -> save -> connect ->
> reveal; everything else in this doc (the seven-state lifecycle in sec. 6, the
> categorized Docker readiness diagnosis in sec. 7.1, adopt-existing-container in
> sec. 9.1, multi-window coordination in sec. 9.3, Update Image / Move Port /
> Reset / Forget verbs in sec. 11) is genuinely new work that has no equivalent
> in the PostgreSQL extension. The v1 scope cut in sec. 17.4 makes the v1.0 /
> v1.1 split explicit.

---

## 1. What the user can do

Local Quick Start gives a developer who has never used DocumentDB a working
local instance and an open Collection View from one entry point, one
one-screen review, and one progress flow — without leaving VS Code and
without touching a terminal.

The default path is intentionally **not a setup wizard**. Quick Start borrows
PostgreSQL's "create local Docker server and reveal the connection" outcome,
but removes the required form by generating safe defaults.

Key capabilities:

- **Install, run, and connect** to an official DocumentDB local container by
  clicking _Quick Start_ in the Connections view.
- **Review before action.** A single one-screen interstitial summarizes what
  the extension is about to do to the user's machine (image, port, data
  persistence, security, lifetime) before anything is downloaded or started.
- **Zero required fields.** Container name, connection name, username,
  password, port, image tag, data volume, and TLS behavior all have defaults.
  The user opens Advanced only when they want to override them.
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
dismissing in one place dismisses both. The flag is stored as a user
**Setting** (`documentdb.quickStart.welcomeDismissed`), not in `globalState`,
so the dismissed state survives an extension uninstall/reinstall and roams
with Settings Sync. Re-installing the extension does **not** revive the
dismissed state.

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
      v DocumentDB Local                          Running . localhost:10260
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

| Node                      | Label                     | Description suffix                              | Icon                                   |
| ------------------------- | ------------------------- | ----------------------------------------------- | -------------------------------------- |
| Section header            | `DocumentDB Local`        | n/a                                             | DocumentDB icon                        |
| Group: Quick Start        | `Quick Start`             | n/a                                             | `rocket`                               |
| Group: Manual connections | `Manual connections`      | n/a                                             | `plug`                                 |
| Managed instance          | `DocumentDB Local`        | `<state> . <host>:<port> [. update available]`  | colored disk state icon (see sec. 8.1) |
| Manual connection         | user name                 | `Manual . <host>:<port> [. same target as ...]` | existing connection icon               |
| New Local Connection...   | `New Local Connection...` | n/a                                             | `plus`                                 |

The tree row label is the **human connection name** (`DocumentDB Local`),
not the docker container alias. The container alias
(`vscode-documentdb-local`) and the resolved image digest live in the
tooltip (see sec. 8.2). This keeps the tree readable while still letting
the user correlate the row with `docker ps` output.

The two groups (`Quick Start`, `Manual connections`) appear only when there
is at least one child of either kind. With no children of either kind, the
section falls back to the **empty-state child rows** in section 3.2.

In v1 a user has **exactly one managed Quick Start instance** at any time
(see sec. 14). The `Quick Start` group exists for forward compatibility
with a future multi-instance flow but always contains a single row in v1.

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

PostgreSQL's local Docker creation proves the value of `create -> wait ->
connect -> reveal`; DocumentDB keeps that outcome but avoids PostgreSQL's
required create form by pre-filling every setup choice.

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

### 4.1 Easy setup defaults

These defaults are visible in Review & Start, but they are not prompts. They
exist so the user can start without thinking about Docker, credentials, or
connection-string shape.

| Setup choice    | Default the user sees                                                                                            | Why this keeps setup easy                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connection name | `DocumentDB Local`                                                                                               | The tree row label is understandable immediately. The docker alias `vscode-documentdb-local` is hidden in the tooltip.                                                                                                                                                                                                                                                                                                        |
| Container alias | `vscode-documentdb-local`                                                                                        | Stable name for lifecycle actions and adoption; visible in `docker ps` and in the row tooltip, not in the row label.                                                                                                                                                                                                                                                                                                          |
| Port            | `10260`                                                                                                          | Matches DocumentDB Local documentation **and** the `documentDB.local.port` setting used by the manual wizard. Both paths must agree (sec. 13).                                                                                                                                                                                                                                                                                |
| Credentials     | Generated username/password                                                                                      | No password decision before first run.                                                                                                                                                                                                                                                                                                                                                                                        |
| Secret storage  | Store generated password in SecretStorage; pass to the container via `--env-file` (temp file, deleted after run) | The password is **not on the host shell command line** (so it does not appear in `ps -ef`, shell history, or process-audit logs). It IS in the container's runtime environment and remains visible via `docker inspect` / `docker exec <c> env` to anyone with Docker access on the host — this matches the security boundary the user already accepts by running Docker locally. Copy password is available later if needed. |
| Data volume     | Persistent local volume                                                                                          | Data survives stop/restart/update by default.                                                                                                                                                                                                                                                                                                                                                                                 |
| Image           | Official DocumentDB local image                                                                                  | No registry/image decision in the happy path.                                                                                                                                                                                                                                                                                                                                                                                 |
| TLS             | Local self-signed setup                                                                                          | Works for local development without cert setup.                                                                                                                                                                                                                                                                                                                                                                               |
| Sample data     | Offered after start (may be deferred in v1; see sec. 14)                                                         | Keeps the first run fast and still discoverable.                                                                                                                                                                                                                                                                                                                                                                              |

**Readiness contract.** Quick Start declares success only when the database
accepts connections, not when the container starts. Readiness is probed by
issuing a `hello` (or `ping`) command over the wire protocol against
`localhost:<port>` using the generated credentials. The v1.0 timeout is a
fixed **60 seconds** (not user-configurable); a future v1.x release may
expose it as a setting. On timeout the user sees a non-modal failure
toast offering `Wait longer`, `Logs`, and `Reset`. This is the DocumentDB
equivalent of PostgreSQL's `pg_isready` probe; we cannot rely on a
baked-in CLI inside the image.

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

### 4.2 The Advanced panel

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

### 4.3 Remote-session review banner

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

- The `[Quick Start]` rocket icon on the section header is **hidden** in
  v1; with a single managed instance, the rocket would otherwise either
  re-trigger the Review screen or silently restart something the user
  did not click on. Start is initiated from the row (inline `[start]`
  icon, right-click `Start`) or from the command palette
  (`DocumentDB: Start Local DocumentDB`, `DocumentDB: Stop Local DocumentDB`).
- Right-click on the managed row offers `Start` / `Stop` / `Restart`.
- Command palette gains `DocumentDB: Start Local DocumentDB` and
  `DocumentDB: Stop Local DocumentDB`.

```
Managed instance is "Stopped"
   |
   click row [start] / palette Start
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

### 6.1 Seven states and two badges

Each managed instance occupies exactly one of these **seven states**. The
state is shown by an icon color and an inline status word in the
description.

```
   +---------------+              +---------------+              +---------------+
   |  NotInstalled |   click QS   |  Provisioning |   success    |    Running    |
   |   (no row)    | -----------> |  (spinner)    | -----------> |   (green dot) |
   +---------------+              +---------------+              +---------------+
                                       |                              |    ^
                                       | failure                      |    |
                                       v                              v    |
                                  +---------------+   user stop  +---------------+
                                  |    Error      | <--- error - |   Stopping    |
                                  | (red dot)     |              | (yellow dot)  |
                                  +---------------+              +---------------+
                                       ^   ^                          |
                                       |   |                          v
                                  +---------------+   user start +---------------+
                                  |   Starting    | <----------- |    Stopped    |
                                  | (yellow dot)  |              |  (gray dot)   |
                                  +---------------+              +---------------+
                                                   --- success --> Running
```

Running -> Stopping is explicit and is initiated by the user's Stop action;
the diagram should be read end-to-end without implicit edges.

Two **soft badges** overlay any state without changing the state itself:

| Badge             | Meaning                                                                                                                                                  | Tree presentation                              |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `UpdateAvailable` | A newer image tag was detected (see sec. 9.4)                                                                                                            | `Running . localhost:10260 . update available` |
| `Missing`         | The extension has metadata for this instance but Docker has no matching container (e.g., removed in a terminal). Effective hard state is `NotInstalled`. | `Missing . click to recreate` (see sec. 9.5)   |

Badges are not states. `Missing` is the _label_ applied to a `NotInstalled`
row when prior metadata still exists; the row's underlying state, action
matrix, and recovery flow are the `NotInstalled` ones.

### 6.2 Action matrix

`v` = action exposed for that state. Inline columns are always shown in
the same position so icons never shift under the cursor (see review finding
R10).

| Action                           | NotInstalled (incl. `Missing` badge) | Provisioning | Running | Stopping | Stopped | Starting | Error | Where it shows       |
| -------------------------------- | :----------------------------------: | :----------: | :-----: | :------: | :-----: | :------: | :---: | -------------------- |
| Quick Start                      |                  v                   |              |         |          |         |          |       | rocket inline + menu |
| Open Connection                  |                                      |              |    v    |          |         |          |       | inline `[open]`      |
| Start                            |                                      |              |         |          |    v    |          |   v   | inline `[start]`     |
| Stop                             |                                      |              |    v    |          |         |          |       | inline `[stop]`      |
| Cancel                           |                                      |      v       |         |    v     |         |    v     |       | inline `[cancel]`    |
| Restart                          |                                      |              |    v    |          |         |          |   v   | overflow `[...]`     |
| View Logs                        |                                      |      v       |    v    |    v     |    v    |    v     |   v   | overflow `[...]`     |
| Copy Connection String           |                                      |              |    v    |          |    v    |          |       | overflow `[...]`     |
| Copy Password                    |                                      |              |    v    |          |    v    |          |       | overflow `[...]`     |
| Reveal in Docker                 |                                      |      v       |    v    |    v     |    v    |    v     |   v   | overflow `[...]`     |
| Delete Container...              |                                      |              |         |          |    v    |          |   v   | overflow `[...]`     |
| Check for Image Update _(v1.1)_  |                                      |              |    v    |          |    v    |          |   v   | overflow `[...]`     |
| Rename Alias... _(v1.1)_         |                                      |              |    v    |          |    v    |          |   v   | overflow `[...]`     |
| Reset DocumentDB Local… _(v1.1)_ |                                      |              |    v    |          |    v    |          |   v   | overflow `[...]`     |
| Forget Quick Start... _(v1.1)_   |                                      |              |    v    |          |    v    |          |   v   | overflow `[...]`     |

Actions marked _(v1.1)_ are documented here for completeness but are
**not shipped in v1.0** — see sec. 17.4 for the v1.0 / v1.1 split. The
v1.0 overflow menu contains only Restart, View Logs, Copy Connection
String, Copy Password, Reveal in Docker, and Delete Container.

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

The canonical local port is `10260`. When that port is busy, the extension
allocates a free port from a small band — it does **not** silently pick
`10261`, which is commonly also taken on developer machines:

1. Try `10260`.
2. If busy, try up to **N=10 random ports** in the band `[10260, 10360)`.
3. If still no free port is found, surface the **Change port...** dialog
   instead of auto-picking. The user then types a port and the same
   conflict check repeats.

(The PostgreSQL extension only allocates a random port when the input is
empty or invalid; it does **not** auto-fall-back from a valid-but-busy
user-supplied port. The DocumentDB design is intentionally stronger here so
that the zero-form happy path keeps working when the default is occupied.)

When a fallback is used, the user sees it explicitly in two places:

1. A yellow banner in the Review screen:

   ```
   ! Port 10260 is in use. We'll use port 10273 instead.
     [Change port...]  [Use 10273]
   ```

2. A persistent description on the tree row:

   ```
   v DocumentDB Local              Running . localhost:10273
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
v DocumentDB Local              Running . localhost:10260 . update available
```

The `Missing` badge applies when prior metadata exists but Docker has no
matching container (sec. 6.1, sec. 9.5):

```
v DocumentDB Local              Missing . click to recreate
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
DocumentDB Local
Container alias: vscode-documentdb-local

State: Running
Endpoint: localhost:10260
Image: ghcr.io/documentdb/...:latest
Resolved version: v1.2.3   (if the image carries a version label; otherwise "unknown")
Resolved digest:  sha256:12ab...90ef
Data volume: vscode-documentdb-local-data
Runs on: This machine
```

The tree row keeps the UI simple; the tooltip carries the container alias
(for `docker ps` correlation) plus the resolved image digest and — when
the image carries a version label — the resolved version. The digest is
always available; the semver version is image-label-dependent and may
read `unknown`.

---

## 9. Conflict resolution

### 9.1 An existing container with the same name

When the user clicks Quick Start but a Docker container already exists
under the planned name (`vscode-documentdb-local`), the extension first
decides whether it is a recognized DocumentDB Local Quick Start resource.
Only recognized containers can be adopted as managed Quick Start instances.

**Recognition contract.** A container is recognized as a Quick Start
instance if and only if it carries the labels
`vscode.documentdb.quickstart=1` and `vscode.documentdb.alias=<alias>`.
These labels are applied at creation time by Quick Start itself; they are
not derived from name, image, or port. `docker container update` does not
support label modification — labels can only be changed by recreating the
container, so a user who wants to manually opt out of adoption must
recreate the container without the labels. The extension also maintains a
local **forgotten-instances list** (sec. 11) that suppresses adoption for
specific container IDs even when the labels still match. Image name,
container name, and port are never sufficient on their own to recognize a
container as managed.

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

- All windows reflect state changes within a few seconds. **v1 implements
  polling only** (on activation, on overflow-menu open, and on the
  Connections view refresh tick). Subscription to the Docker event stream
  is deferred to v1.x; under polling-only, cross-window latency is bounded
  by the poll interval.
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
  DocumentDB Local   Running . stopped from another VS Code window
  ```

### 9.4 Image is outdated

Discovery is **passive**: the extension does not check for image updates on
activation, and does not show a toast. The check runs when:

- The user opens the overflow menu on the managed row (lazy).
- The user clicks `Check for Image Update` explicitly.
- The user restarts the instance after at least 7 days. (The 7-day
  threshold uses a `lastUpdateCheckAt` timestamp persisted with the
  managed-instance metadata.)

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
  Current version   v1.2.3 (if available)  sha256:12ab...90ef
  New image         ghcr.io/documentdb/...:latest
  New version       v1.3.0 (if available)  sha256:45cd...67ab
  Container         will be recreated
  Data volume       will be kept
  Credentials       will be kept

        [Update]                                        [Cancel]
```

When the image does not carry a version label, the `Current version` /
`New version` rows read `unknown`; the digest rows remain authoritative.

### 9.5 Container disappeared outside the extension

If the user removed the container in a terminal, the tree row enters the
`NotInstalled` state with the `Missing` badge applied (see sec. 6.1 for the
state/badge distinction) and changes its label to:

```
v DocumentDB Local              Missing . click to recreate
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

All **post-readiness** errors (pull, create, start, health-check timeout,
container fails to start, etc.) render in the same shape: a single VS Code
toast with at most three actions, and never block the editor.
**Pre-start** readiness failures (Docker not installed, daemon stopped,
permission denied, registry unreachable, remote-host ambiguity) render in
the Docker readiness screen (sec. 7.1), not as toasts, because they
require categorized guidance and a Retry that re-runs the check
sequence.

---

## 11. Lifecycle vocabulary (definitions the UI strictly follows)

Wording mistakes here cause data loss. The UI uses these exact verbs and
never mixes them.

| Verb                                     | Effect on container                                                 | Effect on data volume | Effect on credentials                       | Effect on `quickstart.*` Docker labels                                                                                         | Effect on extension's local management metadata                                             | Effect on tree row                               |
| ---------------------------------------- | ------------------------------------------------------------------- | --------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| **Start**                                | starts existing                                                     | unchanged             | unchanged                                   | unchanged                                                                                                                      | unchanged                                                                                   | -> Running                                       |
| **Stop**                                 | stops                                                               | unchanged             | unchanged                                   | unchanged                                                                                                                      | unchanged                                                                                   | -> Stopped                                       |
| **Restart**                              | stop + start                                                        | unchanged             | unchanged                                   | unchanged                                                                                                                      | unchanged                                                                                   | -> Running                                       |
| **Rename Alias...** _(v1.1)_             | `docker rename` to new alias; container is not stopped or recreated | unchanged             | unchanged                                   | `vscode.documentdb.alias` updated to new value (via container recreation, since labels are immutable); other labels re-applied | alias field updated; container ID unchanged unless recreation is required for label rewrite | label and tooltip update; row position unchanged |
| **Update Image...** _(v1.1)_             | recreate                                                            | kept                  | kept                                        | re-applied on the new container                                                                                                | updated (new digest, new container ID)                                                      | -> Running                                       |
| **Move to a different port...** _(v1.1)_ | recreate                                                            | kept                  | kept                                        | re-applied on the new container                                                                                                | updated (new port, new container ID)                                                        | -> Running                                       |
| **Delete Container...**                  | removes container                                                   | kept                  | kept                                        | n/a (no container)                                                                                                             | kept (re-create reuses alias, port, volume)                                                 | -> NotInstalled with `Missing` badge (sec. 9.5)  |
| **Reset DocumentDB Local...** _(v1.1)_   | removes container                                                   | **dropped**           | **dropped**                                 | n/a (no container)                                                                                                             | **dropped**                                                                                 | -> NotInstalled (row removed)                    |
| **Forget Quick Start...** _(v1.1)_       | **unchanged**                                                       | unchanged             | kept and re-keyed to a Manual connection ID | **unchanged** (see implementation note below)                                                                                  | **dropped**                                                                                 | row converted to a Manual connection             |

Note on `Rename Alias...`: because Docker labels are immutable on an
existing container, changing the `vscode.documentdb.alias` label requires
container recreation. The v1.1 implementation does this transparently
(stop, `docker commit` not used; just recreate with same image digest +
new alias + persistent volume), so the user-visible effect is just "the
name changed." The data volume is intentionally **not** renamed to follow
the alias — the volume keeps its original name to preserve the
metadata-to-volume link if the user renames repeatedly. This trade-off is
also flagged in sec. 15 open question 1.

`Forget Quick Start` deliberately keeps the credentials (the verb forgets
the **management relationship**, not the secret). After Forget:

- The container keeps running with its Docker labels intact.
  `docker container update` does **not** support label removal (it only
  changes resource limits and restart policy), and the design
  intentionally avoids recreating the container just to drop labels,
  because Forget must be non-destructive.
- The extension drops its local management metadata for this container ID
  and adds the container ID to a local **forgotten-instances list**.
  This list is consulted whenever the recognition contract (sec. 9.1)
  runs: a container whose ID appears in the forgotten list is **not**
  offered as an Adopt candidate even though its labels still match. The
  user can clear the list from the command palette
  (`DocumentDB: Reconsider Forgotten Local Instances`).
- The stored credentials are re-keyed from the Quick Start
  SecretStorage namespace into the Manual connection SecretStorage
  namespace so the converted row still opens.
- The row moves out of the `Quick Start` group and into the
  `Manual connections` group; lifecycle actions
  (Start/Stop/Update/Move/Reset) disappear from the overflow menu because
  the extension no longer owns the container.

Confirmation phrasing:

- _Stop_ — no confirmation. Reversible.
- _Restart_ — no confirmation. Reversible.
- _Delete Container_ — one-line confirm: "Delete the container? Your data
  is kept and will be re-attached if you Quick Start again."
- _Reset DocumentDB Local_ — two-step confirm. User must type the
  container alias to confirm. Names the volume that will be deleted and
  warns "Data cannot be recovered."
- _Forget Quick Start_ — one-line confirm: "Stop managing this container
  from the extension? The container keeps running and the saved
  credentials are kept so the Manual connection still works. The
  extension will stop offering lifecycle actions for it and will not
  re-adopt it automatically. You can re-adopt it from the command
  palette later."

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
                                            recreate=bool, adopted=bool,
                                            image_resolved_version=semver|unknown
event: quickstart.lifecycle           prop: action=start|stop|restart|delete|reset|move|update|forget,
                                            initiated_by=user|other_window,
                                            duration_ms, success=bool
event: quickstart.error               prop: stage=..., reason=...
event: quickstart.dismiss_welcome     prop: from=welcome_view|empty_state
```

Container name, user-edited image tag, registry URL, hostnames, ports,
credentials, and image digest are never sent. The **resolved image
version** (semver from the image label, or `unknown`) IS sent so that
"v1.2.3 has a bug" can be correlated with telemetry. Whether the user
opted into sample data IS sent.

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
- **No required form in the happy path.** The default Quick Start path has no
  mandatory fields. Any setting that would otherwise become a setup step must
  either have a safe default or move to Advanced.
- **Canonical local port.** Quick Start and the manual DocumentDB Local path
  use `10260` by default. The current manual wizard hardcodes `10255` for
  the preconfigured DocumentDB/MongoRU paths
  (`PromptConnectionTypeStep.ts` and `PromptPortStep.ts`); this is a
  pre-ship bug and must be fixed so both paths agree on the
  `documentDB.local.port` setting (default `10260`) before Quick Start
  lands.
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

- **Multiple concurrent managed instances per user.** v1 ships strictly
  single-managed-instance. The `Quick Start` group in the tree exists for
  forward compatibility but always contains exactly one row in v1. The
  rocket icon on the section header is hidden once a managed instance
  exists; a future v1.x release will reintroduce it as
  `Create another local instance...`.
- **Bundled sample data.** The `[Load Sample Data]` action is described
  throughout this document, but if no curated dataset can be bundled in
  the extension (extension-size impact) or fetched safely on demand
  (offline behavior, proxy, signature verification) by ship time, the
  action ships **disabled with a "Coming soon" affordance** in v1 and is
  enabled in v1.x. The success card and empty Collection View callout
  still render the button so the discovery surface is preserved.
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
  resource via the labels contract in sec. 9.1; a matching name alone is
  not enough.

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

The following implementation-detail topics intentionally do not belong
here, but each has a downstream implication that the companion
implementation plan must address:

- **Choice of orchestration mechanism (Docker SDK vs. `docker` CLI).** The
  cancellation contract in sec. 4 and sec. 7.2 means
  `vscode.ShellExecution` (the PostgreSQL approach) is insufficient,
  because it cannot abort an in-flight `docker pull`. The implementation
  must use a cancellable process surface (e.g.,
  `child_process.spawn` with kill-on-cancel, or a streaming API from
  `@microsoft/vscode-container-client`), and the cancellation handler
  must explicitly remove any container that was created and release any
  port that was reserved before declaring the operation aborted.
- **How healthchecks are implemented.** The user-visible contract is in
  sec. 4.1 (a `hello`/`ping` over the wire protocol). The implementation
  decides how to issue that probe (raw socket, driver, `mongosh` if
  available, etc.), the back-off curve, and the cancellation behavior.
- **`LocalEmulatorsItem` migration contract.** The current
  `LocalEmulatorsItem` (`src/tree/connections-view/LocalEmulators/LocalEmulatorsItem.ts`)
  renders a `DocumentDB Local` row with a single `New Local Connection...`
  child when empty. Quick Start replaces this empty state with three
  child rows plus inline header icons (sec. 3.2). Existing manual
  connections continue to render at the top level; the
  `Quick Start` / `Manual connections` grouping (sec. 3.3) is applied
  only once at least one Quick Start instance exists. The implementation
  plan must call out this migration explicitly so existing users with
  many manual emulator connections do not regress.
- **Credential transport.** The implementation must pass generated
  credentials to the container via a temp `--env-file` (written under
  `os.tmpdir()` and removed in a `finally` block), not as repeated `-e`
  flags. `-e` flags appear on the host CLI command line and therefore in
  `ps -ef` and shell history; `--env-file` does not. Note the precise
  security boundary: `--env-file` removes the **host-side** exposure
  (CLI, history, process audit), but the password is still present in
  the container's runtime environment and is therefore visible via
  `docker inspect <container>` (Config.Env) and `docker exec <container> env`
  to anyone with Docker access on the host. This matches the trust
  boundary the user already accepts by running Docker locally. PostgreSQL
  already does this (see `dockerCreateWebviewController.ts:280-287`);
  DocumentDB must match.
- **Docker labels for the recognition contract.** The user-facing rule is
  in sec. 9.1. The exact label names (`vscode.documentdb.quickstart=1`,
  `vscode.documentdb.alias=<alias>`) are stable wire format; the
  implementation plan should treat them as a versioned contract and not
  rename them silently.
- **Welcome-card dismissal storage.** Stored in the user Setting
  `documentdb.quickStart.welcomeDismissed` (sec. 2), not in
  `globalState`. This is the only way the dismissal survives an extension
  uninstall/reinstall.
- **Telemetry property data types or sampling rules.**
- **Localization of strings** (handled at implementation time via
  `vscode.l10n.t()`, per repo convention).
- **Tests, build wiring, or settings keys.**

These belong in a companion implementation plan that references this
document.

---

## 17. Design review: comments, findings, and suggestions

### 17.1 Review outcome

**Approve the UX direction for implementation planning.**

The design correctly moves beyond the Cosmos DB extension's attach-only
emulator pattern and uses the PostgreSQL local Docker creation flow as the
primary UX reference. The strongest parts are the explicit Review & Start
screen, zero required fields in the default path, visible Docker/readiness
progress when needed, the tree as the persistent control surface, the
separation between managed Quick Start and manual connections, and the careful
lifecycle vocabulary for Stop, Delete, Reset, and Forget.

The initial review findings below have been folded back into this draft. The
remaining open questions are intentionally limited to follow-up product or
implementation decisions that should not block the core v1 workflow.

### 17.2 Findings

#### First-round findings (folded into the draft)

| ID  | Severity     | Original finding                                                                                                 | Resolution in this draft                                                                                                                       |
| --- | ------------ | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Must fix     | "One click" could conflict with first-run review.                                                                | Product copy now uses **Quick Start**; true one-click is scoped to subsequent starts after setup.                                              |
| R2  | Must fix     | Manual DocumentDB Local and Quick Start could disagree on default port.                                          | `10260` is now a cross-cutting UX rule for both Quick Start and manual local connection; mismatch is called a pre-ship bug.                    |
| R3  | Must fix     | Users could think the extension installs Docker.                                                                 | The Review screen and prerequisite promise say Docker is required and not installed by the extension; if Docker is stopped, start is explicit. |
| R4  | Must fix     | Ephemeral data mode was ambiguous.                                                                               | Ephemeral volumes are removed from v1; persistent local volume is the only data mode.                                                          |
| R5  | Should fix   | Empty database after success may not feel like "try DocumentDB."                                                 | `Load Sample Data` is promoted on the success card and empty Collection View callout.                                                          |
| R6  | Should fix   | Existing-container adoption could take over the wrong container.                                                 | Adopt is offered only for recognized DocumentDB Local Quick Start resources; name-only matches get manual connection/reset/cancel choices.     |
| R7  | Should fix   | Remote VS Code makes "local" ambiguous.                                                                          | Remote-session Review banner names the actual target context before start.                                                                     |
| R8  | Should fix   | `latest` makes image version hard to reason about.                                                               | Managed-row tooltip and update dialog show resolved version and image digest.                                                                  |
| R9  | Nice to have | Multi-window coordination may expand v1 implementation scope.                                                    | User-facing rule remains; v1.0 ships polling-only (sec. 9.3, sec. 17.4); event subscription deferred to v1.1.                                  |
| R10 | Nice to have | Inline actions should not shift under the cursor.                                                                | Three fixed action slots are retained as UX contract: primary, power, overflow.                                                                |
| R11 | Nice to have | Welcome card could annoy users with cloud connections but no local ones.                                         | Empty `DocumentDB Local` section remains the default scope; dismissal is shared with empty-state card.                                         |
| R12 | Should fix   | PostgreSQL shows that local Docker creation should finish by saving, connecting, and revealing the new resource. | The success definition now requires DocumentDB readiness plus a usable revealed connection, not just a running container.                      |
| R13 | Should fix   | PostgreSQL uses a form, but DocumentDB can be easier because its defaults are known.                             | The happy path now has zero required fields; all setup choices are generated or moved to Advanced.                                             |
| R14 | Should fix   | MSSQL reduces friction by starting Docker Desktop when possible, but that can feel surprising.                   | The design allows an explicit user-clicked Docker start action where supported, while preserving the no-silent-start rule.                     |

#### Second-round findings (combined external review, folded into this revision)

| ID  | Severity   | Original finding                                                                                                                                                                                                                       | Resolution in this revision                                                                                                                                                                                     |
| --- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R15 | Must fix   | §6.1 said "six states" but showed seven; the seventh "soft" badge sentence didn't reconcile the count.                                                                                                                                 | Heading renamed to **"Seven states and two badges"** (sec. 6.1). The `Missing` badge is now a documented second badge alongside `UpdateAvailable`. Action matrix in §6.2 unchanged (already had seven cols).    |
| R16 | Must fix   | `Missing` was used inconsistently across §9.5 (label on NotInstalled) and §11 (apparent distinct state).                                                                                                                               | `Missing` is a **badge** over `NotInstalled` everywhere. §6.1, §8.1, §9.5, §11 updated. Action matrix column header is "NotInstalled (incl. `Missing` badge)".                                                  |
| R17 | Must fix   | `Forget Quick Start` (§11) dropped credentials yet converted the row to a Manual connection, which §9.1 explicitly says cannot open without credentials.                                                                               | Forget now **keeps** credentials; it drops only the `quickstart.*` Docker labels and the management relationship. Updated §11 verb table and confirmation copy.                                                 |
| R18 | Must fix   | "Waiting for the database to accept connections" had no defined probe (PostgreSQL uses `pg_isready`; DocumentDB has no equivalent CLI baked into the image).                                                                           | New "Readiness contract" paragraph in §4.1 defines a `hello`/`ping` over the wire protocol with a 60s default timeout. §10 references stay consistent.                                                          |
| R19 | Must fix   | §7.4 deterministic `+1` fallback was fragile and misrepresented PostgreSQL.                                                                                                                                                            | §7.4 rewritten to random free port in `[10260, 10360)` with up to 10 attempts, then escalate to `Change port...`. §0.2 row corrected to state that PostgreSQL does **not** do this for valid-but-busy ports.    |
| R20 | Must fix   | Tree label inconsistent: §3.3 used `vscode-documentdb-local`, §4.1 said `DocumentDB Local`.                                                                                                                                            | Tree row label is **`DocumentDB Local`** (sec. 3.3, sec. 4.1). The container alias `vscode-documentdb-local` lives in the tooltip (sec. 8.2).                                                                   |
| R21 | Must fix   | The manual wizard currently hardcodes port **10255** (`PromptConnectionTypeStep.ts:97,101`, `PromptPortStep.ts:23,25`) despite the `documentDB.local.port` setting defaulting to **10260**. The doc only treated this as hypothetical. | §13 now names the specific files and calls out the fix as a hard pre-ship dependency for Quick Start.                                                                                                           |
| R22 | Should fix | Adopt-recognition contract was deferred to §16 even though it has user-visible consequences (whether Adopt is offered).                                                                                                                | Recognition contract is now an explicit paragraph in §9.1 (labels `vscode.documentdb.quickstart=1` and `vscode.documentdb.alias=<alias>`, applied at creation, never inferred from name/image/port).            |
| R23 | Should fix | §16 listed "out of scope" items that have hard downstream constraints (cancellation, env-file credential transport, process orchestration).                                                                                            | §16 rewritten to keep each item but call out its downstream implication explicitly so the implementation plan does not silently regress against them.                                                           |
| R24 | Should fix | §17.4 had no v1.0 / v1.1 split; readiness diagnosis (§7.1) and the Forget/Update/Move/Reset verbs would balloon v1.                                                                                                                    | §17.4 rewritten as an explicit **v1.0 / v1.1** split. v1.0 = PostgreSQL-parity slice + DocumentDB UX wins; v1.1 = adopt, update, move, reset, forget, event subscription, remote banner, categorized diagnosis. |
| R25 | Should fix | §3.3 enabled multi-instance ("every managed instance is listed") while §14 declared it a non-goal.                                                                                                                                     | §3.3 now states v1 is single-managed-instance. §14 updated to make this concrete. Multi-instance moves to v1.1 (sec. 17.4).                                                                                     |
| R26 | Should fix | Welcome-card dismissal across uninstall (§2) needed an explicit storage commitment because `globalState` is wiped on uninstall.                                                                                                        | §2 now states dismissal is stored in user Setting `documentdb.quickStart.welcomeDismissed`. §16 reiterates.                                                                                                     |
| R27 | Should fix | `LocalEmulatorsItem` migration contract was implicit.                                                                                                                                                                                  | §16 calls out the file path and the v1 invariant: manual connections continue to render at the top level; grouping only kicks in once a Quick Start instance exists.                                            |
| R28 | Should fix | `Load Sample Data` was treated as borrowed from PostgreSQL (it isn't) and committed to without a delivery mode.                                                                                                                        | §14 marks Load Sample Data as v1.0-if-feasible / v1.1-otherwise, with the button rendered disabled-with-"Coming soon" if no dataset can be bundled or fetched safely by ship time.                              |
| R29 | Nice fix   | `Resolved version` was promised in the tooltip, but the image may not carry a version label.                                                                                                                                           | §8.2 and §9.4 phrase the field as "version if available, digest always."                                                                                                                                        |
| R30 | Nice fix   | Telemetry omitted resolved image version (useful for "v1.2.3 has a bug" correlations) and included nothing about Forget.                                                                                                               | §12 adds `image_resolved_version=semver\|unknown` to `quickstart.start_end` and adds `forget` to the lifecycle action enum.                                                                                     |
| R31 | Nice fix   | §6.1 diagram had no explicit `Running → Stopping` arrow.                                                                                                                                                                               | Diagram updated; "user stop" edge from Running to Stopping is now drawn explicitly, and a callout under the diagram repeats the rule.                                                                           |

#### Third-round findings (independent fresh-context review by a different model, folded into this revision)

| ID  | Severity   | Original finding                                                                                                                                                                                                                               | Resolution in this revision                                                                                                                                                                                                                                                                                                                                                                          |
| --- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R32 | Must fix   | §5 said the header rocket "turns into a direct start" of the existing instance after setup, while §14 and §17.4 said the rocket is hidden once a managed instance exists. The two readings conflicted.                                         | §5 rewritten: with v1 single-managed-instance the rocket is **hidden** once a managed instance exists; Start happens from the row's inline `[start]`, the row's right-click menu, or the command palette. The hidden behavior is consistent with §14 and §17.4.                                                                                                                                      |
| R33 | Should fix | §10 declared "all errors render as a single toast," but Docker readiness failures (§7.1) explicitly render as a screen with a Retry that re-runs the check sequence.                                                                           | §10 closing paragraph now scopes the toast rule to **post-readiness** failures (pull, create, start, healthcheck timeout, etc.) and explicitly excludes pre-start readiness diagnosis, which continues to render via §7.1.                                                                                                                                                                           |
| R34 | Must fix   | §11 said `Forget Quick Start` removes labels from the existing container, but `docker container update` does **not** support label removal (only resource limits and restart policy).                                                          | §11 rewritten: Forget does **not** touch the container or its labels. Instead it drops the extension's local management metadata, adds the container ID to a local **forgotten-instances list** consulted by the recognition contract, and re-keys credentials into the Manual connection SecretStorage namespace. A new command `DocumentDB: Reconsider Forgotten Local Instances` clears the list. |
| R35 | Must fix   | §4.1 secret-storage row and §16 credential-transport bullet both claimed `--env-file` keeps the password out of `docker inspect`. That is not true — `Config.Env` from `--env-file` is inspectable via `docker inspect` and `docker exec env`. | Both passages rewritten: `--env-file` removes the **host-side** exposure (CLI command line, `ps -ef`, shell history) but the password remains visible inside the container's runtime environment to anyone with Docker access on the host. This matches the trust boundary the user already accepts by running Docker.                                                                               |

### 17.3 UX principles to carry into implementation planning

1. **Be transparent before side effects.** Downloading an image, creating a
   container, binding a port, and persisting a volume are machine-level
   changes. The Review screen must stay mandatory on first run.
2. **Do not turn Quick Start into a setup form.** PostgreSQL's flow is a good
   creation reference, but DocumentDB should be easier: generate defaults and
   use Advanced for overrides.
3. **Keep routine actions quiet.** After setup, Start and Stop should update
   the tree and status bar without celebratory toasts.
4. **Keep manual attach first-class.** Quick Start should not replace users
   who already run DocumentDB themselves.
5. **Use the tree as source of truth.** Status, port, update availability,
   and lifecycle actions should be discoverable from the managed instance row.
6. **Prefer reversible defaults.** Persistent data, explicit reset, and no
   automatic cleanup on extension uninstall are the safest defaults.
7. **Avoid terminal language in the happy path.** Docker details belong in
   Review, Advanced, logs, and troubleshooting, not in the main success flow.

### 17.4 Suggested v1.0 / v1.1 scope split

The full design above is the multi-release roadmap. The shippable
**v1.0** matches what PostgreSQL actually demonstrates plus the
DocumentDB-specific UX wins; everything else is **v1.1**.

#### v1.0 (must ship)

Surface and behavior:

- Entry points: rocket icon on the `DocumentDB Local` header, child row
  in the empty state, command palette entry, walkthrough card.
- One Review & Start screen with zero required fields.
- Docker readiness: same two checks as PostgreSQL (CLI present, daemon
  reachable) plus a single generic `See Troubleshooting` link. (The nine
  categorized failure modes in sec. 7.1 — Apple Silicon arm64, WSL2
  missing, sudo group, Windows-vs-Linux engine, authenticated proxy,
  etc. — are v1.1.)
- Progress notification with `Show Details` and `Cancel`. Cancel must
  actually abort the in-flight `docker pull`, remove any created
  container, and release the reserved port (sec. 16).
- Pull / create / start / wait-for-readiness / save / connect / reveal.
- **Readiness** is a `hello`/`ping` over the wire protocol, 60s
  timeout (sec. 4.1).
- **Port fallback** picks a random free port in `[10260, 10360)` with up
  to 10 attempts; falls through to the `Change port...` dialog (sec.
  7.4). Both Quick Start and the manual wizard use `10260` as the
  canonical default (sec. 13). The current manual-wizard 10255 hardcode
  is fixed.
- **Credentials** stored in SecretStorage, passed via `--env-file` only
  (sec. 16).
- **Labels** `vscode.documentdb.quickstart=1` and
  `vscode.documentdb.alias=<alias>` applied at creation (sec. 9.1).
- **Tree row** label is `DocumentDB Local`; alias and digest live in the
  tooltip (sec. 3.3, sec. 8.2).
- **Lifecycle actions** in v1.0: Open Connection, Start, Stop, Restart,
  View Logs, Copy Connection String, Copy Password, Reveal in Docker,
  Delete Container. All other overflow actions are v1.1.
- **States** are the seven defined in sec. 6.1. `UpdateAvailable` and
  `Missing` badges are wired through the rendering layer but only
  `Missing` is reachable in v1.0 (Update is a v1.1 feature; the badge
  renders no-op until then).
- **Multi-instance** is single-only in v1.0; the rocket icon is hidden
  once a managed row exists (sec. 14).
- **Multi-window coordination** is polling-only on activation,
  Connections-view refresh, and overflow-menu open (sec. 9.3). Docker
  event subscription is v1.1.
- **Welcome card dismissal** stored in user Setting
  `documentdb.quickStart.welcomeDismissed` (sec. 2).
- **Sample data** is v1.0 if a curated dataset can be bundled or fetched
  safely by ship time; otherwise the button renders disabled with a
  "Coming soon" affordance (sec. 14).

#### v1.1 (deferred)

- Adopt-existing-container flow (sec. 9.1) — the recognition contract
  still ships in v1.0 (labels are applied on creation) so v1.1 can use
  them immediately.
- Update Image with version/digest diff (sec. 9.4).
- Move to a different port (sec. 9.6).
- Reset DocumentDB Local and Forget Quick Start (sec. 11).
- Categorized Docker readiness diagnosis (sec. 7.1, rows beyond the two
  baseline checks).
- Docker event subscription for multi-window coordination (sec. 9.3).
- Remote VS Code (SSH/WSL/dev container) banner (sec. 4.3).
- Load Sample Data if not bundled in v1.0.
- Multiple managed instances via Command Palette
  `DocumentDB: Quick Start - Install Local DocumentDB`.

The v1.0 user promise: **from an empty machine-with-Docker to an open
local DocumentDB connection, without leaving VS Code.** Everything in
v1.1 polishes lifecycle ownership on top of that promise without
changing the promise itself.
