# Kubernetes Discovery Gap Closure Plan

This handoff plan closes the remaining gaps between the current Kubernetes Service Discovery implementation and microsoft/vscode-documentdb#581, "Feature: Add Kubernetes Multi-Cloud Service Discovery Plugin."

Each task below is intended to be independently actionable. When an agent completes a task, update the task status in this file and include the validation commands/results in the task notes or PR description.

## Current State

The repo already contains a Kubernetes discovery provider under `src/plugins/service-kubernetes/`. Current code includes provider registration, kubeconfig loading, tree items, a service discovery wizard, filter support, DKO-aware service discovery, a generic service fallback, endpoint resolution for `LoadBalancer` / `NodePort` / `ClusterIP`, a port-forward manager, tests, and a draft user manual page.

Known important gaps:

- Activation-time setup can leave Kubernetes active even if credential setup is cancelled or fails.
- Context enable/disable and aliases exist as steps but are not wired into Manage Credentials.
- Filter state is not consistently applied by the New Connection service-discovery wizard.
- Tree root/context expansion eagerly scans services, which can hide contexts and create RBAC/performance issues.
- Service discovery heuristics are not fully defined against issue #581 examples.
- Credential secret conventions are DKO-only and not fully documented.
- Port-forward lifecycle lacks explicit user controls/status.
- NodePort and LoadBalancer fallback can produce endpoints that may not be reachable.
- New Connection service-discovery flow does not populate auto-resolved Kubernetes credentials.
- Documentation is not linked from the main Service Discovery manual.
- Dependency size/memory impact has not been measured.

## Completion Checklist

- [x] Task 1: Make activation-time setup transactional.
- [x] Task 2: Wire context enable/disable into Manage Credentials.
- [x] Task 3: Wire context aliases into Manage Credentials and tree display.
- [x] Task 4: Align filters across tree and New Connection wizard.
- [x] Task 5: Improve tree scanning strategy and empty-state UX.
- [x] Task 6: Define and implement service discovery heuristics.
- [x] Task 7: Document and harden credential secret resolution.
- [x] Task 8: Complete ClusterIP port-forward lifecycle and user controls.
- [x] Task 9: Improve NodePort and LoadBalancer endpoint safety.
- [x] Task 10: Complete New Connection wizard credential handling.
- [x] Task 11: Integrate and update Kubernetes discovery documentation.
- [x] Task 12: Measure dependency size and memory impact.
- [x] Task 13: Run end-to-end Kubernetes scenario validation.

## Task 1: Make Activation-Time Setup Transactional

**Status:** Complete

**Gap:** `src/commands/addDiscoveryRegistry/ExecuteStep.ts` adds a provider to `activeDiscoveryProviderIds` before activation-time credentials setup runs. If Kubernetes setup is cancelled or fails, the provider can remain active but unusable.

**Requirement:** Providers that opt into activation-time credentials setup should only become active after setup succeeds, or activation should be rolled back on cancellation/failure.

**Intended functions:**

- Preserve current behavior for providers that do not set `configureCredentialsOnActivation`.
- For providers that do set it, run `provider.configureCredentials(context)` before final activation or remove the provider from active state if setup fails.
- Avoid duplicate provider IDs.
- Refresh the discovery tree only after successful activation.
- Treat `UserCancelledError` as cancellation, not success.
- Propagate unexpected errors through existing command error handling.

**Likely files:**

- `src/commands/addDiscoveryRegistry/ExecuteStep.ts`
- `src/commands/addDiscoveryRegistry/ExecuteStep.test.ts`
- `src/services/discoveryServices.ts`
- `src/plugins/service-kubernetes/KubernetesDiscoveryProvider.ts`

**Validation and tests:**

- Test successful activation-time setup adds the provider once and refreshes the tree.
- Test user cancellation does not add the provider and does not refresh.
- Test setup failure does not add the provider and propagates the error.
- Test existing provider is not duplicated.
- Run `npm run jesttest -- src/commands/addDiscoveryRegistry/ExecuteStep.test.ts --runInBand`.
- Run `npm run l10n` if user-facing strings changed, then `npm run prettier-fix`, `npm run lint`, and `npm run build`.

