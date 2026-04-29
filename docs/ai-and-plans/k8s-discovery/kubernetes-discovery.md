# Kubernetes Service Discovery — Complete UX Reference

> **What this is:** A user-facing summary of every interaction the Kubernetes
> Service Discovery feature exposes today. ASCII flows show what the user sees
> at each step. Use this for design review, smoke testing, and onboarding.
>
> **Audience:** Maintainers, reviewers, QA.
>
> **Companion plans (implementation detail):**
> `1-copy-connection-string-with-password.md`, `2-kubeconfig-multi-source-tree.md`,
> `3-context-aliases.md`.

---

## 1. What the user can do

The Kubernetes Service Discovery feature lets users find DocumentDB-compatible
targets running inside any Kubernetes cluster (AKS, EKS, GKE, OpenShift, kind,
minikube, k3s, k3d, Docker Desktop, Rancher) without leaving VS Code.

Key capabilities:

- **Browse** kubeconfig sources -> contexts -> namespaces -> services in a
  single tree, then expand a service to see databases and collections.
- **Connect** through the New Connection wizard: pick context, pick service,
  save the connection.
- **Manage multiple kubeconfigs** at once (default + custom files + pasted
  YAML), with checkbox visibility and individual refresh / rename / remove.
- **Rename a context** with a friendly display alias (the kubeconfig file is
  never touched).
- **Auto port-forward** for `ClusterIP` services and **auto-credentials** from
  DKO `dbs` resources or annotated Secrets.
- **Reconnect** saved K8s connections later — the tunnel restarts on its own.

Discovery picks targets in this order:

1. **DKO `dbs` resources** (`documentdb.io/preview`).
2. **Services explicitly opted in** via the annotation or label
   `documentdb.vscode.extension/discovery: "true"`.
3. **TCP services exposing a known DocumentDB API port** (`27017`, `27018`,
   `27019`, `10260`).

---

## 2. Entry-point map

```
+------------------ DocumentDB activity bar ------------------+
|                                                             |
|  Service Discovery view             Connections view        |
|         |                                  |                |
|         v                                  v                |
|  [+] Add provider          New Connection -> Service        |
|     -> "Kubernetes"        Discovery -> "Kubernetes"        |
|         |                                  |                |
|         v                                  v                |
|   v Kubernetes (root)              Wizard:                  |
|     v Default kubeconfig             1) Select context      |
|     v ...other sources               2) Select service      |
|     v Pasted YAML 1                Saved connection         |
|         |                          appears in Connections   |
|     +---+ right-click /            view; tunnel             |
|     |   inline icons +/key         auto-restarts on later   |
|     v                              clicks                   |
|     +-------------------------------+                       |
|     | Manage / Add / Rename /       |                       |
|     | Remove / Refresh source,      |                       |
|     | Rename context (alias)        |                       |
|     +-------------------------------+                       |
+-------------------------------------------------------------+
```

Both entry points share the same persisted state — adding a kubeconfig source
in the tree makes it available in the wizard and vice versa.

---

## 3. Tree shape

```
v Discovery
  v Kubernetes                                       <-- root
    v Default kubeconfig (~/.kube/config)            <-- source
      v Prod AKS (my-context) (AKS / eastus)         <-- context, with alias
        v app                "2 DocumentDB targets"  <-- namespace (expandable)
          | > db-primary  [DKO]     [ClusterIP :27017]
          | > db-replica  [Generic] [LoadBalancer :27017]
        | > kube-system    "No DocumentDB targets"   <-- namespace (leaf)
      v another-context (gke-prod-1)
        ...
    v team.yaml                                      <-- file source
      v dev-cluster
        ...
    v Pasted YAML 1                                  <-- inline source
      v kind-local (kind)
        ...
```

Per-row glossary:

