---
feature: srv-dns-fallback
kind: plan
status: active
created: 2026-10-09
code:
    - src/documentdb/ClustersClient.ts
    - src/documentdb/playground/WorkerSessionManager.ts
    - src/documentdb/playground/playgroundWorker.ts
---

# Increment 1: in-memory SRV fallback for `mongodb+srv://` (#993)

The problem, root cause and rejected alternatives are in issue #993 and in
[../README.md](../README.md). This document is the development plan. Progress is recorded
**inline, against each work item**, when that item is committed.

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
- `QuickStartService` and `connectToClient` (D0007).

## Shape

```
configureAuth()  ──►  prepareDriverConnectionString({ connectionString, options, surface, correlation, signal })
                         │
                         ├─ not mongodb+srv://                       → return as-is, no event
                         ├─ driver parse check (new MongoClient(), never connected)
                         ├─ Node probe: dns.promises.resolveSrv(_<svc>._tcp.<host>)
                         │     ├─ ok                                  → return ORIGINAL +srv string   (path=node)
                         │     ├─ EBADRESP / EFORMERR / ECONNREFUSED (or forced) → fallback ▼
                         │     └─ other error                         → return ORIGINAL +srv string   (path=nodeErrorPassthrough)
                         └─ fallback
                               ├─ SRV via dns-packet: system servers in order, UDP → TCP on TC
                               ├─ TXT via Node; dns-packet if Node returns an eligible error
                               ├─ apply driver semantics (D0004), rewrite to mongodb://h1:p1,h2:p2/…
                               └─ return REWRITTEN string                                         (path=fallback)
                                  on failure: rethrow the ORIGINAL Node probe error, unchanged
   ──►  new MongoClient(prepared.connectionString, options)
```

Rethrowing the **original** Node error when the fallback fails keeps the error that users,
`parseError`, telemetry and `ConnectionDiagnosticsService` see the same as today. This follows
error-translation's "never touch the error" rule. The fallback's own failure goes to the output
channel and the telemetry event.

### Proposed module layout

```
src/documentdb/srv/
├── prepareDriverConnectionString.ts   # orchestrator, the only export call sites use
├── srvUriRewrite.ts                   # pure: (original, options, srv, txt) → mongodb:// string
├── fallbackDnsClient.ts               # dns-packet over UDP/TCP against dns.getServers()
├── srvResolutionTelemetry.ts          # event emission, DNS-server classification, compression probe
└── *.test.ts
```

When this folder exists, add `src/documentdb/srv/**` to the `code` frontmatter here and in the
feature README.

---

## WI-1: Add the `dns-packet` dependency

- Add `dns-packet@^5.6.1` (MIT; its one runtime dependency is `@leichtgewicht/ip-codec`) and
  `@types/dns-packet` as a dev dependency.
- Run the `flagging-fresh-dependencies` skill on the resulting lockfile change. 5.6.1 was published
  on 2023-08-25; check the transitive dependency as well.
- Check that webpack bundles it into `dist/extension.js` and **not** into `playgroundWorker.js`
  (D0008).
- Check whether `NOTICE.html` is generated or maintained by hand. If by hand, add both packages.

**Acceptance:** `npm run build` passes; the worker bundle size is unchanged.

---

## WI-2: Pure URI rewrite (`srvUriRewrite.ts`)

Input: the original `+srv` string (after `configureAuth`, so it may contain credentials), the
`MongoClientOptions`, the SRV records, and the TXT records (or none). Output: a `mongodb://` string.
No I/O.

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
| TXT `loadBalanced=true` → `loadBalanced=true`                                                     | (driver validates single host itself)                         |
| `srvServiceName` picks the SRV name; remove it from the URI                                       | —                                                             |
| `srvMaxHosts > 0` → shuffle, keep N; remove it from the URI                                       | —                                                             |
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
`new MongoClient(rewritten, options).options`. Assert that `hosts`, `tls`, `replicaSet`,
`loadBalanced`, `credentials.source` and the error class and message are equal. This catches drift
when the driver is upgraded.

Fixtures: credentials with special characters; `appName=@x@`; a user `authSource`;
OIDC with TXT `authSource` (must be dropped); a user `replicaSet`; `loadBalanced` with one or two
targets; `srvMaxHosts=1`; `srvServiceName=custom`; `ssl=false` set explicitly; targets with
trailing dots; a two-label parent domain; a parent-domain mismatch; multiple TXT records; an empty
TXT value; an invalid TXT key; a `/db` path and no path.

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
- **Response codes.** `NOERROR` with SRV answers succeeds. `NOERROR` without answers is `ENODATA`.
  `NXDOMAIN` is `ENOTFOUND` (authoritative, so do not try the next server). `SERVFAIL` and `REFUSED`
  move on to the next server. A timeout moves on to the next server.
- **Timeouts (D0016).** 5 s per UDP attempt, 10 s per TCP attempt, and an overall cap of
  `min(20 s, documentDB.connectionTimeout)`. Servers are asked in order, never in parallel. All
  values are constants in one place.
- **Abort.** An `AbortSignal` closes any open socket and rejects with `UserCancelledError`.
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
parsing.

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
    readonly srvResolution: SrvResolutionPath;
}

export async function prepareDriverConnectionString(
    input: PrepareDriverConnectionStringInput,
): Promise<PreparedDriverConnectionString>;
```

Steps:

1. If the string does not start with `mongodb+srv://` (case-insensitive), return it unchanged with
   no log and no event.
2. Construct, but never connect, `new MongoClient(original, options)` so that the driver raises its
   own parse errors first (`directConnection`, a port on an SRV host, multiple hosts, …). Discard
   the instance.