## Task 2: Wire Context Enable/Disable into Manage Credentials

**Status:** Complete

**Gap:** `SelectContextsStep` exists but `configureKubernetesCredentials` only prompts for kubeconfig source. Users cannot enable/disable contexts through Manage Credentials.

**Requirement:** Manage Credentials must let users choose which kubeconfig contexts are enabled for Kubernetes discovery.

**Intended functions:**

- Add `SelectContextsStep` to the credentials wizard after `SelectKubeconfigSourceStep`.
- Make zero selected contexts a valid explicit state that disables all contexts.
- Distinguish "never configured" from "configured with zero contexts"; do not use `undefined` for both.
- Persist only contexts that exist in the currently selected kubeconfig.
- Avoid clearing namespace/context filters unnecessarily when selections are unchanged.
- Show a localized warning/empty state when no contexts are enabled.

**Likely files:**

- `src/plugins/service-kubernetes/credentials/configureKubernetesCredentials.ts`
- `src/plugins/service-kubernetes/credentials/SelectContextsStep.ts`
- `src/plugins/service-kubernetes/credentials/ExecuteStep.ts`
- `src/plugins/service-kubernetes/credentials/KubernetesCredentialsWizardContext.ts`
- `src/plugins/service-kubernetes/credentials/credentialsWizardSteps.test.ts`
- `src/plugins/service-kubernetes/config.ts`

**Validation and tests:**

- Test wizard prompt steps include source selection and context selection.
- Test first-time default behavior is explicit and documented.
- Test selecting one context stores only that context.
- Test selecting zero contexts stores an empty enabled-context array.
- Test stale contexts are removed.
- Test filters are preserved when context selection is unchanged.
- Run `npm run jesttest -- src/plugins/service-kubernetes/credentials/credentialsWizardSteps.test.ts --runInBand`.

**Completion notes:**

- Manage Credentials now runs kubeconfig source selection, context selection, alias editing, and persistence.
- `selectedContextNames` distinguishes unconfigured default-all (`undefined`) from explicitly disabled-all (`[]`).
- Context filtering state is preserved unless the kubeconfig source changes.
- Targeted credential wizard tests passed.

## Task 3: Wire Context Aliases into Manage Credentials and Tree Display

**Status:** Complete

**Gap:** `EditContextAliasesStep` exists but is not wired. `KubernetesContextItem` accepts an alias, but `KubernetesRootItem` passes `undefined`.

**Requirement:** Users can optionally alias enabled contexts, and the Discovery tree displays aliases while preserving raw context names in tooltips and IDs.

**Intended functions:**

- Add `EditContextAliasesStep` after `SelectContextsStep`.
- Keep aliases optional.
- Enforce alias validation: max 80 characters, unique among selected contexts, and not equal to another selected context name.
- Persist aliases only for enabled contexts.
- Remove aliases for disabled contexts unless product explicitly chooses to preserve them.
- Read `CONTEXT_ALIASES_KEY` in `KubernetesRootItem` and pass aliases into `KubernetesContextItem`.
- Never use aliases in kubeconfig operations, telemetry identifiers, tree IDs, cluster IDs, or cache keys.

**Likely files:**

- `src/plugins/service-kubernetes/credentials/configureKubernetesCredentials.ts`
- `src/plugins/service-kubernetes/credentials/EditContextAliasesStep.ts`
- `src/plugins/service-kubernetes/credentials/ExecuteStep.ts`
- `src/plugins/service-kubernetes/discovery-tree/KubernetesRootItem.ts`
- `src/plugins/service-kubernetes/discovery-tree/KubernetesContextItem.ts`
- `src/plugins/service-kubernetes/credentials/credentialsWizardSteps.test.ts`
- `src/plugins/service-kubernetes/discovery-tree/KubernetesRootItem.test.ts`

**Validation and tests:**

- Test alias step is present after context selection.
- Test alias is stored and displayed as the context label.
- Test empty alias removes stored alias.
- Test duplicate aliases are rejected.
- Test tooltip includes raw context and alias.
- Run targeted Jest tests for credentials and root/context tree items.

**Completion notes:**