| Node | Label | Description | Icon |
| --- | --- | --- | --- |
| Root | "Kubernetes" | n/a | `symbol-namespace` |
| Source — default | label (default `Default kubeconfig`) | `(KUBECONFIG or ~/.kube/config)` | `key` |
| Source — file | filename or user label | `(file: shortened/path)` | `file` |
| Source — inline | `Pasted YAML N` or user label | `(pasted YAML)` | `clippy` |
| Context (no alias) | original context name | `(provider/region or host)` | `server` |
| Context (with alias) | alias | `(originalName) (provider/region or host)` | `server` |
| Namespace (with targets) | namespace name | `N DocumentDB target(s)` | `archive` |
| Namespace (no targets) | namespace name | `No DocumentDB targets` | `archive` (leaf) |
| Service (DKO) | display name | `[DKO] [<type> :port]` | `server-environment` |
| Service (Generic) | service name | `[Generic] [<type> :port]` | `server-environment` |

Inside a service node, the standard cluster experience takes over: databases
and collections appear underneath after authentication.

---

## 4. Action matrix

`✓` = action exposed for that node type. The right-most column shows where
the action shows up: `[+]`/`[key]`/`[refresh]`/`[edit]`/`[trash]` are inline
icons on hover; everything else is in the right-click menu.

| Action | Root | Source | Context | Namespace | Service | UI affordance |
| --- | --- | --- | --- | --- | --- | --- |
| Refresh | ✓ | ✓ | ✓ | ✓ | ✓ | inline `[refresh]` + right-click |
| Manage kubeconfig sources | ✓ |  |  |  |  | inline `[key]` + right-click |
| Add kubeconfig source | ✓ |  |  |  |  | inline `[+]` + right-click |
| Learn More | ✓ |  |  |  |  | inline + right-click |
| Rename Kubeconfig Source... | | ✓ |  |  |  | inline `[edit]` + right-click |
| Remove Kubeconfig Source | | ✓ |  |  |  | inline `[trash]` + right-click |
| **Rename Context...** | |  | ✓ |  |  | right-click |
| Add to Connections... | |  |  |  | ✓ | right-click |
| Copy Connection String... | |  |  |  | ✓ | right-click |
| Open Database / Collection | |  |  |  | (children) | expand |

The Default source supports the same Rename / Remove right-click actions as
custom sources. If the user removes the Default source, they can re-add it
through `[+] -> Default kubeconfig` (the same id is reused so any pre-v2
saved connection that referenced it still works).

---

## 5. First-time setup

```
[+] Add discovery provider                  Discovery view
        |                                     v Discovery
        v                                       v Kubernetes              <-- new
  Provider quick pick                             v Default kubeconfig
  +--------------------+   pick "Kubernetes"        | (KUBECONFIG or ~/.kube/config)
  | (...other...)      |---------------------->     |
  | Kubernetes         |                            |
  +--------------------+
                                  +-------------------------+
                                  | No prompts, no wizard.  |
                                  | Default source is       |
                                  | seeded automatically.   |
                                  +-------------------------+
```

The very first expansion of `Kubernetes` shows a single Default source. The
user is **not** asked to choose a kubeconfig source up front — the platform
default is used until the user explicitly adds another source.

---

## 6. Source lifecycle

### 6.1 Add a kubeconfig source

```
Click [+] inline icon on the Kubernetes root node
                  |
                  v
+------------------------------------------------+
| Quick pick: "Add a kubeconfig source"          |
|   Default kubeconfig (~/.kube/config)          |
|   Add custom kubeconfig file...                |
|   Paste kubeconfig YAML from clipboard         |
+----------------------+-------------------------+
                       |
   +-------------------+-----------------------+
   |                   |                       |
[default]      [custom file]               [inline]
   |                   |                       |
   |        File-open dialog            Read clipboard text
   |                   |                       |
   v                   v                       v
Validate kubeconfig (loads the file, lists contexts)
   |                   |                       |
   | broken? warn      | broken? error toast,  | empty / invalid?
   | + persist anyway  |   abort               |   error toast, abort
   v                   v                       v
Default source     New file source         New inline source
appears in tree    appears (label =        (label = "Pasted YAML N")
                   filename, dedup by      stored in Secret Storage,
                   absolute path)          dedup by YAML hash
```

Highlights:

- **Default branch is lenient** — it persists even when the kubeconfig is
  unreadable, so the user can fix the file later without re-running the add.
- **File and inline branches are strict** — a broken kubeconfig surfaces an
  error and aborts the add.
- **Re-adds dedupe**. Adding the same path twice or pasting identical YAML
  surfaces an info message and reuses the existing entry.
