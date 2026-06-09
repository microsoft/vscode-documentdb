# Local Quick Start — Revised Design (Iteration 2)

> **Supersedes:** [Iteration 1](./local-quickstart.md) — kept as reference
> for original rationale and edge-case analysis.
>
> **What changed:** Simplified tree architecture, removed dedicated local
> connection subtree, moved container creation to a webview, unified TLS
> exception handling into the regular connection wizard.
>
> **Scope:** UX design and architecture. Not an implementation plan.

---

## 1. One-sentence goal

From an empty machine-with-Docker to an open local DocumentDB connection,
without leaving VS Code.

---

## 2. Key decisions (what changed from iteration 1)

| Decision                           | Iteration 1                                                         | Iteration 2                                                                           |
| ---------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Tree root                          | `DocumentDB Local` with `Quick Start` + `Manual connections` groups | `DocumentDB Local - Quick Start` — container management only                          |
| Quick Start connection             | Separate connection entry in the tree                               | Cluster is inline — expand the Quick Start node to browse databases                   |
| User-created localhost connections | Live inside the local subtree                                       | Live alongside regular clusters in the Connections view                               |
| Emulator templates                 | Kept ("MongoDB Emulator RU", "DocumentDB Local", "Custom")          | Dropped. Regular new-connection wizard only.                                          |
| TLS exception                      | Gated to emulator wizard                                            | Gated step in regular new-connection wizard (localhost + private IPs + local domains) |
| Container creation UI              | Notification-based interstitial                                     | Webview (tRPC router, card-based, same design language as query insights tab)         |
| Legacy migration                   | Not addressed                                                       | First launch: existing emulator connections → `Local Connections (Legacy)` folder     |
| Container runtime                  | Docker-specific                                                     | Docker-first (v1). OCI/podman follow-up issues tracked separately.                    |

---

## 3. Tree shape

### 3.1 Before Quick Start (first activation)

```
v Connections
    > my-cloud-cluster
    > another-cluster
    v DocumentDB Local - Quick Start                       [rocket]
        o  Quick Start — Install & try DocumentDB locally
        o  Learn more...
```

### 3.2 After a successful Quick Start

```
v Connections
    > my-cloud-cluster
    > another-cluster
    > my-manual-localhost                       (user added this themselves)
    v Local Connections (Legacy)                (one-time migration, if any existed)
        > old-emulator-conn
    v DocumentDB Local - Quick Start                       [rocket]
        v DocumentDB Local                     Running · localhost:10260
            v admin
                > mydb
```

The managed cluster is **inline** — expanding the Quick Start node is how
users browse databases and collections. No separate connection entry.

### 3.3 Node glossary

| Node               | Label                                            | Description               | Icon                       |
| ------------------ | ------------------------------------------------ | ------------------------- | -------------------------- |
| Section header     | `DocumentDB Local - Quick Start`                 | n/a                       | DocumentDB icon            |
| Managed instance   | `DocumentDB Local`                               | `<state> · <host>:<port>` | Colored state dot (see §6) |
| Empty-state action | `Quick Start — Install & try DocumentDB locally` | n/a                       | Rocket                     |
| Empty-state link   | `Learn more...`                                  | n/a                       | Link icon                  |

The rocket `[rocket]` icon on the section header is the primary entry
point. Hidden once a managed instance exists (v1 is single-instance).

---

## 4. Legacy migration

On first activation after the update:

1. Read all connections stored under `ConnectionType.Emulators`.
2. Create a folder named `Local Connections (Legacy)` in the regular
   Connections tree. If that name already exists, use the existing
   duplicate-suffix logic (e.g., `Local Connections (Legacy) (2)`).
3. Move each emulator connection into that folder as a regular cluster.
4. Preserve credentials, auth config, and `emulatorConfiguration` on
   each moved connection.
5. Remove the old `ConnectionType.Emulators` storage zone.
6. Show a one-time toast: "Your local connections have been moved to
   'Local Connections (Legacy)' in the Connections view."

The `LocalEmulatorsItem` tree node and the `New Local Connection...`
wizard entry point are removed.

---

## 5. Container creation webview

When the user clicks **Quick Start**, a webview opens. The webview uses the
existing tRPC/webview infrastructure (router + React + FluentUI). Design
language follows the query insights tab: **card-based layout** with
responsive columns, metric cards, and clear action buttons.