- Alias editing is wired after context selection.
- Aliases are persisted only for enabled contexts and removed for disabled contexts.
- Root tree alias lookup passes display aliases to `KubernetesContextItem` while raw context names remain in IDs and tooltips.
- Targeted credential wizard and root tree tests passed.

## Task 4: Align Filters Across Tree and New Connection Wizard

**Status:** Complete

**Gap:** The tree uses `HIDDEN_CONTEXTS_KEY` and `FILTERED_NAMESPACES_KEY`, but the New Connection Kubernetes wizard only honors enabled contexts.

**Requirement:** Filter choices must consistently narrow visible resources in both the Discovery tree and New Connection service-discovery flow.

**Intended functions:**

- Exclude hidden contexts in `SelectContextStep`.
- Exclude hidden namespaces in `SelectNamespaceStep`.
- Keep Manage Credentials responsible for enabled contexts and Filter responsible for visible contexts/namespaces.
- Show localized guidance when filters hide every context or every namespace.
- Decide whether New Connection should list all visible namespaces or only namespaces with discovered targets; document whichever behavior is implemented.

**Likely files:**

- `src/plugins/service-kubernetes/discovery-wizard/SelectContextStep.ts`
- `src/plugins/service-kubernetes/discovery-wizard/SelectNamespaceStep.ts`
- `src/plugins/service-kubernetes/filtering/configureKubernetesFilter.ts`
- `src/plugins/service-kubernetes/filtering/FilterContextsStep.ts`
- `src/plugins/service-kubernetes/filtering/FilterNamespacesStep.ts`
- New or existing discovery-wizard/filter tests.

**Validation and tests:**

- Test hidden contexts are absent from `SelectContextStep`.
- Test hidden namespaces are absent from `SelectNamespaceStep`.
- Test all-hidden states show actionable localized warnings/errors.
- Test filter wizard persists hidden contexts without modifying enabled contexts.
- Run targeted Jest tests for discovery wizard/filtering.

**Completion notes:**

- New Connection context selection now includes enabled contexts only and excludes hidden contexts.
- New Connection namespace selection now excludes namespaces hidden for the selected context.
- Filter configuration resolves enabled contexts from the configured kubeconfig and persists hidden contexts/namespaces without updating enabled contexts.
- Targeted discovery wizard/filtering tests passed according to the implementing agent.

## Task 5: Improve Tree Scanning Strategy and Empty-State UX

**Status:** Complete

**Gap:** Root/context expansion eagerly scans namespaces and services, hiding contexts/namespaces with no targets or RBAC failures. This can be slow and hard to debug.

**Requirement:** Tree browsing should remain responsive and debuggable even with empty namespaces, partial RBAC, or unreachable contexts.

**Recommended approach:** Lazy browsing.

**Intended functions:**

- Root lists enabled and visible contexts without service scans.
- Context lists visible namespaces without service scans.
- Namespace lists services and shows a clear empty/error child if no targets are found or services cannot be listed.
- Unreachable contexts remain visible and show retry/error state when expanded.
- If retaining eager scans, use bounded concurrency and status children instead of silently hiding resources.

**Likely files:**

- `src/plugins/service-kubernetes/discovery-tree/KubernetesRootItem.ts`
- `src/plugins/service-kubernetes/discovery-tree/KubernetesContextItem.ts`
- `src/plugins/service-kubernetes/discovery-tree/KubernetesNamespaceItem.ts`
- `src/plugins/service-kubernetes/discovery-tree/KubernetesRootItem.test.ts`
- `src/plugins/service-kubernetes/discovery-tree/KubernetesContextItem.test.ts`

**Validation and tests:**

- Test root expansion does not call service-list APIs in lazy mode.
- Test context expansion lists namespaces and respects filters.
- Test empty namespace shows an informational child.
- Test RBAC service-list error shows retry/error state and logs diagnostics.
- Test unreachable context is visible and retryable.

**Completion notes:**

- Implemented lazy browsing: root lists visible contexts without namespace/service scans, and context nodes list visible namespaces without service scans.
- Namespace expansion now shows an informational child when no DocumentDB services are found.
- Namespace service-list failures now return retry/error children and log diagnostics.
- Added `KubernetesNamespaceItem` tests and updated root/context tests according to the implementing agent.

