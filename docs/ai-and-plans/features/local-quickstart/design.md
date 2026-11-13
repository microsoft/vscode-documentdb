---
feature: local-quickstart
kind: design
status: active
created: 2026-06-09
code:
    - src/commands/localQuickStart/**
    - src/services/localQuickStart/**
    - src/tree/connections-view/LocalQuickStart/**
    - src/webviews/documentdb/localQuickStart/**
verified: 2026-08-14
---

# Local Quick Start — Revised Design (Iteration 2)

> **Supersedes:** [Iteration 1](./design-iteration-1.md) — kept as reference
> for original rationale and edge-case analysis.
>
> **What changed:** Simplified tree architecture, removed dedicated local
> connection subtree, moved container creation to a webview, unified TLS
> exception handling into the regular connection wizard.
>
> **Scope:** UX design and architecture. Not an implementation plan.
>
> **Docker readiness update:** The provider-neutral behavior in
> [docker-readiness-implementation-plan.md](./iterations/04-ui-redesign/docker-readiness-implementation-plan.md)
> supersedes the Docker Desktop-only examples in this historical design. Docker
> Engine and Docker Desktop are supported providers; the prerequisite is a Docker
> or Podman CLI that can reach a Linux-container daemon from the extension host.
>
> **Approved engine behavior (2026-11-10):**
> [iteration 12](./iterations/12-preferred-engine-and-podman-start.md) specifies a first-row,
> check-free Container engine preference in Configure. A fresh form defaults to Docker and does
> not persist the preference. Execution detects both CLIs, uses the preferred one if its CLI is
> installed, and falls back to the other only when that CLI is missing and the other is installed,
> not when its engine is stopped.
> Instances record their owning engine, which remains fixed for lifecycle and recreation, including
> Start fresh; legacy records are resolved only during execution. Podman runs neither read nor write
> provider memory and ignore Docker evidence, while Docker's existing provider-memory behavior is
> unchanged. On macOS and Windows, an explicit Podman machine start is available only for a stopped
> default machine or the sole machine. Initialization and ambiguous selection remain manual; Linux
> and WSL get copy-only guidance chosen from the address in Podman's error (decision 0012), an
> unreachable remote Podman host gets no start action, and remote sessions do not start a local engine.
> This approved design supersedes the older Docker-only assumptions below. Iteration 12 records
> implementation phases and source provenance; the code remains authoritative for runtime behavior.

---

## 1. One-sentence goal

From an empty machine with a supported container engine to an open local DocumentDB connection,
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
| Container runtime                  | Docker-specific                                                     | Docker-first in iteration 2; superseded by the approved engine preference above.      |

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
5. Keep the old `ConnectionType.Emulators` storage zone for one release as
   a deprecated, read-only rollback path; remove it in a follow-up release.
   Do **not** delete it in the same release that performs the migration, so
   a migration bug can never orphan a user's existing local connections.
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
|                                                                      |
|  │  • Start the Docker service or identified provider            │  |
|  │  • Check the active Docker context or endpoint                 │  |
|  │                                                                │  |
|  │  [ Start Docker (when available) ]  [ Troubleshooting ]       │  |
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

After **Start DocumentDB Local** (or **Recreate container**), Set up shows five stages: checking the
container engine, **Preparing image**, creating and starting the container, and waiting for DocumentDB to accept connections.
Command output is available through **View setup log**.

For data-preserving recreation, Configure is titled **Configure recreation**, with a **Saved image**
row and **Recreate container** primary action; the in-progress heading describes recreation.
The address, recorded engine and credential summaries remain available, as does Start fresh.
Only a recorded image digest supports the explanation that the exact recorded image is used rather
than a newer image. A tag-only record explicitly lacks original image identity.
Execution reuses an available local image without pulling. If a pinned image is unavailable, it
pulls that exact digest; a missing legacy tag with an existing volume blocks setup instead of
silently upgrading the data. The settled image summary and its Details distinguish saved-image
reuse, exact-image download and legacy local-image reuse, without claiming a tag is up to date.

Both Set up and Done enable the shared StatusList row highlight for pointer hover and
keyboard-visible focus, including its high-contrast outline and reduced-motion behavior.

A settled row with facts offers **Details** alongside a concise factual summary. It starts collapsed
and shows available evidence, not step durations. Every stage reserves one summary line while pending
or active, so adding its summary does not move the following rows. Longer content can still wrap
naturally in narrow panels. Checking reports PATH presence for both CLI
executables but probes only the selected engine; its Details omit explanatory notes. Long image
and container IDs are shortened visually and their full values are available via mouse and keyboard
tooltips. An updated image includes its previous ID when already known. While pulling, one summary
line initially shows the known image and origin; the latest bounded engine output replaces it once
available. This active line never wraps: long text is ellipsized visually, with the full value in its
title and the setup log. It reports literal activity, not an estimated completion percentage.
A failed stage does not expand automatically: the
explanation and recovery actions remain visible in the message block below the list. The checking
row retains its last-checked time and re-check action; its Details replaces the old Docker-check
accordion. See [0008](./decisions.md#0008---set-up-stages-expand-to-show-what-each-stage-did).

The main stage labels and status icons retain their existing typography. Everything ordinary below
them uses one proportional UI font at base200 (12 px, 16 px line height), regular weight. Summaries,
fact labels and values share the primary foreground; ports, names and identifiers do not switch to
monospace. Links retain their interaction colour and focus styling but use the same text size.
Only supplementary context uses the theme's description foreground, with a secondary-foreground
fallback. Important qualifications such as a port shown "As requested" remain primary text.
Severity messages retain their semantic emphasis. These are Local Quick Start overrides; the shared
StatusList defaults and other consumers, including Diagnose connection, are unchanged.

### 5.5 Webview: Success

On readiness success, Done retains the five completed rows and their Details, followed by the
success message and next steps. **Open Connection** reveals the managed cluster in the tree. If
requested sample data was not loaded, the success message says so and the waiting row's Details
provides an informational message and a link to the setup log.

The title stays **DocumentDB Local is ready** on every path. A successful recreation uses the
existing success message block with the heading **Container recreated**, not a separate panel.
The summary confirms that DocumentDB is running with the existing data volume and credentials,
and states whether the saved image was reused, its exact digest was downloaded, or a legacy local
image was used. The DocumentDB version is shown only when reported by the readiness probe's server
response (`documentdbVersions`), never inferred from an image label. This is not a verification of
data contents. Actual volume reuse from the creating-stage facts determines this summary, not the
initial Configure mode: if the volume was gone, fresh-setup messaging remains. **View setup log**,
**Open Connection**, **Close**, the next steps and all stage Details remain available.

### 5.6 Cancel rules

| Cancelled during        | Rollback behavior                                                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Pull                    | Abort pull, no container created                                                                                                       |
| Create                  | Remove partially created container                                                                                                     |
| Start (first run)       | Stop and remove container, release port                                                                                                |
| Waiting for readiness   | Stop and remove container, surface last connection error                                                                               |
| Starting (existing row) | Non-destructive: let the in-flight `docker start` finish and leave the instance Running. Cancel only detaches the UI from the spinner. |
| Stopping (existing row) | Non-destructive: let the in-flight `docker stop` finish; the instance lands in Stopped. Cancel never aborts the stop.                  |

The first four rows are the **Provisioning** path, where destructive
rollback is safe because the instance is not yet established. The last two
are the lifecycle **Starting** / **Stopping** transitions of an
already-provisioned instance: there, Cancel is non-destructive — it
detaches the UI from a transition Docker will complete anyway, and never
deletes the container or its data.

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
  container, and its data volume still exists. Shows
  `Missing · click to recreate`. Available actions on a
  `Missing` instance: **Quick Start** (recreate the container, reusing the
  stored credentials and data volume if present) and
  **Delete Container...** (clear the stale metadata). No other lifecycle
  actions apply. With the volume gone too, the instance shows as not set
  up (NotInstalled) instead, and setup creates a new one.
- **`UpdateAvailable`** _(v1.2)_ — newer image detected. Shows
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

- Loopback: `localhost`, `127.0.0.0/8`, `::1`, `*.localhost`
- IPv4 private ranges (RFC 1918):
  - `10.0.0.0/8`
  - `172.16.0.0/12`
  - `192.168.0.0/16`
- IPv4 link-local: `169.254.0.0/16`
- IPv6 unique-local and link-local: `fc00::/7`, `fe80::/10`
- Single-word hostnames (no dots): `home`, `devbox`, etc.
- `*.local` mDNS names

All other hosts: no TLS exception step shown.

> **Caveat — `.local` and single-word hosts can be corporate infra.**
> Many corporate Active Directory domains use a `.local` suffix (e.g.
> `db.corp.local`), and single-word names can resolve to real internal
> servers via DNS search domains. These are **not** the "self-signed is
> expected" case. The gate therefore only decides whether to **offer** the
> step; the step itself always **defaults to Enable TLS** (§7.2), and its
> copy warns when the host may be a managed internal host rather than the
> developer's own machine.

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

Generated passwords must be safe to embed in a connection string. Apply
**both** defenses (belt-and-suspenders), never just one:

1. **Generate from a curated safe alphabet** — `[A-Za-z0-9]` plus a small
   set of unambiguous, URL-safe symbols. Never emit characters that have
   meaning in a URI (`@ : / ? # [ ] %`).
2. **Percent-encode at composition time** — always `encodeURIComponent`
   the username and password when building the connection string, even
   though step 1 should make this a no-op. Relying on the alphabet alone is
   fragile: a future change to the generator, or a user-supplied password
   from the Advanced panel, can reintroduce unsafe characters.

The same encoding rule applies to any user-entered credentials in the
Advanced panel and to the migrated legacy connections (§4).

### 8.2 Credential transport

Credentials are passed to the container via a temporary `--env-file`
(written to `os.tmpdir()`, deleted in a `finally` block). This keeps
passwords out of `ps -ef`, shell history, and process audit logs.

Note: the password is still visible inside the container runtime
environment (`docker inspect`, `docker exec env`) to anyone with Docker
access on the host. This matches the trust boundary the user accepts by
running Docker locally.

### 8.3 Port fallback

Fallback applies **only to the default port** (one the user did not choose):

1. Try `10260`.
2. If busy, try up to 10 random ports in `[10260, 10360)`.
3. If still no free port, show `Change port...` dialog.

When a fallback is used, the webview shows a yellow banner:

```
⚠ Port 10260 is in use. We'll use port 10273 instead.
  [ Change port... ]   [ Use 10273 ]
```

**Explicit ports are never silently relocated.** If the user sets a port in
Advanced and it is busy, surface an error and let them change it — do not
move them to a different port behind their back. (This matches the
PostgreSQL reference, which only auto-allocates when the port field is left
blank or invalid.)

**Use the actually-bound port, not the requested one.** After the container
starts, read the bound host port back from `docker inspect`
(`NetworkSettings.Ports`) and use _that_ value when composing and saving the
connection string. The requested and bound ports can differ (a race between
the free-port check and the bind), so the inspected value is the source of
truth.

### 8.4 Container initialization and seed data

Quick Start uses the image's bundled `init_documentdb_data.sh` and
`sample-data` directory. It runs the script through `docker exec` after the
authenticated wire-protocol readiness probe succeeds, and waits for it
before marking setup complete.

- **Seed sample data** is enabled by default and can be disabled in
  Configure. Seeding runs only for a newly created data volume. A recreate
  that reuses a volume skips seeding, even if its sample database or documents
  were deleted. This preserves user changes regardless of the sample database
  name used by the image.
- The script connects to the container's internal port `10260`, independent
  of the host port selected in Configure.
- Image `0.116.0` removed the script's `-p` / `--password` argument.
  Quick Start passes `DOCUMENTDB_PASSWORD="$PASSWORD"` in the container's
  shell instead. The value comes from the credentials supplied at creation
  through `--env-file`; it is not placed on the host command line.
- Quick Start detects environment-password support from the script's
  `--help` output. Older image-tag overrides retain the legacy `-p`
  invocation. A failed help command stops seeding; an initialization
  failure is never retried with another password interface.
- Quick Start does not set `--init-data true` on the container. Older image
  versions rerun that flag on restart and fail on duplicate sample keys.
  Post-readiness seeding keeps those restarts safe.
- A seed failure is logged in **DocumentDB Local Setup** and remains
  non-fatal: the ready database can still be used without sample data.

The previously described custom init-folder mounting and separate
success-card load action are not implemented by Quick Start.

---

## 9. Prereq checks

Run before showing the Review & Start webview. Results populate the
metric cards.

| Check                    | Scope | Pass                     | Fail                        |
| ------------------------ | ----- | ------------------------ | --------------------------- |
| Docker CLI on PATH       | v1.0  | ✅ Found (version shown) | ❌ "Install Docker" link    |
| Docker daemon reachable  | v1.0  | ✅ Ready                 | ❌ Provider-aware recovery  |
| Port available           | v1.0  | ✅ Free                  | ⚠️ Fallback port (see §8.3) |
| Platform supported       | v1.0  | ✅ amd64/arm64           | ⚠️ "Use x86_64 emulation?"  |
| Image registry reachable | v1.2  | ✅ OK                    | ⚠️ "Check proxy settings"   |

v1.0 ships the same minimal readiness the PostgreSQL reference ships (CLI
present + daemon reachable + a generic troubleshooting link, §15) plus two
cheap local checks — port-free and platform. The categorized
registry/proxy/Apple-Silicon diagnosis is v1.2.

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

Before any image pull or container creation, Quick Start validates **both**
identifiers up front (matching the PostgreSQL reference, which refuses on a
duplicate of either): the **connection/cluster name** in the Connections
view and the **container name** in Docker. A duplicate connection name is
rejected with an inline error before any Docker work; a container-name
collision is resolved as follows.

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

| Verb                         | Container       | Data volume | Credentials | Tree row       |
| ---------------------------- | --------------- | ----------- | ----------- | -------------- |
| **Start**                    | Starts existing | Unchanged   | Unchanged   | → Running      |
| **Stop**                     | Stops           | Unchanged   | Unchanged   | → Stopped      |
| **Restart**                  | Stop + start    | Unchanged   | Unchanged   | → Running      |
| **Delete Container...**      | Removed         | **Dropped** | **Dropped** | → NotInstalled |
| **Update Image...** _(v1.2)_ | Recreated       | Kept        | Kept        | → Running      |
| **Move Port...** _(v1.2)_    | Recreated       | Kept        | Kept        | → Running      |
| **Reset...** _(v1.2)_        | Removed         | **Dropped** | **Dropped** | → NotInstalled |

Confirmations:

- Stop / Restart: none (reversible)
- Delete Container: one-line confirm
- Reset: two-step confirm, user must type container alias

---

## 12. Multi-window coordination

The container is shared machine state. No window "owns" it.

- v1: **polling only** (on activation, on view refresh, on overflow-menu
  open). Docker event subscription deferred to v1.2.
- Destructive actions re-check live state before executing.
- If state changed, show: "The instance is now Stopping (from another
  window). Action is no longer available."

---

## 13. Cross-cutting rules

1. **Opt-in only.** Never install a container engine, never start one silently,
   never modify containers the extension didn't create.
2. **Explicit engine start.** Start actions require a user click. Offer
   **Start Podman machine** only on macOS or Windows when a stopped default
   machine or the sole machine is identified. Never start a root-managed
   service or use elevation.
3. **No background pulls.** Image pulled only inside user-initiated flows.
4. **No required form fields** in the happy path.
5. **Canonical port `10260`** for both Quick Start and manual connections.
   The manual wizard's hardcoded `10255` (in `PromptConnectionTypeStep.ts`
   and `PromptPortStep.ts`) must be fixed before Quick Start ships.
6. **No nag toasts.** Updates and warnings stay in the tree description.
7. **Uninstalling the extension does not remove the container.**
8. **Docker and Podman are supported.** Configure presents a nonpersisted
   preference, defaulting to Docker for a fresh form. Execution detects both
   CLIs and falls back to the other only when the preferred CLI is missing and
   the other is installed. The container
   runtime is accessed through **`@microsoft/vscode-container-client`** — the
   Microsoft-maintained library the PostgreSQL extension uses, which ships
   both a `DockerClient` and a `PodmanClient` behind one interface (with
   mount/label/platform/port argument helpers).
9. **No dependency on the Docker VS Code extension.** Quick Start manages
   the container itself, in-tree. The Docker extension is optional and
   aimed at advanced users; a hard dependency would break the zero-friction
   goal and contradicts going beyond Docker. (Reviewer request to evaluate
   reuse — decided out of scope.)
10. **Attach stays first-class.** Any locally reachable container —
    including a retained test container — can be connected to through the
    regular new-connection wizard at its `localhost:<port>`; Quick Start
    does not need to own it. Auto-discovery of unmanaged DocumentDB
    containers is a v1.2 item.

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
quickstart.report_issue          stage=..., from=error_state|readiness_timeout
```

Never send: container names, raw image tags, registry URLs, hostnames,
ports, credentials, or image digests. The **resolved semantic version**
(`image_resolved_version`, e.g. `1.2.3`) is the one allowed image
identifier — it is needed to correlate "version X has a bug" reports and is
not user-identifying, unlike a raw tag string or digest.

**Wizard journey, as implemented (#979).** The names above are the original plan. Each wizard panel
gets a `quickStartSessionId` from the open command, and every event the panel produces carries it:

- The `localQuickStart.open` command: `activationSource` (the tree row, notification, deep link,
  or `commandPalette` that opened it), `instanceState`, `initialStep`.
- `documentDB.quickstart.wizard.step`, one per phase change: `fromStep`, `toStep`, `trigger`
  (`next`, `back`, `stepper`, `startSetup`, `continueAnyway`, `cancel`, `waitLonger`, `startOver`,
  or `auto` for a setup result), `instanceState`; measurements `timeOnFromStepMs`, `stepChangeIndex`.
- `documentDB.quickstart.wizard.close`, where the journey ended: `initialStep`, `lastStep`,
  `closeReason` (`closeButton` or `panelClosed`), `setupSucceeded`, `instanceState`; measurements
  `sessionDurationMs`, `timeOnLastStepMs`, `stepChangeCount`, `setupAttemptCount`, `waitLongerCount`.
- The panel's `documentDB.rpc.*` procedure events carry `wizardStep` as well. `startQuickStart` also
  carries the per-run `provisionCorrelationId` that links it to `documentDB.quickstart.provision` and
  its stage events.
- Credential recovery (`documentDB.quickstart.reconcile` and related properties): see
  [decision 0005](./decisions.md#0005---restore-missing-credentials-from-the-managed-container).
  The managed-instance `connect` event wraps client acquisition, including when adoption already
  cached the credentials. Its `credentialsRestored` flag survives reconciliation of the same
  credentials within the extension-host session; replaced credentials, completed setup, and Delete
  clear it. Existing generic tree failure diagnostics remain separate from this managed-instance
  connection event.

---

## 15. Scope split

This section records the original proposed scope, not the current setup and success behavior in
§§5.4–5.5.

### v1.0 (must ship)

- Quick Start webview (review, success, Docker diagnosis); create progress
  is terminal-first (spinner + inline error), not an in-webview step list
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
- Docker readiness: CLI present + daemon reachable + port-free + platform
  supported, plus a generic troubleshooting link (categorized
  registry/proxy/Apple-Silicon diagnosis is v1.2; see §9)
- Connection edit dialog (needed for TLS exception on non-gated hosts)
- Container initialization via the image's init-script convention (§8.4)

### v1.1 (prefer to ship)

- Goal: ship v1.1 with meaningful but lightweight webview progress
  visibility
- Lightweight in-webview stage progress notification while create/start is
  running (for example: current stage + completed stages + failure stage),
  without full per-stage percentages or per-step inline retry controls
- Keep terminal-first transparency: integrated terminal remains the source
  of detailed Docker command output
- Maintain v1.0 constraints for simplicity: no `docker pull` percentage
  streaming into the webview

### v1.2 (deferred)

- Adopt-existing-container flow
- Update Image with version/digest diff
- Move to a different port
- Reset (drop data + credentials)
- In-webview staged progress card (per-stage percentages + per-step inline
  retry); v1.1 ships lightweight stage notification and v1.0 remains
  terminal-first (§5.4)
- Categorized Docker readiness (Apple Silicon, WSL2, sudo group,
  proxy, Windows engine, etc.)
- Docker event subscription (replaces polling)
- Remote VS Code banner (SSH / WSL / dev container)
- Load Sample Data dataset (if not bundled in v1.0)
- Multiple managed instances (and multiple image versions side by side)
- Auto-discovery of unmanaged / retained test containers (§13 rule 10)
- Report Issue action on Error / readiness timeout — pre-filled GitHub
  issue with sanitized diagnostics (no creds, hostnames, or ports per §14)
- OCI/podman support
- View Logs + tracing integration

---

## 16. Webview implementation notes

These are the original implementation notes; current setup and success behavior is in §§5.4–5.5.

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
- **Flow reference: the PostgreSQL "Local Docker Server" webview.** Its
  shipped flow is the closest working model for ours:
  - A Docker-branded header and a benefits panel (One-Click creation,
    Fully automated setup, Easy management, Code without distractions)
    frame the welcome and form steps.
  - Prereq checks render as a vertical list of expandable status cards
    ("Checking if Docker is installed", "Checking if Docker is running"),
    each backed by a real `docker` command.
  - The actual `docker` commands execute as **VS Code terminal tasks**, so
    their output is visible in the integrated terminal (full transparency)
    while the webview shows friendly step status.
  - When the server is up, the **webview closes automatically** and the
    tree takes over as the control surface.

  Our happy path diverges in one way (§13 rule 4): PostgreSQL's form has
  several required fields; ours has **none** — credentials and names are
  generated, and everything optional lives under Advanced.

- **Container runtime client** — use **`@microsoft/vscode-container-client`**
  (§13.8) instead of hand-rolling `docker` commands, and run each operation
  as a **VS Code terminal task** so the raw commands and output stay visible
  in the integrated terminal (the PostgreSQL-proven model).
- **v1.0 progress is terminal-first** — the webview shows a spinner + inline
  error (with **Retry**); lightweight stage progress notification is the
  v1.1 target, while the staged in-webview progress card (§5.4) remains a
  v1.2 enrichment, avoiding `docker pull` percentage streaming into the
  webview for v1.0/v1.1.

---

## 17. Open questions

1. **Persistent volume naming.** Should the user-chosen alias in Advanced
   be reflected in the volume name? Pro: discoverable in `docker volume ls`.
   Con: renaming breaks the link. **Leaning:** keep a stable, alias-derived
   name fixed at creation and never rename it on a later alias change, so
   the container↔volume link cannot break.
2. **Self-signed cert trust.** Long term, the image's local CA could be
   auto-trusted in Node's trust store. Out of scope for v1.
3. **Welcome card scope.** Show only when `DocumentDB Local - Quick Start`
   is empty, or when the entire Connections view is empty? **Leaning:**
   scope to the empty Quick Start section, and store the dismissal in a
   user **Setting** (e.g. `documentdb.quickStart.welcomeDismissed`) rather
   than `globalState`, which is wiped on uninstall/reinstall.

---

## 18. Review resolutions (iteration 2)

These review resolutions are historical; current setup and success behavior is in §§5.4–5.5.

This revision folds in the PR review feedback (notably @xgerman's
comments), the design intent shown in @tnaum-ms's prototype screenshots,
and the gaps surfaced in design review. Each row links a comment to where
it is resolved.

| Source / finding                                             | Resolution                                                                                                                                          | Section         |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| OCI / podman / Apple containers (xgerman)                    | Docker-first for v1; runtime behind a thin abstraction so an OCI driver is a later swap; follow-up issues tracked                                   | §2, §13.8       |
| Platform / CPU not supported (xgerman, Azure emulator #254)  | Platform prereq check with the unsupported-CPU reference                                                                                            | §9              |
| URL-encode generated passwords (xgerman)                     | Belt-and-suspenders: safe alphabet **and** percent-encode at composition; applies to Advanced + migrated creds                                      | §8.1            |
| Check a custom (Advanced) port is free (xgerman)             | "Port available" prereq check + fallback band                                                                                                       | §8.3, §9        |
| Reuse the Docker VS Code extension? (xgerman)                | Out of scope — no hard dependency; in-tree management only                                                                                          | §13.9           |
| View logs + tracing (xgerman)                                | Deferred to v1.2                                                                                                                                    | §15             |
| Connect to a retained test container (xgerman)               | Attach via the regular wizard at `localhost:<port>`; auto-discovery is v1.2                                                                         | §13.10, §15     |
| Manage multiple containers / versions / other DBs (xgerman)  | Single instance in v1; labels keep the model forward-compatible; multi-instance + multi-version are v1.2                                            | §10.1, §15      |
| Container initialization & init-script dev (xgerman)         | Use the image's standard init-script convention; Seed = a bundled init script; Advanced can mount a local scripts folder                            | §8.4            |
| New image available — notify or auto-update? (xgerman)       | Notify only via the `UpdateAvailable` badge; never auto-update (no-surprises rule)                                                                  | §6.1, §11       |
| Help file a DocumentDB issue on failure (xgerman)            | Report Issue action (pre-filled, sanitized) on Error / readiness timeout — v1.2                                                                     | §14, §15        |
| Progress location / webview lifetime (screenshots, tnaum-ms) | Heavy work runs as terminal tasks (transparency); webview auto-closes on success; tree takes over                                                   | §5.4, §5.5, §16 |
| TLS gate over-matched local/private hosts (gap)              | Tightened ranges (added IPv6 ULA/link-local, IPv4 link-local, loopback block); `.local`/single-word only _offer_ the step and default to Enable TLS | §7.1, §7.2      |
| Cancel undefined for Starting/Stopping (gap)                 | Defined as non-destructive for already-provisioned instances                                                                                        | §5.6            |
| Legacy storage deleted in the migration release (gap)        | Retain the old zone read-only for one release as a rollback path                                                                                    | §4              |
| `Missing` badge actions undefined (gap)                      | Specified: Quick Start (recreate) and Delete Container (clear metadata)                                                                             | §6.1            |
| `Load Sample Data` shown but is v1.2 (gap)                   | Rendered disabled with "Coming soon" until a dataset ships                                                                                          | §5.5, §15       |
| Telemetry: version-vs-tag tension (gap)                      | Resolved semantic version is allowed; raw tags and digests are not                                                                                  | §14             |

### 18.1 PostgreSQL source-benchmark learnings

The design was benchmarked against the PostgreSQL extension's "Local Docker
Server" flow (`ms-ossdata.vscode-pgsql`, read at the source level). Changes
folded in from that study:

| Learning from the reference                                                                           | Change                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runs container work as terminal tasks with **no in-webview progress**; webview auto-closes on success | v1.0 create progress is terminal-first (spinner + inline error); lightweight stage notification is v1.1, and the staged card is v1.2 — §5.4, §15, §16 |
| Uses **`@microsoft/vscode-container-client`** (`DockerClient` + `PodmanClient`)                       | Adopt the same library instead of a hand-rolled abstraction — §13.8, §16                                                                              |
| Auto-allocates a port **only when the field is blank/invalid**; never relocates an explicit user port | Fallback applies to the default port only; explicit Advanced ports error instead of moving — §8.3                                                     |
| Reads the bound port from `docker inspect`                                                            | Use the inspected bound port when composing the connection string — §8.3                                                                              |
| Distinguishes **failed-to-create vs failed-to-start** after a failed run                              | Same distinction in error copy — §5.4                                                                                                                 |
| Checks duplicate **connection name and container name** before side effects                           | Validate both up front — §10.2                                                                                                                        |
| Ships only CLI + daemon prereqs                                                                       | v1.0 prereqs labeled (CLI/daemon/port/platform); registry/proxy diagnosis is v1.2 — §9, §15                                                           |
| (Kept **better in v2**)                                                                               | Zero required fields, persistent volume, 60 s wire-protocol readiness, full lifecycle, labels+adopt, stricter telemetry                               |

A reviewer-facing decision note for this PR lives at
[`../PRs/653-local-quickstart-design/description.md`](./iterations/01-initial-design.md).