- **Inline YAML is encrypted at rest** — it lives in VS Code Secret Storage;
  the tooltip never shows the YAML contents.

### 6.2 Manage kubeconfig sources (visibility + remove)

```
Click [key] inline icon on the Kubernetes root node
                  |
                  v
+----------------------------------------------------+
| QuickPick (multi-select)                           |
| "Manage Kubernetes Kubeconfig Sources"             |
|                                                    |
|  [v] Default kubeconfig    (default)               |  <-- Default has NO trash
|  [v] team.yaml             (file)      [trash]     |
|  [ ] Pasted YAML 1         (pasted)    [trash]     |  <-- unchecked = hidden
|                                                    |
|  Press Enter to apply visibility                   |
+--------------------+-------------------------------+
                     |
       +-------------+-----------+
       |                         |
   Press Enter             Click [trash] on a row
       |                         |
       v                         v
   Save hidden            Modal confirm: "Remove ...?"
   source list,                  |
   refresh tree         +--------+--------+
   (unchecked sources   |                 |
    disappear; recheck  Remove          Cancel
    later to restore)   |                 |
                        v                 v
                Stop tunnels for this   no change
                source ONLY,
                delete record,
                clear aliases,
                refresh picker
```

Highlights:

- Hiding is **non-destructive** — the source record stays around, just
  excluded from the tree until the user re-checks it.
- **Trash is destructive** — it deletes the source record, clears any context
  aliases that referenced it, and stops only that source's tunnels.
- The **Default source has no trash button** in the manage UI. To remove it,
  the user has to use the per-source right-click menu (which makes the
  destructive intent explicit).

### 6.3 Rename a kubeconfig source

```
right-click on a source node -> "Rename Kubeconfig Source..."
                  |
                  v
   InputBox: "Enter a new label..." (defaults to current label)
                  |
   +--------------+--------------+
   |                             |
 Type new label, Enter      Esc / cancel
   |                             |
   v                             v
   Tree label updates;       no change
   the source's id and
   storage are unchanged,
   so saved connections
   keep working
```

Renaming is display-only. The Default source can be renamed just like any
custom one.

### 6.4 Remove a kubeconfig source (per-source right-click)

```
right-click on a source node -> "Remove Kubeconfig Source"
                  |
                  v
+----------------------------------------------------+
| Modal warning                                      |
| "Remove kubeconfig source X?"                      |
| Detail: saved connections that depend on this      |
| source will need to be reconfigured. Active        |
| port-forward tunnels for this source will be       |
| stopped.                                           |
| [Cancel]   [Remove]                                |
+--------------------+-------------------------------+
                     |
            +--------+--------+
            |                 |
         Cancel            Remove
            |                 |
            v                 v
       no change      Stop tunnels for this
                      source ONLY,
                      delete record,
                      clear aliases,
                      refresh tree;
                      output channel logs
                      "Removed ..."
```

### 6.5 Refresh a source

`Refresh` (right-click or inline `[refresh]`) re-loads the kubeconfig and
re-expands the source. Use this after editing the kubeconfig externally
(`kubectl config ...`) to pick up new contexts.

---

## 7. Context aliases (display rename)

### 7.1 Set / change / clear

```
right-click on a context node -> "Rename Context..."
                  |
                  v
+----------------------------------------------------+
| InputBox                                           |
|   Title:   "Rename Kubernetes context"             |
|   Prompt:  Set a display name for "<original>".    |
|            The kubeconfig file is not modified.    |
|            Leave empty to clear the alias.         |
|   Default: current alias (or empty)                |
|   Placeholder: original context name               |
+--------------------+-------------------------------+
                     |
       +-------------+-----------+--------------+
       |                         |              |
   Type "Prod AKS"          Submit empty     Esc / cancel
       |                         |              |
       v                         v              v
   Alias persists;         Alias cleared;   no change
   tree label changes;     label reverts to
   description shows       original name
   "(my-context) ..."
```

### 7.2 Tree appearance with an alias

```
Without alias:
  > my-context           (k8s.example.com:6443)

With alias "Prod AKS":
  > Prod AKS             (my-context) (k8s.example.com:6443)
                          ^^^^^^^^^^
                          original context name kept in parens
                          for unambiguous identification
```

