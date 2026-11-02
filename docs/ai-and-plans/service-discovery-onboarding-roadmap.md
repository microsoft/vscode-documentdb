---
kind: plan
status: active
created: 2026-10-13
---

# Service discovery UI: contributor guide and AWS roadmap

## Purpose and scope

This document maps the existing Atlas discovery UI to its implementation files and provides a
repeatable process for adding another discovery provider. It also records the agreed scope for an
AWS discovery implementation using the same UI structure.

The file map and Atlas behavior were examined in the working tree on 2026-10-13. This was a
read-only code analysis, not a live authentication or end-to-end test. AWS implementation has since
been added; see the [AWS feature document](./features/aws-discovery/README.md) for implemented files,
operator steps, confirmed follow-up choices and verification limits.

Related references:

- [Atlas discovery flow](../atlas-mongodb-discovery-flow.md)
- [Atlas feature knowledge base](./features/atlas-discovery/README.md)
- [Cluster tree architecture contract](../../.github/skills/tree-cluster-architecture/SKILL.md)
- [React webview architecture](../../.github/skills/react-webview-architecture/SKILL.md)
- [Webview tRPC messaging](../../.github/skills/webview-trpc-messaging/SKILL.md)
- [Infrastructure error translation](../../.github/skills/error-translation/SKILL.md)

## 1. Screenshot sequence and the missing handoff

The five operator-provided screenshots show three separate flows, not one continuous login wizard.
The screenshots are identified by their order in the conversation; their local attachment paths
and displayed connection details are intentionally not included in this document.

| Screenshot | Surface | Responsibility |
| ---------- | ------- | -------------- |
| 1 | Service Discovery sidebar | Atlas provider root and its sign-in action. |
| 2 | Credential webview: Choose method | Select the discovery authentication method. |
| 3 | Credential webview: Enter details | Collect credential fields and explain where to obtain them. |
| 4 | DocumentDB Connections: cluster menu | Operate on an already-saved database connection. |
| 5 | Database menu | Use shared database functionality after connecting. |

The complete sidebar-to-saved-connection journey is:

```text
Service Discovery
  -> Expand provider
  -> Sign-in action
  -> Choose method                 [screenshot 2]
  -> Enter details                 [screenshot 3]
  -> Verify
  -> Discovery credential saved
  -> Success / Done
  -> Browse discovered resources
  -> Select a ready cluster
  -> Save to Connections
  -> Saved connection appears, collapsed
  -> Expand saved connection
  -> Database authentication, if needed
  -> Databases                     [screenshot 4]
  -> Collections / database menu   [screenshot 5]
```

**Discovery authentication and database authentication are separate.** Completing the Atlas
webview saves a discovery credential; it does not automatically create or authenticate a saved
database connection.

Persistence is also separate from closing the panel: the controller resolves the successful
credential operation when persistence completes, allowing discovery refresh before the user clicks
Done. Done closes the success screen.

For Atlas, Save to Connections obtains the endpoint and supported authentication methods. It
reveals the saved connection without expanding it, deliberately avoiding an immediate login prompt.
Alternatively, the user can expand a ready cluster directly in Service Discovery and browse there
without saving a connection.

## 2. Three entry paths

### A. New Connection

```text
New Connection
  -> Connection String OR Service Discovery
  -> Choose registered provider
  -> Provider credential setup, if needed
  -> Provider resource-selection wizard
  -> Populate connection context
  -> Shared connection-saving execute step
  -> DocumentDB Connections
```

### B. Service Discovery sidebar

```text
Registered, visible provider
  -> Provider root
  -> No credentials: explicit sign-in row
  -> Credentials present: discover resources
  -> Browse directly OR Save to Connections
```

Expanding the signed-out Atlas root does not automatically open authentication.

### C. Show a hidden provider

```text
Explore Providers / show hidden provider
  -> Select provider
  -> Optional setup-on-activation hook
  -> Persist visibility
  -> Refresh Service Discovery
```

All registered providers are visible by default. The visibility service persists a hidden-provider
list. Showing a hidden provider is not the same operation as creating a database connection.

## 3. File-level map

### 3.1 Entry prompts and registration

