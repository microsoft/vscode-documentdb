# @documentdb-js/connection-diagnostics

Step-by-step, driver-free connectivity checks for DocumentDB and MongoDB API connection strings in Node.js. The package checks the runtime, connection-string configuration, SRV/TXT records, host name resolution, TCP, TLS and an unauthenticated wire handshake. It returns ordered results, stable finding codes, structured facts and timings, with Markdown and JSON reports.

It does **not** create a driver-managed connection, authenticate, request tokens, check database permissions or discover and probe every advertised topology member. Consumers add authentication, preparation, access or other checks through the same generic `Check<RunContext, TCode>` interface. There is no VS Code, UI, localization or telemetry dependency, and no unrelated public-network connectivity test.

## Installation

Not yet published; the API is under construction. This is currently a workspace package in this repository, requires Node.js 22.18.0 or later, and is ESM-only. Build the workspace before importing it.

## Quick start

```ts
import {
    buildReport,
    createBuiltInChecks,
    englishReportText,
    renderMarkdown,
    runDiagnostics,
} from '@documentdb-js/connection-diagnostics';

const input = { connectionString: 'mongodb://localhost:27017/' };
const run = await runDiagnostics({ input, checks: createBuiltInChecks() });
const report = buildReport(run);
const markdown = renderMarkdown(report, { text: englishReportText, redact: false });
```

`buildReport` copies, sanitizes and freezes one snapshot. Rendering never reconnects or performs I/O. Pass an optional `summary` to `buildReport` for a consumer-derived outcome, headline, server rows, next steps, execution location and notes; the built-in checks alone do not establish authenticated connectivity. `renderJson(report, { redact })` renders the same snapshot as JSON.

`renderJson` also accepts an optional `generatedBy` string-valued object, appended as the last JSON property. It is trusted, consumer-owned attribution (for example a product name, public download URL and application versions), not diagnostic data: it is added after identifier redaction and must contain no secrets or user-supplied values.

`renderMarkdown` requires a `ReportText<TCode>` table for headings, labels, finding descriptions, timestamp formatting, retry advice and the trace note. `englishReportText` is a convenience default: a finding's title is its code and its explanation is its English detail. The renderer itself never reads `detail.text`. A localized consumer supplies its own table instead. All supplied prose and report values are escaped as text, not accepted as Markdown or HTML.

`ReportText.formatTimestamp(timestamp: number | Date)` formats absolute times for Markdown only. `englishReportText` deterministically returns UTC ISO 8601 with milliseconds. A localized consumer can return a human date and time with an explicit zone followed by ISO in parentheses, for example `Nov 2, 2026, 3:12:08 PM UTC (2026-11-02T15:12:08.123Z)`. The formatter is applied before Markdown escaping, including the parentheses.

Run start/finish and the fact fields `startedAt`, `finishedAt`, `checkedAt`, `localTime`, `serverTime`, `validFrom` and `validTo` use this formatter, including nested facts, arrays and sub-steps. Timestamp fields are preserved by identifier redaction; other strings are not interpreted as dates. Durations, clock offsets and relative ages are unchanged. JSON never calls the formatter: current built-in timestamps remain ISO strings, and consumer epoch numbers remain numbers.

The default check sections are environment → Environment; connectionString → Connection configuration; srv/dns → Name resolution; tcp/tls → Transport; hello → Wire protocol; other checks → Additional checks. `sectionOf(checkId)` can override the section when it returns a value; returning `undefined` uses the default mapping. Preparation, Authentication, and Server and access are available for consumer checks. Sub-steps are recorded in `steps`; the runner does not schedule them separately.

## Checks and their order

`createBuiltInChecks()` supplies the following order. A check without its own timeout kind still observes the whole-run timeout. Every check may also be skipped by the runner for missing required inputs, dependencies or an expired whole-run timeout.