### 5.1 Webview: Review & Start (happy path — Docker ready)

```
+======================================================================+
|  DocumentDB Local - Quick Start                              [x]     |
+======================================================================+
|                                                                      |
|  ┌────────────────────────────────────────────────────────────────┐  |
|  │  🚀  Start DocumentDB Local                                   │  |
|  │                                                                │  |
|  │  Get a working local DocumentDB instance in one click.        │  |
|  │  No terminal commands needed.                                  │  |
|  └────────────────────────────────────────────────────────────────┘  |
|                                                                      |
|  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────────┐  |
|  │  Docker      │ │  Port        │ │  Data        │ │  Security  │  |
|  │  ✅ Ready    │ │  10260       │ │  Persistent  │ │  TLS local │  |
|  │              │ │              │ │  volume      │ │  self-sign │  |
|  └──────────────┘ └──────────────┘ └──────────────┘ └────────────┘  |
|                                                                      |
|  ┌────────────────────────────────────────────────────────────────┐  |
|  │  What we'll do                                                 │  |
|  │                                                                │  |
|  │  Image         ghcr.io/documentdb/...:latest                  │  |
|  │  Runs on       This machine                                    │  |
|  │  Credentials   Auto-generated, stored securely                │  |
|  │  Lifetime      Keeps running after VS Code closes             │  |
|  └────────────────────────────────────────────────────────────────┘  |
|                                                                      |
|  ▸ Advanced                                                          |
|                                                                      |
|         [ Start DocumentDB Local ]                    [ Cancel ]     |
|                                                                      |
+======================================================================+
```

The four **metric cards** at the top (Docker / Port / Data / Security)
follow the same responsive grid pattern as the query insights metrics row:
1 column on narrow views, 2 on medium, 4 on wide.

The **"What we'll do"** summary is a card with a two-column data grid
(same as the query insights SummaryCard).

### 5.2 Webview: Advanced panel (expanded)

```
|  v Advanced                                                          |
|  ┌────────────────────────────────────────────────────────────────┐  |
|  │  Container name      [ vscode-documentdb-local             ]  │  |
|  │  Port                [ 10260                               ]  │  |
|  │  Data volume         Persistent local volume                  │  |
|  │  Credentials         (•) Generate strong password             │  |
|  │                      ( ) Use these:                           │  |
|  │                          user [ admin                      ]  │  |
|  │                          pass [ .......................... ]  │  |
|  │  Image tag           [ latest                              ]  │  |
|  │  Seed sample data    [ ] Load sample documents on start       │  |
|  └────────────────────────────────────────────────────────────────┘  |
```

### 5.3 Webview: Docker not ready

When a blocking check fails, the metric cards turn into a diagnosis view
instead of the start flow:

```
+======================================================================+
|  DocumentDB Local - Quick Start                              [x]     |
+======================================================================+
|                                                                      |
|  ┌────────────────────────────────────────────────────────────────┐  |
|  │  ⚠️  Docker is required                                       │  |
|  │                                                                │  |
|  │  Local Quick Start needs Docker to run DocumentDB on your     │  |
|  │  machine. The extension does not install Docker for you.      │  |
|  └────────────────────────────────────────────────────────────────┘  |
|                                                                      |
|  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────────┐  |
|  │  Docker CLI  │ │  Docker      │ │  Registry    │ │  Platform  │  |
|  │  ✅ Found    │ │  daemon      │ │  ⚠️ Not      │ │  ✅ amd64  │  |
|  │  v1.27.0     │ │  ❌ Stopped  │ │  reached     │ │            │  |
|  └──────────────┘ └──────────────┘ └──────────────┘ └────────────┘  |
|                                                                      |
|  ┌────────────────────────────────────────────────────────────────┐  |
|  │  How to fix                                                    │  |
|  │                                                                │  |
|  │  • Start Docker Desktop and sign in                           │  |
|  │  • Check your corporate proxy settings                        │  |
|  │  • Test reachability: ghcr.io                                 │  |
|  │                                                                │  |
|  │  [ Start Docker Desktop ]   [ Troubleshooting ]               │  |
|  └────────────────────────────────────────────────────────────────┘  |
|                                                                      |
|                        [ Retry ]                     [ Cancel ]      |
|                                                                      |
+======================================================================+
```

### 5.4 Webview: Progress

