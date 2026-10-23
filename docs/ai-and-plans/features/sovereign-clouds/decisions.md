---
feature: sovereign-clouds
kind: decisions
status: active
---

# Sovereign Clouds: Decisions

"Adopted" means the operator chose to move forward with the entry while other research is
pending; the operator may still revisit it. Superseded entries are kept for their rejected
alternatives.

| ID  | Status                      | Summary                                                                                            |
| --- | --------------------------- | -------------------------------------------------------------------------------------------------- |
| D1  | **Adopted**                 | The preauthorization gap is fixed outside the extension; no own client ID                          |
| D2  | **Accepted** (operator)     | Implement without sovereign-cloud access, copying patterns proven elsewhere                        |
| D3  | **Accepted** (operator)     | Entra sign-in errors are classified in one table, routed through the diagnostics service           |
| D4  | **Superseded** by D6 and D7 | Which signal decides the cloud                                                                     |
| D5  | **Superseded** by D6        | Custom clouds keep the public audience                                                             |
| D6  | **Adopted**                 | Interactive sign-in: cloud from VS Code's setting; custom clouds resolved, never public            |
| D7  | **Adopted**                 | Managed identity: cloud from an override, the cluster host, then IMDS; otherwise fail clearly      |
| D8  | **Adopted**                 | Stop before requesting a token when the cluster host and the selected cloud clearly disagree       |
| D9  | **Adopted**                 | An opaque broker error in a sovereign cloud gets a hedged message that asks for the on-screen code |
| D10 | **Adopted**                 | Messages are text only in this iteration; no buttons                                               |
| D11 | **Adopted**                 | No public-audience fallback for China unless telemetry shows it works today                        |

---

## D1. Service-side preauthorization, not a client workaround

**Adopted.**