| Check ID           | Scope | What it checks                                                                                                             | Required dependencies | Timeout kind | Check-specific skip conditions                                                                            |
| ------------------ | ----- | -------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------ | --------------------------------------------------------------------------------------------------------- |
| `environment`      | Run   | Node.js, c-ares, OpenSSL, OS, local time/time zone and safe proxy configuration facts                                      | —                     | —            | —                                                                                                         |
| `connectionString` | Run   | URI syntax, seeds, non-secret options, TLS policy, effective network-option origins and compressor availability            | —                     | —            | —                                                                                                         |
| `srv`              | Run   | SRV and TXT records, target-domain rules, configured-resolver fallback and resulting targets                               | `connectionString`    | `srv`        | `notApplicable` for a non-SRV URI                                                                         |
| `dns`              | Host  | OS lookup versus c-ares, bounded CNAME chain, address classes and private-endpoint evidence                                | —                     | `probe`      | `notApplicable` for an IP literal; `inputUnavailable` without a target                                    |
| `tcp`              | Host  | Ordered OS-resolved address attempts, first connected address, per-attempt latency and error codes                         | `dns`                 | `probe`      | `inputUnavailable` with an effective `proxyHost` or no target; raw probes do not implement a proxy tunnel |
| `tls`              | Host  | TLS handshake, certificate verification, safe certificate facts and inspection-only evidence after verification failure    | `tcp`                 | `probe`      | `notApplicable` when TLS is not enabled; `inputUnavailable` without a target or connected TCP address     |
| `hello`            | Host  | Bounded unauthenticated MongoDB API handshake, topology hints, compression, SCRAM mechanism advertisement and clock offset | `tcp`, `tls`          | `probe`      | `inputUnavailable` without a target or connected TCP address                                              |

TLS uses the original host name for SNI and verification, not the resolved address. An inspection-only connection is evidence, not successful verification, and shares the probe timeout. A plaintext connection's `tls/notApplicable` result allows `hello` to continue. A successful IP-literal `dns/notApplicable` result similarly allows TCP.

SRV uses Node.js resolution first and the same configured DNS servers for eligible fallback; `srvFallbackMode` is `auto` (default), `off` or `force`. No public resolver is substituted. Targets come only from the URI or SRV resolution; advertised members are facts, not additional probes.

## Ordered checks, not globally serial checks

The supplied check order is the dependency order, not a general graph scheduler. IDs must be unique; unknown or forward dependencies and run-scope dependencies on host-scope checks are rejected. `pass`, `warning` and `skipped/notApplicable` satisfy a dependency; other skips and failures do not.

Run-scope checks execute in order. Within a consecutive host-scope group, each host follows its own DNS → TCP → TLS → `hello` chain, with at most **4 chains** running concurrently. One host can reach TLS while another is still resolving DNS. The next run-scope check waits for all chains to settle. Results retain supplied check order and resolver target order regardless of completion order; events reflect actual execution. At the start of each consecutive host phase, `hostPhaseStarted` announces its ordered `checkIds` and fixed, formatted `targets` (`host:port`, with IPv6 hosts bracketed), before any `checkStarted` in that phase. It is emitted once per phase, including an empty `targets` array when there are no targets; each host check then finishes once without a target. Consumers can use this announcement to settle aggregate rows exactly.

A consumer's authentication check should depend on its actual inputs, such as a valid connection string and preparation, not on successful diagnostic probes. A failed probe need not suppress a real driver connection, provided time remains.

## Timeouts and retry profiles

Values below are milliseconds. These are diagnostic timeouts, not evidence that the server is down, and not minimum waiting periods: definitive errors return immediately.

| Work / field                                                    | Default (`default`) | Longer (`longer`) | Without diagnostic timeouts (`noDiagnosticTimeouts`) |
| --------------------------------------------------------------- | ------------------- | ----------------- | ---------------------------------------------------- |
| Whole run / `runTimeoutMs`                                      | 300000              | 600000            | `null`                                               |
| Preparation / `preparationTimeoutMs`                            | 15000               | 30000             | `null`                                               |
| SRV/TXT / `srvTimeoutMs`                                        | 10000               | 20000             | `null`                                               |
| Each per-host DNS, TCP, TLS or `hello` probe / `probeTimeoutMs` | 10000               | 20000             | `null`                                               |
| Authentication / `authenticationTimeoutMs`                      | 45000               | 90000             | `null`                                               |
| Each post-connect operation / `postConnectTimeoutMs`            | 5000                | 10000             | `null`                                               |