After the user clicks **Start DocumentDB Local**, the webview transitions
to a progress view. The user can keep working — the webview is not modal
(yet — modal webview API is expected from VS Code; once available we
switch).

```
+======================================================================+
|  DocumentDB Local - Quick Start                              [x]     |
+======================================================================+
|                                                                      |
|  ┌────────────────────────────────────────────────────────────────┐  |
|  │  Setting up DocumentDB Local...                  00:18        │  |
|  └────────────────────────────────────────────────────────────────┘  |
|                                                                      |
|  ┌────────────────────────────────────────────────────────────────┐  |
|  │  [✅] Checking Docker                                         │  |
|  │  [✅] Reserving port 10260                                    │  |
|  │  [🔄] Pulling official image                          42%     │  |
|  │  [  ] Creating container                                      │  |
|  │  [  ] Starting container                                      │  |
|  │  [  ] Waiting for DocumentDB to accept connections            │  |
|  └────────────────────────────────────────────────────────────────┘  |
|                                                                      |
|  ┌────────────────────────────────────────────────────────────────┐  |
|  │  ▸ View Docker output                                         │  |
|  └────────────────────────────────────────────────────────────────┘  |
|                                                                      |
|                                                      [ Cancel ]      |
|                                                                      |
+======================================================================+
```

On failure, the failed step expands with guidance:

```
|  │  [✅] Checking Docker                                         │  |
|  │  [✅] Reserving port 10260                                    │  |
|  │  [❌] Pulling official image                       Failed     │  |
|  │       We couldn't pull the image from ghcr.io.                │  |
|  │       Check your network connection or proxy settings.        │  |
|  │                                                               │  |
|  │       [ Retry ]   [ Troubleshooting ]                         │  |
|  │  [  ] Creating container                                      │  |
|  │  [  ] Starting container                                      │  |
|  │  [  ] Waiting for DocumentDB to accept connections            │  |
```

### 5.5 Webview: Success

```
+======================================================================+
|  DocumentDB Local - Quick Start                              [x]     |
+======================================================================+
|                                                                      |
|  ┌────────────────────────────────────────────────────────────────┐  |
|  │  ✅  DocumentDB Local is running on localhost:10260           │  |
|  └────────────────────────────────────────────────────────────────┘  |
|                                                                      |
|  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────────┐  |
|  │  Status      │ │  Endpoint    │ │  Image       │ │  Data      │  |
|  │  ✅ Running  │ │  localhost    │ │  v1.2.3      │ │  Persisted │  |
|  │              │ │  :10260      │ │  (latest)    │ │            │  |
|  └──────────────┘ └──────────────┘ └──────────────┘ └────────────┘  |
|                                                                      |
|  ┌────────────────────────────────────────────────────────────────┐  |
|  │  [ Open Connection ]       [ Copy Connection String ]         │  |
|  │  [ Load Sample Data ]      [ View Logs ]                      │  |
|  └────────────────────────────────────────────────────────────────┘  |
|                                                                      |
+======================================================================+
```

**Open Connection** expands the managed cluster in the tree (user browses
databases/collections from the Quick Start subtree). The webview can then
be closed.

### 5.6 Cancel rules

| Cancelled during      | Rollback behavior                                        |
| --------------------- | -------------------------------------------------------- |
| Pull                  | Abort pull, no container created                         |
| Create                | Remove partially created container                       |
| Start                 | Stop and remove container, release port                  |
| Waiting for readiness | Stop and remove container, surface last connection error |

Generated credentials are kept in SecretStorage so a retry reuses them.

---

## 6. Lifecycle states

```
 NotInstalled ──(Quick Start)──▸ Provisioning ──(success)──▸ Running
                                     │                        │   ▲
                                     │ failure                │   │
                                     ▼                        ▼   │
                                   Error ◂── error ──── Stopping  │
                                     ▲                        │   │
                                     │                        ▼   │
                                  Starting ◂──(start)── Stopped   │
                                     │                            │
                                     └────────(success)───────────┘
```

### 6.1 State presentation