| File | Responsibility | New-provider action |
| ---- | -------------- | ------------------- |
| [newConnection.ts](../../src/commands/newConnection/newConnection.ts) | Starts the New Connection wizard. | Reuse. |
| [PromptConnectionModeStep.ts](../../src/commands/newConnection/PromptConnectionModeStep.ts) | Offers Connection String or Service Discovery. | Reuse. |
| [PromptServiceDiscoveryStep.ts](../../src/commands/newConnection/PromptServiceDiscoveryStep.ts) | Lists registered providers and delegates to the selected provider's wizard. | Register the provider rather than hard-coding another picker entry. |
| [discoveryServices.ts](../../src/services/discoveryServices.ts) | Defines `DiscoveryProvider` and the registry. | Implement the contract. |
| [ClustersExtension.ts](../../src/documentdb/ClustersExtension.ts) | Registers providers, creates tree views, and registers command handlers. | Register the provider and provider-specific commands. |
| [AtlasDiscoveryProvider.ts](../../src/plugins/service-atlas-mongodb/AtlasDiscoveryProvider.ts) | Connects the Atlas root, wizard, credential manager, and discovery service. | Use as the provider entry-class reference. |
| [config.ts](../../src/plugins/service-atlas-mongodb/config.ts) | Provider identity and presentation constants. | Define provider-owned identity and presentation. |

The required provider surfaces are `getDiscoveryTreeRootItem()` and `getDiscoveryWizard()`.
Optional hooks include credential configuration, learn-more links, activation-time setup, and
deactivation. The wizard must ultimately supply the connection context required by the shared save
step; it must not create a separate persistence mechanism.

### 3.2 Service Discovery sidebar

| File | Responsibility |
| ---- | -------------- |
| [package.json](../../package.json) | View declaration, commands, inline buttons, and menu `when` clauses. |
| [DiscoveryBranchDataProvider.ts](../../src/tree/discovery-view/DiscoveryBranchDataProvider.ts) | Visible provider roots, state wrapping, tree caching, refresh, and cluster/collection lookup. |
| [discoveryProviderVisibility.ts](../../src/services/discoveryProviderVisibility.ts) | Default visibility and persisted hidden-provider preferences. |
| [addDiscoveryRegistry.ts](../../src/commands/addDiscoveryRegistry/addDiscoveryRegistry.ts) | Starts the show-hidden-provider wizard. |
| [addDiscoveryRegistry/ExecuteStep.ts](../../src/commands/addDiscoveryRegistry/ExecuteStep.ts) | Optional activation setup, visibility persistence, and refresh. |
| [AtlasServiceRootItem.ts](../../src/plugins/service-atlas-mongodb/discovery-tree/AtlasServiceRootItem.ts) | Root label/icon, sign-in row, tree/list rendering, and refresh. |
| [atlasTreeNodes.ts](../../src/plugins/service-atlas-mongodb/discovery-tree/atlasTreeNodes.ts) | Empty and recovery rows. |
| [manageCredentials.ts](../../src/commands/discoveryService.manageCredentials/manageCredentials.ts) | Resolves the provider from the selected tree path and invokes its credential manager. |
| [switchAtlasViewMode.ts](../../src/plugins/service-atlas-mongodb/commands/switchAtlasViewMode.ts) | Atlas tree/list mode switching. |

The sidebar icons are native VS Code command contributions, not React buttons. Their visibility
depends on the tree item's `contextValue`, with tags such as `enableManageCredentialsCommand`,
`enableLearnMoreCommand`, and the provider's view-mode marker. Both the manifest contribution and
the runtime command registration must exist.

### 3.3 Credential webview

| File | Responsibility |
| ---- | -------------- |
| [addAtlasCredential.ts](../../src/plugins/service-atlas-mongodb/credentialsManagement/addAtlasCredential.ts) | Opens sign-in, resets discovery state, clears cached error state, and refreshes the node. |
| [atlasCredentialsController.ts](../../src/webviews/documentdb/atlasCredentials/atlasCredentialsController.ts) | Creates the panel, supplies initial configuration, and handles persistence/cancellation/disposal outcomes. |
| [AtlasCredentialsView.tsx](../../src/webviews/documentdb/atlasCredentials/AtlasCredentialsView.tsx) | Method cards, fields, help content, verification, errors, navigation, and success UI. |
| [atlasCredentials.scss](../../src/webviews/documentdb/atlasCredentials/atlasCredentials.scss) | Small view-specific styling adjustment, not the entire wizard layout. |
| [Wizard.tsx](../../packages/vscode-ext-webview-fluentui/src/components/Wizard/Wizard.tsx) | Shared wizard shell. |
| [WizardStep.tsx](../../packages/vscode-ext-webview-fluentui/src/components/Wizard/WizardStep.tsx) | Shared wizard step component. |
| [atlasCredentialsRouter.ts](../../src/webviews/documentdb/atlasCredentials/atlasCredentialsRouter.ts) | Host-side input validation, authentication verification, persistence, errors, completion, and cancellation. |
| [openAppWebview.ts](../../src/webviews/_integration/openAppWebview.ts) | Shared panel factory with the app router, transport, and bundle configuration. |
| [WebviewRegistry.ts](../../src/webviews/_integration/WebviewRegistry.ts) | Maps the webview name to its React component. |
| [appRouter.ts](../../src/webviews/_integration/appRouter.ts) | Registers host-side procedures. |
| [useTrpcClient.ts](../../src/webviews/_integration/useTrpcClient.ts) | Typed React client for calling host procedures. |