Use `timeoutProfile` on `runDiagnostics` or `timeoutsForProfile(profile)` to select a profile. Per-run `timeouts` overrides accept positive finite milliseconds up to the exported `MAX_TIMEOUT_MS` (`2_147_483_647`), or `null`; **`null` means no diagnostic timeout** for that field. `input.connectionTimeouts` accepts the same numeric range, but not `null`. Both input routes use one validator and reject out-of-range values before checks or I/O, even with a custom clock or the `noDiagnosticTimeouts` profile. Values are never clamped. Preparation, authentication and post-connect timeouts are available to consumer checks that declare those kinds.

When resolving timeouts directly, `resolveTimeouts(profile, overrides?)` requires an explicit profile, for example `resolveTimeouts('default')`. Only `runDiagnostics` defaults an omitted `timeoutProfile` to `default`.

Each operation uses the least of its diagnostic timeout, remaining whole-run time and applicable `input.connectionTimeouts` entry. **Shorter connection-configured timeouts win.** The effective network option `connectTimeoutMS` also bounds establishing each new socket when it is shorter than the probe timeout: each TCP address attempt (reported as `tcp.timeout` with source `connection`), and the TCP connection and TLS handshake of the TLS and `hello` probes (reported as `check.timeout` with source `connection`). It does not bound the `hello` reply wait. Diagnostic address attempts and auxiliary lookups share one host probe timeout; inspection-only TLS does not receive another full timeout. The `hello` reply deadline normally reserves 250 ms before its effective probe timeout to classify no reply or a truncated reply. It can therefore emit `hello.noReply` or `hello.inconclusive` rather than `check.timeout`.

- A started operation that reaches its effective runner timeout fails with **`check.timeout`**, identifying the operation, effective milliseconds and source (`check`, `run` or `connection`). More specific observed codes, such as `tcp.timeout`, remain distinct.
- Work not started before the whole-run timeout is **`skipped/runTimeoutExceeded`**. Completed results remain available and coverage is limited.
- A dependency failure, including a timed-out dependency, causes **`dependencyFailed`** and names the originating check. A subsequent skip propagated through another skipped dependency is **`dependencySkipped`**, retaining the origin.
- A timeout alone does not establish a firewall problem, server outage or credential rejection.

Retry profiles **never retry automatically**. Select `longer` or `noDiagnosticTimeouts` explicitly for a fresh run and report; saved connection settings and existing reports do not change. `longer` doubles the default diagnostic timeouts; neither profile lengthens connection-configured timeouts. If those caused the timeout, change the connection setting before a longer retry can help. OS, resolver and driver limits may still end an operation. Neither retry profile removes safety limits or weakens TLS or authentication.

Pass an `AbortSignal` through `signal` to cancel. Without diagnostic timeouts, cancellation may be needed. Cancellation stops scheduling, aborts supported I/O, ignores late completions and runs cleanup; non-abortable I/O may still finish later. The run rejects with `DiagnosticsCancelledError`, separately from a completed, timeout-limited report. An `onEvent` observer can receive `hostPhaseStarted`, `checkStarted`, `checkFinished` and `runFinished` events. No events, including host-phase announcements and `runFinished`, are emitted after cancellation.

## Safety limits

These limits apply in every timeout profile:

| Limit                            | Value                                          |
| -------------------------------- | ---------------------------------------------- |
| Probe targets                    | 16, deduplicated in resolver order             |
| Addresses per host, per resolver | 8                                              |
| Concurrent host chains           | 4                                              |
| One wire reply                   | 1 MiB (1048576 bytes), bounded before decoding |
| One report text field            | 8 KiB (8192 characters)                        |
| One repeated report list         | 32 entries                                     |