| State        | Icon             | Color  | Tree description                    |
| ------------ | ---------------- | ------ | ----------------------------------- |
| NotInstalled | n/a              | n/a    | (no row — empty state)              |
| Provisioning | `loading~spin`   | yellow | `Provisioning... · localhost:10260` |
| Starting     | `loading~spin`   | yellow | `Starting... · localhost:10260`     |
| Running      | `circle-filled`  | green  | `Running · localhost:10260`         |
| Stopping     | `loading~spin`   | yellow | `Stopping... · localhost:10260`     |
| Stopped      | `circle-outline` | gray   | `Stopped · localhost:10260`         |
| Error        | `warning`        | red    | `Error · click for details`         |

Badges (overlay any state):

- **`Missing`** — extension has metadata but Docker has no matching
  container. Shows `Missing · click to recreate`.
- **`UpdateAvailable`** _(v1.1)_ — newer image detected. Shows
  `Running · localhost:10260 · update available`.

### 6.2 Action matrix

| Action                 | NotInstalled | Provisioning | Running | Stopping | Stopped | Starting | Error |
| ---------------------- | :----------: | :----------: | :-----: | :------: | :-----: | :------: | :---: |
| Quick Start            |      v       |              |         |          |         |          |       |
| Open Connection        |              |              |    v    |          |         |          |       |
| Start                  |              |              |         |          |    v    |          |   v   |
| Stop                   |              |              |    v    |          |         |          |       |
| Cancel                 |              |      v       |         |    v     |         |    v     |       |
| Restart                |              |              |    v    |          |         |          |   v   |
| View Logs              |              |      v       |    v    |    v     |    v    |    v     |   v   |
| Copy Connection String |              |              |    v    |          |    v    |          |       |
| Copy Password          |              |              |    v    |          |    v    |          |       |
| Delete Container...    |              |              |         |          |    v    |          |   v   |

Inline icon positions are fixed so buttons don't shift:

```
Position 1: primary   [open] when Running, blank otherwise
Position 2: power     [start] or [stop] or [cancel]
Position 3: overflow  [...]
```

---

## 7. TLS exception in the regular connection wizard

The emulator-specific `New Local Connection...` wizard is removed. TLS
exception handling moves to the **regular new connection wizard** as a
conditional step.

### 7.1 Gating rules

The "Allow invalid TLS certificates" step appears **only** when the
parsed host from the connection string matches any of:

- `localhost`, `127.0.0.1`, `::1`
- Single-word hostnames (no dots): `home`, `devbox`, etc.
- `*.local` domains
- RFC 1918 private IPs:
  - `10.0.0.0/8`
  - `172.16.0.0/12`
  - `192.168.0.0/16`

All other hosts: no TLS exception step shown.

### 7.2 Wizard step

When the gate matches, a new step appears after the connection string /
host prompt:

```
+---- TLS Certificate Validation ----+
|                                     |
|  This connection targets a local    |
|  or private network host.           |
|                                     |
|  (•) Enable TLS (default)          |
|  ( ) Allow invalid certificates     |
|      (self-signed / untrusted CA)   |
|                                     |
|  [Back]                [Continue]   |
+-------------------------------------+
```

### 7.3 Future: connection edit dialog

For hosts outside the gate, the TLS exception will be configurable via a
**connection edit / advanced settings dialog** (to be built as part of this
project — tracked as a separate issue).

---

## 8. Defaults

| Setting         | Default                          | Notes                                                            |
| --------------- | -------------------------------- | ---------------------------------------------------------------- |
| Connection name | `DocumentDB Local`               | Readable tree label                                              |
| Container alias | `vscode-documentdb-local`        | Visible in `docker ps`, in tooltip                               |
| Port            | `10260`                          | Canonical port for both Quick Start and manual connections       |
| Credentials     | Auto-generated username/password | Stored in SecretStorage, passed via `--env-file` (not CLI flags) |
| Data volume     | `vscode-documentdb-local-data`   | Persistent; survives stop/restart/update                         |
| Image           | Official DocumentDB local image  | `ghcr.io/documentdb/...`                                         |
| TLS             | Self-signed local certificate    | `tlsAllowInvalidCertificates=true`                               |

### 8.1 Password generation

Generated passwords must be **URL-safe** or properly URL-encoded before
being embedded in connection strings. Special characters that are not
URL-safe must be percent-encoded. Safest approach: generate passwords
using only `[A-Za-z0-9]` plus a curated set of safe special characters.

### 8.2 Credential transport

Credentials are passed to the container via a temporary `--env-file`
(written to `os.tmpdir()`, deleted in a `finally` block). This keeps
passwords out of `ps -ef`, shell history, and process audit logs.