```text
Tree command or provider wizard
  -> Credential controller
  -> openAppWebview
  -> Registered React view
  -> useTrpcClient mutation
  -> Registered host router
  -> Authentication / resource-access check
  -> Credential store
  -> Typed success or error result
  -> View state update and discovery refresh
```

Atlas uses `choose -> form -> checking -> success` phases. An edit skips method selection.
Failed verification remains on the checking screen with retry/back options.

API Key verification uses an authenticated project-list request. Service Account verification
first obtains a token and then checks project access. Neither path persists rejected input.
The host checks cancellation before persistence. Initial panel configuration does not carry
private secrets; newly entered credentials travel to the host through a mutation.

**Reuse the shell and lifecycle, not Atlas-specific fields or authentication calls.** AWS methods,
fields, and validation will be mapped from the operator's demo application.

### 3.4 Authentication and discovery

| File | Responsibility |
| ---- | -------------- |
| [atlasCredentialStore.ts](../../src/plugins/service-atlas-mongodb/credentials/atlasCredentialStore.ts) | Independent credential records, secure secrets, and secret rotation with fixed identity. |
| [AtlasCredentialSessionRegistry.ts](../../src/plugins/service-atlas-mongodb/auth/AtlasCredentialSessionRegistry.ts) | Per-credential sessions and token refresh. |
| [AtlasApiClient.ts](../../src/plugins/service-atlas-mongodb/api/AtlasApiClient.ts) | Atlas resource-listing requests. |
| [AtlasDiscoveryService.ts](../../src/plugins/service-atlas-mongodb/discovery/AtlasDiscoveryService.ts) | Aggregation, cache, concurrency, deduplication, and partial failures. |
| [AtlasOrganizationItem.ts](../../src/plugins/service-atlas-mongodb/discovery-tree/AtlasOrganizationItem.ts) | Organization-level hierarchy. |
| [AtlasProjectItem.ts](../../src/plugins/service-atlas-mongodb/discovery-tree/AtlasProjectItem.ts) | Project hierarchy and cluster loading. |
| [AtlasClusterModel.ts](../../src/plugins/service-atlas-mongodb/models/AtlasClusterModel.ts) | Normalized metadata, endpoint, and stable identity. |
| [atlasClusterAvailability.ts](../../src/plugins/service-atlas-mongodb/atlasClusterAvailability.ts) | Shared cluster readiness verdict for tree and wizard. |
| [SelectAtlasSteps.ts](../../src/plugins/service-atlas-mongodb/discovery-wizard/SelectAtlasSteps.ts) | Project/cluster selection and unavailable-resource handling. |
| [AtlasExecuteStep.ts](../../src/plugins/service-atlas-mongodb/discovery-wizard/AtlasExecuteStep.ts) | Copies the selected endpoint into the shared connection context. |
| [credentialsManagement/](../../src/plugins/service-atlas-mongodb/credentialsManagement/) | Credential selection, add/update, retry, and sign-out actions. |

Atlas tree mode loads clusters on project expansion; list mode requests clusters upfront. Multiple
credentials can contribute the same resource, which appears once. Failed credentials are reported
alongside healthy results instead of clearing the whole discovery tree.

These are reference patterns, not requirements to copy Atlas's organization/project hierarchy or
its entire multi-credential implementation into every provider.

### 3.5 Database connection and saved-node menus