## Task 6: Define and Implement Service Discovery Heuristics

**Status:** Complete

**Gap:** Current discovery prefers DKO and generically includes only services on port `10260`, while issue examples include `27017` and `30017`. Label/annotation conventions are not implemented.

**Requirement:** Define intentional, documented, and tested rules for when a Kubernetes `Service` is considered DocumentDB-compatible.

**Intended functions:**

- Always include accessible DKO `documentdb.io/preview` `dbs` resources.
- Add explicit service opt-in metadata, such as `documentdb.vscode.extension/discovery: "true"` as an annotation or label.
- Include annotated/labelled services with at least one TCP service port.
- Decide whether broad known-port fallback should include `27017`, `27018`, `27019`, and `10260`, or only `10260`.
- Skip unrelated services without DKO, opt-in metadata, or accepted port heuristic.
- Avoid duplicates when DKO already claims a backing service.
- Validate connection parameters with the existing allowlist.

**Likely files:**

- `src/plugins/service-kubernetes/config.ts`
- `src/plugins/service-kubernetes/kubernetesClient.ts`
- `src/plugins/service-kubernetes/kubernetesClient.test.ts`
- `docs/user-manual/service-discovery-kubernetes.md`

**Validation and tests:**

- Test DKO target inclusion and DKO-first sorting.
- Test annotated service on non-standard port is included.
- Test `10260` service is included.
- Test `27017` behavior matches the final decision.
- Test unrelated service on port `80` without opt-in is excluded.
- Test DKO-backed service is not duplicated by generic fallback.
- Run `npm run jesttest -- src/plugins/service-kubernetes/kubernetesClient.test.ts --runInBand`.

**Completion notes:**

- Added explicit discovery opt-in via `documentdb.vscode.extension/discovery` annotation or label.
- Generic fallback now uses the shared `DOCUMENTDB_PORTS` list and excludes unrelated services.
- DKO targets are included first and their backing services are not duplicated by generic fallback.
- Discovery only considers TCP service ports, treating omitted Kubernetes protocol as TCP.
- Targeted Kubernetes client and service item tests passed.

## Task 7: Document and Harden Credential Secret Resolution

**Status:** Complete

**Gap:** Credential resolution currently supports DKO `spec.documentDbCredentialSecret` or default `documentdb-credentials`. Generic service credential conventions are not supported or documented.

**Requirement:** Credential secret resolution must be explicit, safe, documented, and covered by tests.

**Intended functions:**

- Continue DKO secret resolution from `spec.documentDbCredentialSecret` or `documentdb-credentials`.
- Consider a generic service annotation such as `documentdb.vscode.extension/credential-secret: "<secretName>"`.
- Read generic service secrets only from the same namespace.
- Validate secret names before reading.
- Decode only expected keys, such as `username` and `password`, unless another convention is explicitly approved.
- If a secret is missing/unreadable, prompt for credentials later rather than failing discovery.
- Never place credentials in connection strings.
- Never log secret values.

**Likely files:**

- `src/plugins/service-kubernetes/kubernetesClient.ts`
- `src/plugins/service-kubernetes/discovery-tree/KubernetesServiceItem.ts`
- `src/plugins/service-kubernetes/discovery-wizard/KubernetesExecuteStep.ts`
- `src/plugins/service-kubernetes/kubernetesClient.test.ts`
- `src/plugins/service-kubernetes/discovery-tree/KubernetesServiceItem.test.ts`
- `docs/user-manual/service-discovery-kubernetes.md`

**Validation and tests:**

- Test DKO secret decode succeeds.
- Test missing/unreadable secret returns undefined safely.
- Test generic annotated secret is same-namespace only.
- Test invalid secret-name annotation is ignored or safely warned.
- Test password is in `nativeAuthConfig`, not connection string.
- Test password is added to `valuesToMask`.

**Completion notes:**

- Added generic service credential opt-in via `documentdb.vscode.extension/credential-secret`.
- Generic credentials are read only from same-namespace Kubernetes Secrets after DNS subdomain name validation.
- DKO credential resolution remains supported through DocumentDB CR secret references.
- Tree/Add-to-Connections credential resolution now consumes both DKO and generic annotated secrets without embedding credentials in connection strings.
- Targeted Kubernetes client and service item tests passed.