Some checks apply smaller bounds as well. Omitted targets, addresses and bounded check lists carry counts.
Report steps, findings per result or step, and `summary.serverRows` retain at most 32 typed records.
Their parents carry optional `omittedStepCount`, `omittedFindingCount` and `omittedServerRowCount`
fields, respectively, only when entries were omitted. These are additive fields in report
`schemaVersion: 1`; the original run is not modified. Markdown uses localized omission notices,
including for an omitted headline finding, without offering a timeout retry. Arbitrary payload
lists still use a string omission marker. Text is sanitized before truncation and facts are
flattened for Markdown tables. Each step's facts and each finding's data receive their own
sanitization depth limit, independent of their position in the report. The real driver's inputs
are never trimmed to fit diagnostic limits.

## Secrets and identifiers

**Secret exclusion is unconditional.** Built-in checks collect allowlisted facts, not raw input, options, environment, errors or command documents. Passwords, tokens, private keys, proxy credentials and secret-bearing option values must never enter results, events or reports. Unknown URI option values are withheld because they may be secrets. Consumer checks must follow the same rule; sanitization and redaction are not a substitute for safe collection.

**Identifier redaction is optional and separate.** With `redact: false`, useful identifiers remain visible. With `redact: true`, `redactReport` replaces identifiers with consistent placeholders within a report: hosts and addresses, user/database/replica-set names, certificate subjects and SANs, proxy hosts and connection names. Consumers can provide `identifierKeys` to `buildReport` for additional tenant, account, endpoint, client, role, service, namespace or kubeconfig context fields (`kubeContext`, rendered as `context-1`). Redaction also replaces collected identifiers in summary prose and finding details; it preserves public issuer names, versions, timings and stable codes. Custom prose must use identifiers collected in structured fields for consistent redaction. Review a report before sharing it.

## Codes are authoritative; English details are a convenience

Stable finding codes and the structured `data` documented below are the authoritative contract for machine behavior and localized messages. Consumers add their own codes through the generic **`TCode`** parameter and supply the same required `detail: { language: 'en', text: string }` object. `language` is a BCP 47 tag describing the returned text, not a requested locale or promise of translations.

English `detail.text` wording may change without changing the code contract. Do not parse it. Localized consumers use only codes and data in their own exhaustive message table, never English text as a localization fallback; unknown codes are explicit contract errors. `englishReportText` intentionally uses the English convenience detail for consumers without a message catalogue. Details obey the same secret-exclusion, redaction and escaping rules as other report data. Skip reasons are separate from finding codes.

## Skip reasons

| Reason               | Meaning                                                                                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `notApplicable`      | This check is unnecessary for the input, such as DNS for an IP literal or TLS for plaintext; satisfies a dependency.                                     |
| `inputUnavailable`   | Required input is absent or the diagnostic probe cannot use it, such as a proxy tunnel; consumers may use this when they withhold an interactive prompt. |
| `dependencyFailed`   | A required check failed; `skippedBecause.checkId` identifies the origin.                                                                                 |
| `dependencySkipped`  | A required check was skipped for a reason other than `notApplicable`; the originating check is retained.                                                 |
| `runTimeoutExceeded` | This work did not start before the whole-run timeout.                                                                                                    |

Sub-steps use the same reasons with an optional originating `stepId` instead of `checkId`.

## Finding codes

`AddressClass` is `'public' | 'private' | 'loopback' | 'linkLocal'`, using the DNS address classification.
The optional `addressClass` on TCP findings describes all addresses actually attempted by that probe;
it is absent for mixed or unknown classes. TLS handshake closure and `hello.noReply` use the TCP
probe's connected address, not the host name. Loopback transport details suggest checking the local
database, container or tunnel rather than a firewall or IP allowlist. TLS handshake closure does not
identify who closed the connection or why.

One row per built-in code, in public catalogue order. `?` denotes an optional key; `—` means no data fields (the check emits an empty data object). Types below describe the values actually emitted, including literal alternatives, not arbitrary fields from an error object. `WireCompressor` is `'zlib' \| 'snappy' \| 'zstd'`.

