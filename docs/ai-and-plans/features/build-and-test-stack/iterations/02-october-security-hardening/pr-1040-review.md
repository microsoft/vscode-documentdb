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
- **Boundary:** review only. No fixes, publication, GitHub review submission, thread
  resolution, or ready-for-review transition were requested or performed.

## Review stages

| Stage | Result |
| --- | --- |
| Initial edge-case review | Completed against the full diff and relevant surrounding code. |
| Merge Copilot reviewer comments | GitHub returned zero review comments and zero submitted reviews at the reviewed head. There is no Copilot feedback to merge yet. |
| Independent validation gate | A separate code-review agent checked the candidate against the code and independently reproduced it with synthetic input, including npm's bundled INI parser. R1 remains valid at Medium severity. |
| Independent sweep | The validation agent also reviewed beyond R1. It reported no additional high-confidence bugs introduced by this diff. |
| Different-vendor/model/context requirement | **Not certified.** The separate pass used the harness-selected agent configuration. Its vendor/model/context provenance was not exposed sufficiently to establish the specific section 6.1 requirement. Do not count this as completion of the required cross-vendor gate. |
| Author decisions | Pending. Recommendations below are reviewer recommendations, not author approvals. |

The review record is ready for the author's section 6.2 decisions. Section 6.1 still needs
the explicitly different-vendor validation pass, and any later Copilot comments must be merged
and revalidated. Finding R1 has not been fixed.

## Summary

| ID | Source | Severity | Confidence | Finding | Author decision |
| --- | --- | --- | --- | --- | --- |
| R1 | Primary review; independently validated | Medium | High | New npm credential guard misses valid quoted configuration keys | Pending |

R1 is an omission in a newly introduced preventive check, not evidence of a credential leak
or a demonstrated compromise. The review did not discover any actual committed credentials.

## R1: Recognize quoted npm configuration keys in the credential guard

**Severity:** Medium. **Confidence:** High. **Introduced in this PR:** yes, as incomplete
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

| Input | Parsed credential key | Credential-check result |
| --- | --- | --- |
| `//registry.npmjs.org/:_authToken=npm_review_fixture` | `//registry.npmjs.org/:_authToken` | Rejected, step exits 1 |
| `"//registry.npmjs.org/:_authToken"=npm_review_fixture` | `//registry.npmjs.org/:_authToken` | Missed, step exits 0 |
| `  _authToken=npm_review_fixture` | `_authToken` | Missed, step exits 0 |

The scoped quoted-key case establishes the finding independently of whether current npm
accepts an unscoped authentication key. No real credentials were used in the probes.

### Solutions

| Option | Pros | Cons |
| --- | --- | --- |
| **A. Parse tracked `.npmrc` files with npm-compatible INI semantics, then check normalized credential keys.** Report filenames only and fail explicitly on checker errors. | Handles valid quoting, whitespace and parser-supported escapes instead of approximating the syntax. | A pinned parser must be available before dependency installation without executing workspace lifecycle scripts. |
| **B. Extend the text check to recognize leading key whitespace and quoted credential keys.** | Small, dependency-free patch at the existing early CI boundary. | Still approximates INI parsing; quote and escape coverage needs explicit tests and a documented boundary. |

**Recommendation:** A for the stated guarantee that committed npm credentials are rejected.
B is a smaller immediate mitigation for the demonstrated omission, but should not be presented
as complete parser-equivalent coverage.

**Regression coverage:** unquoted and quoted registry-scoped `_authToken`, `_auth`, and
`_password`; supported quote/escape forms and leading whitespace; harmless configuration;
tracked root and nested `.npmrc` files; checker errors; and an assertion that output contains
only filenames, never credential values.

**Author decision and reasoning:** Pending.

**Implementation / commit / Copilot thread:** Not started; there is no corresponding Copilot
comment to link or reply to.

## Rejected candidates and scope boundaries

### Anonymous authentication on literal loopback addresses

The link handler offers the new TLS consent prompt for `127.x` and `::1`, but
[isEmulatorConnection](../../../../../../src/vscodeUriHandler.ts#L594) still requires a
`localhost` substring to set `isEmulator`. The anonymous
[NoAuthHandler](../../../../../../src/documentdb/auth/NoAuthHandler.ts#L25) applies the stored
exception only inside its `isEmulator` branch. Consequently an anonymous connection using a
literal loopback address can have an accepted exception that the handler does not apply.

**Not reported as a new regression:** the base revision already classified these literal
addresses as non-emulators, stored their requested exception, and ignored it in this handler.
The new prompt exposes that existing mismatch; it does not introduce the runtime defect.
If followed up separately, cover both the saved flags and the eventual client options, rather
than testing consent/storage alone. No author decision to fix or defer this issue is implied.

### Other rejected assumptions

- Reusing a saved connection's TLS posture is intentional. The duplicate branch does not
  save or apply the incoming link's requested exception.
- The publish job's pinned npm CLI installation uses `--ignore-scripts`; it is not workspace
  dependency installation or a rebuild. Its presence alone is not a finding.
- The directly configured local/private TLS policy and the stricter loopback-only external
  link policy are deliberate separate boundaries.
- Deferred localization and version updates are known draft work, not newly discovered bugs.

## Verification and handoff

This is **Case 1: still working**, not a request to prepare or mark the PR ready for review.

| Check | Evidence |
| --- | --- |
| Local build | `npm run build` passed, including workspace prebuilds. |
| Focused unit tests | Vitest passed **5 suites / 176 tests** covering the URI handler, `NoAuthHandler`, OIDC allowlisting, host classification and TLS exception helpers. |
| Credential guard probe | The primary pass reproduced the parser/regex mismatch using synthetic strings. The independent gate reproduced the exact shell outcome and checked npm's bundled parser. |
| Test adapter | The editor test tool reported no tests found; the repository's `npx vitest run` runner provided the successful local result. |
| Independent gate test evidence | The gate relied on the primary pass's successful build/Vitest result; it did not independently rerun those checks. |
| GitHub CI at reviewed head | Unit tests passed. Static checks and Merge gate failed; the CI report identifies missing localization updates. ESLint and formatting passed in that remote run. Package/VSIX checks were skipped for the draft. |

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

1. The author records a decision and rationale for R1 before implementation.
2. Run the required explicitly different-vendor validation gate; revalidate later Copilot
   feedback if any arrives.
3. Complete the declared 1.0.2 version and localization updates before handoff.
4. Exercise the prompts in VS Code: a new connection with confirmations disabled, localhost
   TLS consent choices and cancellation, and a public host requesting the same exception.
5. Validate real Trusted Publishing of a tarball with provenance through the approved release
   process. A dry-run is not evidence that registry authentication/provenance succeeds; this
   review did not publish or dispatch a release workflow.
6. When the author requests ready-for-review handoff, run the full Case 2 list from
   [CONTRIBUTING.md](../../../../../../CONTRIBUTING.md#4-pr-submission-checklist).
   **Full checks, including `prettier-fix`, were deferred while this PR remains a draft.**

No claim is made that the full review workflow or ready-for-review gate has passed.
