---
kind: plan
status: active
created: 2026-11-16
---

# Dependency security update for 1.1.0

One PR against `main`, milestone **1.1.0**. It resolves the Dependabot alerts listed below
with aged, sufficient versions and no unrelated dependency churn.

## Scope

| Alert                                                                         | Severity | Package            | Issue                                                                      | Scope       | Current  | Fix                           | Commit |
| ----------------------------------------------------------------------------- | -------- | ------------------ | -------------------------------------------------------------------------- | ----------- | -------- | ----------------------------- | ------ |
| [239](https://github.com/microsoft/vscode-documentdb/security/dependabot/239) | Critical | `proxy-addr`       | IPv4-mapped IPv6 trust-subnet IP spoofing                                  | Runtime     | `2.0.7`  | `2.0.8`                       | 1      |
| [257](https://github.com/microsoft/vscode-documentdb/security/dependabot/257) | High     | `@azure/msal-node` | Authorization-code parameters disclosed to an attacker-controlled endpoint | Runtime     | `5.1.4`  | `7.1.0` via Identity `4.14.1` | 2      |
| [120](https://github.com/microsoft/vscode-documentdb/security/dependabot/120) | Medium   | `uuid`             | Missing buffer bounds checks in v3/v5/v6                                   | Runtime     | `8.3.2`  | Removed by the MSAL update    | 2      |
| [125](https://github.com/microsoft/vscode-documentdb/security/dependabot/125) | High     | `tmp`              | Path traversal via prefix/postfix                                          | Development | `0.2.5`  | `0.2.7`                       | 3      |
| [250](https://github.com/microsoft/vscode-documentdb/security/dependabot/250) | High     | `markdown-it`      | Quadratic-time multiline link-reference rendering                          | Development | `14.3.2` | `14.3.3`                      | 3      |
| [247](https://github.com/microsoft/vscode-documentdb/security/dependabot/247) | High     | `vite`             | launch-editor Windows existence-check bypass                               | Development | `8.0.16` | `8.1.6`                       | 4      |
| [251](https://github.com/microsoft/vscode-documentdb/security/dependabot/251) | Medium   | `vite`             | Files outside `server.fs.allow` served under matching system paths         | Development | `8.0.16` | `8.1.6`                       | 4      |
| [248](https://github.com/microsoft/vscode-documentdb/security/dependabot/248) | Medium   | `vite`             | launch-editor CLI-flag misinterpretation enables command execution         | Development | `8.0.16` | `8.1.6`                       | 4      |
| [246](https://github.com/microsoft/vscode-documentdb/security/dependabot/246) | Medium   | `vite`             | launch-editor omits Windows `%` escaping                                   | Development | `8.0.16` | `8.1.6`                       | 4      |
| [240](https://github.com/microsoft/vscode-documentdb/security/dependabot/240) | High     | `source-map-js`    | Indexed source-map event-loop denial of service                            | Development | `1.2.1`  | `1.2.2`                       | 4      |
| [235](https://github.com/microsoft/vscode-documentdb/security/dependabot/235) | High     | `basic-ftp`        | Unix directory-listing parser CPU denial of service                        | Runtime     | `5.3.1`  | `6.2.6`                       | 5      |
| [289](https://github.com/microsoft/vscode-documentdb/security/dependabot/289) | Medium   | `basic-ftp`        | Process crash from CR/LF in password or resumed-download path              | Runtime     | `5.3.1`  | `6.2.6`                       | 5      |
| [288](https://github.com/microsoft/vscode-documentdb/security/dependabot/288) | Medium   | `basic-ftp`        | MLSD parser crash via `__proto__` fact name                                | Runtime     | `5.3.1`  | `6.2.6`                       | 5      |

All alerts are in the root [lockfile](../../package-lock.json). Severity and scope are
GitHub's values; development scope is not grounds to dismiss an alert.
**Out of scope:** any package not listed in this document.

## Selection rules

1. Prefer an aged direct/parent release that naturally adopts the patched dependency.
2. Choose a sufficient stable version, not the newest major.
3. Every newly introduced version, including transitives and optional platform packages,
   must have been published **more than seven days** before it enters the lockfile
   (the [fresh-dependency skill](../../.github/skills/flagging-fresh-dependencies/SKILL.md)
   flags `<= 7` days). Planning cutoff: published before **2026-11-09T10:17:46.866Z**.
4. Do not delete the lockfile or run a blanket update. Use exact, scoped overrides only
   where a parent range excludes the fix or would admit a fresh version.

Wider ranges were rejected because they resolved fresh versions in a rehearsal:
`vite@8.1.7` (6.97 days old) and `rolldown@1.1.8` (5.13 days) with its bindings, and
`@tybys/wasm-util@0.10.5` (0.11 days). Hence the exact Vite pin and the scoped constraints.

## Chosen versions

Publication times are the public npm registry's `time[version]` values.
Ages are at the planning reference time **2026-11-16T10:17:46.866Z**.

| Package            | Version                                                     | Published (UTC)          | Age (days) |
| ------------------ | ----------------------------------------------------------- | ------------------------ | ---------- |
| `proxy-addr`       | `2.0.8`                                                     | 2026-09-15T06:12:45.377Z | 62.17      |
| `@azure/identity`  | `4.14.1`                                                    | 2026-10-29T22:16:07.100Z | 17.50      |
| `@azure/msal-node` | `7.1.0`                                                     | 2026-10-13T22:41:13.211Z | 33.48      |
| `tmp`              | `0.2.7`                                                     | 2026-05-27T15:47:18.009Z | 172.77     |
| `markdown-it`      | `14.3.3`                                                    | 2026-10-16T01:47:54.675Z | 31.35      |
| `vite`             | `8.1.6`                                                     | 2026-10-06T04:51:51.393Z | 41.23      |
| `rolldown`         | `1.1.5`                                                     | 2026-07-08T11:32:16.119Z | 130.95     |
| `source-map-js`    | `1.2.2`                                                     | 2026-09-30T14:08:09.382Z | 46.84      |
| `@tybys/wasm-util` | `0.10.4` (already locked; pin prevents a fresh replacement) | 2026-09-13T08:00:13.464Z | 64.10      |
| `basic-ftp`        | `6.2.6`                                                     | 2026-11-04T20:58:51.621Z | 11.55      |

Expected new transitive versions (re-verify with the age gate):

| Package                 | Version   | Published (UTC)          |
| ----------------------- | --------- | ------------------------ |
| `@azure/core-process`   | `1.0.0`   | 2026-08-13T07:26:58.935Z |
| `@azure/msal-common`    | `16.14.2` | 2026-10-02T19:36:37.698Z |
| `open`                  | `11.0.4`  | 2026-09-14T20:36:00.110Z |
| `default-browser`       | `5.5.1`   | 2026-08-16T19:49:09.001Z |
| `is-in-ssh`             | `1.0.0`   | 2025-11-12T15:31:49.173Z |
| `powershell-utils`      | `0.2.1`   | 2026-08-29T12:58:14.937Z |
| `wsl-utils`             | `1.0.1`   | 2026-09-30T04:38:28.398Z |
| `@oxc-project/types`    | `0.139.0` | 2026-07-06T15:29:32.613Z |
| `@napi-rs/wasm-runtime` | `1.1.6`   | 2026-06-24T07:22:04.062Z |
| `@emnapi/core`          | `1.11.1`  | 2026-06-13T03:36:11.046Z |
| `@emnapi/runtime`       | `1.11.1`  | 2026-06-13T03:35:59.303Z |
| `@emnapi/wasi-threads`  | `1.2.2`   | 2026-06-08T03:01:05.029Z |

All 15 `@rolldown/binding-*` packages must be exactly **`1.1.5`** (published
2026-07-08T11:30-11:32Z): `android-arm64`, `darwin-arm64`, `darwin-x64`, `freebsd-x64`,
`linux-arm-gnueabihf`, `linux-arm64-gnu`, `linux-arm64-musl`, `linux-ppc64-gnu`,
`linux-s390x-gnu`, `linux-x64-gnu`, `linux-x64-musl`, `openharmony-arm64`, `wasm32-wasi`,
`win32-arm64-msvc`, `win32-x64-msvc`. Keep every platform's lock entry, not just Linux.

## Commits

One commit per dependency family, in this order, so any family can be dropped without
regenerating the others. Regenerate the lockfile with npm; never hand-edit it.

**Execution (2026-11-16):** The operator instructed `/lead` to implement this plan,
push and create a PR against `main` for milestone 1.1.0, run both verification cases,
and finish with the seven-day dependency scan. Opus 5.5 reviewed the plan and
recommended the following coding models; the leader accepted these assignments
(confidence 95%). All items run serially because they share the lockfile.

| Item | Recommended and assigned model | Reason                                                    |
| ---- | ------------------------------ | --------------------------------------------------------- |
| 1    | `gpt-6-luna`                   | Mechanical lockfile-only patch                            |
| 2    | `gpt-6.1-sol`                  | Authentication SDK and lazy-load compatibility            |
| 3    | `gpt-6-luna`                   | Mechanical lockfile-only patches                          |
| 4    | `gpt-6.1-sol`                  | Cross-module build, bundling and dev-server compatibility |
| 5    | `gpt-6.1-terra`                | Scoped override and bounded FTP API smoke                 |

Preflight: clean worktree, source plan already committed as `6c0aa59f6`;
npm 10.9.3, Node 22.21.1, public npm registry. A no-script, lockfile-only
install produced no diff. The original root lockfile was saved outside the worktree.
All thirteen targeted alerts were verified open through GitHub's API.

### 1. proxy-addr `2.0.8`

- Lockfile-only refresh. `express@5.2.1`'s `^2.0.7` range admits it. Path:
  `@mongosh/service-provider-node-driver` -> `@mongodb-js/oidc-plugin` -> `express` -> `proxy-addr`.
- No override needed if a targeted refresh produces `2.0.8`.
- Check: [Entra auth tests](../../src/documentdb/auth/MicrosoftEntraIDAuthHandler.test.ts);
  do not change application proxy policy.

> **Done (2026-11-16), commit `b3810a922`:** Updated the sole `proxy-addr` copy to
> `2.0.8` with npm; only that package's metadata changed. Operator-approved patch;
> advised (`claude-opus-5.5`), implemented by `gpt-6-luna`. Leader confidence 99%
> after reviewing the scoped diff and age-gate evidence. One introduced version,
> zero fresh, unknown or lookup failures. No tests added or changed; Entra tests
> and the build are deferred to the installed-dependency batch.

### 2. Azure Identity `4.14.1` with MSAL Node `7.1.0`

- Direct dependency `@azure/identity`: `~4.13.0` -> **`~4.14.1`**.
- Override `"@azure/identity": { "@azure/msal-node": "7.1.0" }` so a fresh MSAL cannot be
  selected. Identity itself declares MSAL `^7.1.0`; we never import MSAL directly, so the
  MSAL major is the Azure SDK's supported pairing, not our migration.
- MSAL `7.1.0` brings `@azure/msal-common@16.14.2` and drops `uuid`; confirm `uuid@8.3.2`
  is gone. Do not force a UUID major.
- Identity now requires `open@^11` (ESM-only) and Node `>=22`; our minimum is `22.18`.
  The packaged activation check must prove it loads.
- Checks: [managedIdentityTokenProvider](../../src/documentdb/auth/managedIdentityTokenProvider.test.ts),
  [ManagedIdentityAuthHandler](../../src/documentdb/auth/ManagedIdentityAuthHandler.test.ts),
  [MicrosoftEntraIDAuthHandler](../../src/documentdb/auth/MicrosoftEntraIDAuthHandler.test.ts),
  [managed-identity endpoint harness](../../src/documentdb/auth/managedIdentityEndpoint.harness.test.ts),
  [sovereign auth](../../src/documentdb/auth/sovereignAuth.integration.test.ts).
  Keep failure classification, token caching and sovereign-cloud behavior.

> **Done (2026-11-16), commit `2373d8943`:** Applied the approved Identity range and
> scoped Node MSAL pin; removed `uuid@8.3.2`. Implemented by `gpt-6.1-sol`;
> advised (`claude-opus-5.5`). The advisor resolved the worker's blocker with high
> confidence: unchanged MSAL Browser pins root `msal-common@16.5.1`, while Node
> MSAL correctly pins nested `16.14.2`; preserving both avoids unrelated churn.
> Leader confidence 98% in carrying out that verdict. SDK source review found
> the existing managed-identity call and error-classification paths compatible;
> upstream Azure Arc now validates the requested client ID. `npm ls` passed;
> six focused auth files passed (152 tests). No tests added or changed.
> Cumulative age gate: ten introduced versions, zero fresh, unknown or lookup
> failures. Root build and packaged checks remain in the final batch.

**Deferred, escalated (2026-11-16):** The advisor found that ordinary activation does
not load the lazy Identity SDK, so activation alone cannot prove its packaged load.
The leader asked whether to approve an additional one-off packaged fake-endpoint
smoke or accept graph inspection and existing tests with that proof unverified.
The operator was unavailable. No new auth or test behavior is authorized; the
additional smoke remains parked, while the approved dependency update and existing
checks can proceed. Recommendation: approve the one-off smoke before final handoff.

### 3. tmp `0.2.7` and markdown-it `14.3.3`

- Lockfile-only refresh; `@vscode/vsce@3.7.1` and `@vscode/l10n-dev@0.0.35` ranges admit both.
- Check at handoff: `npm run l10n:check` and `npm run package` behave as before.

> **Done (2026-11-16), commit `b39994c75`:** npm updated only `tmp` and
> `markdown-it` to the accepted patch versions. Advised (`claude-opus-5.5`),
> implemented by `gpt-6-luna`; leader confidence 99% after the mechanical diff
> review. Cumulative age gate: twelve introduced versions, zero fresh, unknown
> or lookup failures. No tests added or changed; localization and packaging
> verification remain in the final Case 2 batch.

### 4. Vite `8.1.6`, Rolldown `1.1.5`, source-map-js `1.2.2`

- Direct `vite`: `~8.0.16` -> exact **`8.1.6`** (temporary exact pin, see selection rules).
- Override `"vite": { ".": "$vite", "rolldown": "1.1.5" }`; all bindings `1.1.5`.
- Override `"@napi-rs/wasm-runtime@1.1.6": { "@tybys/wasm-util": "0.10.4" }`.
- `source-map-js` `1.2.1` -> `1.2.2`; `postcss` and `sass` ranges admit it.
- Keep `vitest@4.1.12` and `@vitejs/plugin-react@6.1.1`. Vite needs Node `^20.19 || >=22.12`.
- `npm run build` is `tsc` only and does not bundle; `npm run package` and its VSIX/activation
  inspection are the real gate. Smoke one L2-dev webview scenario for the dev server.
- Update the existing override comment in `package.json` to match the new Vite shape.

> **Done (2026-11-16), commit `3559f3c4d`:** Implemented the exact Vite,
> Rolldown and wasm pins, retaining all fifteen platform bindings and the
> existing Vitest/plugin-react/glob versions. Implemented by `gpt-6.1-sol`;
> advised (`claude-opus-5.5`). Targeted refresh twice left `source-map-js` at
> `1.2.1`; the advisor approved the plan's exact `1.2.2` override fallback at
> 90% confidence, conditional on no additional churn. That condition passed.
> Leader confidence 98% in the scoped manifest and evidence. Cumulative age
> gate: thirty-five introduced versions, zero fresh, unknown or lookup failures.
> Nineteen Fluent UI test files passed (174 tests); no tests added or changed.
> Build, packaging and L2-dev smoke remain in the final checks.

**Deferred, escalated (2026-11-16):** The advisor found an existing nested
`@napi-rs/wasm-runtime@1.2.4`, whereas the proposed scoped override keys on `1.1.6`.
The leader asked whether to re-key the pin to the actually resolved aged runtime,
force `1.1.6`, or retain the plan verbatim. The operator was unavailable; none of
these alternatives is newly approved. Attempt only the accepted manifest change;
if resolution requires a different pin or introduces a fresh/unknown version,
park item 4 without committing it and continue independent items. Recommendation:
permit a scoped `@tybys/wasm-util@0.10.4` pin under the actually resolved aged runtime.

**Resolution (2026-11-16):** The exact accepted manifest resolved
`@napi-rs/wasm-runtime@1.1.6` and retained `@tybys/wasm-util@0.10.4`.
The hypothetical override mismatch did not occur; no alternative pin, decision
deviation or additional operator authorization is needed.

### 5. basic-ftp `6.2.6`, scoped under get-uri

- Override `"get-uri": { "basic-ftp": "6.2.6" }`. Keep `get-uri@6.0.5` and its parents.
  Path: `@mongosh/service-provider-node-driver` -> `@mongodb-js/devtools-connect` ->
  `@mongodb-js/devtools-proxy-support` -> `pac-proxy-agent` -> `get-uri` -> `basic-ftp`.
- This crosses get-uri's `^5.0.2` range. Latest stable `get-uri@8.0.1` still requires
  `^5.3.1`, so a parent upgrade does not help.
- Risk is low: the [basic-ftp changelog](https://github.com/patrickjuchli/basic-ftp/blob/master/CHANGELOG.md)
  lists one 6.0.0 breaking change, refusing separate PASV transfer hosts by default
  (FTP-bounce hardening). The CommonJS API get-uri uses (`Client`, `access`, `lastMod`,
  `list`, `downloadTo`, `close`) is unchanged.
- Check: one-off smoke, recorded in the PR (no permanent fixture). Serve a PAC file from a
  local FTP server and fetch it through get-uri's `ftp://` handler. Also run the existing
  [shell-session](../../src/documentdb/shell/ShellSessionManager.test.ts) and
  [playground-worker](../../src/documentdb/playground/playgroundWorker.test.ts) tests.
- If the smoke fails, drop this commit and report it; do not ship an untested override.

> **Done (2026-11-16), commit `56930718a`:** Added only the approved scoped
> `get-uri` override and updated the sole `basic-ftp` package record.
> Implemented by `gpt-6.1-terra`; advised (`claude-opus-5.5`), approval 88%.
> Leader confidence 98% after the scoped diff and smoke review. The advisor
> confirmed compatible consumed APIs and numeric `FTPError.code`; separate
> PASV hosts are now rejected by upstream's approved hardening. The temporary
> read-only FTP server bound only to loopback; exact PAC bytes, cached
> `ENOTMODIFIED`, missing-file `ENOTFOUND` and numeric error 550 all passed.
> Shell/playground tests passed (84 tests). No tests added or changed.
> Cumulative age gate: thirty-six introduced versions, zero fresh, unknown
> or lookup failures. Temporary smoke/server assets were cleaned up.

### Resulting root overrides

The existing `"glob": "~12.0.0"` entry stays unchanged. Patch-only entries
(`proxy-addr`, `source-map-js`, `tmp`, `markdown-it`) may be omitted if targeted refreshes
lock the same versions without them.

```json
{
  "glob": "~12.0.0",
  "vite": { ".": "$vite", "rolldown": "1.1.5" },
  "proxy-addr": "2.0.8",
  "source-map-js": "1.2.2",
  "tmp": "0.2.7",
  "markdown-it": "14.3.3",
  "get-uri": { "basic-ftp": "6.2.6" },
  "@azure/identity": { "@azure/msal-node": "7.1.0" },
  "@napi-rs/wasm-runtime@1.1.6": { "@tybys/wasm-util": "0.10.4" }
}
```

## Age gate

Save the pre-change `package-lock.json` outside the worktree as `$BASELINE_ROOT`, then after
each commit's lockfile change:

```bash
node .github/skills/flagging-fresh-dependencies/scripts/find-fresh-dependencies.mjs \
  package-lock.json --baseline "$BASELINE_ROOT" --days 7 --json --fail-on-fresh
```

Require zero fresh, **zero newly introduced unknown external versions** (the scanner does not
fail on unknowns, so check that field), and zero lookup failures (exit 3 means rerun).
Add `--now 2026-11-16T10:17:46.866Z` to reproduce the planning selection.
Public npm age does not prove the Azure Artifacts feed has synced; CI install is the final check.

## Acceptance

- [x] All five commits applied; the age gate passes after each.
- [ ] Every locked copy of `proxy-addr`, `@azure/msal-node`, `tmp`, `markdown-it`, `vite`,
      `source-map-js` and `basic-ftp` is outside its alert's affected range; `uuid@8.3.2` is gone.
- [x] Draft (Case 1): `npm run build` plus the focused tests named above.
- [x] Ready for review (Case 2, in full): `npm run prettier-fix`, `npm run l10n:check`,
      `npm run lint`, `npm run build`, `npm run typecheck:tests`, `npx vitest run`,
      `npm run package`. No `npm run l10n` needed: no product strings change.
- [ ] FTP smoke result recorded in the PR description.
- [ ] Manual smoke on the packaged VSIX: Entra ID sign-in, Azure discovery tree, Collection
      View, and a shell session.
- [ ] After merge, re-fetch the Dependabot alerts and confirm the 13 IDs above closed.

## Outcome

**Still unverified:** interactive packaged-VSIX Entra sign-in, Azure discovery,
Collection View and a shell session. Try these before pushing further or
requesting human review. Ordinary activation does not prove that the lazy Identity
SDK loads; the extra packaged fake-endpoint test remains an operator decision.
These limitations are not represented as passing checks.

Draft PR: [#1087](https://github.com/microsoft/vscode-documentdb/pull/1087),
base `main`, milestone **1.1.0**. Its description links each security alert;
Dependabot alerts are not issue numbers, so no unrelated issues are linked with
`Closes #NNN`. Closure must be confirmed after merge.

Both requested verification cases passed locally:

- Case 1: root build; eight focused auth/shell/playground files, 236 tests passed.
- Case 2: `prettier-fix`, `l10n:check` (3,523 strings), `lint`, root build,
  exact `typecheck:tests`, full Vitest (414 files; 9,431 passed, one skipped),
  and `package`.
- Additional: verification-tool tests (147 Node and 121 browser tests), VSIX
  inspection (9,416,876 bytes). The generated VSIX is named
  `vscode-documentdb-1.0.2.vsix` because this PR does not change the extension version.
- Installed-VSIX activation initially failed before loading the extension because
  the host lacks `libatk-1.0.so.0`; task-local environment recovery is in progress.
- A checks-worker invocation accidentally included a trailing `.` and ran a
  broader extension suite (8,116 passed, one skipped) before the correct focused
  command. This was additional work, not a substitute for either required suite.
  Original check logs were not saved as requested; results are from the host
  session transcript. Recovery logs will be persisted.
- No product strings changed, so localization generation was not needed.
- L2-dev, remote CI and the final full-lockfile age scan are pending.

The [committed AI pre-review](features/build-and-test-stack/iterations/03-november-dependency-security-review.md)
records the Opus initial review and Sol different-vendor validation/independent
sweep. Neither found defects requiring an author decision. User documentation
was searched for these toolchain/authentication dependency changes; no affected
usage instructions were found. Existing build design invariants are unchanged.