3. Probe with `dns.promises.resolveSrv('_<srvServiceName ?? "mongodb">._tcp.<host>')` (D0005).
   - On success, return the original string (`path=node`).
   - On `EBADRESP`, `EFORMERR` or `ECONNREFUSED` (D0012), or when the force switch is on (D0010),
     run the fallback, unless the off switch is set (D0011). With the off switch set, return the
     original string with `fallbackOutcome=disabled`.
   - On any other error, return the original string (`path=nodeErrorPassthrough`) and let the driver
     report its own error. The probe uses Node's default resolver with no extra time limit, and
     never rethrows (D0017).
4. Fallback: resolve SRV with WI-3, resolve TXT with Node (or WI-3 on an eligible Node error), then
   rewrite with WI-2. Return the result as `path=fallback`. If anything fails, log it and rethrow
   the **original probe error**. Rewrite validation errors (WI-2) are thrown as they are, because
   the driver would have thrown the same ones.
5. No caching of any kind. Every call queries DNS (D0001).

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
| `trace` | TXT                                     | `… TXT source=node keys=[authSource,replicaSet] replicaSet=globaldb authSource=<set>`                                                                                    |
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
| `txtSource`                                                   | prop  | `node` · `fallback` · `none`                                                   |                                               |
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
Assert that `notSrv` emits no event.

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
await this.connect(startup, prepared.connectionString, options, credentials.emulatorConfiguration, abortSignal);
```

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

---

## WI-6: Wire `WorkerSessionManager` (interactive shell and query playground)

In `initializeWorker`, before `new Worker(...)` so that no worker is spawned when resolution fails,
and inside the open `worker.startup` telemetry context:

- Call `prepareDriverConnectionString` with `surface` set to `shell` or `playground` (from
  `initMsg.persistent`), the startup and session correlation IDs, and the options. For
  `authMechanism` set to `MicrosoftEntraID` or `ManagedIdentity`, pass
  `options.authMechanism = 'MONGODB-OIDC'` so the `$external` rule applies (the worker sets this
  itself today).
- Post `{ ...initMsg, connectionString: prepared.connectionString, oidcAllowedHosts }`, where
  `oidcAllowedHosts = getOidcAllowedHosts(initMsg.connectionString)` is computed from the
  **original**. Do not modify the caller's `initMsg` (D0008).
- `workerTypes.ts`: add `readonly oidcAllowedHosts?: readonly string[]` to the `init` message.
- `playgroundWorker.ts`: use `msg.oidcAllowedHosts ?? getOidcAllowedHosts(msg.connectionString)`.
- Set `srvResolution` and `srvResolutionDurationMs` on `worker.startup`.
- `ShellSessionManager.extractHosts(initMsg.connectionString)` and the shell banner keep the
  original. Check that neither reads the rewritten copy.

**Tests:** `WorkerSessionManager` posts the rewritten string with `oidcAllowedHosts` derived from the
original, and the caller's object is unchanged. The worker prefers `oidcAllowedHosts`.

---

## WI-7: Actionable error when the fallback cannot help (`ConnectionDiagnosticsService`)

Follow `.github/skills/error-translation/SKILL.md`: the provider translates, never shows UI, and
never touches the error.

- Add `SrvDnsDiagnosticsProvider` (`id: 'srv-dns'`). As the cheap check first, match
  `/querySrv (EBADRESP|EFORMERR|ECONNREFUSED)/` on the message or `error.code`, then return localized
  text. For `EBADRESP` and `EFORMERR` (fallback also failed): "The DNS server rejected or mangled the
  SRV lookup and the built-in fallback could not resolve it either. Use a non-SRV `mongodb://`
  connection string or a different DNS server." For `ECONNREFUSED` (the fallback also ran and was
  refused, D0012): "No DNS server accepted the SRV lookup, from VS Code's resolver or from the
  built-in fallback…". Both link to the user-manual page from WI-8. The text does not depend on
  whether the fallback was disabled (D0011); the provider only sees the error.
- Register it in `ClustersExtension.registerDiscoveryServices`.
- Add a `Links` constant for the documentation page.

**Tests:** provider unit tests for each code, plus `undefined` for unrelated errors and for
`UserCancelledError`.

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
- Run `npm run l10n` for the new strings in WI-4 and WI-7 (Case 2 only).
- Add a `0.11.1` release-notes entry through the `writing-release-notes` skill (D0015).
- Update the feature README: code map, the `code` frontmatter, the timeline, and the decision status
  changes.

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
4. **Nothing persisted.** After a fallback connection, "Copy Connection String", "Update Connection
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
| Stale targets on a long-lived cached client (fallback path only) | Accepted for this increment (D0013); [future-work.md](../future-work.md) FW-1 and FW-2 |
| Credential leak through logs or telemetry                | Never log URIs; a log-spy test; `maskEntireErrorMessage`; no host or IP in properties       |
| Fallback slower than the driver's own failure            | Overall timeout cap within the connection timeout (Q7)                                      |
| With dead DNS, the probe adds about 27 s before the driver fails (D0017) | Accepted; measured as `nodeProbeDurationMs` on `path=nodeErrorPassthrough`; bounded probe (Q2 D) is the known remedy |

## Open questions for the operator

Each question lists the options considered, their pros and cons, and a recommendation. Record the
operator's choice in [decisions.md](../decisions.md) once made, and keep the rejected options there
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
Recorded as D0013; see [future-work.md](../future-work.md) FW-1 and FW-2.

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

---

# Outcome

_Not yet written. At hand-over: what was verified (automated and manual, with runtime and c-ares
versions), what was not, and the Case 2 checks that ran._