Note: the password is still visible inside the container runtime
environment (`docker inspect`, `docker exec env`) to anyone with Docker
access on the host. This matches the trust boundary the user accepts by
running Docker locally.

### 8.3 Port fallback

1. Try `10260`.
2. If busy, try up to 10 random ports in `[10260, 10360)`.
3. If still no free port, show `Change port...` dialog.

When a fallback is used, the webview shows a yellow banner:

```
⚠ Port 10260 is in use. We'll use port 10273 instead.
  [ Change port... ]   [ Use 10273 ]
```

---

## 9. Prereq checks

Run before showing the Review & Start webview. Results populate the
metric cards.

| Check                    | Pass                     | Fail                             |
| ------------------------ | ------------------------ | -------------------------------- |
| Docker CLI on PATH       | ✅ Found (version shown) | ❌ "Install Docker" link         |
| Docker daemon reachable  | ✅ Ready                 | ❌ "Start Docker Desktop" action |
| Image registry reachable | ✅ OK                    | ⚠️ "Check proxy settings"        |
| Platform supported       | ✅ amd64/arm64           | ⚠️ "Use x86_64 emulation?"       |
| Port available           | ✅ Free                  | ⚠️ Fallback port (see §8.3)      |

Platform check should detect unsupported CPU architectures per
[Azure emulator Docker issue #254](https://github.com/Azure/azure-cosmos-db-emulator-docker/issues/254#issuecomment-4515601488).

### 9.1 Readiness contract

Quick Start declares success only when the database accepts connections,
not when the container starts. Readiness is probed by issuing a
`hello`/`ping` command over the wire protocol against
`localhost:<port>`. Timeout: 60 seconds (fixed in v1, setting later).

On timeout: failure toast with `Wait longer`, `Logs`, `Reset`.

---

## 10. Container recognition and adoption

### 10.1 Labels

Quick Start applies these Docker labels at container creation:

- `vscode.documentdb.quickstart=1`
- `vscode.documentdb.alias=<alias>`

These are the **only** way a container is recognized as a Quick Start
instance. Name, image, or port alone are never sufficient.

### 10.2 Existing container conflict

When a container with the planned name already exists:

**Recognized** (has Quick Start labels):

```
+--- Existing Quick Start container found ---+
|                                            |
|  Container    vscode-documentdb-local      |
|  Status       Exited 12 days ago           |
|                                            |
|  (•) Adopt as managed instance             |
|  ( ) Reset and recreate                    |
|  ( ) Cancel                                |
|                                            |
|       [ Continue ]              [ Cancel ] |
+--------------------------------------------+
```

**Unrecognized** (no labels):

```
+--- Container name already in use ---+
|                                     |
|  Another container is using the     |
|  name 'vscode-documentdb-local'.    |
|                                     |
|  (•) Create a manual connection     |
|  ( ) Reset and recreate             |
|  ( ) Cancel                         |
|                                     |
|     [ Continue ]        [ Cancel ]  |
+-------------------------------------+
```

---

## 11. Lifecycle vocabulary

| Verb                         | Container       | Data volume | Credentials | Tree row                 |
| ---------------------------- | --------------- | ----------- | ----------- | ------------------------ |
| **Start**                    | Starts existing | Unchanged   | Unchanged   | → Running                |
| **Stop**                     | Stops           | Unchanged   | Unchanged   | → Stopped                |
| **Restart**                  | Stop + start    | Unchanged   | Unchanged   | → Running                |
| **Delete Container...**      | Removed         | Kept        | Kept        | → NotInstalled (Missing) |
| **Update Image...** _(v1.1)_ | Recreated       | Kept        | Kept        | → Running                |
| **Move Port...** _(v1.1)_    | Recreated       | Kept        | Kept        | → Running                |
| **Reset...** _(v1.1)_        | Removed         | **Dropped** | **Dropped** | → NotInstalled           |

Confirmations:

- Stop / Restart: none (reversible)
- Delete Container: one-line confirm
- Reset: two-step confirm, user must type container alias

---

## 12. Multi-window coordination

The container is shared machine state. No window "owns" it.

- v1: **polling only** (on activation, on view refresh, on overflow-menu
  open). Docker event subscription deferred to v1.1.
- Destructive actions re-check live state before executing.
- If state changed, show: "The instance is now Stopping (from another
  window). Action is no longer available."

