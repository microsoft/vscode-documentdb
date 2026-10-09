---
feature: srv-dns-fallback
kind: plan
status: active
created: 2026-10-09
code:
    - src/documentdb/ClustersClient.ts
    - src/documentdb/playground/WorkerSessionManager.ts
    - src/documentdb/playground/playgroundWorker.ts
    - packages/documentdb-js-srv-resolver/**
    - src/documentdb/srv/**
---

# Increment 1: in-memory SRV fallback for `mongodb+srv://` (#993)

The problem, root cause and rejected alternatives are in issue #993 and in
[../README.md](../../README.md). This document is the development plan. Progress is recorded
**inline, against each work item**, when that item is committed.

**Revised after design review (2026-10-09).** Six findings (R1–R6) were verified and folded into
WI-2 to WI-7, and Q8 was added. Each change is marked with its finding number. Evidence and
verdicts: [design-review.md](./design-review.md).

## Goal

A `mongodb+srv://` connection that fails today with `querySrv EBADRESP` because c-ares (≥ 1.34.7)
rejects a compressed SRV target connects successfully. It works the same way on every surface: tree,
Collection View, other webviews, the interactive shell and the query playground. The user sees no
change in behavior and nothing is persisted. Users who connect successfully today get exactly the
same driver input as before.

We must also be able to answer three questions from telemetry:

1. **Blast radius.** What share of SRV connections, and how many machines, hit the c-ares
   regression, broken down by c-ares version, platform and DNS server class?
2. **When the fallback is applied.** How often does it run, and how often does it succeed?
3. **The known gap.** How often does an SRV lookup fail in a way the fallback cannot fix
   (`ECONNREFUSED` from c-ares 1.34.6, timeouts)?

## Non-goals

- Fixing `dns.getServers()` returning the wrong servers (nodejs/node#62326). This is measured, not
  fixed.


- A native OS resolver (`os-dns-native`). It may come later as a first try ahead of `dns-packet`.
- Any change to the stored connection, its display, "Copy Connection String", or export (D0001).
- `QuickStartService` and `connectToClient` (D0007). `connectToClient` is already marked
  `@deprecated` (done during planning). Removing it is for a later release.
- Publishing the new package to npm (D0020). The operator does that separately.

## Decisions this plan implements

Full entries, with reasons and rejected alternatives, are in [../decisions.md](../../decisions.md).
Changing any of them during implementation is a **deviation** (see Progress recording, below).

| Area             | Decisions in force                                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Core rules       | D0001 transient, never persisted · D0002 same system DNS servers only · D0003 `dns-packet` · D0004 driver semantics exactly |
| When it runs     | D0005 Node probe first · D0012 `EBADRESP`/`EFORMERR`/`ECONNREFUSED` · D0017 unbounded probe, pass-through        |
| Where            | D0007 `ClustersClient` + `WorkerSessionManager`; `connectToClient` deprecated · D0008 resolve on the host                          |
| Observability    | D0009 one `connect.srvResolution` event · D0014 all output at `trace` · D0019 tooltip flag                       |
| Switches         | D0010 force switch · D0011 off switch, documented                                                               |
| Timing           | D0016 5 s UDP / 10 s TCP / shared cap `min(20 s, connectionTimeout)` · D0018 separate budgets                              |
| Scope / shipping | D0013 no cached-client refresh · D0015 `v0.11.1` from `release/0.11.1` · D0020 local workspace package                      |
| Superseded       | D0006 (by D0012)                                                                                                            |

## Progress recording

Follow the knowledge-base rule: record progress **inline, under the work item it belongs to**, when
that item is committed. Do not put it in a log at the end, and do not rewrite the plan text.

- `**Done.** <commit sha> <subject>.` What landed and why, in two or three sentences.
- `**Deviation.** …` What changed from the plan, the alternatives considered, why each was rejected,
  and who approved it (the coordinator, with confidence ≥ 80 %, or the operator, with their answer).
- `**Not done / deferred.** …` with the reason.
- The `# Outcome` chapter is written at hand-over: what was verified and what was not.

## Milestones

Each milestone ends with one gate, run once (builds are slow, so do not run them per edit): `npm run
build`, then `npx jest --no-coverage <the tests touched in this milestone>`. Then progress is
recorded inline under each work item (see above), and **one commit** is made per milestone (more
than one is fine; one commit for the whole increment is not). Do not push or open a PR unless the
operator asks.

| #   | Milestone                                   | Work items        | Exit criteria                                                                                                     |
| --- | ------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| M1  | Package scaffold and dependency             | WI-0, WI-1        | Package builds and is linked; `dns-packet` vetted with `flagging-fresh-dependencies`; not in the worker bundle     |
| M2  | URI rewrite                                 | WI-2              | Rule table implemented; differential tests against the installed driver pass, at the R6 boundary                   |
| M3  | Fallback DNS client                         | WI-3              | Local UDP/TCP stub tests pass, including the compressed-target replay, TXT absence and the shared deadline        |
| M4  | Core resolve function and extension adapters | WI-4              | Package API done; trace, telemetry and switches work in the extension adapter; R1, R2 and R5 tests pass          |
| M5  | Tree path and tooltip flag                  | WI-5, WI-10       | `ClustersClient` uses the helper; tooltip line appears after a fallback connection; `clusterId` keyed             |
| M6  | Shell and playground                        | WI-6              | Host-side resolution; cancellation tests (DNS held pending) pass; D0018 timing in place                           |
| M7  | Diagnostics and documentation               | WI-7, WI-8        | Provider with negative tests; user-manual page with both switches and the timing rule; `0.11.1` release-notes entry |
| M8  | Review and hand-over                        | WI-9, `# Outcome` | One end-of-work code review, findings resolved or recorded; automated verification done; manual steps handed to the operator |

## Shape

```
configureAuth()  ──►  prepareDriverConnectionString({ connectionString, options, surface, correlation, abortSignal })
                         │   (abortSignal checked between every step; cancellation stays UserCancelledError)
                         ├─ not mongodb+srv://                       → return as-is, no event
                         ├─ Node probe: resolveSrv(_<svc>._tcp.<host>) on a cancellable Resolver (default timeout)
                         │     ├─ ok                                  → return ORIGINAL +srv string   (path=node)
                         │     ├─ EBADRESP / EFORMERR / ECONNREFUSED (or forced) → fallback ▼
                         │     └─ other error                         → return ORIGINAL +srv string   (path=nodeErrorPassthrough)
                         └─ fallback (one shared deadline)
                               ├─ preflight: new MongoClient(original, options + OIDC stub), never connected
                               ├─ SRV and TXT in parallel via dns-packet: system servers in order, UDP → TCP on TC
                               │     (no TXT record = no TXT options)
                               ├─ apply driver semantics (D0004), rewrite to mongodb://h1:p1,h2:p2/…
                               └─ return REWRITTEN string + sanitized options copy                 (path=fallback)
                                  on failure: rethrow the ORIGINAL Node probe error, unchanged
                                  (except cancellation and driver-equivalent validation errors)
   ──►  new MongoClient(prepared.connectionString, prepared.options)
```

Rethrowing the **original** Node error when the fallback fails keeps the error that users,
`parseError`, telemetry and `ConnectionDiagnosticsService` see the same as today. This follows
error-translation's "never touch the error" rule. The fallback's own failure goes to the output
channel and the telemetry event.

### Module layout (D0020)

The logic that does not depend on VS Code lives in a workspace package. The extension keeps only
thin adapters.

```
packages/documentdb-js-srv-resolver/            # @documentdb-js/srv-resolver (working name), not published yet
├── package.json        # peerDependencies: mongodb >=6; dependencies: dns-packet
├── tsconfig.json, jest.config.js, README.md, LICENSE   # copied from documentdb-js-shell-api-types
└── src/
    ├── index.ts                     # public API: resolveSrvForDriver(), types
    ├── resolveSrvForDriver.ts       # WI-4 core: probe, decide, preflight, fallback, error/cancel rules, deadline
    ├── srvUriRewrite.ts             # WI-2, pure
    ├── fallbackDnsClient.ts         # WI-3, dns-packet over UDP/TCP against dns.getServers()
    ├── report.ts                    # SrvResolutionReport, DNS-server classification, compression probe
    └── *.test.ts                    # differential tests against the installed driver, DNS stub server

src/documentdb/srv/                              # extension adapters only
├── prepareDriverConnectionString.ts  # calls the package; maps the env switches to options (D0010, D0011)
├── srvResolutionTelemetry.ts         # report → connect.srvResolution and the startup summary
├── srvResolutionSummary.ts           # tooltip summary (WI-10)
└── *.test.ts
```

Package boundary, injected by the caller:

- **`logger`**: `{ trace(message: string): void }`, a no-op by default. The extension passes
  `ext.outputChannel`.
- **`onReport`**: called in a `finally` block with a `SrvResolutionReport` (path, error codes,
  outcome, durations, transport, target compression, DNS-server class, counts). It is called for
  failures too, without modifying the error. The extension turns it into telemetry.
- **Options**: `fallback: 'auto' | 'off' | 'force'`, `deadlineMs`, `signal`. Environment variables
  are an extension concern; the package never reads `process.env`.
- The package imports neither `vscode` nor `@vscode/l10n`. It writes no user-facing text, only
  trace lines and errors that mirror the driver's own.

**Used locally; publishing is separate (D0020).** The extension depends on
`"@documentdb-js/srv-resolver": "*"`, and npm workspaces link the local folder. The code ships inside
the webpack bundle (`vsce package --no-dependencies`; `.vscodeignore` excludes `packages/**`).
Publishing to npm therefore changes nothing for the extension, and nothing in this increment
depends on it. The operator publishes when they see fit, through
`.github/workflows/npm-publish-documentdb-js.yml`, after adding the package's input and step there.
Implementers must not publish, must not edit that workflow, and must not reference a registry
version.

When these folders exist, add `packages/documentdb-js-srv-resolver/**` and `src/documentdb/srv/**`
to the `code` frontmatter here and in the feature README.

---

## WI-0: Create the workspace package (D0020)

- Copy the boilerplate from `packages/documentdb-js-shell-api-types` (package.json scripts, tsconfig,
  jest config, LICENSE). Start the version at `0.1.0` and set `"publishConfig": { "access": "public" }`
  like the others. The name is a working name; settle it before the first publish.
- Add `"@documentdb-js/srv-resolver": "*"` to the extension's `dependencies`. npm workspaces link
  it locally (`node_modules/@documentdb-js/srv-resolver → packages/…`), `prebuild` builds it, and
  webpack bundles it. Check that it does **not** end up in `playgroundWorker.js` (D0008).
- Add `'<rootDir>/packages/documentdb-js-srv-resolver'` to the `projects` list in the root
  `jest.config.js`, next to the other packages, so `npx jest` runs the package's tests too.
- **Not in this increment:** adding a `publish_srv_resolver` input and step to
  `.github/workflows/npm-publish-documentdb-js.yml`. That happens when the operator decides to
  publish.

**Acceptance:** `npm run build` passes, and a smoke import from the extension resolves to the
workspace copy.

**Done.** `406b5f73` `feat(srv): scaffold @documentdb-js/srv-resolver workspace package`.
`packages/documentdb-js-srv-resolver` (version `0.1.0`, `publishConfig.access: public`,
`peerDependencies: mongodb >=6.0.0`) is linked through npm workspaces, listed in the root
`dependencies`, the root `tsconfig.json` references and the root `jest.config.js` projects. The
gate (`npm run build`, package jest) passed, and `require.resolve('@documentdb-js/srv-resolver')`
from the root resolves to `packages/documentdb-js-srv-resolver/dist/index.js`.

**Deviation.** The boilerplate was copied from `packages/documentdb-js-shell-runtime`, not
`documentdb-js-shell-api-types`: shell-runtime already has the `mongodb` peer dependency and the
plain `tsc -p .` build, while shell-api-types carries a second scripts tsconfig and type-definition
assets this package does not need. The files are otherwise identical (`tsconfig.json`,
`jest.config.js`, `LICENSE.md`). Approved by the coordinator (confidence > 90 %).

**Not done / deferred.** The "not in `playgroundWorker.js`" bundle check is moved to the M5/M6
gates: nothing in `src/` imports the package until WI-4, so a webpack check now would prove
nothing.

---

## WI-1: Add the `dns-packet` dependency

- Add `dns-packet@^5.6.1` (MIT; its one runtime dependency is `@leichtgewicht/ip-codec`) to the
  **package's** `dependencies`, and `@types/dns-packet` to its dev dependencies (D0020). The root
  lockfile changes as usual.
- Run the `flagging-fresh-dependencies` skill on the resulting lockfile change. 5.6.1 was published
  on 2023-08-25; check the transitive dependency as well.
- Check that webpack bundles it into `dist/extension.js` and **not** into `playgroundWorker.js`
  (D0008).
- Check whether `NOTICE.html` is generated or maintained by hand. If by hand, add both packages.

**Acceptance:** `npm run build` passes; the worker bundle size is unchanged.

**Done.** `406b5f73` (same commit). `dns-packet@5.6.1` and `@types/dns-packet@5.6.5` (dev) are in the
package's manifest. Both `dns-packet@5.6.1` and `@leichtgewicht/ip-codec@2.0.5` were already in the
lockfile as dev-only transitive dependencies; they lost their `"dev": true` flag, and
`@types/dns-packet@5.6.5` was added. No other lockfile entry changed. `flagging-fresh-dependencies`
(7 days): 0 fresh of 1,774 locked versions. Publish dates: `dns-packet@5.6.1` 2023-09-22 (the plan
said 2023-08-25; the registry `time` map is authoritative), `@leichtgewicht/ip-codec@2.0.5`
2024-03-27, `@types/dns-packet@5.6.5` 2024-01-26; all MIT. `NOTICE.html` is generated by the
`notice@0` task in `.azure-pipelines/build.yml`, so it is not edited by hand.

**Not done / deferred.** The bundle-placement and worker-size checks run at the M5/M6 gates, once
the extension imports the package (see WI-0). **Done at the M5/M6 gate:** after
`npm run webpack-dev-ext`, `dns-packet` and the resolver code occur in `dist/main.js` and not in
`dist/playgroundWorker.js`. The worker bundle gains only the small `workerOidcAllowedHosts` helper
(WI-6); no byte-for-byte size comparison against `v0.11.0` was run.

---

## WI-2: Pure URI rewrite (`srvUriRewrite.ts`)

Input: the original `+srv` string (after `configureAuth`, so it may contain credentials), the
`MongoClientOptions`, the SRV records, and the TXT records (or none). Output: a `mongodb://` string
**and a sanitized copy of the options** without `srvMaxHosts` and `srvServiceName` (R3). The
driver rejects both with a non-SRV string even when they come from the options object. The caller's
options object is never mutated. No I/O.

Rules (D0004; mirror `mongodb` 7.2.0 `resolveSRVRecord` and `checkParentDomainMatch`):

| Rule                                                                                              | Driver error to reproduce                                     |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Zero SRV records                                                                                  | `MongoAPIError('No addresses found at host')`                 |
| Each target must pass `checkParentDomainMatch` (strip trailing dots first)                        | `MongoAPIError('Server record does not share hostname …')`    |
| Port defaults to 27017 when missing                                                               | —                                                             |
| More than one TXT record                                                                          | `MongoParseError('Multiple text records not allowed')`        |
| TXT keys outside `authSource`, `replicaSet`, `loadBalanced`                                       | `MongoParseError('Text record may only set any of: …')`       |
| Empty TXT value                                                                                   | `MongoParseError('Cannot have empty URI params in DNS TXT …')` |
| TXT `authSource` only if the user did not set one (URI or options) and the mechanism is not `$external` (`MONGODB-OIDC`, `MONGODB-X509`, `MONGODB-AWS`, `GSSAPI`); read the mechanism from the URI **and** `options.authMechanism` | —                                                             |
| TXT `replicaSet` only if the user did not set one (URI or options)                                | —                                                             |
| TXT `loadBalanced=true` → `loadBalanced=true` (validated by the load-balanced rows below)          | —                                                             |
| No TXT record (`ENODATA` or `ENOTFOUND` from either resolver) → continue without TXT options (R3) | —                                                             |
| `replicaSet` from the URI, the options **or TXT**, combined with `srvMaxHosts > 0` (R3)            | `MongoParseError('Cannot combine replicaSet option with srvMaxHosts')` |
| Load-balanced checks on the **full** target list, before sampling (R3): more than one target       | `MongoParseError('loadBalanced option only supported with a single host in the URI')` |
| … `loadBalanced` with `replicaSet`, or with `directConnection`                                    | the driver's `LB_REPLICA_SET_ERROR` / `LB_DIRECT_CONNECTION_ERROR` |
| … `loadBalanced` with `srvMaxHosts > 0`                                                            | `MongoParseError('Cannot limit srv hosts with loadBalanced enabled')` |
| `srvMaxHosts` or `srvServiceName` in the options object → drop them from the returned options copy (R3) | —                                                             |
| `srvServiceName` picks the SRV name; remove it from the URI                                       | —                                                             |
| `srvMaxHosts > 0` → after every validation above, shuffle and keep N; remove it from the URI       | —                                                             |
| Add `tls=true` unless `tls` or `ssl` is set in the URI or options                                 | —                                                             |

Throw the driver's own error classes (`MongoAPIError`, `MongoParseError` from `mongodb`) with the
driver's messages, so a validation failure looks the same as it does today.

**Implementation note:** rewrite by string surgery on the scheme and host segment, and edit the
query through `URLSearchParams` only. The userinfo bytes must be copied verbatim. Passwords
containing `@`, `:`, `%` or `/` must not be decoded and re-encoded. The `DocumentDBConnectionString`
quirk around `appName=@…@` must survive.

**Tests (table-driven), including a differential test against the driver itself.** For each fixture,
mock `dns.promises.resolve` in Jest, run the driver's internal `resolveSRVRecord`
(`mongodb/lib/connection_string`) on the `+srv` string, then parse our rewritten string with
`new MongoClient(rewritten, sanitizedOptions).options`. Compare at the right boundary (R6):

- **Resolution and options semantics, on the full target list:** `tls`, `replicaSet`,
  `loadBalanced`, `credentials.source`, the host set, and the error class and message. Run this
  comparison with `srvMaxHosts` sampling switched off on our side, because `resolveSRVRecord`
  returns every target and the driver samples later, in the `Topology` constructor
  (`lib/sdam/topology.js`, `shuffle(seedlist, srvMaxHosts)`).
- **Host selection, separately:** the selected count is `min(srvMaxHosts, targets)`, and every
  selected host is one of the targets. An injected random source makes exact selection
  deterministic where a test needs it.

This catches drift when the driver is upgraded.

Fixtures: credentials with special characters; `appName=@x@`; a user `authSource`;
OIDC with TXT `authSource` (must be dropped); a user `replicaSet`; `loadBalanced` with one or two
targets; `srvMaxHosts=1`; `srvServiceName=custom`; `ssl=false` set explicitly; targets with
trailing dots; a two-label parent domain; a parent-domain mismatch; multiple TXT records; an empty
TXT value; an invalid TXT key; a `/db` path and no path. Added after review (R3), as a cross
product where it matters: no TXT (`ENODATA` and `ENOTFOUND`, from Node and from the fallback
client); `srvMaxHosts` in the URI and in the options × `replicaSet` in the URI, the options and
TXT; TXT `loadBalanced=true` × one or two targets × `srvMaxHosts`; `srvMaxHosts` and
`srvServiceName` passed only in the options object.

**Done.** `855b9093` `feat(srv-resolver): pure SRV URI rewrite mirroring the driver`.
`packages/documentdb-js-srv-resolver/src/srvUriRewrite.ts` exports `isSrvConnectionString`,
`getSrvLookupTarget`, `rewriteSrvUri` and `getSrvRewriteErrorKind` (a `WeakMap` filled at throw
time, so errors are classified for telemetry without being modified). The host segment is split
with the driver's own `HOSTS_REGEX`, userinfo is copied byte for byte, and only the query goes
through `URLSearchParams`. 172 tests in `srvUriRewrite.test.ts` and
`srvUriRewrite.differential.test.ts`; the differential suite runs the driver's internal
`resolveSRVRecord` with mocked DNS and compares on the full target list (R6), with host selection
tested separately through an injected `random`.

**Deviation (D0004: the driver wins over the rule table).** Approved by the coordinator
(confidence > 90 %, since D0004 says the driver is the reference):

- TXT `authSource` is applied only when the client has credentials (the driver checks
  `options.credentials`, `lib/connection_string.js` ~line 101). Skips are reported as
  `authSource:noCredentials`.
- A **user** `replicaSet` with `srvMaxHosts` fails with the driver's parse-time message
  `Cannot use srvMaxHosts option with replicaSet`; only a TXT `replicaSet` gets
  `Cannot combine replicaSet option with srvMaxHosts`.
- Load-balanced validation runs on the full target list **before** TXT and again after it, as in
  the driver (~line 73).
- A trailing dot is stripped only for the parent-domain check; target hosts keep it, as the
  driver's `HostAddress` does.
- A successful but empty TXT answer throws the same `TypeError` as the driver. The fallback client
  never produces one (`NOERROR` without answers is `ENODATA`), so this is unreachable in practice.
- The rewrite repeats the SRV-only option conflicts (`directConnection`, `loadBalanced` in the
  options object) so it is safe on its own; the WI-4 preflight normally raises them first.

Alternative considered: follow the plan's table literally. Rejected because any divergence is
exactly the drift D0004 forbids, and the differential test would fail.

---

## WI-3: Fallback DNS client (`fallbackDnsClient.ts`)

- **Servers.** Use `dns.getServers()`, parsing `a.b.c.d`, `a.b.c.d:port` and `[v6]:port`, and try
  them in order. If the list is empty, fail with `ECONNREFUSED`.
- **Query.** Random 16-bit ID (`crypto.randomInt`), `RD=1`, one question, no EDNS. The reply must
  fit in 512 bytes or come back truncated. Encode with `dns-packet`.
- **UDP first.** Use a fresh `dgram` socket per query (`udp4` or `udp6` by server family) on an
  ephemeral port. Ignore datagrams whose source, ID, `QR` bit or question does not match, and keep
  waiting until the timeout. This gives the same anti-spoofing baseline as c-ares.
- **TCP on truncation.** If `TC=1`, repeat over TCP using the 2-byte length prefix.
- **Response codes.** `NOERROR` with answers of the requested type succeeds. `NOERROR` without
  answers is `ENODATA`. `NXDOMAIN` is `ENOTFOUND` (authoritative, so do not try the next server).
  `SERVFAIL` and `REFUSED` move on to the next server. A timeout moves on to the next server. For
  **TXT**, the caller treats `ENODATA` and `ENOTFOUND` as "no TXT record" and continues, exactly as
  the driver does (R3). They are fallback failures only for SRV.
- **Timeouts (D0016), one shared deadline (R4).** 5 s per UDP attempt, 10 s per TCP attempt, and
  **one** overall deadline of `min(20 s, documentDB.connectionTimeout)` covering the SRV query, the
  TXT query and any TCP retries. SRV and TXT get no separate budgets. Servers are asked in order,
  never in parallel. All values are constants in one place.
- **Abort.** An `AbortSignal` closes any open socket and rejects with `UserCancelledError`. The
  shared deadline and the caller's cancellation signal are combined into one signal.
- **Answers.** Use only answers of the requested type (SRV or TXT). Ignore CNAME records and
  additional sections.
- **Compression probe.** For each SRV answer, inspect the raw RDATA from offset 6 for a label
  pointer (`0b11xxxxxx`), and report `targetCompressed: boolean`. This confirms the root cause in
  the logs and in telemetry.
- **Return value.** `{ records, server, transport, attempts, replyBytes, targetCompressed }`. Every
  attempt is also logged at trace level (see [Trace output](#trace-output)).

**Tests:** a UDP+TCP DNS stub on `127.0.0.1` with an ephemeral port, built with `dns-packet` plus a
hand-built compressed-target reply (the replay from nodejs/node#66173). Cases: compressed target
decodes; `TC` triggers TCP; ID mismatch and wrong-question datagrams are ignored; `SERVFAIL` moves
to the second server; `NXDOMAIN` stops; timeout moves on; abort closes the socket; IPv6 server
parsing. Added after review: TXT `NOERROR` without answers and TXT `NXDOMAIN` are reported as "no
TXT", not as failures (R3); with every server slow, SRV plus TXT plus TCP retries end at the single
deadline, not at a multiple of it (R4).

**Done.** `023e7446` `feat(srv-resolver): fallback DNS client over UDP and TCP`.
`packages/documentdb-js-srv-resolver/src/fallbackDnsClient.ts` exports `resolveSrvFallback`,
`resolveTxtFallback`, `parseDnsServers`, `hasCompressedSrvTarget` and `FallbackDnsError` (Node-shaped:
`code`, `syscall`, `hostname`, plus `serversTried` and `attempts`). The timing constants live in
`src/constants.ts`; the logger interface and the cancellation helpers in `src/types.ts`. Each
attempt's timeout is `min(per-attempt limit, time left until the caller's absolute deadlineAt)`.
46 tests against a UDP+TCP stub on `127.0.0.1` (`src/test/dnsStubServer.ts`) with a hand-built
compressed-target reply, including every case listed above, socket-leak checks and the R4 shared
deadline; three consecutive clean runs.

**Deviation.** Approved by the coordinator (confidence ≥ 85 % each):

- **Cancellation type.** The package cannot throw `UserCancelledError`: it lives in
  `@microsoft/vscode-azext-utils`, which imports `vscode` (D0020 forbids that). The package rejects
  with the caller's `signal.reason` when it is an `Error`, otherwise with
  `SrvResolutionCancelledError`. The extension adapter (WI-4) aborts with a `UserCancelledError` as
  the reason, so callers get exactly that object back. Rejected alternatives: a string flag on a
  generic error (callers would have to re-wrap, which the error rule forbids), and copying a
  `UserCancelledError` look-alike into the package (`instanceof` checks in the extension would fail).
- **Error codes** use Node's `dns` constants (`ESERVFAIL`, `EREFUSED`, `EFORMERR`, `ENOTIMP`,
  `EBADRESP`, `ETIMEOUT`, `ECONNREFUSED`), so `fallbackErrorCode` reads like `nodeErrorCode`. The
  telemetry table's `SERVFAIL` and `REFUSED` become `ESERVFAIL` and `EREFUSED`.
- **Unparseable `dns.getServers()` entries are skipped** with one trace line each, instead of
  failing the whole fallback; if none remain, the result is `ECONNREFUSED` as for an empty list.
- `NOERROR` without answers (`ENODATA`) stops like `NXDOMAIN`: both are authoritative answers.

---

## WI-4: Orchestrator, trace output and telemetry (`prepareDriverConnectionString.ts`)

```ts
export type SrvResolutionPath = 'notSrv' | 'node' | 'fallback' | 'nodeErrorPassthrough';

export interface PrepareDriverConnectionStringInput {
    readonly connectionString: string; // after configureAuth; may contain credentials
    readonly options: MongoClientOptions; // authMechanism / authSource / replicaSet / tls may live here
    readonly surface: 'extension' | 'shell' | 'playground';
    readonly correlation: Readonly<Record<string, string | undefined>>; // connectionCorrelationId, startupCorrelationId, shellSessionId…
    readonly abortSignal?: AbortSignal;
}

export interface PreparedDriverConnectionString {
    readonly connectionString: string; // never persist; hand to the driver only
    readonly options: MongoClientOptions; // the caller's options, or a sanitized copy on the fallback path (R3); never the caller's object mutated
    readonly srvResolution: SrvResolutionPath;
}

export async function prepareDriverConnectionString(
    input: PrepareDriverConnectionStringInput,
): Promise<PreparedDriverConnectionString>;
```

Steps:

1. If the string does not start with `mongodb+srv://` (case-insensitive), return it unchanged with
   no log and no event.
2. Probe with `dns.promises.resolveSrv('_<srvServiceName ?? "mongodb">._tcp.<host>')` (D0005), on a
   fresh `new dns.promises.Resolver()`: default timeout and tries (D0017), but `cancel()` can be
   called when `abortSignal` fires, and the probe then rejects with `UserCancelledError` (R2).
   - On success, return the original string and options (`path=node`).
   - On `EBADRESP`, `EFORMERR` or `ECONNREFUSED` (D0012), or when the force switch is on (D0010),
     run the fallback, unless the off switch is set (D0011). With the off switch set, return the
     original string with `fallbackOutcome=disabled`.
   - On any other error, return the original string (`path=nodeErrorPassthrough`) and let the driver
     report its own error. The probe uses Node's default resolver with no extra time limit, and
     never rethrows (D0017).
3. **Preflight, on the fallback path only (R1).** Construct, but never connect,
   `new MongoClient(original, preflightOptions)`, so the driver raises its own parse errors first
   (`directConnection`, a port on an SRV host, multiple hosts, `srvMaxHosts` with a URI
   `replicaSet`, …). `preflightOptions` is a copy of the options as the driver will finally see
   them. For `MONGODB-OIDC` without `OIDC_CALLBACK`, `OIDC_HUMAN_CALLBACK` or `ENVIRONMENT`, add a
   stub `OIDC_CALLBACK` that rejects. The stub is never invoked, because this client never
   connects (verified with driver 7.2.0, see the review, R1). Discard the instance. On the Node.js
   path there is no preflight, because the driver gets the original string anyway.
4. Fallback: resolve SRV and TXT with WI-3, started in parallel (as the driver does), under one
   shared deadline (R4). No TXT record means no TXT options (R3). Then rewrite with WI-2. Return the
   rewritten string and the sanitized options as `path=fallback`. Errors:
   - `UserCancelledError` always propagates as cancellation, never replaced (R2).
   - Rewrite and preflight validation errors (WI-2, step 3) are thrown as they are, because the
     driver would have thrown the same ones.
   - Any other fallback failure is logged, and the **original probe error** is rethrown.
   - Force switch after a **successful** probe (D0010, development only): there is no probe error,
     so the fallback's own error is thrown (R5).
5. No caching of any kind. Every call queries DNS (D0001).
6. The abort signal is checked between steps, so cancellation never waits for the next DNS reply
   (R2).

**Switches (D0010, D0011):**

- `DOCUMENTDB_DEBUG_FORCE_SRV_FALLBACK=1` skips Node's verdict and always runs the fallback. Add it
  to `.vscode/launch.json` as a commented-out `env` entry.
- `DOCUMENTDB_DISABLE_SRV_FALLBACK=1` never runs the fallback; the probe and the event still run.
  It is the support escape hatch. If both are set, the off switch wins.

Both are documented in the user-manual page from WI-8.

### Trace output

Use `ext.outputChannel`, which is an `IAzExtLogOutputChannel`. Every line starts with
`[SrvResolution] <correlationId>`, using the `connectionCorrelationId` or `startupCorrelationId`
that the existing `[ClustersClient] startup=…` and `[WorkerSessionManager]` lines use, so one
connection can be followed with a single search.

**Never log:** the connection string (original or rewritten), userinfo, passwords or tokens. Host
names, SRV targets, ports, TXT option **keys** and DNS server addresses are allowed. These logs are
local only, and they are what a support engineer asks a user to paste. TXT option values are logged
only for `replicaSet` and `loadBalanced`; `authSource` values are written as `<set>`.

| Level   | When                                    | Example                                                                                                                                                                  |
| ------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `trace` | Start                                   | `[SrvResolution] 3f2a… start surface=extension srvHost=x.global.mongocluster.cosmos.azure.com service=mongodb ares=1.34.8 node=24.21.0 dnsServers=[192.168.10.1] forced=false` |
| `trace` | Node probe ok                           | `… node probe ok targets=3 durationMs=11 → path=node (original +srv handed to driver)`                                                                                   |
| `trace` | Node probe failed, not eligible         | `… node probe failed code=ENOTFOUND durationMs=40 (not fallback-eligible) → path=nodeErrorPassthrough`                                                                   |
| `trace` | Node probe failed, eligible             | `… node probe failed code=EBADRESP durationMs=9 → running fallback`                                                                                                     |
| `trace` | Each fallback attempt                   | `… fallback SRV server=192.168.10.1:53 transport=udp id=0x1a2b rcode=NOERROR tc=false answers=3 bytes=212 targetCompressed=true durationMs=8`                           |
| `trace` | TXT                                     | `… TXT source=fallback keys=[authSource,replicaSet] replicaSet=globaldb authSource=<set>`                                                                                |
| `trace` | Rewrite                                 | `… rewrite targets=[fc-…-000.global…:10260,fc-…-001.global…:10260] tlsAdded=true removedParams=[srvMaxHosts] txtApplied=[replicaSet] txtSkipped=[authSource:$external]`  |
| `trace` | Fallback applied (one line per connect) | `… DNS reply for x.global… was rejected by Node.js (EBADRESP, c-ares 1.34.8); resolved 3 SRV targets via 192.168.10.1 (udp) instead. See issue #993.`                    |
| `trace` | Fallback failed                         | `… SRV fallback failed code=ETIMEOUT serversTried=2 durationMs=4012; the original error is reported`                                                                      |
| `trace` | Off switch set                          | `… fallback eligible (EBADRESP) but disabled by DOCUMENTDB_DISABLE_SRV_FALLBACK → original +srv handed to driver`                                                       |

All lines are at `trace` (D0014). The output is for support conversations, where the user is asked
to set the log level to Trace anyway. A failed connection already shows its own error, and
telemetry is the signal at scale.

Add a test that spies on `ext.outputChannel` and asserts that no line contains the password or the
userinfo from a fixture string.

### Telemetry

**Event `connect.srvResolution`** (D0009). Emit it from `prepareDriverConnectionString` with
`callWithTelemetryAndErrorHandling`, with `errorHandling.suppressDisplay = true`,
`errorHandling.rethrow = true` and `telemetry.maskEntireErrorMessage = true`. Emit it only for
`+srv` strings. The framework sets `result`: **Succeeded** when the driver gets a usable string
(`node`, `fallback`, `nodeErrorPassthrough`), and **Failed** when the fallback failed or the rewrite
rejected the records.

| Name                                                          | Kind  | Values                                                                         | Answers                                       |
| ------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------ | --------------------------------------------- |
| `surface`                                                     | prop  | `extension` · `shell` · `playground`                                           | where it happened                             |
| `connectionCorrelationId`, `startupCorrelationId`, `shellSessionId` | prop  | as available                                                                   | join with `connect.startup` / `worker.startup` |
| `path`                                                        | prop  | `node` · `fallback` · `nodeErrorPassthrough`                                   | **when the fix is applied**                   |
| `nodeErrorCode`                                               | prop  | `EBADRESP` · `EFORMERR` · `ENOTFOUND` · `ETIMEOUT` · `ECONNREFUSED` · … · `none` | **blast radius**, known gap                   |
| `fallbackOutcome`                                             | prop  | `succeeded` · `failed` · `notAttempted` · `disabled` (D0011)                   | does the fix work                             |
| `fallbackErrorCode`                                           | prop  | `ETIMEOUT` · `ENOTFOUND` · `ENODATA` · `SERVFAIL` · `REFUSED` · `parentDomainMismatch` · `txtInvalid` · … | why it did not                                |
| `fallbackTransport`                                           | prop  | `udp` · `tcp`                                                                  | TCP retry rate                                |
| `targetCompressed`                                            | prop  | `'true'` · `'false'` · `unknown`                                               | **confirms the root cause**                   |
| `txtSource`                                                   | prop  | `fallback` · `none` (no TXT record); fallback path only (R4)                    |                                               |
| `txtOptionsApplied`                                           | prop  | sorted subset of `authSource,replicaSet,loadBalanced`, or `none`               | semantics coverage                            |
| `tlsAdded`                                                    | prop  | `'true'` · `'false'`                                                           |                                               |
| `dnsServerClass`                                              | prop  | `loopback` · `private` · `public` · `mixed` · `none` (from `isLocalOrPrivateHost`, never the IP) | router vs. systemd stub vs. public            |
| `dnsServerIpFamily`                                           | prop  | `ipv4` · `ipv6` · `mixed`                                                      |                                               |
| `aresVersion`                                                 | prop  | `process.versions.ares`                                                        | **which runtimes are affected**               |
| `nodeRuntimeVersion`                                          | prop  | `process.versions.node`                                                        | maps to VS Code / Electron releases           |
| `isAzureEndpoint`, `isGlobalEndpoint`                         | prop  | `'true'` · `'false'`                                                           | who is affected, without hostnames            |
| `forcedFallback`                                              | prop  | `'true'` · `'false'`                                                           | exclude dev runs                              |
| `nodeProbeDurationMs`                                         | meas  | ms                                                                             | cost of D0005 for everyone                    |
| `fallbackDurationMs`                                          | meas  | ms                                                                             | cost of the fix                               |
| `srvTargetCount`, `dnsServerCount`, `fallbackServersTried`    | meas  | counts                                                                         |                                               |

Platform and remote kind (`common.os`, `common.remotename`) come from the framework's common
properties. Do not add them by hand.

**Summary on existing startup events.** Set `srvResolution` (the `path`, or `notSrv`) on
`connect.startup` (ClustersClient) and `worker.startup` (WorkerSessionManager), and add an
`srvResolutionDurationMs` cost measurement, either through a new `ConnectionStartupTimings` activity
or by setting it directly. This lets the existing startup dashboards split failures by path without
a join. Do **not** rename the existing `stage0x…` values; dashboards depend on them.

**Questions this answers** (Kusto-like sketch; run in the existing dashboards):

```kusto
// Blast radius: share of SRV connections that needed the fallback, by c-ares version
RawEventsVSCodeExt | where EventName endswith "connect.srvresolution" and Properties.forcedfallback == "false"
| summarize srv = count(), fallback = countif(Properties.path == "fallback"),
            machines = dcountif(VSCodeMachineId, Properties.nodeerrorcode in ("EBADRESP","EFORMERR","ECONNREFUSED"))
  by aresVersion = tostring(Properties.aresversion), os = tostring(Properties["common.os"])

// When the fix is applied, and whether it works
... | where Properties.path == "fallback" | summarize count() by tostring(Properties.fallbackoutcome), bin(ServerTimestamp, 1d)

// Known gap: SRV failures the fallback does not address
... | where Properties.path == "nodeErrorPassthrough" | summarize count() by tostring(Properties.nodeerrorcode), aresVersion

// End to end: did the connection succeed after the fallback?
// join connect.srvResolution ⨝ connect.startup on connectionCorrelationId; compare startupOutcome by path
```

**Tests:** inject the Node resolver and the fallback client. Assert the properties and measurements
for each path. Assert that no property value contains the host, a DNS server IP or the password.
Assert that `notSrv` emits no event. Added after review:

- **R1:** with the real driver constructor, for Entra ID and managed identity options (no
  callback, as the worker path supplies them): the Node.js path does not construct a preflight
  client; the fallback path's preflight succeeds with the stub; the returned options never contain
  the stub.
- **R2:** abort while the probe is pending, while SRV or TXT is pending, and between steps. Each
  rejects with `UserCancelledError` (not the probe error), and the probe resolver's `cancel()` was
  called.
- **R5:** force switch with a successful probe and a failing fallback throws the fallback's error.

**Done.** `be0337b4` `feat(srv): core SRV resolve function, extension adapter and telemetry`.
The package's `resolveSrvForDriver()` (`src/resolveSrvForDriver.ts`, report types in
`src/report.ts`) implements steps 1–6. The extension adapter
`src/documentdb/srv/prepareDriverConnectionString.ts` maps the two environment switches to
`fallback: 'off' | 'force' | 'auto'` (off wins; only the value `1` counts), passes
`deadlineMs = min(20 s, documentDB.connectionTimeout)`, writes trace lines to
`ext.outputChannel.trace`, and emits `connect.srvResolution` through
`srvResolutionTelemetry.ts`. `.vscode/launch.json` has both switches as commented-out `env`
entries. 99 new tests (58 package, 41 extension), covering every path, R1 with the real driver
constructor, R2 at each await point (including a DNS error racing the abort), R4 (one deadline
for SRV and TXT), R5, options identity, and log spies with a credential fixture on success and
on every error path.

**Deviation.** Approved by the coordinator (confidence ≥ 85 % each):

- **Telemetry wrapper.** `callWithTelemetryAndErrorHandling` swallows a `UserCancelledError` even
  with `rethrow = true`, lets registered handlers see the error, and sends its `stack`, which for a
  DNS error contains `_mongodb._tcp.<host>`. The adapter therefore uses the same
  "original failure" pattern as `ClustersClient.initClient` and `WorkerSessionManager.spawnWorker`:
  inside the callback it throws a stack-less stand-in (`UserCancelledError` for cancellation, so
  `result=Canceled`), and outside it rethrows the original object unchanged.
- **Cancellation.** The adapter links the caller's `abortSignal` to an internal controller that
  aborts with a `UserCancelledError` as the reason, so the package's cancellation contract (WI-3
  note) hands back a real `UserCancelledError`.
- **DNS-server classification** (`dnsServerClass`, `dnsServerIpFamily`) lives in the extension's
  `srvResolutionTelemetry.ts`, not in the package's `report.ts`, so it reuses
  `isLocalOrPrivateHost` (plus an explicit loopback check) instead of duplicating it. The report
  carries the raw `dnsServers` and `srvHost` for local use only; neither reaches telemetry.
  `isAzureEndpoint` uses `hasAzureDomain`; `isGlobalEndpoint` checks for a `global` DNS label.
- **Startup summary.** The adapter takes an optional `startupTelemetry` (the enclosing
  `connect.startup` or `worker.startup` context) and sets `srvResolution` (path or `notSrv`) and
  `srvResolutionDurationMs` on it, on failure too. It also returns a `summary`
  (`srvResolutionSummary.ts`) for WI-10. Neither is in the plan's signature; both are additive.
- **`fallbackErrorCode` values:** the fallback client's Node code (`ETIMEOUT`, `ESERVFAIL`, …),
  the rewrite kind (`noAddresses`, `parentDomainMismatch`, `txtInvalid`, `optionConflict`),
  `preflight`, or `txt:<code>` when a TXT failure other than "no record" stopped the fallback.
- **Forced fallback after a successful probe** writes `forced fallback applied for <host>; …`
  instead of the "rejected by Node.js" line, because nothing was rejected.

---

## WI-5: Wire `ClustersClient`

In `initializeClient`, during `stage03PreparingClient` and **after** `getHostsFromConnectionString`
and the `connect.staticmetadata` emission (both keep using the original string):

```ts
const prepared = await prepareDriverConnectionString({
    connectionString, options, surface: 'extension',
    correlation: { connectionCorrelationId: this.connectionCorrelationId }, abortSignal,
});
startup.telemetry.properties.srvResolution = prepared.srvResolution;
await this.connect(startup, prepared.connectionString, prepared.options, credentials.emulatorConfiguration, abortSignal);
```

- Use `prepared.options` (the caller's options, or the sanitized copy on the fallback path, R3).
  The handler's `OIDC_CALLBACK` is carried over unchanged.
- Pass the **original** string to `connect()`'s `isLocalish` check (`resolveAllowInvalidCertificates`)
  through a separate parameter, so the TLS-exception policy is evaluated on what the user entered.
  The targets share the parent domain, so the result is the same, but do not rely on that.
- `getClusterMetadata(this._mongoClient, hosts)` keeps the original `hosts`.
- The Entra ID and managed identity handlers already compute `ALLOWED_HOSTS` from
  `credentials.connectionString` (the original). No change is needed.
- The cached-reconnect path in `getClient` reuses the existing `MongoClient`. It is unchanged in
  this increment (Q3).

**Tests:** extend `ClustersClient.test.ts`. With the helper mocked to return
`path=fallback, mongodb://…`, `MongoClient` must receive the rewritten string, while
`CredentialCache`, `getHostsFromConnectionString` and `connect.staticmetadata` see the original.

**Done.** `d7df1147` `feat(srv): wire ClustersClient and show fallback use in the cluster tooltip`.
`initializeClient` calls `prepareDriverConnectionString` after `connect.staticmetadata`, passing
`startup.telemetry` so `connect.startup` gets `srvResolution` and `srvResolutionDurationMs`.
`connect()` gets the original string as a separate parameter for the TLS-exception (`isLocalish`)
check. The audit of `connect()` found no other use of the string: credentials, `hosts`, metadata
and display keep the original, and the driver gets the rewritten string and `prepared.options`.
The cached-reconnect path is unchanged (D0013). Tests cover the rewritten string reaching
`MongoClient` while everything else sees the original, cancellation (no client created), error
identity and the startup property.

---

## WI-6: Wire `WorkerSessionManager` (interactive shell and query playground)

In `initializeWorker`, before `new Worker(...)` so that no worker is spawned when resolution fails,
and inside the open `worker.startup` telemetry context:

- Call `prepareDriverConnectionString` with `surface` set to `shell` or `playground` (from
  `initMsg.persistent`), the startup and session correlation IDs, and the options. For
  `authMechanism` set to `MicrosoftEntraID` or `ManagedIdentity`, pass
  `options.authMechanism = 'MONGODB-OIDC'` so the `$external` rule applies (the worker sets this
  itself today). There is no `OIDC_CALLBACK` on the host. The helper's fallback-only preflight adds
  its own non-invoked stub (WI-4 step 3, R1), so the options passed here stay serializable.
- Post `{ ...initMsg, connectionString: prepared.connectionString, clientOptions: <serializable
  subset of prepared.options>, oidcAllowedHosts }`, where
  `oidcAllowedHosts = getOidcAllowedHosts(initMsg.connectionString)` is computed from the
  **original**. Do not modify the caller's `initMsg` (D0008).
- **Cancellation (R2).** Each startup gets its own `AbortController`, stored on the manager.
  `terminateWorker`, `killWorker` and `dispose` abort it. Pass its signal to
  `prepareDriverConnectionString`. After preparation, and again right before `new Worker(...)`,
  if the signal is aborted, throw `UserCancelledError` without creating a worker. `ensureWorker`
  then rejects, so `PlaygroundEvaluator.evaluate()` never reaches `sendEval`, and the shell never
  sends its first command. The existing `startup.outcome === 'terminated'` mapping in `spawnWorker`
  keeps the telemetry result `Canceled`.
- **Timeout (R4, D0018).** Separate budgets: preparation (the probe per D0017, then the fallback
  within the D0016 deadline) runs first, and the full init timeout
  (`sendRequest(initMsg, initTimeoutMs, …)`) starts only after it. Do not subtract preparation time
  from `initTimeoutMs`. Record `srvResolutionDurationMs` on `worker.startup` so the extra wait is
  measured.
- `workerTypes.ts`: add `readonly oidcAllowedHosts?: readonly string[]` to the `init` message.
- `playgroundWorker.ts`: use `msg.oidcAllowedHosts ?? getOidcAllowedHosts(msg.connectionString)`.
- Set `srvResolution` and `srvResolutionDurationMs` on `worker.startup`.
- `ShellSessionManager.extractHosts(initMsg.connectionString)` and the shell banner keep the
  original. Check that neither reads the rewritten copy.

**Tests:** `WorkerSessionManager` posts the rewritten string with `oidcAllowedHosts` derived from the
original, and the caller's object is unchanged. The worker prefers `oidcAllowedHosts`. Added after
review:

- **R2:** hold DNS pending, call `killWorker()` (and separately `dispose()`), then let DNS complete.
  Assert that no `Worker` was constructed, no `init` and no `eval` message was posted, and
  `ensureWorker` rejected with `UserCancelledError`. Run it for the playground (`evaluate`) and the
  shell.
- **R1:** an Entra ID and a managed identity SRV startup on the Node.js path and on the forced
  fallback path both reach `new Worker(...)`; the host never throws an OIDC argument error.

**Done.** `@M6@` `feat(srv): resolve SRV on the host for the shell and query playground`.
`initializeWorker` calls `prepareDriverConnectionString` before `new Worker(...)`, with
`authMechanism: 'MONGODB-OIDC'` and `tls: true` on a copy of the options for Entra ID and managed
identity, as the worker does itself. It posts a copy of `initMsg` with the prepared string, the
`SerializableMongoClientOptions` fields from the prepared options (the whole serializable type, so
nothing the worker used before is dropped, and no functions), and `oidcAllowedHosts` computed from
the original. The worker uses them through `getWorkerOidcAllowedHosts`
(`workerOidcAllowedHosts.ts`), a small pure helper that the worker bundle imports without pulling
in any resolver code. Each startup has its own `AbortController`; `terminateWorker`, which
`killWorker`, `dispose` and `shutdown` reach, aborts it, and the signal is checked after
preparation and again right before `new Worker(...)`. `sendRequest` still gets the full
`initTimeoutMs` after preparation (D0018). `ShellSessionManager.extractHosts` and the banner read
the caller's original `initMsg`. No startup stage was added or renamed; preparation time is the
adapter's `srvResolutionDurationMs` on `worker.startup`. 20 new tests, including pending-DNS
cancellation through the playground and shell paths, shutdown before a worker exists, and the real
adapter and resolver with injected DNS plus the real driver preflight for both OIDC methods on the
Node.js and forced-fallback paths. Bundle check (M5/M6 gate, `webpack-dev-ext`): `dns-packet`,
`rewriteSrvUri`, `resolveSrvFallback` and `prepareDriverConnectionString` occur in `dist/main.js`
and not in `dist/playgroundWorker.js` (D0008).

**Deviation (coupled fix).** `PlaygroundEvaluator.evaluate` wraps `ensureWorker` in
`callWithTelemetryAndErrorHandling('playground.connect', …)`, which swallows a
`UserCancelledError` even with `rethrow = true`. The evaluator would then have gone on to
`sendEval` after a cancellation during DNS preparation: exactly the R2 hazard. It now uses the same
"original failure" pattern as `spawnWorker` and rethrows the original error. `shutdown()` also
calls `terminateWorker` when no worker exists yet, so a graceful shutdown during preparation
aborts it. Approved by the coordinator (confidence > 90 %: without the fix, R2 is not met).

---

## WI-7: Actionable error when the fallback cannot help (`ConnectionDiagnosticsService`)

Follow `.github/skills/error-translation/SKILL.md`: the provider translates, never shows UI, and
never touches the error.

- Add `SrvDnsDiagnosticsProvider` (`id: 'srv-dns'`). As the cheap check first, require **evidence
  of an SRV DNS operation** (R5): the message starts with `querySrv ` (the worker path only has the
  message), or `error.syscall === 'querySrv'`. Never match on `error.code` alone, because an
  ordinary socket refusal (`connect ECONNREFUSED 10.0.0.5:10260`) also has
  `code: 'ECONNREFUSED'`. Then return localized text that **does not claim the fallback's
  outcome** (it may have been disabled, D0011) and does not say who rejected what (c-ares may have
  rejected a valid reply):
  - `EBADRESP` / `EFORMERR`: "The SRV record for this connection could not be resolved: the DNS
    reply could not be read. This often happens with home routers and some VPN or corporate DNS
    servers. Use a non-SRV `mongodb://` connection string, or a different DNS server."
  - `ECONNREFUSED`: "The SRV record for this connection could not be resolved: the DNS server
    refused the query. Check your network's DNS settings, or use a non-SRV `mongodb://` connection
    string."

  Both link to the user-manual page from WI-8, which explains the built-in fallback and its
  switches.
- Register it in `ClustersExtension.registerDiscoveryServices`.
- Add a `Links` constant for the documentation page.

**Tests:** provider unit tests for each code, plus `undefined` for unrelated errors and for
`UserCancelledError`. Negative tests (R5): an ordinary TCP refusal (`code: 'ECONNREFUSED'`,
`syscall: 'connect'`) returns `undefined`; a `querySrv EBADRESP` produced with the off switch set
gets the same neutral text.

---

## WI-8: Documentation and release notes

- Add a user-manual page `docs/user-manual/troubleshooting-srv-dns.md`: symptoms, how to confirm
  (the `ELECTRON_RUN_AS_NODE` check from #993), that the extension now works around it, and the
  remaining workarounds (non-SRV string, DNS server change) with their caveats. Link it from
  `how-to-construct-url.md`.
- On the same page, document both switches (D0011): `DOCUMENTDB_DISABLE_SRV_FALLBACK=1` (turns the
  fallback off, for support) and `DOCUMENTDB_DEBUG_FORCE_SRV_FALLBACK=1` (forces it, for
  diagnosis). Explain how to set an environment variable for the extension host on Windows, macOS
  and Linux, and under Remote-SSH, WSL and Dev Containers, where the variable must be set on the
  remote side. Also explain how to collect the `[SrvResolution]` trace (set the output channel's
  log level to Trace).
- On the same page, state the timing rule (D0018): `documentDB.connectionTimeout` starts after DNS
  resolution. When the fallback is needed, connecting can take up to 20 s longer than the setting
  (D0016).
- Run `npm run l10n` for the new strings in WI-4 and WI-7 (Case 2 only).
- Add a `0.11.1` release-notes entry through the `writing-release-notes` skill (D0015).
- Update the feature README: code map, the `code` frontmatter, the timeline, and the decision status
  changes.

---

## WI-10: Show in the cluster tooltip whether the fallback was used (D0019)

Operator requirement (2026-10-09): the UI must be able to show whether the fallback was used. This
increment shows it **in the cluster tooltip only**. The cluster dashboard follows later (FW-2), so
the data shape must already serve both.

- **The flag.** `ClustersClient` keeps the last `SrvResolutionSummary` of its own connection, in
  memory: `{ path, nodeErrorCode?, fallbackTransport?, srvTargetCount?, resolvedAt }`. It contains no
  hostnames and no connection string. Expose it as
  `ClustersClient.getSrvResolution(clusterId): SrvResolutionSummary | undefined`, keyed by
  **`clusterId`**, never `treeId` (copilot-instructions, dual ID). It is never persisted (same
  rule as D0001), and it disappears with the client (`deleteClient`, reload).
- **The tooltip.** When the summary's path is `fallback`, add one localized line to the cluster
  tooltip, for example: "DNS: SRV record resolved by the extension's fallback resolver, because
  VS Code's resolver rejected the DNS reply (`EBADRESP`)." Nothing is shown for `node`,
  `nodeErrorPassthrough` or `notSrv`. Places that build the tooltip:
  - Connections view: `buildClusterTooltip` in `src/tree/connections-view/clusterItemPresentation.ts`
    (also used by the Local Quick Start item);
  - discovery and Azure views: the default tooltip in `ClusterItemBase.getTreeItem()`, plus the
    `tooltipOverride` setters in `KubernetesResourceItem` and `AzureVMResourceItem`.

  Put the line in one shared helper that every place calls, so a future view cannot miss it.
- **Refresh.** The tooltip is built in `getTreeItem()`, which runs before the first connection. The
  row must be re-rendered after a connection whose path is `fallback`, or the line never appears.
  Check during implementation which mechanism re-renders the cluster row itself, not only its
  children. Candidates: an item refresh through the existing tree state manager, or implementing
  `resolveTreeItem` in `BaseExtendedTreeDataProvider` so the tooltip is computed lazily on hover.
  The project does not use `resolveTreeItem` yet.
- **Scope.** The flag describes the tree's connection (`ClustersClient`). The shell and playground
  resolve independently in their own startup (WI-6). Their result goes to trace and telemetry only
  in this increment. The summary type is shared, so the dashboard can later show every surface.

**Tests:** the summary is set for each path and contains no host; it is keyed by `clusterId` (move
a connection into a folder: the tooltip still shows the line); the tooltip contains the line only
for `fallback`; it is gone after `deleteClient`.

**Done.** `d7df1147` (same commit as WI-5). `ClustersClient.getSrvResolution(clusterId)` returns the
in-memory `SrvResolutionSummary` from the client instance in `_clients`, so it is keyed by
`clusterId` and disappears with `deleteClient` and on reload. One helper,
`src/documentdb/srv/srvResolutionTooltip.ts`, renders the line as
`**DNS:** SRV record resolved by the extension's fallback resolver, because VS Code's DNS resolver
could not use the reply (`EBADRESP`).` (label and message localized separately; no hostnames), and
only for `path === 'fallback'`. It is called from `buildClusterTooltip` (Connections view and
Local Quick Start; `clusterId` added to `ClusterPresentationModel`), from
`ClusterItemBase.getTreeItem`, and from `BaseExtendedTreeDataProvider.getTreeItem` for every
`ClusterItemBase`. The provider is the choke point that also covers subclasses that replace the
tooltip (Kubernetes, Azure VM and the Atlas item, which the plan did not list). A dedupe guard stops
the line from appearing twice.

**Refresh mechanism.** After a successful connection whose path is `fallback`, `getClient` fires
`onDidChangeSrvResolution(clusterId)`. Each `BaseExtendedTreeDataProvider` keeps a map from
`clusterId` to the rows it has rendered (cleared on `clearParentCache`, on a subtree `refresh`, and
on dispose) and fires `onDidChangeTreeData` for each row, so VS Code calls `getTreeItem` again.

**Deviation.** Approved by the coordinator (confidence ≥ 85 %):

- **One extra `listDatabases` per fallback connection is accepted.** For an expanded row, VS Code
  also asks for the children again. The coding agent first added a one-shot children-reuse cache to
  `BaseExtendedTreeDataProvider` to avoid that second listing. It was removed in review: it put
  stateful caching into the provider every tree uses, and if the row was collapsed when the event
  fired, the cached promise stayed and the next expansion would have returned old children, even
  after a disconnect. Only affected users pay the extra listing.
- **No refresh on `deleteClient`.** Firing on an expanded row would make VS Code call
  `getChildren`, which reconnects silently after a disconnect. The summary disappears with the
  client, so the next render omits the line.
- **Lazy `resolveTreeItem` was rejected**: VS Code calls it only when `tooltip` is undefined, and
  caches the result per item, so a hover before the first connection would hide the line.
- `SrvResolutionTelemetry`'s property and measurement types were widened to
  `ITelemetryContext['properties']` and `['measurements']`, so the startup contexts (which can hold
  `TelemetryTrustedValue`) type-check.

---

## WI-9: Verification

**Automated** (Case 1 while working: `npm run build` plus the touched tests):

- WI-2: the differential test against the driver's `resolveSRVRecord`.
- WI-3: the local UDP/TCP stub with a compressed-target reply.
- WI-4 to WI-7: unit tests as listed above.

**Manual:**

1. **Confirm the regression in the runtime.** With VS Code's bundled Node.js
   (`ELECTRON_RUN_AS_NODE=1 code -e …`), run the nodejs/node#66173 replay against the stub:
   `dns.resolveSrv` must return `EBADRESP` and `fallbackDnsClient` must decode the same reply.
2. **Forced path against a real cluster.** Launch with F5 and
   `DOCUMENTDB_DEBUG_FORCE_SRV_FALLBACK=1` against an Azure DocumentDB `.global.` cluster, using
   native auth **and** Entra ID. Expand the tree, open the Collection View, the interactive shell
   and the query playground. Check the "fallback applied" line and the rest of the trace output in **DocumentDB for VS Code**
   output (log level Trace), and check the `connect.srvResolution` events (`path=fallback`,
   `forcedFallback=true`).
3. **A real compressing resolver.** Use a Linux dev container whose `resolv.conf` points at a small
   forwarding stub that re-encodes SRV targets with compression, or a known affected router. Run
   unforced. Expect `path=fallback`, `nodeErrorCode=EBADRESP` and `targetCompressed=true`.
4. **Nothing persisted.** After a fallback connection, the cluster tooltip shows the fallback line
   (WI-10), and "Copy Connection String", "Update Connection
   String…" and export still show `mongodb+srv://`. Inspect connection storage and secret storage.
5. **Unaffected path.** On a normal network, check `path=node`, that the driver receives the
   original string (trace line), and the `nodeProbeDurationMs` overhead.
6. **Remote.** Remote-SSH or WSL: resolution runs in the remote extension host and uses its DNS
   servers (trace line `dnsServers=[…]`).
7. **Off switch.** With both switches set, the force switch is ignored: the trace shows "disabled",
   the event shows `fallbackOutcome=disabled`, and the original error reaches the user. Follow the
   user-manual steps (WI-8) exactly as written, so the documentation is tested too.
8. **Slow network.** Throttle or delay DNS (for example `tc qdisc … netem delay 3000ms` in a Linux
   dev container). The fallback should still succeed within the D0016 limits.

---

## Risks

| Risk                                                    | Mitigation                                                                                  |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Semantic drift from the driver after a `mongodb` upgrade | WI-2 differential test against the driver's own `resolveSRVRecord`                          |
| UDP reply spoofing                                       | Random ID, source/ID/question match (c-ares baseline); the parent-domain check limits targets |
| Extra latency for every SRV connection (D0005)           | Measured as `nodeProbeDurationMs`; SRV only, TXT is not probed                              |
| Stale targets on a long-lived cached client (fallback path only) | Accepted for this increment (D0013); [future-work.md](../../future-work.md) FW-1 and FW-2 |
| Credential leak through logs or telemetry                | Never log URIs; a log-spy test; `maskEntireErrorMessage`; no host or IP in properties       |
| Fallback slower than the driver's own failure            | Overall timeout cap within the connection timeout (Q7)                                      |
| Cancelled playground code still runs after DNS preparation (R2) | Per-startup `AbortController`; no `Worker` is created after abort; tests hold DNS pending and then cancel |
| Host-side preflight rejects OIDC options (R1)            | Preflight only on the fallback path, with a non-invoked stub callback; tests use the real constructor |
| The rewrite accepts what the driver rejects (R3)         | Validate on the full target list before sampling; sanitized options; cross-product fixtures |
| With dead DNS, the probe adds about 27 s before the driver fails (D0017) | Accepted; measured as `nodeProbeDurationMs` on `path=nodeErrorPassthrough`; bounded probe (Q2 D) is the known remedy |

## Open questions for the operator

Each question lists the options considered, their pros and cons, and a recommendation. Record the
operator's choice in [decisions.md](../../decisions.md) once made, and keep the rejected options there
too.

### Q1: Should there be a kill switch for the fallback?

| Option                                                                                                                        | Pros                                                                                                     | Cons                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. No switch** (proposed)                                                                                                   | No new setting, no settings-naming review. The fallback only runs where the connection would fail anyway. | If the rewrite is wrong in some edge case, the only remedy is a hotfix release.                                                                           |
| **B. User setting** (for example `documentDB.connection.srvFallback.enabled`, default `true`)                                  | Support can tell a user to turn it off. Cheap to add.                                                    | Discoverable and synced, so it needs the `settings` feature's naming and grouping review. It doubles the test matrix and will almost never be used. |
| **C. Remote flag** (experimentation service)                                                                                  | Can be turned off for everyone without a release.                                                        | Only works if the extension already uses such a service; otherwise it is new infrastructure for one switch.                                               |
| **D. Env var off switch** (`DOCUMENTDB_DISABLE_SRV_FALLBACK=1`, next to the D0010 force switch)                                | Invisible to normal users, no settings work, same code path as D0010.                                    | Hard for end users to set (VS Code must be started with the variable). Awkward under Remote.                                                             |

**Recommendation:** A, plus D as a support escape hatch, since it costs almost nothing.

**Operator (2026-10-09): A + D, and the switch is documented in the user docs.** Recorded as
D0011; the documentation is part of WI-8.

### Q2: Should a failed lookup stop waiting for DNS twice?

When the probe fails with a code the fallback does not handle (`ENOTFOUND`, `ETIMEOUT`, …), the
original string still goes to the driver, which looks up DNS again.

**Fact checked 2026-10-09 (driver 7.2.0):** `MongoClient._connect()` calls `resolveSRVRecord()`
inside a `try/finally` with no `catch`, and `resolveSRVRecord` rethrows the raw `dns` error. The
error a caller sees is therefore the original Node.js DNS error, unwrapped. The only extra behavior
is a single retry on `ETIMEOUT` (`retryDNSTimeoutFor`).

| Option                                                                                                                                   | Pros                                                                                                                                       | Cons                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Pass through and let the driver fail** (proposed)                                                                                   | The error the user sees is the driver's own, exactly as today. Keeps the driver's `ETIMEOUT` retry. A transient failure may succeed on the second try. | On failure, DNS latency is paid twice; with `ETIMEOUT` it can be paid three times (probe, driver, driver retry). |
| **B. Rethrow the probe error directly**                                                                                                  | Fails fast with one lookup. Given the fact above, the error is the same object type the driver would surface.                              | Loses the driver's `ETIMEOUT` retry unless we copy it. Ties us to the driver not wrapping the error in later versions; needs a regression test. |
| **C. Hybrid:** rethrow on errors where retrying cannot help (`ENOTFOUND`, `ENODATA`); pass through on transient ones (`ETIMEOUT`, `ESERVFAIL`, `ECONNREFUSED`) | No double wait where a retry cannot help; keeps the retry where it can.                                                                    | More branches. Still needs the regression test from B for the rethrown codes.                                                                          |

**Recommendation (first pass, withdrawn):** C. Add a test that mocks `dns.promises.resolve` and asserts that our rethrown
error and the driver's error (from `new MongoClient(srv).connect()`) have the same class, `code`
and `message`. The test fails if a future driver starts wrapping the error.

**Operator (2026-10-09):** worried that C can make bad decisions; asked for more investigation.
The question was then answered below.

#### Investigation (2026-10-09)

Measured on Node.js 22.21.1 (c-ares 1.34.5), against the system DNS server and an unreachable
server (`10.255.255.1`):

| Probe failure                                                    | Time to fail | `resolveSrv()` and `resolve(…, 'SRV')` give the same error? |
| ---------------------------------------------------------------- | ------------ | ----------------------------------------------------------- |
| `ENOTFOUND` (NXDOMAIN)                                           | 6–46 ms      | yes: `querySrv ENOTFOUND _mongodb._tcp.<host>`              |
| `ENODATA`                                                        | 3–12 ms      | yes                                                         |
| `ETIMEOUT`, default resolver (what the driver uses)              | **27 039 ms** | yes                                                         |
| `ETIMEOUT`, `new Resolver({ timeout: 2000, tries: 1 })`          | **2 002 ms** | yes; the bounded resolver uses the same `dns.getServers()` list |

Findings:

1. **C saves almost nothing.** The errors it rethrows fail in milliseconds. The expensive one,
   `ETIMEOUT`, is passed through by C as well, so with dead DNS the user still waits about 27 s
   (probe) plus 2 × 27 s (driver plus its retry). C adds branches and risk to save about 50 ms.
2. **Rethrowing (B and C) moves failures in telemetry.** `connect.startup` would record
   `lastStage=stage03PreparingClient` instead of `stage04ConnectingAndAuthenticating`, and
   `worker.startup` would fail before a worker exists. Existing startup dashboards would show a
   jump that has nothing to do with user behavior.
3. **Rethrowing changes the error object for the shell and the playground.** Today the worker
   relays only the message, and the host rejects with `new Error(msg.error)`
   (`WorkerSessionManager`, `initResult`). Rethrowing on the host would surface the raw DNS error,
   with `code` and `syscall`. The text is the same, but the object is not.
4. **A bounded probe cannot change the outcome.** On a probe `ETIMEOUT` the original string is
   passed through anyway, so a shorter probe changes only how long we wait before handing over.
   Its one risk: a rejected reply (`EBADRESP`) that arrives after the limit makes the probe time
   out, so the fallback is not tried. A 5 s limit, the same as a UDP attempt (D0016), sits far
   above any realistic round trip.

#### New options

| Option                                                                                                                                                         | Pros                                                                                                                                                                                                                         | Cons                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D. A with a bounded probe:** `new dns.promises.Resolver({ timeout: 5000, tries: 1 })`, an overall 5 s timer that calls `resolver.cancel()`, never rethrow | The driver stays the only source of every error not handled by the fallback, so error objects, stages and dashboards do not change. The extra wait with dead DNS drops from about 27 s to at most 5 s (about 54 s today, about 59 s with D). No new code paths. | Still up to 5 s added to an already failing connection. Fast errors are still looked up twice (milliseconds). |
| **E. Reactive, no probe:** the driver goes first; on a `querySrv EBADRESP`/`EFORMERR`/`ECONNREFUSED` failure, rewrite the string and connect again                | No double wait and no probe cost for anyone, including successful connections.                                                                                                                                               | Reopens D0005: no denominator of all SRV connections unless we infer it from errors. A second client creation in `ClustersClient.connect` and in the cached-reconnect path. On the worker path the error arrives as a string, so the host must parse it and spawn a second worker. |

**Revised recommendation:** D. C is withdrawn: findings 1 to 3 show it buys about 50 ms at the
cost of moving errors and telemetry stages. E is the only option with no double wait at all, but
it costs D0005's telemetry and doubles the work on the worker path.

**Operator (2026-10-09): A.** Plain pass-through: the probe uses Node's default resolver, has no
added time limit, and never rethrows. On any error that does not trigger the fallback, the original
`+srv` string goes to the driver, which reports its own error exactly as today. Recorded as D0017.
The cost is accepted: with dead DNS, the probe adds one default-resolver timeout (about 27 s
measured) before the driver's own failure. It is visible as `nodeProbeDurationMs` on
`path=nodeErrorPassthrough` events, which is the data that would justify revisiting D later.

### Q3: Should a cached client on the fallback path be recreated so it follows failover?

A client created from the rewritten `mongodb://` string does not poll SRV, so it does not follow
`.global.` failover.

| Option                                                                                                                       | Pros                                                                                                                                                                         | Cons                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Defer** (proposed)                                                                                                      | Smallest increment. Same behavior as any user with a plain `mongodb://` string today. Telemetry (`path=fallback` count) tells us whether the affected group is large enough to justify the work. | After a failover, affected users see a dead connection until they refresh the connection or reload the window.                                                                                                           |
| **B. Recreate on reconnect** in `getClient` when the last resolution was `fallback` and the client is not connected          | Picks up new targets the next time the user acts. Small change, in one place.                                                                                               | `getClient` today calls `connect()`, which does nothing when already connected. Telling "disconnected" from "connected" reliably is subtle. `llmEnhancedFeatureApis` and `QueryInsightsApis` hold the old client and must be rebuilt. |
| **C. Our own SRV poller** for fallback clients: re-resolve periodically (TTL-based); on change, evict the cached client        | Closest to the driver's behavior.                                                                                                                                            | Background DNS traffic, timers, lifecycle and error handling with no user present. The largest change of the four.                                                                                                       |
| **D. Evict on topology loss:** listen for `topologyDescriptionChanged` / heartbeat failures with no servers available, then evict | Reacts only when it matters. No background polling.                                                                                                                          | Event wiring is fiddly. A short network blip can cause an unnecessary eviction.                                                                                                                                         |

**Recommendation:** A in this increment. Decide between B and D as a follow-up once telemetry
shows how many fallback users there are.

**Operator (2026-10-09): A.** Write the options up as future work, and include visibility of the
servers behind a connection and a way to reconnect or refresh, which the extension still lacks.
Recorded as D0013; see [future-work.md](../../future-work.md) FW-1 and FW-2.

### Q4: What log level should the "fallback applied" line use?

| Option                                                        | Pros                                                                     | Cons                                                                                                                       |
| ------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| **A. `info`** (proposed)                                      | Visible at the default log level; support can find it. Not alarming.     | Easy to overlook. Printed on every connection for affected users.                                                         |
| **B. `warn`**                                                 | Signals an unusual network condition. Highlighted in the output channel. | Affected users can do nothing about it, yet see a warning on every connection; this may trigger support requests.      |
| **C. `warn` once per window per host, `info` afterwards**     | Visible once, then quiet.                                                | Needs a small in-memory set. This only dedupes log lines and does not cache resolution, so D0001 still holds.             |

**Recommendation:** A. C is a reasonable refinement if support says the line is being missed.

**Operator (2026-10-09): `trace` is enough; the output is only for support, and users don't need
it.** None of the proposed options. Recorded as D0014; the trace table in WI-4 is updated.

### Q5: How should the fix ship?

**Fact checked 2026-10-09:** this branch sits on tag `v0.11.0`. Since that tag, `origin/main` has
only dependency bumps and pipeline changes (#983, #984, #985, #987, #988, #989), with no features.
Two of those bumps, `undici` 7.30.0 (#987) and `browserslist` 4.29.3 (#989), re-introduce
dependencies that #986 reverted on `v0.11.0` as too fresh. Release from `main` only after rerunning
the `flagging-fresh-dependencies` check.

| Option                                                                       | Pros                                                                                                                         | Cons                                                                                                                                         |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Patch from `main`** (`0.11.1`)                                          | No backport work. Normal release process. `main` currently carries no features, so the patch scope stays small.              | Ships the dependency bumps listed above, including two that #986 reverted on `v0.11.0`. They must be re-vetted.                              |
| **B. `release/0.11.1` backport** from `v0.11.0` (`backport` skill)           | Ships exactly the fix plus `dns-packet` on top of the vetted `v0.11.0` lockfile. Lowest risk.                                | Cherry-picking takes work, and the `dns-packet` lockfile entry has to be recreated on the release branch. Two branches to verify.            |
| **C. Next minor release**                                                    | No extra release.                                                                                                            | Affected users stay broken until then. They upgraded to an affected VS Code without any choice.                                              |

**Recommendation:** A if the freshness check passes for every dependency on `main`; otherwise B.
The milestone is `0.11.1` either way. This branch is cut from `v0.11.0`, so it can feed either
option.

**Operator (2026-10-09): ship on top of tag `v0.11.0`.** `v0.11.1` is `v0.11.0` plus this fix, and
nothing else. Once it ships, the fix is also merged into `main`, where 1.0 is being prepared and is
about a week from release. This is CONTRIBUTING §1.3's normal patch flow, not a backport, and no
cherry-picking is needed because this branch already starts at the tag. Recorded as D0015,
including the four release steps the operator confirmed afterwards.

### Q6: Should `ECONNREFUSED` trigger the fallback?

| Option                                                                                                       | Pros                                                                                                                                                                                                          | Cons                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Measure only** (D0006, proposed)                                                                        | No extra attempt when the server list is wrong (the c-ares 1.34.6 bug, where the fallback would ask `127.0.0.1` too). Clean telemetry: `fallbackOutcome` only covers the reply-parsing case. | Any `ECONNREFUSED` that is *not* the 1.34.6 bug, where our UDP/TCP client would succeed, goes unfixed and unnoticed.                                      |
| **B. Include it**                                                                                            | Covers unknown socket-level differences between c-ares and our client. Refusals fail fast (ICMP port unreachable), so a useless attempt costs little. Telemetry measures directly whether the fallback helps. | Mixes two root causes under `path=fallback`; dashboards must split them by `nodeErrorCode`. Slightly longer failure in the 1.34.6 case.                    |
| **C. Include it unless the server list looks like the 1.34.6 bug** (only loopback servers on Windows)         | Targets the attempt where it can help.                                                                                                                                                                       | A heuristic; a real local DNS stub on Windows would be misclassified.                                                                                    |

**Recommendation:** B. I had proposed A in D0006, but a refusal fails within milliseconds, so an
extra attempt is cheap and the telemetry shows whether the fallback helps. If accepted, mark D0006
`Superseded` and add a new decision.

**Operator (2026-10-09): B.** Recorded as D0012; D0006 is superseded.

### Q7: What timeout budget should the fallback use?

Note: the fallback only runs after Node.js received a reply and rejected it. The DNS server is
therefore known to be answering, so timeouts matter mainly for the second and later servers and
for TCP.

| Option                                                                                                                             | Pros                                                                                                                       | Cons                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **A. 2 s per UDP attempt, 5 s per TCP attempt, overall cap `min(10 s, connection timeout)`, servers asked in order** (proposed)     | Bounded and predictable. Keeps the server order, so split DNS works (a VPN server listed first stays first).               | With several unresponsive servers, up to 10 s passes before the driver even starts.                                         |
| **B. Mirror Node's resolver defaults** (c-ares timeout and tries)                                                                  | Same failure timing users already see.                                                                                     | Longer worst case. The c-ares defaults are not exposed through Node.js, so we would hardcode guesses.                          |
| **C. Query all servers in parallel; first valid answer wins**                                                                      | Fastest success.                                                                                                           | Breaks server order. With split DNS, a public server's `NXDOMAIN` can beat the VPN server's correct answer. More traffic.  |
| **D. Scale with the connection-timeout setting** (for example one third of it)                                                     | Respects the user's setting.                                                                                               | Less predictable. A small setting can leave too little time for TCP.                                                        |

**Recommendation:** A, keeping the server order. All values stay constants in one place, so they
can be tuned from `fallbackDurationMs` telemetry.

**Operator (2026-10-09): A, with longer limits for really slow networks.** Values chosen: 5 s per
UDP attempt, 10 s per TCP attempt, overall cap `min(20 s, documentDB.connectionTimeout)`. Recorded
as D0016 with the reasoning (a default Node.js `ETIMEOUT` measured at 27 s, so the cap stays below
it). WI-3 is updated.

### Q8: How does DNS preparation relate to the shell and playground connection timeout?

Raised by the design review (R4). `WorkerSessionManager` starts its init timer
(`documentDB.connectionTimeout`, default 30 s) when it posts `init`. Preparation now runs on the
host **before** that, so it is not counted. This is separate from D0017 (unbounded probe), which
stays as decided.

What the timer covers today: the worker's driver resolves SRV inside `connect()`, so today the
timer **includes** SRV DNS. With this plan, the Node.js path still does that (the driver
re-resolves in the worker, inside the timer), plus the probe outside it. The fallback path hands
the worker a `mongodb://` string, so its DNS happens entirely outside the timer. Also note: the
driver's own SRV lookup in `MongoClient._connect()` runs before server selection, so
`serverSelectionTimeoutMS` never counts DNS either.

| Option                                                                                                        | Pros                                                                                                                                                                         | Cons                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Separate budgets:** preparation first (probe per D0017, fallback ≤ D0016 deadline), then the full init timeout | Every connection gets the same budget for connect, TLS, auth and token acquisition, whether or not it needed the fallback. Matches the driver, which does not count DNS against server selection. Simple. | The setting no longer bounds the whole startup: an affected user can wait up to the D0016 deadline (≤ 20 s) longer, and a dead DNS server adds the probe's timeout (D0017). |
| **B. One budget:** init timeout = `connectionTimeout − preparation time`                                         | The setting bounds the whole startup, as a user would expect from its name.                                                                                                  | With the unbounded probe (D0017), a slow probe can leave almost nothing for init, causing spurious timeouts. A slow fallback (say 15 s of 30 s) leaves too little for Entra ID token acquisition and TLS. |
| **C. One budget with a floor:** init gets `max(connectionTimeout − preparation time, floor)`, for example 10 s       | Mostly bounded, without starving init.                                                                                                                                       | Still not a hard bound. One more constant to explain and test.                                                                                                                            |

**Recommendation:** A, documented in WI-8 ("the connection timeout starts after DNS resolution"),
with `srvResolutionDurationMs` on `worker.startup` showing how much time preparation really takes.
B and C fight the operator's choice in D0017, because an unbounded probe cannot share a fixed budget.

**Operator (2026-10-09): A, separate budgets.** Recorded as D0018. WI-6 and WI-8 are updated.

---

# Outcome

_Not yet written. At hand-over: what was verified (automated and manual, with runtime and c-ares
versions), what was not, and the Case 2 checks that ran._
