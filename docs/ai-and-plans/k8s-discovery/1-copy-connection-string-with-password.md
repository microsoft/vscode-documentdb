# Copy Connection String with Password — Kubernetes Discovery

> **Status:** Draft for review
> **Owner:** Copilot CLI agent (initial draft) → user review
> **Scope of code change:** `src/commands/copyConnectionString/copyConnectionString.ts`
> (plus a new co-located unit test). Optional small telemetry improvements.

---

## 1. Problem statement

For **saved connections** in the Connections view, right-clicking a cluster and choosing
**Copy Connection String...** asks the user whether to copy the connection string **with
or without the password** (when a password is present and the cluster uses native auth).

For **Kubernetes-discovered targets** in the Discovery view, the same menu item also
appears (the manifest's intended `kubernetesServiceLeaf` exclusion does **not** match
the actual `KubernetesServiceItem.contextValue`, so the command is exposed today). When
the user clicks it:

- The plugin runs `getCredentials()`, which may auto-resolve a username and password
  from a DKO `documentDbCredentialSecret` or from a generic service's
  `documentdb.vscode.extension/credential-secret` annotation.
- The current `copyConnectionString` implementation gates the password prompt behind
  `isConnectionsView` (`containsDelimited(node.contextValue, Views.ConnectionsView)`).
- For a Kubernetes node `isConnectionsView` is `false`, so the prompt is **skipped** and
  the connection string is silently copied **without** the password — even when one is
  available.

This is inconsistent with the saved-connection UX. Users who legitimately want to share
or paste the full connection string (e.g. into a terminal `mongosh` command) have no way
to opt in.

### Why this matters

- **Workflow parity.** The two views should feel the same for native-auth clusters that
  hold a password.
- **Hidden capability.** Today the password is silently dropped — there is no UI hint
  that one was even resolved.
- **Power user need.** During development against a kind/minikube cluster, copy-paste
  into `mongosh` is the most common follow-up action; forcing the user to also remember
  and re-type the password defeats the convenience of auto-resolved credentials.

---

## 2. Out of scope

- **Tunnel side effects.** Calling `getCredentials()` on a `ClusterIP` K8s service today
  prompts for a local port and **starts a port-forward tunnel** even if the user only
  wants to copy the string. That is a separate UX issue tracked elsewhere; this change
  does not touch it.
- **Other discovery providers (Azure RU, Azure VM, Azure vCore).** Their behavior is
  intentionally **unchanged**. We only flip the prompt on for Kubernetes-discovered
  items, matching the user's explicit ask.
- **Suppressing the menu item entirely for K8s items.** The pre-existing
  `kubernetesServiceLeaf` no-op suppression in `package.json` is left as-is — the user
  has confirmed they want the action available; we are improving it, not hiding it.
- **No behavior change in the Azure Resources view.** `ClusterIP` resolution is not
  applicable there.

---

## 3. Requirements

### 3.1 Functional

- **R-01.** When the user invokes **Copy Connection String...** on a Kubernetes
  discovery node, and the resolved credentials use **Native auth** with a non-empty
  password, the user MUST see the same two-option quick pick used today by the
  Connections view:
  - "Copy without password" (default)
  - "Copy with password"
- **R-02.** If the user picks **"Copy with password"**, the connection string written to
  the clipboard MUST contain the username **and** password from
  `nativeAuthConfig`.
- **R-03.** If the user picks **"Copy without password"** or dismisses the picker, the
  connection string written to the clipboard MUST contain only the username (current
  behavior preserved).
- **R-04.** When the resolved credentials have **no password** (auto-resolution failed
  or was not configured), the prompt MUST NOT appear; the connection string is copied
  silently as today.
- **R-05.** When the selected auth method is **not** `NativeAuth` (e.g. EntraID), the
  prompt MUST NOT appear; existing logic for non-native auth continues to apply.
- **R-06.** Existing behavior for Connections view, Azure Resources view, and
  non-Kubernetes Discovery items MUST NOT change.

### 3.2 Non-functional

