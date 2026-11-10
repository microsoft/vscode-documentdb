---
feature: deep-links
kind: plan
status: in-progress
created: 2026-11-10
prs: [1077]
---

# Copilot review follow-up

The operator asked the leader to use the lead workflow from `origin/main`, consult
`gpt-6-astra` on every Copilot finding, implement its work plan using its recommended
models, shorten the unavailable-Entra modal title, and run Case 1 and Case 2 until green.
The run started at 2026-11-10 19:38:56 UTC from `4d2fbd6cc`.
No push or GitHub thread mutation is authorized by this plan.

## Assessment and accepted plan

Astra verified all eight unresolved comments against the source and installed driver.
All eight are valid. The driver can send cached tokens without invoking the callback,
so callback-only revocation is insufficient. The installed SRV resolver also confirmed
that sanitizing an OIDC declaration after fallback selects the wrong native auth database.

The operator's instruction to implement the advisor's plan accepts the scoped fixes below.
The advisor found no new trust-policy decision: retain Option B, eager interactive
acquisition after destination approval, mandatory TLS, captured identity/audience, and
Native/NoAuth isolation. New trust settings, automatic trust adoption, termination of
already-authenticated sessions, and general connected-edit lifecycle changes are out of scope.

| Comment | Finding | Item |
| --- | --- | --- |
| 4529518469 | Missing localization; operator also requests shorter title | WI-2, WI-3 |
| 4529518550 | Trust removed during token acquisition | WI-1 |
| 4529518602 | Existing clients retain stale socket/callback trust | WI-1 |
| 4529518636 | Rejected browser launch escapes authentication picker | WI-2 |
| 4529518681 | Native sanitization occurs after SRV fallback | WI-1 |
| 4529518724 | Browser launch interrupts original failure cleanup | WI-2 |
| 4529518778 | Successful recovery edit leaves stale client/credentials/children | WI-2 |
| 4529518823 | Cached command-connect rejection lacks bounded telemetry | WI-2 |

### WI-1: token/socket revocation and worker preparation order

- Recommended/actual model: `gpt-6.1-sol`; authentication, concurrency and worker lifecycle.
- Covers findings 2, 3 and 5. Independent of WI-2.
- Owns auth handlers/options and tests; worker manager, protocol, worker and evaluator
  and tests; shell session manager and tests. No settings, resolver-package or policy-suffix edits.
- Shared synchronous `OidcDestinationPolicy` exposes `allowedHostPatterns` and
  `assertAllowed(host?: string): void`. Capture original URI/restrictions before awaits.
  Host checks intersect current trust with original restrictions. TLS hooks preserve
  Node certificate/hostname checks; callbacks check before and after acquisition.
- Worker initialization carries `SerializableOidcDestinationPolicy` containing
  `originalConnectionString`, optional `customHostnameSuffix` and a one-Int32
  `SharedArrayBuffer` revocation latch. Custom suffix changes permanently revoke that
  generation synchronously; dispose listeners on failure/exit/shutdown/replacement.
  Built-in-only policies are unaffected by unrelated custom settings.
- Recheck original destinations after acquisition, outside provider-error catches, before
  clearing failures or returning/posting tokens. Preserve stale-generation suppression.
- Sanitize Native/NoAuth working URIs before SRV preparation; retain worker-side guard.
- Tests: pending-acquisition revocation; provider/policy classification; original restriction
  preservation; shared-latch revocation and cleanup; missing worker policy; generation
  replacement; native TXT authSource precedence; real-driver reconnect with a valid certificate
  and no application/token payload after revocation.
- Focused validation: auth handler/options/policy/harness, worker manager/worker/evaluator,
  and shell manager Vitest files using the root configuration.

### WI-2: navigation, short title, recovery and telemetry

- Recommended/actual model: `gpt-6.1-sol`; successful-save detection and cached tree recovery
  cross module boundaries. Independent of WI-1.
- Covers findings 1 (source), 4, 6, 7 and 8.
- Owns both modal helpers/tests, update-connection-string wizard/context/execute step and
  tests, `ClusterItemBase` and tests, and provider/stored-cluster recovery tests.
  Documentation/localization are exclusively WI-3.
- Title: **Microsoft Entra ID unavailable**. Keep details, buttons, picker row and separate
  rejected-connection heading unchanged.
- Both documentation-launch helpers warn nonblockingly with the existing
  **We couldn't open this link.** for false/rejection and return normally.
  The prior rejection-propagation test changes intentionally under the requested fix.
- Add `connectionStringSaved?: boolean`, initialized false and set true only after save.
  In a command starting in destination-rejection recovery, successful save evicts clients
  and credentials by `clusterId` and resets failed children by tree ID before refresh.
  Cancellation, unchanged input, missing storage and failed saves preserve prior state.
- Cached `connect()` rejection adds exactly `connectionResult=failed`,
  `experience=this.experience.api`, `failurePhase=cachedClientConnect`.
- Tests: both launch outcomes/dismissal; original-error cleanup; rejected edit/retry with
  differing stable/tree IDs; unsuccessful-edit isolation; bounded telemetry; all three pickers.

### WI-3: documentation, generated localization and integration

- Depends on WI-1 and WI-2. Advisor recommends `gpt-6-luna` for mechanical wording;
  actual owner is the leader, as the advisor explicitly assigned integration to the leader.
  No additional mechanical worker is needed.
- Update active feature documentation, append factual dated amendments beside historical
  approved wording, preserve earlier review evidence, explain revoked worker recreation.
- Generate localization only after source strings settle; never hand-edit the bundle.
- Run Case 1 (`npm run build`, focused tests), then Case 2 (`npm run l10n`,
  `npm run prettier-fix`, `npm run l10n:check`, `npm run lint`, `npm run build`,
  `npm run typecheck:tests`, `npx vitest run`, `npm run package`).
- Repair check failures through the responsible worker; commit generated/formatting changes
  separately. Record exact outcomes and model/role usage here.

## Decisions and progress

- Astra, high confidence: all eight comments valid; use two disjoint Sol workers and
  leader integration. Evidence includes installed driver cached-token and TLS ordering.
- Operator: shorten the modal title for UI reasons. Astra selected the exact short title;
  leader accepts it within that explicit wording request.
- Astra: synchronous shared revocation latch avoids the stale-worker-message window without
  changing trust policy. New generations are required after custom-trust changes.
- Leader, 95% confidence: two parallel workers have disjoint ownership; local item commits
  and separate documentation/generated commits preserve reviewability.

### Checkpoint: planning advisor returned, 19:51 UTC

Plan: 0/3 done; WI-1 and WI-2 queued for parallel dispatch; WI-3 depends on both.
Advisor `8679a4b4-6898-4929-8ae3-10027dffed19`, `gpt-6-astra`: 10m54s elapsed,
391.6 AIU, 26 model requests (10m30s summed), 54s tool spans; no test/build runs.
Tokens: 1.6M input (1.5M cache read, 103k cache write), 23k output.
Snapshot totals: leader 25.9 AIU; subagents 391.6 AIU; run 417.4 AIU.
Next: coding, advisor logic review, focused checks, per-item commits, integrated checks.