## Task 8: Complete ClusterIP Port-Forward Lifecycle and User Controls

**Status:** Complete

**Gap:** ClusterIP port-forwarding exists, but there is no explicit stop/status command and cleanup is limited to extension dispose or credential reconfigure.

**Requirement:** Port-forward behavior should be explicit, user-visible, and tested.

**Intended functions:**

- Keep automatic tunnel start for ClusterIP service connection.
- Track active tunnel metadata: context, namespace, service, local port, remote port, start time.
- Add optional commands:
  - Stop all Kubernetes port-forward tunnels.
  - Stop a selected service tunnel.
  - List/show active tunnels.
- Stop all tunnels on extension dispose and Kubernetes credential reconfigure.
- Decide whether tunnels persist after collection view/session close; update docs accordingly.
- Surface backend resolution failures instead of silently dropping sockets.
- Keep logs free of secrets.

**Likely files:**

- `src/plugins/service-kubernetes/portForwardTunnel.ts`
- `src/plugins/service-kubernetes/promptForLocalPort.ts`
- `src/plugins/service-kubernetes/KubernetesDiscoveryProvider.ts`
- `src/documentdb/ClustersExtension.ts`
- `package.json` if commands/menus are added.
- `src/plugins/service-kubernetes/portForwardTunnel.test.ts`
- `docs/user-manual/service-discovery-kubernetes.md`

**Validation and tests:**

- Test tunnel start, reuse, stop one, and stop all.
- Test port conflict prompts to use an existing port-forward.
- Test backend resolution errors are logged/actionable.
- Test credential reconfigure stops tunnels.
- Manually validate ClusterIP connection through kind/minikube if available.

**Completion notes:**

- Added safe tunnel metadata via `TunnelInfo`.
- Added `listTunnels()` and `stopTunnel(...)`.
- Kept `stopAll()` for credential reconfigure and extension disposal.
- Added backend resolution failure logging without secrets.
- Targeted port-forward test suite passed according to the implementing agent.

## Task 9: Improve NodePort and LoadBalancer Endpoint Safety

**Status:** Complete

**Gap:** NodePort uses the first node ExternalIP or InternalIP. LoadBalancer without ingress falls back to NodePort. This can return an address that is not reachable from the developer machine.

**Requirement:** Endpoint resolution should avoid over-promising reachability and should guide users when reachability is uncertain.

**Intended functions:**

- For LoadBalancer, prefer ingress hostname/IP.
- For LoadBalancer without ingress, use NodePort fallback only under a documented policy.
- For NodePort, prefer ExternalIP.
- Treat InternalIP as uncertain unless local-cluster provider rules say it is acceptable.
- Surface actionable warning or unreachable reason when an address may not be reachable.
- Include endpoint type/reason in telemetry.

**Likely files:**

- `src/plugins/service-kubernetes/kubernetesClient.ts`
- `src/plugins/service-kubernetes/discovery-tree/KubernetesServiceItem.ts`
- `src/plugins/service-kubernetes/discovery-wizard/KubernetesExecuteStep.ts`
- `src/plugins/service-kubernetes/kubernetesClient.test.ts`
- `docs/user-manual/service-discovery-kubernetes.md`

**Validation and tests:**

- Test LoadBalancer ingress hostname/IP success.
- Test pending LoadBalancer without ingress and without NodePort.
- Test LoadBalancer NodePort fallback behavior matches final policy.
- Test NodePort ExternalIP success.
- Test NodePort InternalIP behavior matches final policy.
- Test no node address returns unreachable.

**Completion notes:**

- Endpoint resolution now prefers ExternalIP across all nodes before falling back to InternalIP.
- NodePort and LoadBalancer NodePort fallback return warnings when only an InternalIP is available.
- Tree credential resolution surfaces ready-endpoint warnings to the output channel/user and telemetry.
- Targeted Kubernetes client and service item tests passed.

## Task 10: Complete New Connection Wizard Credential Handling

**Status:** Complete

**Gap:** Tree-based `KubernetesServiceItem.getCredentials()` resolves DKO credentials, but `KubernetesExecuteStep` for New Connection only sets `context.connectionString`.