| File | Responsibility |
| ---- | -------------- |
| [AtlasClusterItem.ts](../../src/plugins/service-atlas-mongodb/discovery-tree/AtlasClusterItem.ts) | Discovery cluster behavior, database authentication, and connection material for saving. |
| [SelectAtlasDatabaseUserStep.ts](../../src/plugins/service-atlas-mongodb/connect/SelectAtlasDatabaseUserStep.ts) | Optional database-user suggestions with manual-entry fallback. |
| [addConnectionFromRegistry.ts](../../src/commands/addConnectionFromRegistry/addConnectionFromRegistry.ts) | Saves a discovered endpoint, checks duplicates, and reveals the saved connection without expanding it. |
| [newConnection/ExecuteStep.ts](../../src/commands/newConnection/ExecuteStep.ts) | Shared saving path for the New Connection wizard. |
| [connectionStorageService.ts](../../src/services/connectionStorageService.ts) | Persistent connection storage. |
| [DocumentDBClusterItem.ts](../../src/tree/connections-view/DocumentDBClusterItem.ts) | Saved connection node. |
| [ClusterItemBase.ts](../../src/tree/documentdb/ClusterItemBase.ts) | Shared client lifecycle, authentication integration, database expansion, and recovery. |
| [DatabaseItem.ts](../../src/tree/documentdb/DatabaseItem.ts) | Database node and collection expansion. |
| [package.json](../../package.json) and [ClustersExtension.ts](../../src/documentdb/ClustersExtension.ts) | Menu eligibility and command execution. |

Do not recreate the screenshot 4/5 menus inside the new plugin. Preserve shared node context tags,
reuse standard commands, and explicitly gate unsupported operations. Sharing menus does not prove
that every operation is supported by a particular database service; compatibility must be tested.

## 4. Repeatable provider-onboarding process

### Step 1: Define the contract

Specify provider identity, entry paths, credential lifecycle, resource hierarchy, database
authentication, readiness, and connection reachability. Separate discovery identity from database
identity. Identify which decisions are confirmed and which need a demo or live-service experiment.

### Step 2: Register the provider and entry surfaces

Implement `DiscoveryProvider`, register it, and expose its root. Verify New Connection, the sidebar,
and hide/show behavior. Define signed-out, loading, empty, error, and ready states deliberately.

### Step 3: Build credential onboarding

Reuse the shared wizard shell and panel factory. Register the React view and host router. Keep
verification and persistence host-side. Define Back, Cancel, retry, secret rotation, and panel-close
behavior before implementing the success path.

### Step 4: Implement discovery independently of rendering

Normalize API results into provider models. Handle pagination, bounded concurrency, refresh, and
partial failures. Use shared availability rules in both the sidebar and selection wizard.

### Step 5: Implement browsable cluster nodes and identity

Every browsable cluster must extend `ClusterItemBase`.

- `clusterId`: stable, slash-free, provider-prefixed cache identity.
- `treeId`: current hierarchical tree position.
- `viewId`: owning branch provider.
- Credentials and clients are keyed by `clusterId`, not `treeId`.
- The current Discovery provider removes the prefix through the first underscore and looks up a
  cached tree-node suffix. Choose provider IDs and resource suffixes compatible with that contract.
- Use the same stable suffix in every rendered layout; make it collision-safe within the provider.
- Test rendering through the real parent and resolving the cluster and collection back from its
  stable identity.

### Step 6: Wire both connection-saving paths

Support sidebar Save to Connections and New Connection's shared execute step. Define the connection
material returned by `getCredentials()`. Verify duplicate handling, reload, folder moves, and
database login after save. Add a reachability provider only if connection preparation is needed.

### Step 7: Finish lifecycle and diagnostics

Wire credential management, refresh, retry, and removal. Preserve healthy discovery results during
partial failures where applicable. Diagnostics providers return explanations; callers own UI and
recovery. Do not confuse hiding a provider, removing a credential, and deleting a saved connection.

### Step 8: Verify the full journey and document it

Cover these acceptance scenarios:

- Both entry points reach the intended onboarding UI.
- Invalid credentials and cancelled verification do not create stored credentials.
- Successful persistence refreshes discovery and Done closes the panel.
- Empty, loading, transient failure, permission failure, and unavailable-resource states are usable.
- Tree and wizard agree on which resources can connect.
- Tree/list render-to-lookup round trips preserve identity.
- Both saving paths produce usable saved connections without unexpected login prompts.
- Saved connections survive reload and folder moves.
- Database/collection actions are available only where supported.
- Secrets are absent from logs, telemetry, and non-secret configuration.
- Keyboard navigation, focus, theme, and narrow-panel layouts work.

