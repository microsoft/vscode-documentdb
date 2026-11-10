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

| Comment    | Finding                                                           | Item       |
| ---------- | ----------------------------------------------------------------- | ---------- |
| 4529518469 | Missing localization; operator also requests shorter title        | WI-2, WI-3 |
| 4529518550 | Trust removed during token acquisition                            | WI-1       |
| 4529518602 | Existing clients retain stale socket/callback trust               | WI-1       |
| 4529518636 | Rejected browser launch escapes authentication picker             | WI-2       |
| 4529518681 | Native sanitization occurs after SRV fallback                     | WI-1       |
| 4529518724 | Browser launch interrupts original failure cleanup                | WI-2       |
| 4529518778 | Successful recovery edit leaves stale client/credentials/children | WI-2       |
| 4529518823 | Cached command-connect rejection lacks bounded telemetry          | WI-2       |

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

### Checkpoint: first full Case 2 returned, 20:13 UTC

The full list ran, but this was **not a green handoff**. Source code, strict package-test types
and packaging passed; four lint violations and four stale protocol-fixture expectations remain.

| Command | Result | Duration |
| --- | --- | --- |
| `npm run l10n` | Passed; generated short title verified | Not captured |
| `npm run prettier-fix` | Passed | 59.418s |
| `npm run l10n:check` | Passed | 54.454s |
| `npm run lint` | Failed: three forbidden inline import types and one redundant assertion | 107.233s |
| `npm run build` | Passed | 36.541s |
| `npm run typecheck:tests` | Passed | 12.645s |
| `npx vitest run` | 350 files passed, one failed; 6,413 tests passed, four failed, one skipped | 91.361s |
| `npm run package` | Passed; VSIX 8,973,700 bytes | 25.572s |
| `git diff --check` | Passed | 0.043s |

The runtime failures all assert the removed `oidcCustomHostnameSuffix` field in the Government
shell/playground initialization fixture. WI-1's owner will assert the replacement policy payload,
original URI and active shared latch while retaining the token/scope/telemetry checks.
WI-2's owner will replace the three inline import types with top-level type-only namespace imports
and remove the redundant assertion. No production behavior or accepted policy changes.
The leader extended only the necessary test-file ownership; no new work item/model was introduced.

Checker `f85d9c3a-32d6-4434-a3b3-bbe57b2945bc`, `gpt-5.6-luna`: 8m40s elapsed,
1.6 AIU, 16 requests (1m08s summed), 7m29s tool spans. Tokens: 339k input
(328k cache read, 11k cache write), 6k output. Host command-success detection is not the check
verdict; the explicit exit-code results above are authoritative.
Snapshot totals: leader 78.8 AIU; subagents 929.9 AIU; run 1008.7 AIU.
Next: bounded test-only fixes, local follow-up commits, then rerun the full Case 2 list.

### Checkpoint: test-only repairs returned, 20:15 UTC

WI-1 follow-up **done**, commit `1d096b9b8`: the four Government cases now assert the
original connection, serialized policy and active one-Int32 shared latch. All original token,
scope and telemetry assertions remain; all 38 tests in the integration file passed.
Leader, 95% confidence: this updates the required internal protocol fixture without changing behavior.

WI-2 follow-up **blocked on lint typing**, not runtime: all 69 focused tests passed.
The leader's proposed type-only namespace import conflicts with the repository's restricted-import
rule. The same WI-2 advisor is assessing a named-type/narrow-shape alternative; no lint exemption
or production change has been authorized. No new accepted item or coding model.

Aggregate worker snapshots: WI-1 130.6 AIU, 52 requests (7m32s summed), 2m33s tool spans,
4.6M input (4.3M cache read, 231k cache write), 30k output; WI-2 47.6 AIU, 20 requests
(3m31s summed), 2m03s tool spans, 1.4M input (1.4M cache read, 77k cache write), 15k output.
The helper's multi-turn elapsed fields are not used as follow-up durations.
Snapshot totals: leader 88.3 AIU; subagents 970.2 AIU; run 1058.5 AIU.

### Checkpoint: lint advisor returned, 20:16 UTC

Astra approved named type-only `AzureWizardPromptStep` imports and a narrow `importOriginal`
shape containing that constructor and `UserCancelledError`. The full real-module spread remains,
so no exports or cancellation identity are lost; no assertions, runtime behavior or lint rules
are weakened. The leader relayed the exact approved shape to the same Sol worker.
Advised (`gpt-6-astra`), high confidence; no parked question.

The WI-2 advisor's aggregate snapshot: 162.9 AIU, 14 requests (2m52s summed), 19s tool spans;
657k input (599k cache read, 57k cache write), 6k output. No checks run by the advisor.
Snapshot totals: leader 95.4 AIU; subagents 1019.8 AIU; run 1115.3 AIU.

### Checkpoint: lint repair returned green, 20:17 UTC

WI-2 follow-up **done**, commit `4877f701f`: approved named-type mock shapes and redundant-cast
removal only; all behavioral assertions retained. Focused ESLint, all 69 tests and root TypeScript
passed. The leader followed Astra's revised typing recommendation without exemptions.

WI-3 generated localization and test formatting committed separately as `89ecc82ce`.
The generated bundle contains the exact short title. The docs-only integration commit is
`8e1dd8d8d`; subsequent completion notes remain separate from code/generated commits.

WI-2 aggregate worker snapshot: 51.9 AIU, 23 requests (3m46s summed), 2m49s tool spans;
1.7M input (1.7M cache read, 79k cache write), 16k output.
Snapshot totals: leader 101.0 AIU; subagents 1024.1 AIU; run 1125.1 AIU.
Next: rerun every Case 2 command against the corrected final source.