---

## 13. Cross-cutting rules

1. **Opt-in only.** Never install Docker, never start Docker silently,
   never modify containers the extension didn't create.
2. **Explicit Docker start.** If Docker is stopped, offer a user-clicked
   `Start Docker Desktop` action where supported.
3. **No background pulls.** Image pulled only inside user-initiated flows.
4. **No required form fields** in the happy path.
5. **Canonical port `10260`** for both Quick Start and manual connections.
   The manual wizard's hardcoded `10255` (in `PromptConnectionTypeStep.ts`
   and `PromptPortStep.ts`) must be fixed before Quick Start ships.
6. **No nag toasts.** Updates and warnings stay in the tree description.
7. **Uninstalling the extension does not remove the container.**
8. **Docker-first, OCI later.** v1 targets Docker. Podman/OCI follow-up
   issues are tracked separately.

---

## 14. Telemetry

```
quickstart.review_shown          source=tree|menu|command|welcome
quickstart.docker_readiness      result=ok|cli_missing|daemon_stopped|...
quickstart.start_begin           source=...
quickstart.start_stage           stage=pull|create|start|connect
                                 duration_ms, success=bool
quickstart.start_end             result=success|cancelled|failed
                                 elapsed_ms, port_fallback=bool
                                 image_resolved_version=semver|unknown
quickstart.lifecycle             action=start|stop|restart|delete
                                 duration_ms, success=bool
quickstart.error                 stage=..., reason=...
quickstart.dismiss_welcome       from=welcome_view|empty_state
```

Never send: container names, image tags, registry URLs, hostnames, ports,
credentials, or image digests.

---

## 15. Scope split

### v1.0 (must ship)

- Quick Start webview (review, progress, success, Docker diagnosis)
- Pull / create / start / readiness / connect / reveal
- Tree node with inline cluster (expand to browse)
- Seven lifecycle states + `Missing` badge
- v1.0 actions: Open, Start, Stop, Restart, View Logs, Copy Connection
  String, Copy Password, Delete Container
- Single managed instance (rocket hidden after setup)
- Port fallback with random port band
- Credentials via `--env-file`
- Docker labels for recognition
- Legacy migration of existing emulator connections
- TLS exception in regular connection wizard (gated)
- Polling-only multi-window coordination
- Basic Docker readiness (CLI present + daemon reachable + generic
  troubleshooting link)
- Connection edit dialog (needed for TLS exception on non-gated hosts)

### v1.1 (deferred)

- Adopt-existing-container flow
- Update Image with version/digest diff
- Move to a different port
- Reset (drop data + credentials)
- Categorized Docker readiness (Apple Silicon, WSL2, sudo group,
  proxy, Windows engine, etc.)
- Docker event subscription (replaces polling)
- Remote VS Code banner (SSH / WSL / dev container)
- Load Sample Data (if not bundled in v1.0)
- Multiple managed instances
- OCI/podman support
- View Logs + tracing integration

---

## 16. Webview implementation notes

The Quick Start webview follows existing extension patterns:

- **tRPC router** — same pattern as CollectionView/DocumentView.
  Procedures: `getDockerStatus`, `startQuickStart`, `cancelQuickStart`,
  `getInstanceState`, etc.
- **React + FluentUI v9** — card-based layout using the same component
  vocabulary as the query insights tab (`Card`, `Text`, `Badge`,
  `Button`, responsive grid with CSS grid/flexbox).
- **Design reference**: the query insights tab's `metricsRow` (4 metric
  cards in responsive grid), `SummaryCard` (2-column data grid), and
  `AnimatedCardList` (step transitions) are the closest starting points.
- **Modal webview** — the VS Code API is expected to support modal
  webviews in the future. Once available, the Quick Start webview should
  use it. Until then, it opens as a regular editor tab.

---

## 17. Open questions

1. **Persistent volume naming.** Should the user-chosen alias in Advanced
   be reflected in the volume name? Pro: discoverable in `docker volume ls`.
   Con: renaming breaks the link.
2. **Self-signed cert trust.** Long term, the image's local CA could be
   auto-trusted in Node's trust store. Out of scope for v1.
3. **Welcome card scope.** Show only when `DocumentDB Local - Quick Start`
   is empty, or when the entire Connections view is empty?
