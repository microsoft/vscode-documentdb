---
feature: build-and-test-stack
kind: review
status: active
created: 2026-10-20
prs: [1040]
---

# PR #1040 review: October security hardening

Review of [PR #1040](https://github.com/microsoft/vscode-documentdb/pull/1040), following
[CONTRIBUTING.md section 6](../../../../../../CONTRIBUTING.md#6-ai-assisted-review-workflow).

- **Reviewed head:** `861e6c5aefa4ccec8fbc1f528d7198890c975a79`.
- **Base:** `main`, `ac06067792e9a25dd7555d282835ec853647b02c`.
- **Scope:** all 17 changed files: connection-link consent and TLS handling, loopback
  classification, anonymous authentication, Entra ID host allowlisting, npm build/release
  workflows, tests, settings copy, changelog and release documentation.
- **Location:** this cross-feature review lives with the build-and-test stack because the
  confirmed finding concerns its CI credential guard. Related intent is recorded under
  [No Authentication](../../../no-auth/README.md) and
  [Local Quick Start](../../../local-quickstart/README.md).
- **Boundary:** review only at first. On 2026-10-21 the author asked for both findings to be
  fixed; see [Fix progress](#fix-progress). No publication, GitHub review submission, thread
  resolution, or ready-for-review transition was requested or performed.

## Review stages

| Stage                                            | Result                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial edge-case review                         | Completed against the full diff and relevant surrounding code.                                                                                                                                                                                                                                                                                       |
| Merge Copilot reviewer comments                  | GitHub returned zero review comments and zero submitted reviews at the reviewed head. There is no Copilot feedback to merge yet.                                                                                                                                                                                                                     |
| Independent validation gate                      | A separate code-review agent checked the candidate against the code and independently reproduced it with synthetic input, including npm's bundled INI parser. R1 remains valid at Medium severity.                                                                                                                                                   |
| Independent sweep                                | The validation agent also reviewed beyond R1. It reported no additional high-confidence bugs introduced by this diff.                                                                                                                                                                                                                                |
| Different-vendor/model/context requirement       | **Not certified.** The separate pass used the harness-selected agent configuration. Its vendor/model/context provenance was not exposed sufficiently to establish the specific section 6.1 requirement. Do not count this as completion of the required cross-vendor gate.                                                                           |
| Severity and solution re-evaluation (2026-10-21) | R1 re-rated **Medium → Low**. A probe matrix compared the current guard with two replacement checks (one of them new, option C), using npm's bundled INI parser as the reference. The rejected loopback candidate was promoted to **R2 (Low)** because this PR rewrote the affected lines and added a consent prompt whose answer that path ignores. |
| Author decisions                                 | 2026-10-21: the author asked for both findings to be fixed ("please fix both"), so the recommended options were implemented: C for R1 and A for R2. The author gave no further reasoning.                                                                                                                                                            |

The author's section 6.2 decisions are recorded, and both findings are fixed. Section 6.1 still
needs the explicitly different-vendor validation pass, and any later Copilot comments must be
merged and revalidated.

## Summary

| ID  | Source                                            | Severity         | Confidence | Finding                                                                           | Author decision                                                   |
| --- | ------------------------------------------------- | ---------------- | ---------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| R1  | Primary review; independently validated; re-rated | Low (was Medium) | High       | New npm credential guard misses valid quoted configuration keys                   | Fix (option C). Fixed in `93f8a8a4`.                              |
| R2  | Re-evaluation (promoted from rejected candidates) | Low              | High       | Anonymous link connections to `127.x` / `::1` ask for TLS consent, then ignore it | Fix (option A). Fixed in `e0533846`, release notes in `2111d471`. |

R1 is an omission in a newly introduced preventive check, not evidence of a credential leak
or a demonstrated compromise. The review did not discover any actual committed credentials.

## R1: Recognize quoted npm configuration keys in the credential guard

**Severity:** Low (re-rated from Medium; see [Severity re-evaluation](#severity-re-evaluation)).
**Confidence:** High that the omission exists. **Introduced in this PR:** yes, as incomplete
coverage in the new guard.

**Location:** [main.yml, line 194](../../../../../../.github/workflows/main.yml#L194).

### Evidence and impact

The new step promises to fail if a committed `.npmrc` contains npm credentials, but its check is:

```bash
git grep -lIiE '(^|:)(_authToken|_auth|_password)[[:space:]]*=' -- '.npmrc' '**/.npmrc'
```

This is valid npm configuration syntax:

```ini
"//registry.npmjs.org/:_authToken"=npm_review_fixture
```

Both the project-installed INI parser and the parser bundled with the installed npm normalize
that quoted key to `//registry.npmjs.org/:_authToken`. The regex misses it because the closing
quote sits between `_authToken` and `=`, where the expression allows only whitespace.

When this line is committed in a tracked `.npmrc`, `git grep` reports no match and the shell
`if` step succeeds. This protection therefore permits a real credential in valid quoted-key
syntax to remain committed. Other CI checks may fail for unrelated reasons; this credential
check does not reject the input.

Synthetic probes reproduced the distinction:

| Input                                                   | Parsed credential key              | Credential-check result |
| ------------------------------------------------------- | ---------------------------------- | ----------------------- |
| `//registry.npmjs.org/:_authToken=npm_review_fixture`   | `//registry.npmjs.org/:_authToken` | Rejected, step exits 1  |
| `"//registry.npmjs.org/:_authToken"=npm_review_fixture` | `//registry.npmjs.org/:_authToken` | Missed, step exits 0    |
| `  _authToken=npm_review_fixture`                       | `_authToken`                       | Missed, step exits 0    |

The scoped quoted-key case establishes the finding independently of whether current npm
accepts an unscoped authentication key. No real credentials were used in the probes.

### Severity re-evaluation

The omission is real and reproducible, but Medium overstates its impact:

- **The guard detects; it cannot prevent.** The repository is public, and the check runs on
  `pull_request` and `push` events, after the commit already exists on GitHub. Its value is
  fast, loud notice. A missed case delays that notice; it does not cause the exposure.
- **The main control does not depend on syntax.** npm is a GitHub secret-scanning partner. An
  `npm_…` token pushed to a public repository is matched by its value, whatever the INI key
  syntax, and is revoked. This guard is defense in depth behind that control. The reviewer's
  token could not read this repository's security settings, so whether push protection is
  enabled was not confirmed.
- **The threat is an accident, and the missed syntax is uncommon.** `npm login` and
  `npm config set` write unquoted keys, which the current guard already rejects. Quoted keys
  appear only in hand-written files. Someone with commit access gains nothing by committing a
  credential in a form the guard misses.
- **Residual gap:** `_auth` and `_password` hold base64 basic credentials that have no
  recognizable prefix, so secret scanning is unlikely to match them. For those values this
  guard is the only check in the repository, which is why the gap is still worth closing
  when the fix is cheap.

**Re-rated: Low.** A defense-in-depth gap with no demonstrated exposure and a one-line fix.

The re-evaluation also found two behaviors of the current guard. Neither is a separate finding:

- A commented-out line, such as `# //registry.npmjs.org/:_authToken=x`, is rejected, because
  `(^|:)` matches the colon inside the comment. This is a loud false positive.
- An environment reference, such as `_authToken=${NPM_TOKEN}`, is rejected. That is consistent
  with the stated policy (pipelines inject credentials, and none belong in the repository).
  However, the error tells the author to "revoke the token", even when the file contains no
  token.

### Probe matrix

Fixtures were committed as tracked `.npmrc` files in a scratch repository and checked with
`git grep`. _Flag_ means the step fails. npm's bundled `ini` parser was the reference for what is
actually a credential key. Option B is the quote-tolerant regex
`(^|:|^[[:space:]]*["']?)(_authToken|_auth|_password)["']?[[:space:]]*=`. Option C is defined in
the Solutions section below.

| Fixture                                                                 | Credential key? | Current guard | B            | C        |
| ----------------------------------------------------------------------- | --------------- | ------------- | ------------ | -------- |
| `//registry.npmjs.org/:_authToken=x`                                    | yes             | flag          | flag         | flag     |
| `"//registry.npmjs.org/:_authToken"=x`                                  | yes             | **miss**      | flag         | flag     |
| `'//registry.npmjs.org/:_authToken'=x`                                  | yes             | **miss**      | flag         | flag     |
| `//registry.npmjs.org/:_authToken = x`                                  | yes             | flag          | flag         | flag     |
| `  _authToken=x`                                                        | yes (unscoped)  | **miss**      | flag         | flag     |
| `//host/:_AUTH=x`                                                       | yes             | flag          | flag         | flag     |
| `//host/:_password=eA==`                                                | yes             | flag          | flag         | flag     |
| `"//host/:\u005fauthToken"=x` (JSON escape in a quoted key)             | yes             | **miss**      | **miss**     | **miss** |
| `//registry.npmjs.org/:_authToken=${NPM_TOKEN}`                         | reference only  | flag          | flag         | flag     |
| `# //registry.npmjs.org/:_authToken=x`                                  | no (comment)    | _false flag_  | _false flag_ | pass     |
| `; _auth=x`                                                             | no (comment)    | pass          | pass         | pass     |
| `registry=https://pkgs.dev.azure.com/org/_packaging/feed/npm/registry/` | no              | pass          | pass         | pass     |
| `always-auth=true`                                                      | no              | pass          | pass         | pass     |

Option C was also checked against a root `.npmrc` and a nested multi-line file. Both were
rejected. Only a real parser (option A) catches the escaped key. Writing a key that way takes
deliberate obfuscation, which is outside the accidental-commit threat model for this guard.

### Solutions

| Option                                                                                             | Pros                                                                                                                                                                                                                                                    | Cons                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A. Parse tracked `.npmrc` files with npm-compatible INI semantics, then check the normalized keys. | The only option that handles every quote and escape form, including the escaped key above.                                                                                                                                                              | Needs a parser before `./.github/actions/setup`. The choices are fetching a package from the registry inside a security check, or depending on the runner image's bundled npm internals, whose path and version can drift. This is the most code to maintain for a Low finding. It still rejects `${VAR}` references unless more logic is added. |
| B. Extend the anchored `key=` regex to accept quotes and leading whitespace.                       | Small. No dependency.                                                                                                                                                                                                                                   | Still approximates `key=value` syntax, so each new syntax needs another regex branch. Keeps the commented-line false positive.                                                                                                                                                                                                                   |
| **C. Reject any non-comment line that contains a credential key name, regardless of syntax.**      | One-line change. No dependency. Runs in the same early step. Enforces the stated policy (no credential keys in a committed `.npmrc`) directly instead of parsing `key=value`, so quoting, spacing and case do not matter. Ignores `#` and `;` comments. | Would also reject a non-credential line that happens to contain `_auth` or `_password`, such as a registry URL path. That is unlikely, and the failure is loud and easy to fix. Rejects `${VAR}` references by design. Misses deliberately escaped keys, as B does.                                                                              |
| D. Accept the gap and rely on GitHub secret scanning.                                              | No change.                                                                                                                                                                                                                                              | Leaves base64 `_auth` and `_password` values without a check in the repository. The step's comment and name would promise more than the step checks.                                                                                                                                                                                             |

**Recommendation: C**, together with clearer error wording. It closes every accidental case in
the matrix and removes the comment false positive. It has fewer drawbacks than B, and A's
dependency and maintenance cost is not justified for a Low finding:

```bash
if git grep -lIiE '^[[:space:]]*([^#;[:space:]].*)?(_authToken|_auth|_password)' -- '.npmrc' '**/.npmrc'; then
    echo "::error::The .npmrc file(s) above set npm credential keys (_authToken, _auth or _password). Pipelines inject credentials at build time, so remove these keys. If a real credential was committed, revoke it."
    exit 1
fi
```

Also reword the step's YAML comment to say that it rejects credential **keys**, including
`${VAR}` references. Then the stated behavior and the real behavior match.

**Alternative with the fewest drawbacks if the author prefers no workflow change: D.** It
accepts the residual base64 `_auth` / `_password` gap. In that case, reword the step comment
so that it does not claim full coverage. Choose A only if the guard is ever expected to resist
deliberate evasion. That is a different threat model from the one this PR states.

**Regression coverage:** this is an inline workflow step with no test harness, so the probe
matrix above is the evidence for the change. Re-run it against the final pattern, and record
in the commit message that it passed. Add a scripted test only if the check is moved into a
standalone script.

**Author decision and reasoning:** Fix, using the recommended option C (2026-10-21, "please fix
both"). The author gave no further reasoning.

**Implementation / commit / Copilot thread:** Fixed in
[`93f8a8a4`](https://github.com/microsoft/vscode-documentdb/commit/93f8a8a447e5e002bd0d36926581c1132d2fbd3b)
(`ci: reject any npm credential key in a committed .npmrc`). The step now uses the option C
pattern and the clearer error message. It was renamed to "Fail if a committed .npmrc sets npm
credential keys", and its comment now says that `${VAR}` references are rejected too. There is
no corresponding Copilot comment to link or reply to.

**Fix verification:** the step script was extracted from the committed YAML and run against the
probe matrix as both a root and a nested tracked `.npmrc`. Every credential key form fails, with
exit code 1: unquoted, double-quoted, single-quoted, spaced, indented unscoped, upper-case,
`_password` and `${VAR}`. Commented lines (`#` and `;`), `registry=` and `always-auth=true`
pass. The repository's own `.azure-pipelines/.npmrc` passes. The output contained file names
only, with no fixture values. As expected for option C, the escaped `\u005f` key is still not
detected.

## R2: Honor the link's TLS consent for anonymous loopback connections

**Severity:** Low. **Confidence:** High. **Introduced in this PR:** partly. The mismatch existed
before this PR, but the PR made it visible to users, as described below.

**Location:** [NoAuthHandler.ts, line 26](../../../../../../src/documentdb/auth/NoAuthHandler.ts#L26)
and [isEmulatorConnection](../../../../../../src/vscodeUriHandler.ts#L594).

### Evidence and impact

The link handler now shows a TLS consent prompt for every loopback target, including `127.x`
and `::1`. However, `isEmulatorConnection` still requires a `localhost` substring to set
`isEmulator`. The anonymous `NoAuthHandler` checks the stored exception only inside its
`isEmulator` branch. So when a user chooses **Turn off validation** for
`mongodb://127.0.0.1:10260/?tlsAllowInvalidCertificates=true` with anonymous authentication, the
choice is saved and then ignored. The connection still fails with a self-signed certificate
error.

The original review rejected this issue as pre-existing. This re-evaluation reclassifies it
for three reasons:

- This PR rewrote the exact lines involved. The new comment says the check is "host-gated like
  the other auth handlers", but
  [NativeAuthHandler](../../../../../../src/documentdb/auth/NativeAuthHandler.ts#L45), the
  Entra ID handler and the Managed Identity handler apply `resolveAllowInvalidCertificates`
  without an `isEmulator` gate. `NoAuthHandler` is the only handler with that gate.
- This PR added an explicit consent prompt whose acceptance has no effect on this path. Before
  this PR, the flag was ignored silently. Now the user is asked a question, and the answer is
  ignored.
- The failure is safe: certificate validation stays on, so there is no security impact. That
  is why the severity is Low and not higher.

### Solutions

| Option                                                                                                                                                                                                                | Pros                                                                                                                                                                                                                                                                                           | Cons                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Move the TLS check in `NoAuthHandler` out of the `isEmulator` branch, matching `NativeAuthHandler`.** Also apply the 4-second server-selection timeout when the exception resolves, as `NativeAuthHandler` does. | About five lines. Makes all four handlers behave the same, so the comment becomes true. `resolveAllowInvalidCertificates` still enforces the host gate, so a public host remains protected. It also fixes the same mismatch for anonymous connections that opt in through connection settings. | Changes runtime behavior in a security patch, so it needs one handler test. Existing saved anonymous `127.x` connections that already carry the flag start honoring it. That is the intended behavior, and those hosts are local only. |
| B. Make `isEmulatorConnection` treat every loopback host as an emulator.                                                                                                                                              | Fixes the link flow at its origin.                                                                                                                                                                                                                                                             | Widens the meaning of "emulator", which also drives labels, timeouts and other branches. A larger behavior change, and anonymous connections created another way are still not fixed.                                                  |
| C. Skip the TLS prompt for anonymous non-`localhost` targets.                                                                                                                                                         | No runtime change.                                                                                                                                                                                                                                                                             | Hides the inconsistency instead of fixing it. The user cannot reach a local test instance by IP address through a link.                                                                                                                |
| D. Defer to a follow-up issue.                                                                                                                                                                                        | Keeps the patch scope smallest.                                                                                                                                                                                                                                                                | Ships a consent prompt that is known to be ignored on one path.                                                                                                                                                                        |

**Recommendation: A.** It is the smallest change that makes the new consent prompt truthful,
and it aligns `NoAuthHandler` with the other three handlers. The existing host gate keeps it
safe.

**Alternative with the fewest drawbacks: D**, with a linked issue and a short note in the 1.0.2
release notes. Choose D only if the author wants this patch to contain no runtime auth changes
beyond those already reviewed.

**Regression coverage:** in `NoAuthHandler.test.ts`, check the client options returned for
`127.0.0.1` and `::1` with `isEmulator: false` and `disableEmulatorSecurity: true`. Expect
`tlsAllowInvalidCertificates: true`. Also check that the same flags on a public host produce no
TLS option. Cover the client options, not only the saved flags.

**Author decision and reasoning:** Fix, using the recommended option A (2026-10-21, "please fix
both"). The author gave no further reasoning.

**Implementation / commit / Copilot thread:** Fixed in
[`e0533846`](https://github.com/microsoft/vscode-documentdb/commit/e05338469206fa1304d44c3d20929a2f46f69d0f)
(`fix(auth): apply an accepted TLS exception to anonymous loopback connections`).
`NoAuthHandler` now calls `resolveAllowInvalidCertificates` outside the `isEmulator` branch. It
applies the 4-second server-selection timeout when the connection is an emulator or the
exception resolves, exactly as `NativeAuthHandler` does. The same commit updates the
[No Authentication README](../../../no-auth/README.md) and adds the tests. The 1.0.2
changelog and release notes mention the user-visible fix in
[`2111d471`](https://github.com/microsoft/vscode-documentdb/commit/2111d4714b9b29e39a3e282d7cb64f64552cbe94).
There is no corresponding Copilot comment.

**Fix verification:** the new tests cover these cases:

- `NoAuthHandler.test.ts`: `127.0.0.1` and `[::1]` with `isEmulator: false` and
  `disableEmulatorSecurity: true` produce `tlsAllowInvalidCertificates: true` and the 4-second
  timeout.
- `NoAuthHandler.test.ts`: the same loopback host without the flag produces no options.
- `NoAuthHandler.test.ts`: a public host with the flag produces no options.
- `vscodeUriHandler.test.ts`: an end-to-end test for `127.0.0.1` and `[::1]`. It accepts the
  link's TLS prompt, checks the saved flags (`isEmulator: false`, `disableEmulatorSecurity:
true`), and then passes the saved connection to `NoAuthHandler` to check the resulting client
  option.

With the handler change reverted, all four loopback tests fail. With the change in place, the
whole run passes.

### Other rejected assumptions

- Reusing a saved connection's TLS posture is intentional. The duplicate branch does not
  save or apply the incoming link's requested exception.
- The publish job's pinned npm CLI installation uses `--ignore-scripts`; it is not workspace
  dependency installation or a rebuild. Its presence alone is not a finding.
- The directly configured local/private TLS policy and the stricter loopback-only external
  link policy are deliberate separate boundaries.
- Deferred localization and version updates are known draft work, not newly discovered bugs.

## Fix progress

| Date       | Commit                                                                                                       | Change                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-21 | [`1e1ca935`](https://github.com/microsoft/vscode-documentdb/commit/1e1ca9351837d7da5dd45ae1e7bcde9aad180c92) | Severity and solution re-evaluation: R1 re-rated to Low, R2 added.                                                                                       |
| 2026-10-21 | [`93f8a8a4`](https://github.com/microsoft/vscode-documentdb/commit/93f8a8a447e5e002bd0d36926581c1132d2fbd3b) | R1 fixed (option C): the credential guard rejects any non-comment credential key line.                                                                   |
| 2026-10-21 | [`e0533846`](https://github.com/microsoft/vscode-documentdb/commit/e05338469206fa1304d44c3d20929a2f46f69d0f) | R2 fixed (option A): `NoAuthHandler` applies the TLS exception exactly as `NativeAuthHandler` does. Tests and the No Authentication README were updated. |
| 2026-10-21 | [`2111d471`](https://github.com/microsoft/vscode-documentdb/commit/2111d4714b9b29e39a3e282d7cb64f64552cbe94) | The 1.0.2 changelog and release notes mention the R2 fix.                                                                                                |
| 2026-10-21 | This commit                                                                                                  | The review records the decisions, fixes and verification.                                                                                                |

Fix verification (Case 1):

- `npm run build` passed.
- `npx vitest run src/vscodeUriHandler.test.ts src/documentdb/auth/NoAuthHandler.test.ts
src/documentdb/utils/tlsException.test.ts` passed: **3 suites, 82 tests**.
- The R1 probe matrix ran against the step script extracted from the committed workflow. The
  results are under R1.

The fixes have not yet been revalidated by an independent reviewer.

## Verification and handoff

This is **Case 1: still working**, not a request to prepare or mark the PR ready for review.

| Check                          | Evidence                                                                                                                                                                                                        |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local build                    | `npm run build` passed, including workspace prebuilds.                                                                                                                                                          |
| Focused unit tests             | Vitest passed **5 suites / 176 tests** covering the URI handler, `NoAuthHandler`, OIDC allowlisting, host classification and TLS exception helpers.                                                             |
| Credential guard probe         | The primary pass reproduced the parser/regex mismatch using synthetic strings. The independent gate reproduced the exact shell outcome and checked npm's bundled parser.                                        |
| Test adapter                   | The editor test tool reported no tests found; the repository's `npx vitest run` runner provided the successful local result.                                                                                    |
| Independent gate test evidence | The gate relied on the primary pass's successful build/Vitest result; it did not independently rerun those checks.                                                                                              |
| GitHub CI at reviewed head     | Unit tests passed. Static checks and Merge gate failed; the CI report identifies missing localization updates. ESLint and formatting passed in that remote run. Package/VSIX checks were skipped for the draft. |

The focused command selected these existing suites:

```bash
npx vitest run \
  src/vscodeUriHandler.test.ts \
  src/documentdb/auth/NoAuthHandler.test.ts \
  src/documentdb/auth/oidcAllowedHosts.test.ts \
  src/documentdb/utils/hostClassification.test.ts \
  src/documentdb/utils/tlsException.test.ts
```

The actual invocation also included `src/documentdb/auth/NativeAuthHandler.test.ts`, which does
not exist and added no suite. The reported count is the five suites that actually ran.

Remote evidence:
[CI run](https://github.com/microsoft/vscode-documentdb/actions/runs/39479528105),
[CI report](https://github.com/microsoft/vscode-documentdb/pull/1040#issuecomment-6298887748).
Remote lint/format results above are not a claim that these checks were run locally.

### Remaining gates, not performed by this review

1. Done: the author decided to fix R1 and R2, and both fixes are committed (see
   [Fix progress](#fix-progress)). An independent reviewer should still revalidate both fixes
   in the gate below.
2. Run the required explicitly different-vendor validation gate; revalidate later Copilot
   feedback if any arrives.
3. Complete the declared 1.0.2 version and localization updates before handoff.
4. Exercise the prompts in VS Code: a new connection with confirmations disabled, localhost
   TLS consent choices and cancellation, and a public host requesting the same exception. For
   R2, also test anonymous authentication against a `127.0.0.1` instance with a self-signed
   certificate: after the user accepts the exception, the connection should succeed.
5. Push the branch and confirm that the renamed credential-guard step passes in GitHub CI.
6. Validate real Trusted Publishing of a tarball with provenance through the approved release
   process. A dry-run is not evidence that registry authentication/provenance succeeds; this
   review did not publish or dispatch a release workflow.
7. When the author requests ready-for-review handoff, run the full Case 2 list from
   [CONTRIBUTING.md](../../../../../../CONTRIBUTING.md#4-pr-submission-checklist).
   **Full checks, including `prettier-fix`, were deferred while this PR remains a draft.**

No claim is made that the full review workflow or ready-for-review gate has passed.