Tooltip always shows both names plus the cluster, server, provider, and region.

### 7.3 Wizard appearance with an alias

```
QuickPick item without alias:
  my-context             (Default kubeconfig) https://k8s.example.com:6443

QuickPick item with alias "Prod AKS":
  Prod AKS               [my-context] (Default kubeconfig) https://k8s...
                         ^^^^^^^^^^^^
                         bracketed original kept in description so
                         users can still grep the picker by real name
```

### 7.4 Lifecycle guarantees

- The kubeconfig file is **never** modified.
- The real context name continues to back saved connections, port-forward
  metadata, telemetry, and output-channel logs. Aliases are display-only.
- Aliases are scoped per `(source, context)` — the same context name in two
  different sources can have different aliases.
- If the underlying context disappears (kubeconfig was edited externally), the
  orphan alias is silently pruned the next time the source is loaded.
- Removing a source clears every alias that referenced it.

---

## 8. New Connection wizard

```
"+ New Connection" -> "Service Discovery" -> "Kubernetes"
                  |
                  v
+--------------------------------------------+
| Step 1: Select Kubernetes context          |
| QuickPick lists ALL contexts from ALL      |
| sources (sorted, alias-aware):             |
|                                            |
|   Prod AKS    [my-context]                 |
|               (Default kubeconfig)         |
|               https://...                  |
|   eks-staging (team.yaml)                  |
|               https://...                  |
|   kind-local  (Pasted YAML 1)              |
|               https://...                  |
+--------------------+-----------------------+
                     |
                     v
+--------------------------------------------+
| Step 2: Select DocumentDB target           |
| QuickPick lists every discovered service   |
| in the chosen context, across namespaces:  |
|                                            |
|   db-primary  [app] [DKO]                  |
|               [ClusterIP :27017]           |
|   my-mongo    [default] [Generic]          |
|               [NodePort :30017]            |
+--------------------+-----------------------+
                     |
                     v
+--------------------------------------------+
| Resolve endpoint and connect:              |
|   - LoadBalancer ready or NodePort with    |
|     external IP -> use directly            |
|   - ClusterIP -> prompt local port,        |
|     start port-forward tunnel              |
|   - LoadBalancer pending / unreachable     |
|     service -> warn and cancel             |
+--------------------+-----------------------+
                     |
                     v
        Auto-resolve credentials
        (DKO Secret or generic
        annotation; otherwise prompt
        the user at connect time)
                     |
                     v
        Saved as a new connection
        in the Connections view, with
        port-forward metadata attached
        when applicable
```

If multiple sources expose the same context name, the source label in the
description disambiguates them. If no sources have any contexts, the wizard
fails fast with a warning that points the user at "Add kubeconfig source...".

---

## 9. Connecting from the Discovery tree

The user can also right-click any service node in the tree and choose
**Add to Connections...**. This skips the wizard but runs the same endpoint
resolution + credential auto-fill + tunnel start. If a connection with the
same port-forward identity already exists, the extension reuses it instead of
creating a duplicate.

Expanding a service in the Discovery tree directly (without saving) also
works: it authenticates and lists databases / collections inline, just like
any saved connection.

---

## 10. Reconnect from the Connections view

```
User clicks a saved K8s-discovered connection
                  |
                  v
   The extension reads its saved port-forward metadata
                  |
        +---------+----------+
        |                    |
   No metadata         Metadata present
   (non-K8s connection)     |
        |                    v
        | normal flow   Restart tunnel using the
        |               saved (sourceId, context,
        |               namespace, service, port)
        |                    |
        |               +----+-----+----------------+
        |               |          |                |
        |             reused    started          externalAssumed
        |             (silent)  (info toast)     (modal confirm:
        |                                         "An external proxy
        v                                          is on this port.
   Authenticate + connect                          Use it?")
                  |
                  v
        Cluster expands with
        databases and collections
```

This is what makes "open the saved K8s connection later" work — even after
a VS Code restart — without forcing the user back through the wizard. If the
source the connection points to has been removed, the reconnect surfaces a
clear error ("Kubeconfig source X was not found...") and the user can re-add
it.