**Requirement:** New Connection -> Service Discovery -> Kubernetes should provide the same auto-credential behavior as the tree "Add to Connections View" path.

**Intended functions:**

- In `KubernetesExecuteStep`, after endpoint resolution, attempt credential resolution for the selected service.
- If credentials resolve, set:
  - `context.nativeAuthConfig`
  - `context.availableAuthenticationMethods = [AuthMethodId.NativeAuth]`
  - `context.selectedAuthenticationMethod = AuthMethodId.NativeAuth`
  - `context.valuesToMask` for password.
- If credentials do not resolve, make sure the New Connection flow prompts for required auth details before final save.
- Ensure saved connection strings do not include username/password.
- Align behavior with Azure RU/vCore provider execute steps.

**Likely files:**

- `src/plugins/service-kubernetes/discovery-wizard/KubernetesExecuteStep.ts`
- `src/commands/newConnection/PromptConnectionModeStep.ts`
- `src/commands/newConnection/PromptServiceDiscoveryStep.ts`
- `src/commands/newConnection/ExecuteStep.ts`
- New or existing Kubernetes discovery wizard tests.

**Validation and tests:**

- Test DKO service selected through New Connection stores native auth credentials.
- Test missing auto credentials triggers prompts or produces valid expected auth state.
- Test password masking.
- Test saved connection string has no credentials.

**Completion notes:**

- New Connection Kubernetes execution now resolves DKO and generic annotated credentials after endpoint resolution.
- Resolved credentials populate `nativeAuthConfig`, `availableAuthenticationMethods`, and `selectedAuthenticationMethod`.
- Passwords are masked and connection strings remain credential-free.
- Ready endpoint warnings are surfaced in the New Connection path.
- Targeted Kubernetes discovery wizard tests passed.

## Task 11: Integrate and Update Kubernetes Discovery Documentation

**Status:** Complete

**Gap:** `docs/user-manual/service-discovery-kubernetes.md` is not linked from `docs/user-manual/service-discovery.md`, and docs may not match final behavior after other tasks.

**Requirement:** User documentation should be discoverable and accurate.

**Intended functions:**

- Add Kubernetes to `docs/user-manual/service-discovery.md`.
- Update Kubernetes doc to cover:
  - Enablement and activation setup.
  - Kubeconfig sources.
  - Context enable/disable.
  - Aliases.
  - Filtering.
  - Discovery heuristics.
  - DKO support.
  - Generic service annotation/port fallback.
  - Endpoint resolution by service type.
  - Port-forward lifecycle.
  - Credential secret conventions.
  - Minimum RBAC.
  - Troubleshooting.
- Decide whether `getLearnMoreUrl()` should remain an aka.ms URL or link directly to docs.
- Use DocumentDB terminology consistently.

**Likely files:**

- `docs/user-manual/service-discovery.md`
- `docs/user-manual/service-discovery-kubernetes.md`
- `src/plugins/service-kubernetes/KubernetesDiscoveryProvider.ts`

**Validation and tests:**

- Verify relative links work.
- Verify docs match actual command names, storage keys, and behavior.
- Run `npm run prettier-fix`.
- Run `npm run lint` if code changed.

**Completion notes:**

- Linked Kubernetes service discovery from the main Service Discovery manual.
- Updated the Kubernetes manual for activation-time kubeconfig setup, kubeconfig sources, enabled contexts, aliases, filters, lazy tree browsing, New Connection parity, DKO and generic service discovery rules, credential Secret conventions, endpoint and port-forward behavior, RBAC, and troubleshooting.
- Kept `getLearnMoreUrl()` as the existing aka.ms redirect for a stable external link; no code change was needed for Task 11.
- Validation: ran targeted Markdown checks for relative links, trailing whitespace, and final newlines. No code changed; l10n, Jest, build, and lint were not required. `npm run prettier-fix` was not run because the repository script does not target Markdown and could mutate parallel-agent code changes.

## Task 12: Measure Dependency Size and Memory Impact

**Status:** Complete

**Gap:** Issue #581 requires dependency footprint evaluation for `@kubernetes/client-node`. No VSIX size or extension-host memory evidence is documented.

