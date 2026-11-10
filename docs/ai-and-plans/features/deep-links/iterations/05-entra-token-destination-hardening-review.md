---
feature: deep-links
kind: review
status: complete
created: 2026-11-10
code:
    - src/documentdb/auth/oidcAllowedHosts.ts
    - src/documentdb/auth/oidcClientOptions.ts
    - src/documentdb/playground/PlaygroundEvaluator.ts
    - src/documentdb/wizards/authenticate/ChooseAuthMethodStep.ts
---

# Entra token destination hardening: AI pre-review

## Scope and evidence

The operator requested the [hardening plan](./04-entra-token-destination-hardening.md), selected
Option B using the existing machine-scoped setting, and named `claude-opus-5.5` as advisor.
The leader committed the proposal (`e572791ce`) and revised execution plan (`639ebd072`) before
coding. This review covers the resulting stacked change against
`dev/tnaum/url-handler-improvmements`, not `main`.

Five read-only Opus consultations covered the execution plan, shared trust boundary, token
lifecycle/protocol harness/pickers, corrected builder/saved-connection recovery, and final
integration. Reviewers inspected implementation and installed driver source; their reviews did
not run builds or use real credentials, Azure resources or production telemetry.
Coding workers and the leader ran the local tests recorded in the source plan.

The final integrated review covered `639ebd072` plus the uncommitted B1–B5 tree, including
untracked tests. The reviewed implementation was subsequently committed as `95f7267f2`,
`b0982d727`, `414c4e226`, `7f178d4d9` and `c1207ab77`.
The final prescribed measurement correction and mechanical lint fixes were included in those
commits. Formatting and generated localization do not change the reviewed design.

## Findings and implementation dispositions

These are the leader's implementation dispositions under the operator's instruction to complete
the hardening work, **not a claim that the human author performed their final review**.

| Finding                                                                                          | Reviewer assessment                        | Disposition and evidence                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| URI CA files plus SOCKS proxy options can redefine peer trust even for an approved hostname.     | Medium; high confidence.                   | Fixed in `95f7267f2`. Remove every casing of URI CA/CRL and proxy options. Preserve extension-controlled CA options and original stored/native strings. Parser-level regressions cover duplicate case variants.               |
| Two Azure-discovery wizard contexts omit the destination and therefore hide valid Entra methods. | High; high confidence.                     | Fixed in `7f178d4d9`. Both resource items pass `credentials.connectionString`; integration tests drive both real callers, including Entra-only modes and rejected endpoints. ARM provenance does not authorize a destination. |
| Playground relay lacked direct tests for captured identity and current trust.                    | Coverage gap.                              | Fixed in `b0982d727`. Nine tests cover forged identity fields, setting removal, stale requests, native sessions, mixed-host rejection and no live credential-cache dependency.                                                |
| Rejection classification omitted `documentdb` labels and `windows.net`, contrary to WI8.         | Medium, measurement only; high confidence. | Fixed in `95f7267f2`. Exact service labels and boundary-safe domain classification now match the plan. Nine regression rows preserve destination rejection.                                                                   |
| `isEntraDestinationRejectedError` is `instanceof`-only, unlike an earlier prompt's description.  | Reviewed nonissue.                         | Leave narrow: both IPC recipients reconstruct real rejection instances. Error names control failure presentation, never destination authorization.                                                                            |

The advisor approved the corrected builder and saved-connection paths, and approved integration
subject to the specified measurement fix, which was applied. All advisor recommendations were
followed. No unresolved local implementation finding remains.

## Reviewed invariants

- Every seed is authorized before audience/token acquisition; all OIDC paths share secure options.
- Relays bind identity and audience to the original session, rechecking current machine trust.
- Certificate validation and per-socket destination checks protect new/discovered/reconnected hosts.
- Unknown picker context denies Entra; all relevant producers either supply a destination or
  intentionally exclude Entra. Learn More never selects authentication or changes settings.
- Rejected saved methods fail rather than silently fall back; edited rejected destinations clear
  the selection. Tree recovery remains action-only.
- Logs and telemetry contain bounded classes or the explicitly configured suffix, not tokens or
  full connection strings.

## Limits and human follow-up

The real-driver harness uses temporary local certificates and dummy tokens. Its later SRV-polling
case rejects a trailing-dot result that passes the driver's parent-domain rule; it does not
demonstrate acceptance of an arbitrary unrelated SRV domain.
Driver hooks and polling internals must be rechecked after driver upgrades.

Live Government/China/private-link endpoint and certificate acceptance remain unverified.
The operator should exercise consent, picker cancellation/Learn More, rejected saved-connection
modals and both recovery actions in a running workbench, and check localized layouts.
The documentation link becomes live when the corresponding documentation is deployed.
No production sizing, service-team confirmation, service-specific audience request or upstream
driver report is claimed.

The existing Update Connection String command can retain an already connected old client until
disconnect. That predates this change and does not send tokens to the new rejected host.
Driver-wrapped destination failures can use the generic diagnostics modal/documentation rather
than the dedicated seed-policy modal.

The PR remains a draft for human author review and the explicitly recorded live/manual checks.