Pre-v2 saved connections lacked a `sourceId` in their metadata; they
automatically fall back to the Default source so existing users do not need
to re-save.

---

## 11. Endpoint resolution UX

```
                  Kubernetes Service
                         |
     +--------+----------+----------+--------------+
     |        |          |          |              |
LoadBalancer  NodePort   ClusterIP  ExternalName   other / no TCP
     |        |          |          |              |
   ingress?   |        prompt      not auto-     unreachable
   /     \    |        local port  resolved        |
  yes    no   |          |          |              |
   |     |   ext.IP/   start /    warn user      warn user;
   v     |   InternalIP reuse tunnel + cancel    + cancel
 ready   |    only        |
        falls  |          v
        back   |    mongodb://127.0.0.1:<localPort>
        to    warn
       NodePort user
        |     |
        +--+--+
           v
  ready: connect direct
```

- **InternalIP-only NodePort** returns ready with a warning banner; the user
  decides whether to proceed.
- **LoadBalancer without ingress** falls back to NodePort behavior when a
  NodePort is available.
- **Tunnels are reused** when the same port is already serving the same
  identity. If a foreign process holds the port, the user is asked whether
  the extension should treat that as "their own" `kubectl port-forward` and
  proceed.

---

## 12. Credential auto-resolution

When the user picks a service for connection (via wizard or "Add to
Connections..."), the extension tries to find credentials automatically:

| Service kind | Where the Secret name comes from | Behavior |
| --- | --- | --- |
| **DKO** | `spec.documentDbCredentialSecret` on the `dbs` resource (defaults to `documentdb-credentials`) | Same-namespace Secret is read for `username` / `password` keys. |
| **Generic / opted-in** | `documentdb.vscode.extension/credential-secret` annotation on the Service | Same-namespace Secret only. |

If credentials are found, NativeAuth is preselected with the username and the
password (the password is masked in telemetry and never embedded in the saved
connection string). If nothing is found, the connection still saves; the user
is prompted for credentials the first time they connect.

---

## 13. Copy Connection String

```
right-click on a service node -> "Copy Connection String..."
                  |
                  v
   The extension resolves credentials (auto-fill or prompt)
                  |
                  v
   Native auth + non-empty password?
                  |
        +---------+--------+
        |                  |
      yes                 no
        |                  |
        v                  v
   QuickPick:          Copy username-only
   "Copy without password" (default)
   "Copy with password"
        |
   +----+----+
   |         |
   +- with    -> mongodb://<user>:<pass>@... (password masked in telemetry)
   +- without -> mongodb://<user>@...
   +- escape  -> nothing copied
```

This prompt fires for both the Connections view and the Kubernetes Discovery
tree. Other discovery providers (Azure RU, Azure VM, Azure vCore) keep their
existing username-only behavior.

---

## 14. Failure / recovery matrix

| Symptom | Where it shows | One-click action |
| --- | --- | --- |
| Default kubeconfig fails to load on Add | Warning toast | Source still added; user fixes file later. |
| Custom file fails to load on Add | Error toast | Source NOT added. |
| Pasted YAML invalid on Add | Error toast | Source NOT added. |
| Source kubeconfig fails to load (later) | Recovery children inside that source node | Remove this source / Open docs / Retry |
| Source has no contexts | Recovery children inside that source node | (same as above) |
| All sources hidden via Manage UI | Warning + "Manage kubeconfig sources..." action under root | Open Manage QuickPick |
| No sources at all (defensive) | Warning + "Add kubeconfig source..." action under root | Open Add QuickPick |
| Namespace listing fails for one context | Single `[refresh]` "Failed to connect. Click to retry." inside the context | Retry |
| Service listing fails inside a namespace | Namespace stays expandable; click `[refresh]` "Failed to list services." | Retry |
| RBAC denied | Warning + retry node + entry in DocumentDB output channel | Grant RBAC, retry |
| LoadBalancer pending | Warning toast on connect | Wait or use NodePort |
| NodePort uses InternalIP only | Warning toast on connect | Use a reachable address |
| ClusterIP port-forward fails | Error toast + cleared client cache | Re-open / change port |
| Saved connection's source missing | Error toast on reconnect — uses the source label from the time the connection was saved (falls back to the id only for legacy connections without a saved label) | Re-add the source or re-save the connection |
| Credentials Secret missing / invalid | Discovery still succeeds | User is prompted at connect time |

Every recovery row except RBAC and "wait for LB" can be reached with a single
click directly from the tree.

---

## 15. End-to-end smoke-test script

A reviewer can walk this top-to-bottom against a real cluster (kind or AKS)
to exercise every supported workflow.

1. **Activate the provider.** Service Discovery -> `+` -> "Kubernetes".
   Confirm `Discovery -> Kubernetes -> Default kubeconfig` appears with no
   prompts. (§5)
2. **Browse the default source.** Expand it. Contexts appear; expand one to
   see namespaces sorted (DocumentDB-first). Expand a target namespace to see
   services. (§3)
3. **Add a custom file source.** Click `+ -> Add custom kubeconfig file...`,
   pick a secondary kubeconfig. The new source appears as a sibling to
   Default. (§6.1)
4. **Add an inline source.** Copy any valid kubeconfig YAML. Click
   `+ -> Paste kubeconfig YAML from clipboard`. `Pasted YAML 1` appears.
   (§6.1)
5. **Manage visibility.** Click `[key]` -> uncheck the file source -> Enter.
   The file source disappears from the tree. Re-open Manage -> re-check ->
   Enter. It returns. (§6.2)
6. **Rename a source.** Right-click the file source -> "Rename Kubeconfig
   Source..." -> "Team config" -> Enter. Tree updates. (§6.3)
7. **Rename a context.** Right-click any context -> "Rename Context..." ->
   "Prod AKS" -> Enter. The label changes; the original context name appears
   in `(parens)` next to it. Re-run with empty input to clear. (§7)
8. **Run the wizard.** "+ New Connection" -> "Service Discovery" ->
   "Kubernetes". Confirm the flat picker shows contexts from all visible
   sources, with alias-as-label and `[original]` in description when an alias
   is set. Pick a `ClusterIP` service; accept the default port. The "Tunnel
   started on 127.0.0.1:..." toast appears. The connection is saved. (§8)
9. **Add to Connections from the tree.** Right-click another service ->
   "Add to Connections...". Confirm the dedup behavior if you re-run it. (§9)
10. **Reconnect.** Reload VS Code window. Open the saved K8s connection from
    the Connections view. The tunnel restarts automatically. (§10)
11. **Try DKO credentials.** Connect to a DKO-backed service whose Secret is
    available. Confirm no password prompt fires. (§12)
12. **Copy connection string.** Right-click a K8s service that has a
    password -> "Copy Connection String..." -> confirm the with/without
    QuickPick fires. Paste into a terminal `mongosh` to verify. (§13)
13. **Recover from a broken source.** Rename the file source's target file
    on disk to break it. Refresh the source. Recovery children appear inside
    just that source; the others stay healthy. Restore the file and Retry.
    (§14)
14. **Remove a source.** Right-click -> "Remove Kubeconfig Source" -> confirm.
    Aliases for that source are cleared; the saved connection from step 10
    surfaces a clear error on next reconnect ("Kubeconfig source X was not
    found..."). (§6.4 + §10)
15. **Re-add the Default source.** Click `+ -> Default kubeconfig`. The
    Default source returns with the same `'default'` id, so any pre-v2 saved
    connection still resolves through it.

---

## 16. Glossary

| Term | Meaning |
| --- | --- |
| **Source** | A kubeconfig "location" managed by this plugin (default / file / pasted YAML). |
| **Context** | A Kubernetes context as defined in the kubeconfig YAML. |
| **Alias** | Display-only label override for a context, scoped per (source, context). |
| **Target** | A discovered DocumentDB-compatible Kubernetes Service (DKO or generic). |
| **DKO** | DocumentDB Kubernetes Operator; targets backed by `documentdb.io/preview` `dbs` resources. |
| **Generic target** | A non-DKO Service exposing a known DocumentDB port or opted in via annotation/label. |
| **Tunnel** | A `kubectl port-forward`-equivalent process started inside the extension. |
| **Identity** (port-forward) | `<sourceId>/<context>/<namespace>/<service>:<port>` — used for tunnel reuse and saved-connection dedup. |
