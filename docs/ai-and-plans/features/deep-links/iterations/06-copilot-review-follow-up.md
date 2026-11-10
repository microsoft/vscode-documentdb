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

**Done (2026-11-10), commit `9d54bf86d`:** Sol implemented the original/current policy
intersection, callback pre/post checks, synchronous worker-generation revocation, teardown cleanup,
post-acquisition relay checks and pre-SRV native sanitization. Added 34 regressions; 440 focused
tests and root TypeScript passed. The valid-certificate driver harness proves a revoked cached-token
reconnect sends no application payload without relying on another callback.
Advised (`gpt-6-astra`): high-confidence approval with no findings, including installed dependency,
worker lifecycle, policy/provider classification and original-grant review. No plan change.
Leader, 95% confidence: item ownership stayed disjoint and no settings/public schemas changed.

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

**Done (2026-11-10), commit `9bb8e7772`:** Sol implemented the exact short title, local browser
failure warnings, successful-save-only rejection recovery and bounded telemetry. Added 17 tests;
137 tests in the ten focused files passed. Existing rejection-propagation expectations changed
intentionally under the operator's requested fix; dismissal/cancellation and original-error
assertions remain. The successful-save flag is set only after storage succeeds.
Advised (`gpt-6-astra`): high-confidence approval with no findings, including full lifecycle and
persistence review. Leader, 95% confidence: scoped file ownership and stable/tree identity
separation match the approved plan. The worker's initial type check saw only concurrent WI-1
errors; WI-1's subsequent integrated root type check passed.

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

### Checkpoint: WI-2 implementation returned, 19:58 UTC

Plan: 0/3 done, WI-1 running, WI-2 implementation complete and advisor review next, WI-3 queued.
Sol worker `b0cdc9cc-4aa2-4eaf-b6d1-132996ad2e9e`: 4m14s elapsed, 40.6 AIU,
16 requests (3m01s summed), 1m43s tool spans; host detected five check invocations, 1m17s,
none failed. Tokens: 1.1M input (980k cache read, 71k cache write), 13k output.
Snapshot totals: leader 49.5 AIU; subagents 646.8 AIU; run 696.3 AIU.

### Checkpoint: WI-2 advisor returned, 20:01 UTC

Astra approved WI-2 without rework. Plan: WI-2 ready to commit; WI-1 running; WI-3 queued.
Advisor `49b546e1-bacf-47f0-b352-8660bbd02934`: 2m12s elapsed, 113.3 AIU,
ten requests (2m06s summed), 16s tool spans; no tests/builds.
Tokens: 377k input (330k cache read, 47k cache write), 4k output.
Snapshot totals: leader 53.4 AIU; subagents 784.5 AIU; run 837.9 AIU.

### Checkpoint: WI-1 implementation returned, 20:02 UTC

Plan: 1/3 done (`9bb8e7772`); WI-1 advisor review running; WI-3 queued.
Sol worker `2187fc61-a7c1-41ea-9d63-628840d6839e`: 9m09s elapsed, 97.3 AIU,
47 requests (7m02s summed), 2m27s tool spans; host detected seven check invocations,
2m03s, none failed. Tokens: 3.9M input (3.8M cache read, 123k cache write), 28k output.
Worker evidence: 34 regressions; 440 focused tests passed; root type check passed.
Snapshot totals: leader 56.0 AIU; subagents 784.5 AIU; run 840.6 AIU.
Next: advisor WI-1 logic review and integrated Case 1 checks, then final Case 2.

### Checkpoint: WI-1 advisor and Case 1 returned, 20:04 UTC

Plan: 2/3 done (`9d54bf86d`, `9bb8e7772`); WI-3 integration in progress, none parked.
Astra approved WI-1 without rework. The reused planning advisor's aggregate helper snapshot:
676.6 AIU, 35 model requests (13m10s summed), 1m23s tool spans; no tests/builds.
Tokens: 2.7M input (2.5M cache read, 229k cache write), 29k output.
The helper's multi-turn elapsed/turn fields reflect the first turn, so they are not used as
the WI-1 review duration.

Case 1 checker `9bf44fef-fdf7-4446-a431-f377a0974af0`, host-selected `gpt-5.6-luna`:
1m06s elapsed, 0.6 AIU, three requests (10s summed), 53s tool spans.
Tokens: 51k input (34k cache read, 17k cache write), 646 output.
**Integrated Case 1 passed:** `npm run build`; 577 tests in 19 files, 7.92s runtime.
Snapshot totals: leader 66.2 AIU; subagents 928.3 AIU; run 994.6 AIU.
Next: commit active documentation and completion notes, then run all Case 2 commands.