| Code                                   | Severity        | Meaning                                                                                                                              | Data fields                                                                                                                                                       |
| -------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check.timeout`                        | error           | A started check reached its effective runner timeout.                                                                                | `operation: string`, `timeoutMs: number`, `source: 'check' \| 'run' \| 'connection'`, `target?: string`                                                           |
| `env.proxyConfigured`                  | info            | Proxy environment variables exist; they do not automatically apply to database traffic.                                              | `variables: string[]`                                                                                                                                             |
| `env.caresRejectsCompressedSrv`        | info            | The bundled c-ares version rejects compressed SRV targets.                                                                           | `aresVersion: string`                                                                                                                                             |
| `cs.unparseable`                       | error           | The connection string could not be parsed.                                                                                           | `reason: 'invalidScheme' \| 'invalidHost' \| 'invalidPort' \| 'other'`                                                                                            |
| `cs.srvWithPort`                       | error           | An SRV URI contains an explicit port.                                                                                                | —                                                                                                                                                                 |
| `cs.srvMultipleHosts`                  | error           | An SRV URI contains multiple seed hosts.                                                                                             | —                                                                                                                                                                 |
| `cs.unknownOption`                     | error           | An option is unsupported; a spelling suggestion may be available.                                                                    | `option: string`, `suggestion?: string`                                                                                                                           |
| `cs.optionIgnoredByDriver`             | warning         | An option is deprecated by the driver; despite the code name, this check does not establish that it is ignored.                      | `option: string`, `replacement?: string`                                                                                                                          |
| `cs.conflictingTlsOptions`             | error           | `ssl` and `tls` disagree.                                                                                                            | —                                                                                                                                                                 |
| `cs.tlsVerificationDisabled`           | warning         | URI options weaken certificate or host name verification.                                                                            | `options: string[]`                                                                                                                                               |
| `cs.directConnectionWithMultipleHosts` | error           | Direct connection is requested with multiple hosts.                                                                                  | —                                                                                                                                                                 |
| `cs.unencodedReservedCharacter`        | error           | A credential component contains an unencoded reserved character.                                                                     | `part: 'username' \| 'password'`, `character: string`                                                                                                             |
| `cs.authSourceUnusual`                 | info            | The authentication source is neither `admin` nor `$external`.                                                                        | `authSource: string`                                                                                                                                              |
| `cs.compressorUnavailable`             | warning         | A requested compressor is unavailable to the consumer.                                                                               | `compressor: string`, `available: readonly WireCompressor[]`                                                                                                      |
| `srv.notFound`                         | error           | No usable SRV targets were returned.                                                                                                 | —                                                                                                                                                                 |
| `srv.compressedReplyRejected`          | info / error    | Node.js rejected an eligible SRV reply; info if fallback succeeded, error otherwise.                                                 | `nodeErrorCode: string`, `fallbackOutcome: 'succeeded' \| 'failed' \| 'disabled'`                                                                                 |
| `srv.txtUnsupportedOption`             | error           | TXT connection options are unsupported or invalid.                                                                                   | —                                                                                                                                                                 |
| `srv.targetOutsideDomain`              | error           | An SRV target violates the parent-domain rule.                                                                                       | —                                                                                                                                                                 |
| `dns.notFound`                         | error           | The OS resolver reported `ENOTFOUND`.                                                                                                | —                                                                                                                                                                 |
| `dns.temporaryFailure`                 | error           | The OS resolver reported `EAI_AGAIN`.                                                                                                | —                                                                                                                                                                 |
| `dns.resolversDisagree`                | warning         | The OS and c-ares resolvers differ or c-ares failed.                                                                                 | `osAddressCount: number`, `caresAddressCount: number`, `caresErrorCode?: string`                                                                                  |
| `dns.privateEndpoint`                  | info            | An Azure private-link alias resolves to a private address; this does not prove a private endpoint exists.                            | —                                                                                                                                                                 |
| `dns.privateEndpointPublicAddress`     | info            | An Azure private-link alias resolves publicly, the normal answer outside the resource's private network.                             | —                                                                                                                                                                 |
| `dns.loopback`                         | info            | The host resolves to a loopback address.                                                                                             | —                                                                                                                                                                 |
| `tcp.refused`                          | error           | The TCP connection was refused.                                                                                                      | `errorCode: 'ECONNREFUSED'`, `addressClass?: AddressClass`                                                                                                        |
| `tcp.timeout`                          | error           | A TCP attempt timed out; this is not itself proof of a firewall block.                                                               | `errorCode: 'ETIMEDOUT'`, `source?: 'connection'`, `addressClass?: AddressClass`                                                                                  |
| `tcp.unreachable`                      | error           | A host or network route is unreachable.                                                                                              | `errorCode: 'EHOSTUNREACH' \| 'ENETUNREACH'`, `addressClass?: AddressClass`                                                                                       |
| `tcp.reset`                            | error           | The peer reset the TCP connection.                                                                                                   | `errorCode: 'ECONNRESET'`, `addressClass?: AddressClass`                                                                                                          |
| `tls.notTlsServer`                     | error           | Positive evidence indicates a non-TLS reply.                                                                                         | `errorCode: string`                                                                                                                                               |
| `tls.handshakeRejectedByServer`        | error           | The connection closed during the TLS handshake before a certificate arrived.                                                         | `errorCode: 'ECONNRESET' \| 'EPIPE'`, `addressClass?: AddressClass`                                                                                               |
| `tls.selfSigned`                       | warning / error | The certificate or its chain contains a self-signed certificate; warning when allowed by configured exceptions, error when rejected. | `errorCode: 'DEPTH_ZERO_SELF_SIGNED_CERT' \| 'SELF_SIGNED_CERT_IN_CHAIN'`                                                                                         |
| `tls.untrustedIssuer`                  | warning / error | The certificate issuer is untrusted.                                                                                                 | `errorCode: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' \| 'UNABLE_TO_GET_ISSUER_CERT' \| 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'`                                              |
| `tls.hostnameMismatch`                 | warning / error | The certificate does not match the original host name.                                                                               | `errorCode: 'ERR_TLS_CERT_ALTNAME_INVALID'`                                                                                                                       |
| `tls.expired`                          | warning / error | The certificate has expired.                                                                                                         | `errorCode: 'CERT_HAS_EXPIRED'`                                                                                                                                   |
| `tls.notYetValid`                      | warning / error | Certificate validity begins in the future; check the clock.                                                                          | `errorCode: 'CERT_NOT_YET_VALID'`, `localTime: string` (ISO timestamp)                                                                                            |
| `tls.verificationBypassed`             | info            | A configured TLS exception allowed a connection despite a verification problem.                                                      | —                                                                                                                                                                 |
| `hello.noReply`                        | error           | No handshake bytes arrived before the reply deadline.                                                                                | `waitedMs: number`, `addressClass?: AddressClass`                                                                                                                 |
| `hello.notWireProtocol`                | error           | Reply bytes are not the MongoDB API wire protocol.                                                                                   | —                                                                                                                                                                 |
| `hello.closedWithoutReply`             | error           | The peer closed before a complete reply; plaintext may need TLS.                                                                     | `tls: boolean`                                                                                                                                                    |
| `hello.inconclusive`                   | error           | A bounded reply could not establish handshake success, or the command was rejected.                                                  | `reason: 'responseTo' \| 'opCode' \| 'truncated' \| 'malformed' \| 'tooLarge' \| 'commandFailed'`; only for `commandFailed`: `code?: number`, `codeName?: string` |
| `hello.mechanismNotOffered`            | warning         | A known user's configured/default SCRAM mechanism was not offered.                                                                   | `mechanism?: 'SCRAM-SHA-1' \| 'SCRAM-SHA-256'`, `offered: string[]`                                                                                               |
| `hello.compressorUnavailable`          | error           | The driver would select an unavailable compressor and fail a later command.                                                          | `compressor: string`                                                                                                                                              |
| `hello.clockOffset`                    | info            | Clock difference exceeds five minutes plus measurement uncertainty.                                                                  | `offsetMs: number`, `uncertaintyMs: number` (rounded milliseconds)                                                                                                |