Useful test references include [atlasTree.test.ts](../../src/plugins/service-atlas-mongodb/discovery-tree/atlasTree.test.ts),
[AtlasClusterModel.test.ts](../../src/plugins/service-atlas-mongodb/models/AtlasClusterModel.test.ts),
[AtlasDiscoveryService.test.ts](../../src/plugins/service-atlas-mongodb/discovery/AtlasDiscoveryService.test.ts),
and [atlasCredentialsRouter.test.ts](../../src/webviews/documentdb/atlasCredentials/atlasCredentialsRouter.test.ts).

During implementation, follow the repository's Case 1 build and targeted-test checks. Run the full
Case 2 verification when handing a PR over for review. This document does not claim either suite
has run for AWS discovery.

## 5. Agreed AWS roadmap

### Confirmed scope, updated 2026-10-28

The demo has now been inspected. The [AWS integration analysis](./features/aws-discovery/README.md)
contains the second-pass source evidence, login-card specification, and implementation gates.

| Decision | Agreed scope |
| -------- | ------------ |
| Deliverables | A reusable provider-onboarding guide and an AWS implementation roadmap. |
| Initial resources | Amazon DocumentDB provisioned clusters only. |
| Visual direction | Reuse Atlas's shared UI structure and closely match the screenshots' layout and step sequence. |
| Provider wording | Adapt names and instructions to AWS; do not retain Atlas-specific credential terminology. |
| Authentication | Four Atlas-style login cards: AWS profile (Recommended), Access key, SSO, and Temporary credentials. Preserve role/MFA-backed profiles; no standalone Assume Role or Default credential chain cards. |
| Credential and region scope | Multiple independent credential entries/accounts; select and remember regions per entry. |
| Networking | Existing route with CA configuration and diagnostics; no managed SSM/SSH tunnels initially. |
| Cluster expansion | Databases and collections; infrastructure metadata in separate details/tooltips. |
| Entry points | Both New Connection -> Service Discovery and sidebar sign-in/browsing. |
| Completion scope | Save to Connections and shared cluster/database menus, with compatibility verification. |

### Milestones

| Milestone | Deliverable | Completion gate |
| --------- | ----------- | --------------- |
| 1. Reference mapping | Map this Atlas process to the AWS demo. | Authentication methods, session lifecycle, resource model, and connection prerequisites identified. |
| 2. Provider integration | Registration, sidebar root, New Connection entry, and command wiring. | Both entry points reach the intended onboarding surface. |
| 3. Atlas-like onboarding | Header, method cards, details/help, Verify, Done, Back/Cancel, and error recovery. | Visual structure matches Atlas; AWS wording and demo-backed behavior are correct. |
| 4. Discovery browsing | Resource enumeration, hierarchy, readiness, refresh, and recoverable failures. | Sidebar and wizard expose consistent selectable resources. |
| 5. Connection handoff | Save through both paths and use shared database connection infrastructure. | Saved connections survive reload and expose databases/collections when reachable and authorized. |
| 6. E2E verification and guide | Automated contracts, screenshot walkthrough, and completed onboarding checklist. | Another contributor can follow the guide without reverse-engineering Atlas. |

Milestone 1 is the prerequisite for finalizing AWS behavior. Milestones 2 and 3 establish the entry
surfaces; milestone 4 supplies their resource data; milestone 5 completes the saved-connection
journey; milestone 6 verifies the integrated result. Demo reference mapping has now been completed
as source analysis; live authentication and connection validation remain implementation work.

### Follow-up choices and validation

- A user-selected local CA bundle on the extension host; no automatic download.
- Identity-only entries are accepted after successful verification even if every region denies discovery.
- Temporary entries, including preferences, are memory-only.
- Other syntactically valid region names can be entered; partition-specific live coverage is unverified.
- Infrastructure metadata uses tooltips; cluster children remain databases/collections.
- Native database username/password authentication; shared connection commands retain TLS settings.
- Both tree and list layouts are included, using the Atlas toggle convention.

The [implementation walkthrough](./features/aws-discovery/README.md#contributor-and-operator-walkthrough)
describes the resulting process. No cloud resources were created, and live AWS/database and
side-by-side screenshot validation remain outstanding.
