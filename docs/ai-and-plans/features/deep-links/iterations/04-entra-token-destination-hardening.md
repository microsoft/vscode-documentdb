---
feature: deep-links
kind: plan
status: proposed
created: 2026-11-10
code:
    - src/documentdb/auth/oidcAllowedHosts.ts
    - src/documentdb/auth/MicrosoftEntraIDAuthHandler.ts
    - src/documentdb/auth/ManagedIdentityAuthHandler.ts
    - src/documentdb/playground/WorkerSessionManager.ts
    - src/documentdb/playground/playgroundWorker.ts
    - src/documentdb/wizards/authenticate/ChooseAuthMethodStep.ts
    - src/vscodeUriHandler.ts
---

# Iteration 4 - Entra token destination hardening

> **Status:** proposed for review; not approved or implemented.
> This file records the proposal, not a claim that the vulnerability has been fixed.

## Goal

Prevent an externally supplied connection from causing the DocumentDB extension to send an Entra
database access token to an untrusted server. Enforce the same destination policy for URL links,
pasted connection strings, saved connections, managed identity, and shell/playground sessions.

Related intent: [deep links](../README.md) and [sovereign clouds](../../sovereign-clouds/README.md).

## Problem and existing defenses

The current OIDC allowlist permits cloud-wide suffixes such as `*.azure.com`. Those suffixes include
customer-controlled servers, not just Microsoft-operated database services. A customer-controlled
Azure hostname with a valid TLS certificate is therefore not sufficient evidence that the server
should receive an Azure database token.

For a new connection, the reviewed attack requires the user to open a crafted connection link,
accept **Add and open**, choose Microsoft Entra ID, and complete any required account authorization.
The server can receive the token during the authentication exchange even if database authorization
subsequently fails. This is not a zero-click attack.

The credential at risk is a database-audience access token, not a password or refresh token, and not
automatically an ARM or Microsoft Graph token. It is not bound to the particular database hostname
in the link. Replay is constrained by audience, identity permissions, expiry, policies, and network
access.

Retain the existing defenses:

- Mandatory confirmation before a link adds a new connection.
- Removal of URL-supplied certificate-validation bypasses, with the existing loopback exception.
- Driver validation of OIDC destinations after initial SRV resolution.
- Extension-controlled token audiences and removal of competing URI authentication properties.
- ARM-derived endpoints for `/connect/azure`, rather than a URL-supplied database endpoint.

The preceding read-only review demonstrated the broad-allowlist path with the real authentication
handler and installed driver, mocked authentication, blocked networking, and a dummy token delivered
to an in-memory authentication sink. It reported 350 passing targeted tests. No real credential or
live replay was used. Those results establish the starting concern; they are not verification of
this proposed fix.

## Proposed design

### 1. One service-specific destination policy

Evolve [oidcAllowedHosts.ts](../../../../../src/documentdb/auth/oidcAllowedHosts.ts) into the shared
source of destination trust rather than adding a URL-handler-only check.

- Replace built-in cloud-wide patterns with a curated set of verified database-service suffixes.
  The existing `*.mongocluster.cosmos.azure.com` recognition is a starting point, not a verified
  complete inventory.
- Establish the public, Government, China, private-endpoint, and SRV target forms before choosing
  the final patterns. Record supporting service documentation or sanitized endpoint evidence.
- Reject malformed or unrecognized Entra destinations explicitly. Remove the fallback to
  `*.azure.com`; failure to classify a destination must not broaden trust.
- Check every seed host. Do not reuse `hasDocumentDBHost()` unchanged as the security predicate:
  its current `some()` semantics are appropriate for recognition, not authorization of a
  multi-host connection.
- Normalize hostnames consistently and match DNS label boundaries, not substrings. Cover ports,
  case, lookalikes, IP literals, and trailing-dot handling explicitly.
- Keep cloud classification separate from destination authorization. A host can provide evidence
  about an Azure cloud without being an approved token recipient.
- Preserve the existing audience-resolution and cloud-mismatch checks; do not infer a new audience
  from a link or an arbitrary server response.

Native/password authentication remains outside this new Entra destination restriction.

### 2. Enforce before token acquisition and throughout connection use

The intended sequence is:

```text
Parse connection -> validate destination policy -> resolve audience
                 -> validate resolved connection targets -> acquire token -> authenticate
```

In [MicrosoftEntraIDAuthHandler.ts](../../../../../src/documentdb/auth/MicrosoftEntraIDAuthHandler.ts),
move destination validation ahead of `getSessionFromVSCode`. Prefer acquiring the token at the
driver callback after its destination checks, while preserving account selection, error handling,
and connection timing behavior.

Use the same policy in:

- [ManagedIdentityAuthHandler.ts](../../../../../src/documentdb/auth/ManagedIdentityAuthHandler.ts).
- [WorkerSessionManager.ts](../../../../../src/documentdb/playground/WorkerSessionManager.ts) and
  [playgroundWorker.ts](../../../../../src/documentdb/playground/playgroundWorker.ts), which serve
  shell and playground sessions.
- Connections reopened from storage and subsequent reconnects, not just new connections or links.

Continue supplying the narrowed `ALLOWED_HOSTS` to the driver. Initial seed validation alone is
not the complete invariant: SRV results, topology-discovered members, reconnects, and token refresh
must not introduce a recipient outside the policy.

Verify the installed driver's behavior with an offline protocol-level harness. Do not assume the
OIDC callback itself has enough destination context to enforce this. If driver behavior leaves a
gap, resolve it with a supported enforcement mechanism or a reviewed driver fix before claiming
coverage. Do not use a timeout, event-listener race, or a broad wildcard as a workaround.