**Requirement:** Provide evidence that the Kubernetes client dependency has acceptable footprint or prepare a follow-up issue for dynamic plugin activation.

**Intended functions:**

- Measure package/VSIX size before and after Kubernetes dependency if baseline can be recreated.
- Measure `dist/main.js` and any Kubernetes-related bundled output.
- Confirm lazy loading keeps Kubernetes runtime code out of startup until Kubernetes features are used.
- Measure extension-host memory:
  - idle before Kubernetes activation.
  - after enabling Kubernetes.
  - during active discovery.
  - during active ClusterIP port-forward.
- Document measurements or blockers.
- If impact is unacceptable, prepare follow-up issue text for general dynamic discovery-provider activation.

**Likely files:**

- `package.json`
- `package-lock.json`
- `webpack.config.ext.js`
- `src/plugins/service-kubernetes/kubernetesClient.ts`
- Optional documentation note if maintainers approve.

**Validation and tests:**

- Run `npm run clean`.
- Run `npm run webpack-prod`.
- Run existing package command if appropriate for the environment.
- Record VSIX size, `dist/main.js` size, and memory observations.
- Do not invent measurements; document blockers if measurement is not possible.

**Completion notes:**

- Dependency declaration audit:
  - `package.json` declares `@kubernetes/client-node` as `^1.4.0`.
  - `package-lock.json` resolves `@kubernetes/client-node` to `1.4.0`.
  - `npm ls @kubernetes/client-node --all` reports `vscode-documentdb@0.8.0-beta -> @kubernetes/client-node@1.4.0`.
- Import-shape audit:
  - Command: `rg "@kubernetes/client-node" src --glob "**/*.{ts,tsx}" -n`.
  - Top-level imports are type-only in `src/plugins/service-kubernetes/kubernetesClient.ts`, `src/plugins/service-kubernetes/discovery-tree/KubernetesServiceItem.ts`, and `src/plugins/service-kubernetes/portForwardTunnel.ts`.
  - Runtime imports use `await import('@kubernetes/client-node')` in `loadKubeConfig`, `createCoreApi`, DKO custom-object listing, and `PortForwardTunnelManager._doStartTunnel`.
- Dependency footprint:
  - Command: `du -sh node_modules/@kubernetes/client-node` reported `57M`.
  - A lockfile transitive-closure script over `package-lock.json` found `72` packages with `73.6 MiB` apparent disk usage. Largest entries were `node_modules/@kubernetes/client-node` (`57.3 MiB`), nested `@types/node` (`2.6 MiB`), root `@types/node` (`2.4 MiB`), `bare-url` (`1.5 MiB`), and `bare-fs` (`1.3 MiB`).
- Bundle/startup impact:
  - Initial `npm run webpack-prod` evidence showed a lazy-loading violation: `dist/main.js` was `11M` and contained `class KubeConfig`, meaning the Kubernetes runtime was bundled into the startup entry despite dynamic-import source code.
  - Fixed in `webpack.config.ext.js` by preserving dynamic `import()` in SWC (`module.ignoreDynamic: true`) so webpack can code-split lazy runtime dependencies.
  - After the fix, `npm run webpack-prod` succeeded. `dist/main.js` is `4.4M`; Kubernetes runtime code moved to lazy chunk `dist/958.js` (`1.7M`). `grep -o "class KubeConfig" dist/main.js | wc -l` reports `0`, while `dist/958.js` contains `class KubeConfig`, `CustomObjectsApi`, `PortForward`, and `openid-client`.
  - The webview build still reports existing webpack asset-size warnings for `views.js`, `json.worker.js`, and `editor.worker.js`; these are unrelated to Kubernetes.
- VSIX size:
  - Command: `npm run package` succeeded for the current worktree.
  - `vsce` reported `Packaged: ../vscode-documentdb-0.8.0-beta.vsix (91 files, 6.84 MB)`.
  - `stat -f 'bytes=%z' vscode-documentdb-0.8.0-beta.vsix` reported `bytes=7172376`. The generated VSIX was removed after measurement.
  - A clean before/after baseline without the Kubernetes dependency was not recreated in this shared dirty worktree.
