---
feature: aws-discovery
kind: feature
status: active
created: 2026-10-28
verified: 2026-10-28
code:
    - src/services/discoveryServices.ts
    - src/plugins/service-aws-documentdb/**
    - src/webviews/documentdb/awsCredentials/**
---

# AWS discovery: implementation and integration analysis

## Status and recommendation

**Implemented locally; live AWS validation remains outstanding.** The original second-pass analysis
is retained below as rationale. The implementation uses the existing Atlas wizard shell and native
discovery/connection infrastructure, not the standalone demo's UI. Automated checks and live-test
limitations are recorded in the verification section.

Reuse the demo's AWS authentication and resource-discovery concepts, but integrate them as a native
discovery provider in this extension. Reuse Atlas's card-based onboarding layout and shared tree,
connection, and webview infrastructure. Do not embed the demo extension, import its Explorer tree,
or create another database connection implementation.

The demo is a control-plane discovery application. Its connection action generates a URI for the
clipboard; it does not establish a database connection. Completing database browsing is therefore
new integration work, not simply relocating an existing demo feature.

See the [general onboarding guide](../../service-discovery-onboarding-roadmap.md) for the original
screenshot sequence and shared file map.

### Evidence conventions

- **Observed** means verified in source during this analysis.
- **Confirmed** means explicitly selected by the operator.
- **Proposed** means an implementation recommendation, not an already-shipped behavior.
- Demo links assume sibling checkouts named `aws-docdb-discovery` and `vscode-documentdb`.
  They are local reference links, not a build dependency; they will not resolve in a standalone
  checkout of this repository.
- Line anchors describe the inspected source and may move as either repository evolves.

## 1. Confirmed scope

The operator confirmed the following on 2026-10-28:

| Area                  | Requirement                                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Resource scope        | Amazon DocumentDB provisioned clusters.                                                                                 |
| Login presentation    | Selectable login cards like Atlas, not the demo's method Quick Pick.                                                    |
| Login cards           | AWS profile, Access key, SSO, Temporary credentials.                                                                    |
| Recommended card      | AWS profile.                                                                                                            |
| Excluded cards        | Standalone Assume Role and Default credential chain.                                                                    |
| Profile compatibility | Preserve SDK-supported role-backed and MFA profiles under AWS profile.                                                  |
| Credential model      | Multiple independent credential entries/accounts, like Atlas.                                                           |
| Region scope          | Select and remember regions per credential entry.                                                                       |
| Entry points          | Service Discovery sidebar and New Connection -> Service Discovery.                                                      |
| Cluster expansion     | Databases, then collections; AWS metadata belongs in separate details/tooltips.                                         |
| Network scope         | Existing network route, CA configuration, and connection diagnostics.                                                   |
| Tunnel scope          | No managed SSM/SSH tunneling in the first implementation.                                                               |
| Saved connections     | Use the standard Connections view and shared cluster/database commands.                                                 |
| Layouts               | Both account/region tree and flat cluster list, with Atlas-style root toggle.                                           |
| Verification policy   | A verified AWS identity may be saved even if every selected region denies discovery. Failures remain visible.           |
| CA handling           | Select an existing local PEM CA bundle on the extension host, during database connection setup rather than AWS sign-in. |

These decisions supersede the earlier roadmap's assumption that the demo and login methods were
still pending. Multiple credential entries do not imply automatically enumerating every account
available to an SSO user: account/role selection remains part of establishing an entry.

## Contributor and operator walkthrough

1. Provide an existing network route from the VS Code extension host to the cluster VPC. AWS
   API sign-in does not establish that route. Obtain a current AWS CA bundle following the
   [AWS TLS guidance](https://docs.aws.amazon.com/documentdb/latest/developerguide/security.encryption.ssl.html).
2. Expand **Service Discovery -> AWS DocumentDB** and select its sign-in row. Alternatively use
   **New Connection -> Service Discovery -> AWS DocumentDB**.
3. Choose one of the four cards: AWS profile (Recommended), Access key, SSO, or Temporary credentials.
   The outer stages and navigation match Atlas: Choose method, Enter details, Verify, Done.
4. Enter the method's details and selected regions. A profile references local AWS configuration;
   it does not copy the files. SSO opens browser approval, then account and role selection within
   the details stage. Profile MFA can prompt only during explicit sign-in.
5. Select **Verify & Save**. STS identity verification is the acceptance gate, not regional
   permissions or database connectivity. Temporary credentials remain session-only. Close dismisses
   the completed panel; cancellation before acceptance does not save the candidate.
6. Browse **account -> region -> cluster**, or switch the root to the flat list. Regional and
   credential failures produce a recovery row alongside healthy clusters; inspect its tooltip.
   Manage Credentials supports independent entries, updating, reauthentication, removal, and retry.
7. Expand an available cluster. Select a readable PEM CA bundle on the extension host, then supply
   the **database** username/password. AWS API credentials are not reused as database credentials.
   Cluster children are the shared database and collection nodes, not infrastructure metadata.
8. Use **Save to Connections** to persist a normal database connection. The New Connection path
   selects account/region and cluster before the same CA configuration and shared persistence.
   Saving alone does not assert database connectivity; a saved connection without database
   credentials prompts when first connected.
9. **Select AWS CA Bundle...** on a discovered cluster replaces its selected bundle and clears the
   active client before reuse. Existing saved connections are independent; update their connection
   string if their `tlsCAFile` path changes. Removing discovery credentials never deletes them.

The bundle path is machine-local and absolute, so copied connection strings may need a different
path on another machine. Certificate and hostname verification remain enabled. No bundle downloads,
CLI installation, managed tunnels, or cloud resource changes are performed.

### Browser SSO compatibility

The browser flow follows the demo's device authorization sequence: register a public OIDC client,
request device authorization in the Identity Center region, open `verificationUriComplete` (or
`verificationUri`), poll for approval, then select an account and role. Discovery regions are
independent of the Identity Center region. Candidate tokens remain staged until **Verify & Save**;
Back, cancellation, browser-opening failure, and panel disposal discard the pending flow.

The browser URL check accepts AWS regional device/OIDC hosts and directory access-portal URLs such
as `https://directory-alias-example.awsapps.com/start/#/device?user_code=EXAMPLE`, as shown in the
AWS SDK's `StartDeviceAuthorizationCommand` example. The initial implementation accepted only
regional hosts, so it rejected valid access-portal responses before opening the browser. The demo
does not apply that restriction. HTTPS, host boundaries, access-portal device paths, and the absence
of credentials or a nondefault port are still checked; arbitrary URLs are not opened.

Browser launch failures now have a specific recovery message. The view displays host-sanitized
errors using the same `Error` guard as Atlas instead of requiring a particular `TRPCClientError`
class identity. Tests reproduce both the rejected valid URL and the previously hidden error.
These are code-confirmed defects; the screenshot's generic message alone does not establish
which failure occurred in a live session. Live browser approval still needs operator validation.

### VPC details and endpoint troubleshooting

VPC tooltip enrichment fetches VPC ID, subnet group, subnet IDs/AZs/status, security-group IDs/
status, cluster AZs and network type. It requires the `rds:DescribeDBSubnetGroups` IAM action in
addition to cluster enumeration. If that optional permission is denied, cluster discovery still
succeeds and the tooltip explains that the VPC details are unavailable.

Use the DocumentDB endpoint hostname rather than a hard-coded IP for normal connections. AWS
places the cluster in a VPC, and cluster DNS endpoints provide a stable service name whose target
can change during failover. A literal IP may bypass a local DNS-resolution problem, but can instead
be a proxy/bastion address or stale endpoint address; it also does not preserve hostname-based TLS
certificate verification. Compare DNS and TCP checks from the same extension-host machine before
attributing the behavior to DocumentDB:

```powershell
Resolve-DnsName <full-cluster-endpoint>
Test-NetConnection <full-cluster-endpoint> -Port 27017
Test-NetConnection 18.215.214.255 -Port 27017
```

The direct-IP success alone does not establish that the address belongs to the cluster or that
the hostname is wrong. Keep TLS certificate and hostname checks enabled. See AWS's
[VPC connectivity guidance](https://docs.aws.amazon.com/documentdb/latest/developerguide/connect-from-outside-a-vpc.html)
and [TLS documentation](https://docs.aws.amazon.com/documentdb/latest/developerguide/security.encryption.ssl.html).

## 2. Second-pass findings

| Finding                                                           | Source evidence                                                                                                                                                                                                                                                                                                   | Integration consequence                                                                                                                                                                         |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Atlas already has the desired card interaction.                   | [AtlasCredentialsView.tsx](../../../../src/webviews/documentdb/atlasCredentials/AtlasCredentialsView.tsx#L319) uses Fluent `Card`, `CardHeader`, `Radio`, selected styling, icons, and qualifier text. Its `cardGrid` uses two columns and one below 640px.                                                       | Use the same interaction and responsive layout for four AWS cards. No new design system is needed.                                                                                              |
| Atlas has four outer phases, with a different final button label. | [AtlasCredentialsView.tsx](../../../../src/webviews/documentdb/atlasCredentials/AtlasCredentialsView.tsx#L573) renders Continue, Verify & Save, and Close; the final step is labelled Done.                                                                                                                       | Preserve the distinction between Done as a stage and Close as an action. Add method-specific substates rather than assuming every login is one submission.                                      |
| The demo is single-session.                                       | [authManager.ts](../../../../../aws-docdb-discovery/src/auth/authManager.ts#L41) has one `_session` and one persisted session key. [accessKey.ts](../../../../../aws-docdb-discovery/src/auth/accessKey.ts#L5) and [sso.ts](../../../../../aws-docdb-discovery/src/auth/sso.ts#L24) use fixed secret keys.        | Replace global slots with entry-scoped storage, sessions, refresh locks, and invalidation. Do not instantiate multiple managers sharing these keys.                                             |
| Access-key input is stored before validation.                     | [accessKey.ts](../../../../../aws-docdb-discovery/src/auth/accessKey.ts#L38) writes during collection; [authManager.ts](../../../../../aws-docdb-discovery/src/auth/authManager.ts#L95) collects before activation/STS validation. Its cleanup skips entries with the same method.                                | A failed same-method replacement can overwrite the prior secret. Stage candidate input in memory and commit only after verification, preserving the previous entry on failure.                  |
| SSO also persists intermediate state early.                       | [sso.ts](../../../../../aws-docdb-discovery/src/auth/sso.ts#L113) saves the token cache before account/role selection. Cancellation can return before the manager receives a completed configuration.                                                                                                             | Keep onboarding registration/tokens in an operation-scoped host context until the entry is accepted; dispose staged state on cancellation.                                                      |
| Profile support already includes MFA.                             | [profile.ts](../../../../../aws-docdb-discovery/src/auth/profile.ts#L147) passes `mfaCodeProvider` to `fromIni`. [authManager.ts](../../../../../aws-docdb-discovery/src/auth/authManager.ts#L152) skips explicit MFA role configurations on restore, but still activates profiles with the interactive callback. | The comment "never prompts" is not sufficient to guarantee silent restoration. Background resolution must return an interaction-required state instead of launching MFA UI.                     |
| Expiry-aware single-flight refresh is useful existing logic.      | [credentialRefresher.ts](../../../../../aws-docdb-discovery/src/auth/credentialRefresher.ts#L38) joins in-flight resolution and forwards forced refresh.                                                                                                                                                          | Adapt it per credential entry; add invalidation/generation protection so an old completion cannot restore removed or replaced credentials.                                                      |
| Temporary credentials are intentionally nonpersistent.            | [methods.ts](../../../../../aws-docdb-discovery/src/auth/methods.ts#L97) excludes temporary credentials from persistence; [temporary.ts](../../../../../aws-docdb-discovery/src/auth/temporary.ts#L58) checks known expiry.                                                                                       | Recommended carry-forward: keep their secret material in memory and clearly explain expiry/re-entry. Do not serialize the demo's secret-bearing `BaseConfig` union as panel config or metadata. |
| Optional metadata is partly coupled to core discovery.            | [docdbDiscovery.ts](../../../../../aws-docdb-discovery/src/discovery/docdbDiscovery.ts#L145) requires cluster, instance, and subnet-group calls in one `Promise.all`; EC2 enrichment later uses `allSettled`.                                                                                                     | Split cluster enumeration from optional instance/network enrichment so metadata permission failures do not erase usable clusters.                                                               |
| Some failures can disappear as unavailable regions.               | [errors.ts](../../../../../aws-docdb-discovery/src/util/errors.ts#L60) classifies rejected-token and DNS errors as unavailable; [clusterTree.ts](../../../../../aws-docdb-discovery/src/ui/clusterTree.ts#L34) hides skipped regions by default.                                                                  | Keep auth, permission, and network failures distinct from positively identified unsupported/disabled regions. Display recovery rather than hiding uncertain failures.                           |
| The demo tree is not a database tree.                             | [clusterTree.ts](../../../../../aws-docdb-discovery/src/ui/clusterTree.ts#L46) expands clusters into endpoints, metadata, and instances.                                                                                                                                                                          | Replace the cluster node with a `ClusterItemBase` subclass. Keep metadata out of the database-child path.                                                                                       |
| Copying a URI is not connection support.                          | [extension.ts](../../../../../aws-docdb-discovery/src/extension.ts#L146) asks for database credentials and copies a URI; [connectionString.ts](../../../../../aws-docdb-discovery/src/util/connectionString.ts#L8) assumes a relative CA file.                                                                    | Implement the normal database-auth/save handoff and explicit CA handling. Test real clients rather than accepting a correctly formatted URI as success.                                         |

### What this clarifies in the initial analysis

1. The reusable part is the demo's AWS behavior, not an unchanged authentication manager or UI.
2. SSO needs a staged workflow even when the outer UI retains Atlas's four-step appearance.
3. Profile restoration is not proven noninteractive by the demo.
4. Regional failure isolation in the demo depends on the caller wrapping each scan. The worker
   pool itself does not catch arbitrary scan failures; the new service must own this contract.
5. Atlas rejects a credential that sees no projects. Do not copy that rule blindly: successful AWS
   enumeration returning zero clusters must remain a valid empty result.

## 3. Login-card UI contract

**The four authentication methods must be cards on the Choose method page, like Atlas.** They are
not four Command Palette commands or a replacement method Quick Pick.

Implemented arrangement, with AWS profile selected initially:

```text
Add an AWS DocumentDB connection
Discover AWS clusters, then connect using database credentials.

Choose method > Enter details > Verify > Done

+--------------------------------+--------------------------------+
| AWS profile                    | Access key                     |
| Recommended                    | Access Key ID + Secret Key     |
| Use a configured AWS profile.  | Provide an explicit key pair.  |
+--------------------------------+--------------------------------+
| SSO                            | Temporary credentials          |
| IAM Identity Center            | Key ID + secret + token        |
| Sign in through your browser.  | Session-only; expires.         |
+--------------------------------+--------------------------------+

Continue    Cancel                                      Learn more
```

Match Atlas's card icon, title, qualifier, explanatory text, selected outline, radio affordance,
header, step navigation, footer, and theme integration. Use two columns when space permits and
one on narrow panels. AWS wording must describe AWS behavior, not Atlas API Keys or Service Accounts.
Avoid describing long-lived credentials as guaranteed to remain valid forever.

### Method-specific details

| Card                  | Inputs/interactions                                                                                          | Host-side work                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| AWS profile           | Profile picker inside the webview, safe profile-type summary, region selection; MFA when required.           | Enumerate profile metadata, resolve using SDK, verify effective identity. Do not send profile file contents to the webview.                         |
| Access key            | Access Key ID, masked Secret Access Key, regions.                                                            | Validate candidate identity before durable storage; discover regional resources separately.                                                         |
| SSO                   | SSO profile/settings, start URL and SSO region, browser approval, account/role selection, discovery regions. | Register client/device authorization, poll with cancellation, list accounts/roles, obtain role credentials, verify access. Tokens remain host-side. |
| Temporary credentials | Access Key ID, masked secret/token, optional expiry, regions.                                                | Validate without durable secret storage; show expiry and re-entry requirements.                                                                     |

### Outer stages and inner interaction

- **Choose method:** cards, Continue, Cancel.
- **Enter details:** method fields and region selection. For SSO, use explicit browser-sign-in and
  account/role substeps inside this stage; do not hide account selection inside a passive spinner.
- **Verify:** resolve and validate the final identity, then accept the entry. Regional discovery
  runs separately and reports permission failures in the tree or selection wizard. Identity success
  is not proof of discovery permissions or database connectivity.
- **Done:** summarize account/role, selected regions, and storage/session policy; Close dismisses
  the panel. Do not say a temporary secret was saved permanently.

Profile MFA is an interactive challenge belonging to the foreground onboarding/re-authentication
operation. The exact inline challenge component can be finalized during implementation, but it
must not appear unexpectedly during passive tree expansion or startup.

The operator explicitly chose to accept valid identity-only entries even when all regions deny
discovery. Empty successful discovery is valid, healthy peers are preserved, and all regional
failures stay visible. A successful sign-in must never claim that database access was tested.

## 4. Target architecture and file plan

The implementation is contained in the following provider and webview folders:

```text
src/plugins/service-aws-documentdb/
  AwsDiscoveryProvider.ts
  config.ts
  auth/                       credential resolution, SSO, profile/MFA lifecycle
  credentials/                entry metadata and secret persistence
  credentialsManagement/      add, update, reauthenticate, remove, retry
  api/                        AWS SDK calls and pagination
  discovery/                  aggregation, caching, cancellation, ownership
  models/                     resource identity, readiness, endpoints
  connect/                    strict TLS URI construction and local CA selection
  discovery-tree/             root, account, region, cluster
  discovery-wizard/           New Connection resource selection
  AwsDiagnosticsProvider.ts

src/webviews/documentdb/awsCredentials/
  AwsCredentialsView.tsx
  awsCredentialsController.ts
  awsCredentialsRouter.ts
```

Keep the first implementation provider-specific. Do not introduce a universal cloud-login framework
or refactor Atlas merely to share its two-card rendering helper. Reuse existing shared components;
extract additional shared code only when both consumers genuinely need it.

| Existing file/surface                                                                                           | Planned integration                                                                |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [discoveryServices.ts](../../../../src/services/discoveryServices.ts)                                           | Implement `DiscoveryProvider`; preserve its tree and wizard contracts.             |
| [ClustersExtension.ts](../../../../src/documentdb/ClustersExtension.ts)                                         | Register provider, commands, diagnostics, and lifetime cleanup.                    |
| [package.json](../../../../package.json)                                                                        | Provider-specific command/menu contributions and required AWS SDK dependencies.    |
| [WebviewRegistry.ts](../../../../src/webviews/_integration/WebviewRegistry.ts)                                  | Register the AWS React component.                                                  |
| [appRouter.ts](../../../../src/webviews/_integration/appRouter.ts)                                              | Register typed AWS procedures and validation.                                      |
| [openAppWebview.ts](../../../../src/webviews/_integration/openAppWebview.ts)                                    | Reuse panel creation, messaging, and disposal.                                     |
| [Wizard.tsx](../../../../packages/vscode-ext-webview-fluentui/src/components/Wizard/Wizard.tsx)                 | Reuse shared layout/navigation rather than copying the screenshot as bespoke HTML. |
| [ClusterItemBase.ts](../../../../src/tree/documentdb/ClusterItemBase.ts)                                        | Extend for browsable AWS clusters; preserve common context tags and commands.      |
| [addConnectionFromRegistry.ts](../../../../src/commands/addConnectionFromRegistry/addConnectionFromRegistry.ts) | Reuse Save to Connections.                                                         |
| [newConnection/ExecuteStep.ts](../../../../src/commands/newConnection/ExecuteStep.ts)                           | Reuse wizard persistence, duplicate handling, and reveal.                          |

Concrete AWS entry points:

| File                                                                                                                          | Responsibility                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [AwsDiscoveryProvider.ts](../../../../src/plugins/service-aws-documentdb/AwsDiscoveryProvider.ts)                             | Native provider, New Connection steps, credentials and layout commands.                                 |
| [AwsServiceRootItem.ts](../../../../src/plugins/service-aws-documentdb/discovery-tree/AwsServiceRootItem.ts)                  | Sign-in/recovery/empty rows, account/region hierarchy and flat list.                                    |
| [AwsClusterItem.ts](../../../../src/plugins/service-aws-documentdb/discovery-tree/AwsClusterItem.ts)                          | Shared cluster base, database credentials, Save/Copy material and CA replacement.                       |
| [AwsClusterModel.ts](../../../../src/plugins/service-aws-documentdb/models/AwsClusterModel.ts)                                | ARN-derived stable suffix shared by both layouts and reverse lookup.                                    |
| [SelectAwsClusterSteps.ts](../../../../src/plugins/service-aws-documentdb/discovery-wizard/SelectAwsClusterSteps.ts)          | Account/region and cluster selection, recovery and CA handoff.                                          |
| [awsConnection.ts](../../../../src/plugins/service-aws-documentdb/connect/awsConnection.ts)                                   | PEM validation and credential-free URI with strict TLS, `rs0`, secondaryPreferred, and no retry writes. |
| [AwsDiscoveryService.ts](../../../../src/plugins/service-aws-documentdb/discovery/AwsDiscoveryService.ts)                     | Verification, entry lifecycle, refresh and merged discovery snapshots.                                  |
| [awsCredentialStore.ts](../../../../src/plugins/service-aws-documentdb/credentials/awsCredentialStore.ts)                     | Isolated metadata/secret slots and memory-only temporary entries.                                       |
| [AwsCredentialsView.tsx](../../../../src/webviews/documentdb/awsCredentials/AwsCredentialsView.tsx)                           | Atlas-style four-card wizard and method-specific details.                                               |
| [awsCredentialsRouter.ts](../../../../src/webviews/documentdb/awsCredentials/awsCredentialsRouter.ts)                         | Host validation, panel-owned SSO flows and acceptance/cancellation boundary.                            |
| [awsCredentialsController.ts](../../../../src/webviews/documentdb/awsCredentials/awsCredentialsController.ts)                 | Panel creation, completion and disposal.                                                                |
| [configureAwsCredentials.ts](../../../../src/plugins/service-aws-documentdb/credentialsManagement/configureAwsCredentials.ts) | Multi-entry management shared by sidebar and wizard.                                                    |
| [AwsDiagnosticsProvider.ts](../../../../src/plugins/service-aws-documentdb/AwsDiagnosticsProvider.ts)                         | Text-only TLS and network explanations for discovery and saved AWS endpoints.                           |

AWS SDK clients belong exclusively in host-side modules. Select versions against this repository's
runtime/bundler requirements; do not copy the demo's dependency versions or installation artifacts
without validation. The demo manifest has build/typecheck scripts but no automated test script.

## 5. Credential and discovery lifecycle

### Independent credential entries

Use an opaque stable entry ID. Persist non-secret method/configuration, label, verified identity,
and selected regions separately from secret material. Do not use account ID alone as credential
identity: multiple roles or profiles can target one account.

- Isolate access keys and SSO caches by entry.
- Keep profile references rather than copying the user's shared AWS credential files.
- Temporary secrets and metadata are memory-only; the whole temporary entry disappears after reload.
- Stage new/updated candidates before validation; failed updates preserve the previous entry.
- Make completion/cancellation idempotent and prevent late async results from reviving removed
  entries. Cancellation before the persistence boundary must leave no newly accepted credential.
- Never remove a saved database connection merely because discovery credentials are removed.
- Signing out locally does not imply revoking AWS keys or deleting external CLI/SSO profile caches.

### Resource tree

```text
Service Discovery
  AWS DocumentDB
    Account
      Region
        Cluster
          Database
            Collection
```

The account/region hierarchy and flat list are implemented. Credentials are managed separately.
Clusters are deduplicated by full ARN; the first successful entry supplies ownership. A failed
credential or region does not erase healthy peers.

Use provider-prefixed, slash-free stable IDs derived from partition/account/region/resource
identity. Keep original AWS identity for API calls. Do not include an expiring STS session name or
credential record ID in a cluster's stable resource identity.

[DiscoveryBranchDataProvider.ts](../../../../src/tree/discovery-view/DiscoveryBranchDataProvider.ts#L338)
currently removes the provider prefix through the first underscore and searches a cached tree
suffix. The AWS tree must preserve that suffix in every layout and test real render-to-lookup
round trips. A new exact-identity lookup system is not a prerequisite for this provider.

Refresh should use remembered per-entry regions, bounded concurrency, pagination, cancellation,
and explicit error classification. Fetch infrastructure metadata on demand or independently of
basic enumeration. Preserve DNS hostnames for connection use; resolved IP details are informational.

The first implementation enumerates clusters only; it does not require EC2, instances, or subnet-group
permissions. Scans use four workers, paginated API calls and a 60-second snapshot cache. Credential
resolution is single-flight per entry, with generation guards against stale replacements/removals.
Refresh is lazy, not a background timer. AWS SDK defaults govern request timeouts; cancellation
aborts outstanding requests. There is no separate overall scan deadline.

The suggested region list is commercial, but validation permits other syntactically valid regions
(up to 50 per entry). The SDK selects endpoints from region names; cluster ARNs preserve partitions.
China/GovCloud operation is not live-certified by the current checks.

## 6. Database connectivity is a separate workstream

Discovery verifies AWS API access. Connecting verifies endpoint reachability, TLS, database
authentication, and database permissions. Report these as distinct failures.

The implementation uses the standard database username/password flow. AWS API credentials and
SSO tokens are never treated as database credentials. Database IAM authentication is not included.

The demo URI includes `tlsCAFile=global-bundle.pem`, `replicaSet=rs0`,
`readPreference=secondaryPreferred`, and `retryWrites=false`. These are reference settings, not
proof that the integrated client works. In particular:

- Define CA-file selection/provisioning and lifecycle explicitly.
- Resolve paths on the extension host, including remote VS Code environments.
- Validate missing/unreadable CA files and keep certificate/hostname verification enabled.
- Verify settings reach discovery browsing, saved connections, shell, playground, and other
  relevant clients; a successful tree connection alone is not enough.
- Use an existing route; do not add managed tunnels under this scope.
- Keep metadata separate from database children and gate commands that the service cannot support.

The AWS diagnostics provider returns explanations only. UI and recovery belong to the foreground
caller. No reachability provider is registered because there is no managed tunnel or other
connect-time infrastructure preparation.

## 7. Implementation sequence and acceptance gates

| Phase | Deliverable                               | Required evidence                                                                                                                          |
| ----- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | Credential records and four auth adapters | Independent entries; failed replacement preserves prior state; cancellation and stale completions tested.                                  |
| 2     | Atlas-style login panel                   | Exactly four cards; AWS profile marked Recommended; responsive selection, keyboard/focus behavior, help, and error states.                 |
| 3     | Interactive SSO/profile handling          | Browser approval/account/role flow; cancellation stops polling; MFA only on explicit foreground paths; no token leakage into panel config. |
| 4     | Discovery service and tree                | Per-entry regions; pagination; duplicate-resource merge; partial failures; valid empty results; readiness consistency.                     |
| 5     | Both connection entry paths               | Sidebar and New Connection; stable-ID round trips; Save to Connections; no duplicate implementation of shared menus.                       |
| 6     | TLS and database integration              | Existing-route connection with CA handling; database/collection browsing; reload/folder movement; shell/playground propagation.            |
| 7     | Handoff verification                      | Focused mocks/contracts plus live smoke tests and screenshots; report untested methods and blocked environments explicitly.                |

The phase order describes dependencies, not permission to ship a successful-looking UI without
the underlying connection functionality. Use repository-standard build/test tooling during
implementation and the full ready-for-review verification before PR handoff.

Minimum regression scenarios:

- Card selection persists only intentional UI state and clears stale method-specific secrets.
- Two entries for one account do not overwrite each other's secret or session.
- Removal/sign-out during refresh cannot resurrect a credential.
- Temporary credentials with known and unknown expiry recover without pretending to auto-renew.
- SSO browser cancellation, timeout, slow polling, refresh rejection, and account/role cancellation.
- Profile MFA on explicit sign-in versus noninteractive restore/expansion.
- One denied region plus one healthy region; network failure is not hidden as unsupported.
- Metadata permission failure leaves core clusters browsable.
- Same cluster through different credentials appears once and retains a usable follow-up owner.
- Actual parent-rendered cluster and collection reverse lookup in every enabled layout.
- Saving a connection, restarting, moving folders, and reconnecting with CA configuration intact.

## 8. Open decisions and limits of this analysis

The implementation choices above settle CA selection, identity-only acceptance, tree/list mode,
tooltip metadata, session-only temporary entries and native database authentication. Remaining
validation is environmental rather than an alternative UI design:

- Live profile/role/MFA, access-key, SSO and temporary-credential authentication.
- Actual AWS discovery in healthy, denied, empty and partition-specific regions.
- Reachable-cluster TLS, database/collection browsing, save/reload and shell/playground operations.
- Side-by-side Atlas/AWS screenshots in an Extension Development Host, including narrow panels,
  focus, keyboard navigation and theme changes.

### Verification

Case 1 verification applies during implementation: `npm run build` and focused Vitest suites.
After rebasing onto the current `main`, the build passed and the focused run passed 12 suites /
97 tests covering the AWS backend, credential router/controller/DOM flow, strict TLS handoff,
tree/list reverse lookup, and lazy webview registration. AWS credentials also has a default
browser-verification fixture and scenario alongside the other registered views.
No live AWS credentials or database connections were used. A browser-preview probe found no
running local preview server, so automated DOM tests do not constitute a visual screenshot review.
Full lint/format/localization/package checks remain deferred until a ready-for-review handoff.