The missing preauthorization (see [README](README.md#what-is-being-done)) is raised with Microsoft
outside the code. Two public precedents were resolved the same way: microsoft/vscode-mssql#22296
(US Government) and microsoft/vscode#244689 (China).

Rejected:

- **Own client ID through `VSCODE_CLIENT_ID:`.** Moves the same approval to a new app and adds a
  registration per national cloud. Whether a Microsoft-published extension may do this at all is a
  policy question. See [research §2](research-findings.md#using-our-own-client-id-instead-not-recommended).
- **Asking customers to grant consent.** Not possible for first-party to first-party access.

## D2. Implement without sovereign-cloud access

**Accepted** by the operator.

The operator has no Azure Government access and asked for changes that are safe "blindly", modeled on
the Azure Resources, Azure Functions, and Azure tools libraries, which are maintained by the team that
handles sovereign clouds daily, and on `vscode-cosmosdb` with more caution because its sovereign paths
are less exercised.

Consequences:

- Every cloud-dependent value comes from a closed, sourced table or from the cloud's own ARM
  metadata, never from a hostname.
- Public-cloud behavior must stay byte-for-byte identical; tests pin that.
- The outcome section of each iteration states plainly that sovereign behavior was not observed.

## D3. One classifier table for Entra sign-in errors

**Accepted** by the operator.

The operator wants one place to add Entra error codes, acting as a router. Adding a code must be a
one-entry change to a table, with no new provider and no new call site.

Design: [iteration 01, part B](iterations/01-cloud-aware-scope-and-entra-diagnostics.md#part-b-entra-error-classifier).
The classifier is consumed by a single `ConnectionDiagnosticsProvider`, so every surface that already
calls `ConnectionDiagnosticsService.explain()` gets it without wiring.

## D4. Which signal decides the cloud

**Superseded** by D6 (interactive) and D7 (managed identity).

The original proposal used `microsoft-sovereign-cloud.environment` for interactive sign-in, and for
managed identity a `TOKEN_RESOURCE` hint, then the host suffix, then the setting. Rejected then and
still rejected: persisting the discovered `subscription.environment` on the connection (only
discovered connections have it; overlaps #931).

## D5. Custom clouds keep the public audience

**Superseded** by D6. Requesting the public audience in a custom cloud would be a silent, wrong
fallback; failing clearly is better.

## D6. Interactive sign-in

**Adopted.**

The audience follows the same setting that chooses the sign-in authority,
`microsoft-sovereign-cloud.environment`, so the two cannot disagree.

| Setting        | Audience                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------- |
| (unset)        | `https://ossrdbms-aad.database.windows.net`, unchanged                                      |
| `USGovernment` | `https://ossrdbms-aad.database.usgovcloudapi.net`                                           |
| `ChinaCloud`   | `https://ossrdbms-aad.database.chinacloudapi.cn`                                            |
| `custom`       | Resolved in this order; **never** the public value by default:                              |
|                | 1. `documentDB.customEnvironment.ossrdbmsEndpoint`                                          |
|                | 2. the login host of `microsoft-sovereign-cloud.customEnvironment` matched to a known cloud |
|                | 3. `ossrDbmsResourceId` from the custom cloud's ARM metadata (`2022-09-01`), cached         |
|                | 4. otherwise fail with a message naming the setting from step 1                             |

`documentDB.customEnvironment` mirrors `mssql.customEnvironment`: an object setting used together
with `microsoft-sovereign-cloud.environment = custom`. Its `ossrdbmsEndpoint` property is the
"sovereign cloud equivalent for `https://ossrdbms-aad.database.windows.net/`".

Deferred: the addendum-style "ask once, pre-filled from `suffixes.sqlServerHostname`" prompt. A
prompt in the token path would also fire from the shell and the playground, where a modal input box
is the wrong surface. Step 4 fails with a clear message instead; the prompt can be added later as a
command.

## D7. Managed identity

**Adopted.**

Managed identity tokens come from the VM, not from VS Code's sign-in, so the setting is not a signal.

1. `documentDB.customEnvironment.ossrdbmsEndpoint`, if set.
2. A `TOKEN_RESOURCE` from the connection string, only if it is one of the known audiences.
3. The cluster host: `.azure.cn` → China, `.azure.com` → public. No `.azure.us` rule until a US
   Government DocumentDB host suffix is publicly documented.
4. IMDS `compute.azEnvironment`: `AZUREPUBLICCLOUD` → public. Any other value means "not public,
   cloud unknown".
5. Otherwise fail with a message naming the setting from step 1.

The VS Code setting is deliberately not consulted: a user who never signs in interactively has no
reason to set it, and a stale value would pick the wrong audience silently.

## D8. Cloud mismatch stops the request

**Adopted.**

For interactive sign-in, when the cluster host ends in `.azure.cn` but the selected cloud is not
China, or ends in `.azure.com` but the selected cloud is not public, the request is stopped before a
token is requested, with a message naming both clouds and the setting. No rule for `.azure.us` (see
D7). Hosts that match neither suffix, such as private DNS names, are not checked.

## D9. Opaque broker errors

**Adopted.**

On Windows the extension receives only `platform_broker_error`, without the AADSTS code (research §3).
When the failure is opaque, the selected cloud is not public, and the failing request was the
DocumentDB token, the message says what AADSTS65002 would mean and asks the user to check the code in
the sign-in window. It never asserts 65002. In the public cloud, an opaque broker error gets a generic
message.

## D10. Text-only messages in this iteration

**Adopted.**

`ConnectionDiagnosticsService` providers return text only, by design (error-translation skill).
Buttons such as "Report issue" or "Switch cloud" would change that contract and every call site. Each
message therefore states who can fix the problem and links to a public troubleshooting page.
Structured actions are future work.

## D11. China and the public audience

**Adopted.**

Microsoft's DocumentDB China documentation uses the China audience, so the extension switches to it.
Before shipping, check telemetry for successful Entra connections to `*.azure.cn` hosts. If there are
any, add a China-only fallback to the public audience after a failure, with telemetry, and remove it
once the data is clear. If there are none, no fallback.