Policy failures must surface through the existing localized authentication error flow. Do not
silently fall back to another authentication method or log tokens/full connection strings.

### 3. Explain the boundary in the connection UI

In [ChooseAuthMethodStep.ts](../../../../../src/documentdb/wizards/authenticate/ChooseAuthMethodStep.ts),
do not offer interactive Entra or managed identity for a destination rejected by the shared policy.
Keep enforcement in the handlers even when the picker is skipped or credentials were saved earlier.

Suggested explanatory copy, subject to UX/localization review:

> Microsoft Entra ID authentication is not permitted for this server.

In [vscodeUriHandler.ts](../../../../../src/vscodeUriHandler.ts), retain the mandatory new-connection
confirmation and ensure the actual destination hostname is visible, not only a friendly label.
Do not display credentials embedded in a connection string.

Do not add a one-click "send the token anyway" override to the link flow. A user accepting
**Add and open** is not a substitute for destination authorization.

### 4. Preserve explicit custom-cloud support

Retain machine-scoped `documentDB.customEnvironment.hostnameSuffix` as an explicit trust input.
Explain that it authorizes matching servers to receive database access tokens, and recommend the
narrowest service-specific suffix. Preserve existing configuration validation.

A link, a link's `source` label, workspace settings, or a host's private-network address must not
grant this trust. The built-in allowlist must not widen to accommodate an unrecognized endpoint.
Any additional restriction on explicitly configured suffixes requires a compatibility decision
during review; do not silently remove current custom-cloud support.

For Azure integrations that can supply an ARM resource ID, prefer `/connect/azure`. Do not require
ARM lookup for every connection: legitimate users may have database permissions without management
permissions. ARM-derived connections must still use the common authentication policy.

## Work items and dependencies

| Work item | Deliverable | Prerequisite |
| --- | --- | --- |
| WI1: Endpoint inventory | Evidence-backed service suffixes, SRV/private endpoint examples, sovereign-cloud verification limits | None |
| WI2: Shared destination policy | Fail-closed validation of all hosts, narrow driver allowlist, custom-service handling, unit tests | WI1 |
| WI3: Authentication and worker integration | Pre-token enforcement across interactive Entra, managed identity, saved connections, shell/playground; protocol-level tests | WI2 |
| WI4: Connection UX | Policy-aware authentication choices and clear target/error presentation without bypass | WI2 |
| WI5: Verification and documentation | Acceptance matrix results and approved intent documented in both affected features | WI3, WI4 |

Implement WI2-WI4 together for the security fix. A picker-only or URL-handler-only change is not
an acceptable substitute.

## Acceptance tests

Use dummy tokens and controlled local/in-memory infrastructure; no real user token should be sent
to a test sink. Assert token-provider calls and captured authentication payloads, not only errors.

| Scenario | Required result |
| --- | --- |
| Customer-controlled `*.cloudapp.azure.com` destination | Rejected before token acquisition; no token sent |
| Unrelated domain, deceptive suffix, malformed connection | Explicit rejection, with no permissive fallback |
| Mixed approved and unapproved seed hosts, in either order | Entire Entra attempt rejected before token acquisition |
| Supported service endpoints in each supported cloud | Authentication reaches the intended server using the correct audience |
| Legitimate SRV and private-endpoint forms | Continue to work with certificate validation enabled |
| Initial SRV results outside policy | Rejected before requesting or transmitting a token |
| Unapproved topology member, reconnect destination, or later SRV result | No cached or newly acquired token transmitted to that destination |
| Saved credentials or authentication picker skipped | Same destination policy enforced |
| Interactive Entra, managed identity, shell, playground | Equivalent destination protection |
| Explicit trusted custom service | Works without widening the built-in policy |
| Link-supplied audience/authentication properties or purported source | Cannot change audience or establish destination trust |
| New-connection confirmation canceled | No connection created and no token requested |
| Non-Entra native/password connection | Existing supported behavior preserved |

Extend the existing policy, authentication-handler, sovereign integration, authentication-picker,
worker-manager, and URI-handler suites; add the smallest protocol harness needed to prove token
non-disclosure through the actual driver.

During implementation, use Case 1 verification: `npm run build` and targeted `npx vitest run` tests
covering the changed surfaces. Do not run full handoff checks merely to commit this plan.
At ready-for-review, run the repository's full Case 2 list, including localization generation if
user-facing strings changed, and report cloud/manual verification gaps separately from unit results.
If a `TDD:` contract fails, stop for operator approval rather than changing the contract silently.

## Review decisions and release gates

Before implementation approval, settle:

1. The authoritative built-in suffix inventory and which sovereign/private endpoint cases still
   need service-owner or live-environment verification.
2. The compatibility policy for previously accepted but unrecognized Entra destinations, and any
   new limits on explicit custom suffixes.
3. The exact UI treatment of unavailable Entra choices and the user-facing explanation.

Before declaring the fix complete:

- Demonstrate that the driver and extension together enforce the invariant for all connection
  destinations, including discovered hosts and reconnects.
- Complete the acceptance matrix and explicitly identify unverified live-cloud behavior.
- After approval, update the active deep-links and sovereign-cloud documentation, related user
  configuration guidance, and misleading "safe default" comments alongside the implementation.
- Record approved security/compatibility decisions and the operator's rationale in the relevant
  feature decision log; this proposal itself does not establish those decisions.

This work does not change token audiences, make ARM permissions mandatory, or introduce a general
network-egress firewall. Shorter token lifetimes, extra confirmation dialogs, and TLS alone are not
substitutes for the destination restriction.