- Memory impact:
  - Command: Node `--expose-gc` dynamic import probe for `@kubernetes/client-node`.
  - Before dynamic import: `rss=41.1 MiB`, `heapUsed=3.5 MiB`.
  - After dynamic import: `rss=131.5 MiB` (`+90.4 MiB`), `heapUsed=32.8 MiB` (`+29.3 MiB`).
  - After constructing `new KubeConfig()`: `rss=131.5 MiB` (`+90.5 MiB`), `heapUsed=32.7 MiB` (`+29.2 MiB`).
  - Real extension-host idle/active-discovery/ClusterIP port-forward memory was not measured because this non-interactive CLI session does not have an instrumented VS Code extension host or a live Kubernetes scenario. The bundle validation above demonstrates startup does not load the Kubernetes runtime until a Kubernetes feature calls the dynamic import.

## Task 13: Run End-to-End Kubernetes Scenario Validation

**Status:** Complete

**Gap:** There is no final E2E checklist proving issue #581 behavior works across core scenarios.

**Requirement:** Validate issue-level behavior with real or simulated Kubernetes environments.

**Scenarios:**

- No kubeconfig: setup fails clearly and provider state remains consistent.
- Multi-context kubeconfig: select contexts, alias one, verify tree.
- Filtering: hide context/namespace, verify tree and New Connection wizard.
- DKO LoadBalancer target: discover, resolve credentials if RBAC allows, add connection, expand/open data.
- Generic service target: discover by final heuristic and prompt for credentials if no secret exists.
- ClusterIP target: start tunnel, reuse tunnel, stop tunnel if implemented, verify reconfigure cleanup.
- RBAC-limited user: namespace/service/secret permissions denied produce actionable errors.

**Likely files:**

- `scripts/k8s-test-setup.sh`
- `scripts/k8s-test-teardown.sh`
- `docs/user-manual/service-discovery-kubernetes.md`
- Relevant source/test files from Tasks 1-12.

**Validation and tests:**

- Run targeted Jest tests for all modified areas.
- Run `npm run l10n` if user-facing strings changed.
- Run `npm run prettier-fix`.
- Run `npm run lint`.
- Run `npm run build`.
- Optionally run `npm run jesttest -- --runInBand` if baseline and environment allow.

**Completion notes:**

- Removed generated `dist/` artifacts with `npm run clean` before Jest to avoid the known `dist/package.json` haste-map collision.
- Ran `npm run l10n`.
- Ran `npm run prettier-fix`.
- Ran `npm run jesttest -- --runInBand`; Jest passed with 106 test suites and 2075 tests.
- Ran `npm run lint`.
- Ran `npm run build`.
- Live Kubernetes cluster validation was not run in this non-interactive environment; issue-level behavior is covered by the expanded unit/integration-style Jest suites and documented manual scenarios.

## Suggested Execution Order

1. Task 1: Activation safety.
2. Task 2: Context enable/disable.
3. Task 3: Context aliases.
4. Task 4: Filter consistency.
5. Task 5: Tree scanning and empty states.
6. Task 6: Service discovery heuristics.
7. Task 7: Credential secret conventions.
8. Task 10: New Connection credential parity.
9. Task 8: Port-forward lifecycle/user controls.
10. Task 9: NodePort/LoadBalancer reachability safety.
11. Task 11: Documentation integration.
12. Task 12: Size/memory evidence.
13. Task 13: End-to-end validation.

## Parallelization Guidance

- Task 1 can run independently.
- Tasks 2 and 3 should be done by the same agent.
- Tasks 4 and 5 should be done by the same agent.
- Tasks 6, 7, and 10 should be coordinated because they all touch target/credential semantics.
- Tasks 8 and 9 should be coordinated because they both touch endpoint reachability.
- Task 11 should wait until behavior is finalized.
- Task 12 can run after dependency/import structure stabilizes.
- Task 13 should be final.

## Repository Validation Rules

Before finishing a PR or branch that implements these tasks:

1. Run `npm run l10n` if any user-facing strings changed.
2. Run `npm run prettier-fix`.
3. Run `npm run lint`.
4. Run `npm run build`.
5. Run relevant targeted Jest tests.

If any `describe('TDD: ...')` test fails, stop and ask whether the behavior change is intentional before updating the test.
