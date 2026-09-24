---
feature: local-quickstart
kind: iteration
status: active
prs: [953]
created: 2026-09-24
code:
  - src/webviews/documentdb/localQuickStart/credentialValidation.ts
  - src/webviews/documentdb/localQuickStart/advancedOptions.ts
  - src/webviews/documentdb/localQuickStart/localQuickStartRouter.ts
  - src/webviews/documentdb/localQuickStart/LocalQuickStart.tsx
  - src/services/localQuickStart/quickStartCredentials.ts
  - src/services/localQuickStart/QuickStartService.ts
---

# 08 — Reject credentials and ports setup can't honor (issue #949)

> Configure accepted usernames, passwords and an empty port that DocumentDB Local then failed on,
> minutes later or not at all. One rule set now runs in both the webview and the router, and the
> host runs the driver's SASLprep on non-ASCII passwords while the user types.

- **Issue:** [#949](https://github.com/microsoft/vscode-documentdb/issues/949) (INPUT-1 to INPUT-7)
- **PR:** [#953](https://github.com/microsoft/vscode-documentdb/pull/953) · `fix/quickstart-input-validation-949`

## Why

Issue #949, found on v0.10.2 against DocumentDB Local 0.117.0:

| ID      | Sev | Input                                | What happened                                                        |
| ------- | --- | ------------------------------------ | -------------------------------------------------------------------- |
| INPUT-1 | P2  | Username of 64–128 characters        | 3-minute timeout; PostgreSQL truncates role names past 63 bytes      |
| INPUT-2 | P2  | Password that fails SASLprep (emoji) | 3-minute timeout; the driver rejects it before connecting            |
| INPUT-3 | P2  | Username `documentdb`                | Container exits, then a 3-minute timeout                             |
| INPUT-4 | P2  | Username with a space                | Reports Running, but every write fails and samples are skipped       |
| INPUT-5 | P3  | Password `  abc  `                   | Silently trimmed; U+2028 and U+0085 accepted                         |
| INPUT-6 | P2  | Hidden custom-credential values      | Still validated after switching to auto-generate; Start stays greyed |
| INPUT-7 | P2  | Empty port field                     | Summary shows the suggested port, setup binds 10260                  |

The root cause for INPUT-1 to INPUT-6 is two validators (router zod schema and webview) that checked
length and control characters only, and disagreed on when to run. INPUT-7 is the options builder
leaving `port` out when the field was empty, and the service falling back to `QUICK_START_PORT`.

## What was done

Single commit, `5acd5eb9` after the 2026-09-24 rebase onto `aaf83be8` (#958).

### 1. One rule set, shared by the webview and the router (INPUT-1, 3, 4, 5, 6)

`credentialValidation.ts` is `vscode`-free so both bundles import it. The router's `superRefine`
calls the same function, so a direct tRPC caller gets the webview's messages.

Rules beyond the issue came from running image 0.117.0 against about 80 usernames and passwords:

- Username: `\`, `=`, `,` break the gateway's unquoted libpq string and SCRAM escapes; a leading `'`
  or `-` breaks the image's startup scripts; `public` and `none` are roles PostgreSQL refuses.
- Password: a backslash is spliced into JSON by the image, so `\n` changes the stored password; a
  leading `-` breaks startup.
- Reserved prefixes (`documentdb`, `citus`, `pg`, `internal_role`) in any letter case, matching the
  gateway's `BlockedRolePrefixes`.

INPUT-6: every check is skipped when `useCustomCredentials` is false.

**Deviation: surrounding whitespace is rejected, not trimmed.** Trimming stored a password other than
the one the user will type later. The service's `.trim()` calls went with it. A trailing space is
`transient`: it blocks Start at once but only shows after an 800 ms pause, so a passphrase isn't
flagged at every space between words.

### 2. SASLprep on the host (INPUT-2)

The driver's `@mongodb-js/saslprep` needs `Buffer` and adds about 560 KB to the webview bundle, so
the host runs it through a new `checkPassword` query (no telemetry: the input is a password).
Printable ASCII always passes, so only other passwords leave the webview. Start is disabled while a
check is pending; a failed query counts as `ok`, and the router runs SASLprep again at Start.

`@mongodb-js/saslprep` is now a direct dependency; `package-lock.json` dedupes it with the driver's copy.

### 3. Always send the port the summary shows (INPUT-7)

`advancedOptions.ts` sends `getEffectivePort(field, suggestedPort)`, the same value the summary and
the port probe use. The service ignores any stored port (`explicitPort ?? QUICK_START_PORT`), so an
empty field never meant "reuse the old port".

## Outcome

**Verified (2026-09-24, after merging `main` at `1c2b7fab`, #954).**

- 23 suites / 457 tests in `src/services/localQuickStart` and `src/webviews/documentdb/localQuickStart`,
  `tsc`, ESLint and Prettier pass. The l10n bundle regenerates unchanged.
- With `main`'s `localQuickStartRouter.ts`, 10 of the 19 router tests fail.
- The rebase onto #958 had no conflicts; #958's `QuickStartService.ts` and `LocalQuickStart.tsx` edits
  don't touch the lines this PR changes.

**Not verified.**

- No real-Docker run after the rebase. The ~80-value sweep against 0.117.0 predates it.
- Whether `Public` or `NONE` (other letter cases) are also refused; only lowercase is blocked.
- The wizard wiring (debounce, `transient` display, Start disabled while checking) has no render
  test; the wizard has no render-test harness.
- Windows/WSL.

**Left as is.**

- The username input keeps `maxLength={128}` although the limit is 63 bytes, so a pasted long name
  shows the error instead of being cut silently.
- An existing instance created with values the new rules reject keeps working: every credential
  check is skipped on the recreate path.