- **R-07.** No new user-facing strings introduced — reuse the existing l10n keys
  ("Copy without password", "Copy with password", "Do you want to include the password
  in the connection string?", "The connection string will (not) include the password").
- **R-08.** Password value MUST be added to `context.valuesToMask` whenever it is read,
  same as today, so it never leaks to telemetry or logs.
- **R-09.** Detection of "is this a Kubernetes discovery item?" MUST work whether the
  node is invoked from a context-menu action, the inline icon action, or the command
  palette via tree-node correlation. Detection should not rely on the `view` ID.

### 3.3 Telemetry (recommended, not strictly required)

- **R-10.** Add a `copyOrigin` telemetry property with values:
  `connectionsView` | `kubernetesDiscovery` | `other`. Helps measure adoption and
  catch regressions.
- **R-11.** Add a `passwordIncluded` telemetry property with values:
  `true` | `false` | `notPrompted`. Helps measure how often users choose to include
  the password.

---

## 4. Design

### 4.1 Detection

Today:

```ts
const isConnectionsView = containsDelimited(node.contextValue, Views.ConnectionsView);
```

New:

```ts
const isConnectionsView = containsDelimited(node.contextValue, Views.ConnectionsView);
// `kubernetesService` is part of `discovery.kubernetesService` from
// KubernetesServiceItem.contextValue. `containsDelimited` uses \b boundaries,
// and `.` counts as a non-word boundary, so this matches reliably.
const isKubernetesDiscoveryItem = containsDelimited(node.contextValue, 'kubernetesService');
const shouldOfferPasswordPrompt = isConnectionsView || isKubernetesDiscoveryItem;
```

`shouldOfferPasswordPrompt` then replaces the `isConnectionsView` branch.

### 4.2 Branch logic

```ts
if (shouldOfferPasswordPrompt) {
    const isNativeAuth =
        credentials.selectedAuthMethod === AuthMethodId.NativeAuth ||
        credentials.selectedAuthMethod === undefined;
    const hasPassword = !!credentials.nativeAuthConfig?.connectionPassword;

    if (isNativeAuth && hasPassword) {
        // existing quick pick — unchanged
    }
}
```

No structural refactor needed; only the gate widens.

### 4.3 Why not flip the rule globally?

A simpler change would be `if (isNativeAuth && hasPassword)` regardless of view. That
would also enable the prompt for Azure RU discovery items (whose connection string from
Azure contains a password). The user explicitly scoped this PR to Kubernetes; widening
the rule is left as a separate decision documented in the review checklist.

---

## 5. Validation

### 5.1 Unit tests (new file `copyConnectionString.test.ts`)

| Case  | Setup                                                                                | Expected                                                |
| ----- | ------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| T-01  | `contextValue` includes `connectionsView`, native auth, password present, picks WITH | Clipboard string contains both `user:password@`         |
| T-02  | Same as T-01 but user picks WITHOUT                                                  | Clipboard string contains only `user@`, no password     |
| T-03  | `contextValue` includes `discovery.kubernetesService`, native auth, password present, picks WITH | Clipboard string contains `user:password@`  |
| T-04  | Same as T-03 but user picks WITHOUT                                                  | Clipboard string contains only `user@`                  |
| T-05  | `contextValue` includes `discovery.kubernetesService`, native auth, **no password**  | No `showQuickPick` call; clipboard string has no password |
| T-06  | `contextValue` includes `discovery.kubernetesService`, EntraID auth                  | No password prompt; `authMechanism=MONGODB-OIDC` set     |
| T-07  | `contextValue` includes `discovery.azureResources`, native auth, password present    | No prompt (regression guard for other discovery types)   |

The test file should mock `vscode`, `@vscode/l10n`, the `ext.state` and clipboard APIs,
and the node's `getCredentials()`. Existing K8s tests in
`src/plugins/service-kubernetes/discovery-tree/KubernetesServiceItem.test.ts` show the
mocking pattern.

### 5.2 Manual smoke test (recommended before merge)

1. Spin up a kind cluster and apply a DKO `dbs` resource with a credential Secret
   (`scripts/k8s-test-setup.sh` helps).
2. In VS Code, configure Kubernetes discovery -> default kubeconfig.
3. Expand Discovery → Kubernetes → context → namespace → service.
4. Right-click the service → **Copy Connection String...**.
5. Confirm the quick pick appears.
6. Pick **Copy with password** → paste into terminal → confirm `mongosh "<paste>"`
   connects without re-prompting for password.
7. Repeat with **Copy without password** → paste → confirm `mongosh` prompts (or fails)
   for the password.
8. Repeat with a service that has no `credential-secret` annotation → confirm no prompt
   appears and the copied string has no password (regression guard).
9. Open Connections view → right-click any saved cluster → confirm prompt still works
   (regression guard).
10. Open Azure RU discovery item → confirm no prompt (scoped change guard).

### 5.3 Build / lint / test gates

The PR Completion Checklist applies (see `.github/copilot-instructions.md`):

```bash
npm run l10n          # nothing should change — no new strings
npm run prettier-fix
npm run lint
npx jest --no-coverage
npm run build
```

---

## 6. Risks and edge cases

- **Cancelled quick pick.** `showQuickPick` may resolve to `undefined` if the user
  presses Escape. Existing code handles this correctly (`includePassword.includePassword`
  read after assignment); we will preserve that null safety in the new branch.
- **Unrelated discovery items leaking through.** The `kubernetesService` token is
  unique today (only emitted by `KubernetesServiceItem.contextValue`). If a future
  discovery provider invents a similarly-named context value, the prompt may fire there
  too. Acceptable risk; unit test T-07 guards the current set of providers.
- **Username-less connection.** If `nativeAuthConfig.connectionUser` is empty but
  `connectionPassword` is set, the existing username assignment
  `parsedConnectionString.username = credentials.nativeAuthConfig?.connectionUser ?? '';`
  yields `''`. Setting `password` on a connection string whose username is empty would
  produce `:password@` which is invalid for many MongoDB clients. The existing
  Connections-view code has the same hazard, so we mirror its behavior; we do not add
  new guarding here.

---

## 7. Implementation checklist

The agent will check these off as it completes them:

- [x] Define problem and write this plan.
- [x] Verify detection token works with `containsDelimited` (regex with `\b` and `.`).
- [x] Modify `copyConnectionString.ts`:
  - [x] Add `isKubernetesDiscoveryItem` detection.
  - [x] Compute `shouldOfferPasswordPrompt = isConnectionsView || isKubernetesDiscoveryItem`.
  - [x] Replace the `isConnectionsView` branch condition.
  - [x] Add `copyOrigin` and `passwordIncluded` telemetry properties (R-10, R-11).
- [x] Add `src/commands/copyConnectionString/copyConnectionString.test.ts` covering
      cases T-01..T-07.
- [x] Run `npx jest --no-coverage` — all tests pass.
- [x] Run `npm run prettier-fix` and `npm run lint` — clean.
- [x] Run `npm run build` — clean.
- [x] Run `npm run l10n` — no string diff (reusing existing keys).
- [ ] Manual smoke test (5.2) — out of scope for the agent; left for the user.

---

## 8. Open questions for next review

1. **Scope creep — Azure RU?** Should we also enable the prompt for Azure RU discovery
   items, since `extractCredentialsFromRUAccount` returns a password from the Azure
   connection string? (Today it is silently dropped on copy.)
2. **Default option.** Today the prompt has both options at the same level (no `picked`
   default). Should "Copy without password" be marked as the default for safety?
3. **Tunnel side effect for `ClusterIP`.** A future task: provide a "best-effort"
   external connection string that does **not** start a tunnel just for copy. Would
   mention the limitation in the prompt detail or add a separate command like
   "Copy ClusterIP info without starting tunnel".
4. **Telemetry keys.** Are `copyOrigin` and `passwordIncluded` consistent with the
   project's telemetry vocabulary? Worth a quick scan against the
   `telemetry-instrumentation` skill.
