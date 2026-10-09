---
feature: srv-dns-fallback
kind: decisions
status: active
created: 2026-10-09
---

# SRV DNS fallback: decisions

> Why the `mongodb+srv://` workaround for the c-ares SRV parsing regression has this shape, and
> which alternatives were rejected.

| #    | Decision                                                            | Status   | Changed from the proposal? | Date       | PR  |
| ---- | ------------------------------------------------------------------- | -------- | -------------------------- | ---------- | --- |
| 0001 | The resolved `mongodb://` string is transient and never persisted   | Accepted | Operator position (#993)   | 2026-10-09 | —   |
| 0002 | The fallback queries the same system DNS servers, nothing else      | Accepted | Operator position (#993)   | 2026-10-09 | —   |
| 0003 | Use `dns-packet` in-process, not a native addon or system tools     | Accepted | Operator position (#993)   | 2026-10-09 | —   |
| 0004 | The rewrite mirrors the driver's SRV semantics exactly              | Accepted | Operator position (#993)   | 2026-10-09 | —   |
| 0005 | Probe with Node's resolver first; fall back only on a broken reply  | Accepted | Operator accepted 2026-10-09 | 2026-10-09 | —   |
| 0006 | Fallback-eligible codes are `EBADRESP` and `EFORMERR` only          | Superseded by D0012 | Operator chose Q6 option B | 2026-10-09 | —   |
| 0007 | Two call sites: `ClustersClient` and `WorkerSessionManager`         | Accepted (modified) | Accepted; `connectToClient` also deprecated | 2026-10-09 | —   |
| 0008 | Shell and playground resolve on the host, not in the worker         | Accepted | Operator accepted 2026-10-09 | 2026-10-09 | —   |
| 0009 | One `connect.srvResolution` event per `+srv` connection             | Accepted | Operator accepted 2026-10-09 | 2026-10-09 | —   |
| 0010 | A development-only switch forces the fallback path                  | Accepted | Operator accepted 2026-10-09 | 2026-10-09 | —   |
| 0011 | No user setting; an environment variable turns the fallback off, and it is documented | Accepted | Operator chose Q1 A + D, and asked for user docs | 2026-10-09 | —   |
| 0012 | `ECONNREFUSED` also triggers the fallback                           | Accepted | Operator chose Q6 option B; supersedes D0006 | 2026-10-09 | —   |
| 0013 | Cached fallback clients are not refreshed in this increment          | Accepted | Operator chose Q3 A; options moved to future work | 2026-10-09 | —   |
| 0014 | All SRV resolution output is at `trace` level                        | Accepted (modified) | Proposal was one `info` line; operator: trace only | 2026-10-09 | —   |
| 0015 | Ship as `v0.11.1` from `release/0.11.1`, cut at `v0.11.0`, then forward-merge | Accepted | Operator decision (Q5)     | 2026-10-09 | —   |
| 0016 | Longer fallback timeouts for slow networks                           | Accepted (modified) | Q7 option A, with longer values (operator) | 2026-10-09 | —   |
| 0017 | The probe passes every error that skips the fallback to the driver, with no extra time limit | Accepted | Operator chose Q2 A over the recommended D | 2026-10-09 | —   |
| 0018 | DNS preparation and the shell and playground init timeout have separate budgets | Accepted | Operator chose Q8 A, as recommended | 2026-10-09 | —   |
| 0019 | The UI shows whether the fallback was used: the tooltip now, the dashboard later | Accepted | Operator requirement     | 2026-10-09 | —   |
| 0020 | The VS Code-independent logic lives in a workspace package, published at the operator's discretion | Accepted | Operator chose "workspace package now" | 2026-10-09 | —   |

> Entries below are **semantically** immutable: append new entries rather than rewriting old ones,
> and record reversals as a new entry plus a status change above. Heading text is frozen once
> written; a retitle means a new decision.

**Status vocabulary:** `Proposed` · `Open` · `Accepted` · `Accepted (modified)` · `Deferred` ·
`Superseded by D#` · `Rejected`

---

## 0001 — The resolved `mongodb://` string is transient and never persisted

**Status:** Accepted · **Date:** 2026-10-09 · **Raised by:** operator, issue #993

### Decision

The fallback rewrites the URI in memory, at client-creation time, on **every** new connection.
The result is handed to the driver only. It is never written to connection storage, secret
storage, settings, tree or cluster models, or `CredentialCache`. "Copy Connection String",
"Update Connection String…", export, the connection UI and telemetry domain metadata keep using the
persisted `+srv` string.

### Why

The SRV records have a 30-second TTL. Failover and replica promotion change the targets, and
following them is the whole point of the `.global.` endpoints. A persisted host list would go stale
silently, and the user would lose the `+srv` string they entered.

---

## 0002 — The fallback queries the same system DNS servers, nothing else

**Status:** Accepted · **Date:** 2026-10-09 · **Raised by:** operator, issue #993

### Decision

The fallback asks the servers returned by `dns.getServers()`, in order. It never adds public
resolvers and never uses DNS over HTTPS.

### Rejected alternatives

- **Force public DNS** (`setServers(['1.1.1.1'])`). This breaks private endpoints, VPN and
  corporate split DNS, and sends customers' hostnames to a third party.
- **DNS over HTTPS** (`tangerine`). It has the same privacy and private-DNS problems, plus a large
  dependency tree.

---

## 0003 — Use `dns-packet` in-process, not a native addon or system tools

**Status:** Accepted · **Date:** 2026-10-09 · **Raised by:** operator, issue #993

### Decision

Encode and decode DNS messages with `dns-packet` (pure JavaScript, MIT, one small dependency). The
operator verified that it decodes the compressed-target reply that c-ares 1.34.8 rejects.

### Rejected alternatives

- **`os-dns-native`.** This N-API addon gives the best results, but it ships no prebuilt binaries,
  so we would need per-platform VSIXs. That is too much packaging risk for a patch. It may be
  revisited later as a first try ahead of `dns-packet`.
- **Windows-only `Resolve-DnsName`.** It does not cover macOS or Linux, and it means spawning
  PowerShell.
- **`nslookup`, `dig` or `host`.** Parsing their output is fragile, and the tools are not always
  installed.
- **Retrying Node's lookup, or tuning the c-ares query.** The reply parser is the problem, not the
  query; Node.js exposes no option that changes it.
- **Waiting for upstream, or documenting the workaround only.** The upstream fix PR was closed,
  and a hardcoded host list does not follow failover.

---

## 0004 — The rewrite mirrors the driver's SRV semantics exactly

**Status:** Accepted · **Date:** 2026-10-09 · **Raised by:** operator, issue #993

### Decision

The fallback output must connect exactly as the driver's own `resolveSRVRecord` would:

- every target passes `checkParentDomainMatch`;
- TXT may set only `authSource`, `replicaSet` and `loadBalanced`, and the rewrite errors on
  multiple TXT records or empty values;
- `tls=true` is added unless the user set `tls` or `ssl`;
- `srvServiceName` and `srvMaxHosts` are honored during resolution, then removed from the URI;
- a TXT `authSource` is dropped when the user set one, or when the mechanism authenticates against
  `$external` (OIDC, X.509, AWS, GSSAPI);
- a TXT `replicaSet` is dropped when the user set one.

The driver code this mirrors is `lib/connection_string.js` (`resolveSRVRecord`) and
`lib/utils.js` (`checkParentDomainMatch`) in `mongodb` 7.2.0.

### Why

The rewrite changes the URI scheme under the driver's feet. Any divergence becomes a connection
that behaves differently only on the networks that need the fallback, which is the hardest place
to diagnose it.

---

## 0005 — Probe with Node's resolver first; fall back only on a broken reply

**Status:** Accepted (operator, 2026-10-09; was Proposed) · **Date:** 2026-10-09 · **Raised by:** planning

### Question

When do we decide to use the fallback?

### Options considered

1. **Probe first.** Before creating the client, call `dns.promises.resolveSrv()` ourselves. On
   success, hand the **original** `+srv` string to the driver. On an eligible error, run the
   fallback and hand over the rewritten string.
2. **Reactive retry.** Let the driver fail, catch `querySrv EBADRESP`, then rewrite and create a
   second client.
3. **Always resolve ourselves.** Always use the rewritten string.
4. **Monkey-patch `dns.promises.resolve`** so the driver gets the fallback transparently.

### Decision (proposed)

Option 1.

### Why

- Unaffected users keep the exact behavior they have today, including the driver's SRV polling.
- Option 1 is a single pre-step at each site. Option 2 duplicates client creation and abort
  handling in three places (`ClustersClient.connect`, the cached-reconnect path, and the worker).
- Option 1 produces one telemetry event per `+srv` connection, which measures the blast radius
  against **all** SRV connections, not only failing ones.
- Option 3 changes behavior for every SRV user and drops SRV polling for all of them.
- Option 4 patches a module shared by every extension in the extension host. Rejected outright.

### Consequences

- Every `+srv` connection makes one extra SRV query (TXT is not probed; its RDATA has no names).
  The cost is measured as `nodeProbeDurationMs`.
- On a **non-eligible** probe error (`ENOTFOUND`, `ETIMEOUT`, …), the original string is passed
  through and the driver reports its usual error. That means a failing lookup can wait twice. See
  the plan, open question Q2.

---

## 0006 — Fallback-eligible codes are `EBADRESP` and `EFORMERR` only

**Status:** Superseded by D0012 · **Date:** 2026-10-09 · **Raised by:** planning

> **Superseded (2026-10-09).** Plan question Q6 reopened this entry, and the operator chose to
> include `ECONNREFUSED` (D0012). The options are in
> [iterations/01-srv-fallback/plan.md, Q6](./iterations/01-srv-fallback/plan.md#q6-should-econnrefused-trigger-the-fallback).
> The original proposal is kept below as written.

### Decision (proposed)

Only `EBADRESP` and `EFORMERR` trigger the fallback. `ECONNREFUSED` does not.

### Why

`ECONNREFUSED` on SRV comes from c-ares 1.34.6 reporting `127.0.0.1` as the DNS server. The
fallback uses the same `dns.getServers()` list and would be refused as well, so it would only add
latency. The telemetry event still records `nodeErrorCode` for every non-eligible failure, so the
size of that known gap is measured and can justify `os-dns-native` later.

---

## 0007 — Two call sites: `ClustersClient` and `WorkerSessionManager`

**Status:** Accepted (modified) (operator, 2026-10-09; was Proposed) · **Date:** 2026-10-09 · **Raised by:** planning

### Decision (proposed)

Route `ClustersClient` (tree, webviews, commands) and `WorkerSessionManager` (interactive shell and
query playground share one worker) through the helper. Leave out the other two `MongoClient` sites
that issue #993 lists.

### Why the other two are left out

- **`QuickStartService.waitForReadiness`** builds its own `mongodb://127.0.0.1:<port>` string. It
  can never be `+srv`.
- **`connectToClient`** is reachable only from `parseMongoConnectionString`, which has no callers
  in `src/` (checked 2026-10-09). Wiring dead code adds test surface for no user benefit. Removing
  it is a separate change.

### Operator modification (2026-10-09)

Accepted, with one addition: `connectToClient` is marked `@deprecated` with a JSDoc comment saying
it is unused, is not wired to the fallback, and will be removed in a future release. The comment
was added during planning (`src/documentdb/connectToClient.ts`). The removal itself, together with
the unused `parseMongoConnectionString`, is left for a later release and is not part of
`v0.11.1`.

---

## 0008 — Shell and playground resolve on the host, not in the worker

**Status:** Accepted (operator, 2026-10-09; was Proposed) · **Date:** 2026-10-09 · **Raised by:** planning

### Decision (proposed)

`WorkerSessionManager` resolves before it posts the `init` message, and sends a **copy** of the
message carrying the driver string. The caller's `initMsg` keeps the original. The host also
computes the OIDC `ALLOWED_HOSTS` from the original string and passes it in the message. The worker
stops deriving it from `msg.connectionString`.

### Why

- The host has `ext.outputChannel` and the open `worker.startup` telemetry context. The worker has
  neither; it only relays logs.
- The `dns-packet` code stays in the extension bundle and out of the worker bundle.
- The worker is spawned per session, so the string is still re-resolved on every connection.
- Because of the parent-domain check, the allowed hosts derived from the rewritten string would be
  identical. Passing them explicitly removes the need to rely on that argument for a security
  control.

### Rejected alternative

**Resolving inside the worker.** Logging and telemetry would need new worker-to-main message types,
and the worker bundle would grow.

---

## 0009 — One `connect.srvResolution` event per `+srv` connection

**Status:** Accepted (operator, 2026-10-09; was Proposed) · **Date:** 2026-10-09 · **Raised by:** operator request (blast radius and
"when the solution is applied"), shaped in planning

### Decision (proposed)

The helper emits `connect.srvResolution` for every `mongodb+srv://` connection, from every surface,
and no event for plain `mongodb://` connections. A short `srvResolution` summary is also copied
onto the enclosing `connect.startup` or `worker.startup` event. The event carries no hostnames, IP
addresses or connection strings, and its error message is fully masked. The event schema is in the
plan.

### Why

- A dedicated event emitted by the helper covers every surface without per-site instrumentation.
- Emitting it for every SRV connection, not only fallbacks, gives the denominator. "X % of SRV
  connections on c-ares 1.34.8 needed the fallback" is the blast radius.
- `process.versions.ares` on the event ties the affected population to VS Code and Node.js
  releases, and shows when an upstream fix arrives.
- Node's DNS error messages contain the queried hostname (`querySrv EBADRESP _mongodb._tcp.<host>`),
  so error text must not reach telemetry.

---

## 0010 — A development-only switch forces the fallback path

**Status:** Accepted (operator, 2026-10-09; was Proposed) · **Date:** 2026-10-09 · **Raised by:** planning, from the request for local
debugging

### Decision (proposed)

When the environment variable `DOCUMENTDB_DEBUG_FORCE_SRV_FALLBACK=1` is set, the helper skips
Node's resolver and treats the probe as `EBADRESP`. Developers set it in `launch.json`. Events
emitted with the switch on carry `forcedFallback = 'true'`, so dashboards can exclude them.

### Why

The bug only reproduces behind a compressing forwarder. Without a switch, the fallback can only be
exercised end to end with a hand-built DNS stub. The switch lets anyone run the real fallback
against a real cluster from the F5 debug host.

### Rejected alternative

**A hidden user setting.** Settings are discoverable, synced, and need the settings-editor
treatment from the `settings` feature. An environment variable is invisible to end users and does
not reach a VSIX install by accident.

---

## 0011 — No user setting; an environment variable turns the fallback off, and it is documented

**Status:** Accepted · **Date:** 2026-10-09 · **Raised by:** plan Q1; operator chose A + D

### Decision

There is no user setting. Setting `DOCUMENTDB_DISABLE_SRV_FALLBACK=1` in the extension host's
environment turns the fallback off: the probe still runs and the event is still emitted, with
`fallbackOutcome = 'disabled'`, but the driver always gets the original string. The switch is
documented in the user manual's SRV troubleshooting page (plan WI-8), next to the D0010 force
switch.

### Why

The fallback only runs where the connection would otherwise fail, so a visible setting would almost
never be used and would still need the settings-editor review. An environment variable gives
support an escape hatch at almost no cost. Documenting it means support can point to it instead of
explaining it again each time.

### Rejected alternatives

- **User setting** (Q1 B): discoverable and synced; needs settings review; almost never used.
- **Remote flag** (Q1 C): only worth it if the extension already uses an experimentation service.

---

## 0012 — `ECONNREFUSED` also triggers the fallback

**Status:** Accepted · **Date:** 2026-10-09 · **Raised by:** plan Q6; operator chose B; supersedes
D0006

### Decision

Fallback-eligible probe errors are `EBADRESP`, `EFORMERR` and `ECONNREFUSED`.

### Why

A refused query fails within milliseconds, so a useless fallback attempt (the c-ares 1.34.6
`127.0.0.1` case) costs almost nothing. Any refusal that comes from a difference between c-ares and
our socket client gets fixed instead of going unnoticed. Telemetry separates the two root causes
by `nodeErrorCode`, and `fallbackOutcome` shows whether the fallback helps for `ECONNREFUSED`.

### Rejected alternatives

- **Measure only** (D0006, Q6 A): leaves any fixable refusal unfixed and unnoticed.
- **Heuristic on the server list** (Q6 C): would misclassify a real local DNS stub on Windows.

---

## 0013 — Cached fallback clients are not refreshed in this increment

**Status:** Accepted · **Date:** 2026-10-09 · **Raised by:** plan Q3; operator chose A

### Decision

A client created from the rewritten string keeps its host list until it is disposed. Recreating
it, polling SRV, and evicting it on topology loss (Q3 B, C, D) are recorded in
[future-work.md](./future-work.md). That note also covers the wider need the operator named:
showing the servers behind a connection, and letting the user reconnect or refresh it.

### Why

This keeps the patch small. Affected users get the same behavior as anyone who uses a plain
`mongodb://` string today. Telemetry (`path=fallback` counts) sizes the affected group before any
of the larger options is built.

---

## 0014 — All SRV resolution output is at `trace` level

**Status:** Accepted (modified) · **Date:** 2026-10-09 · **Raised by:** plan Q4; operator: "trace
is enough, it's only for support scenarios, users don't care"

### Decision

Every `[SrvResolution]` line, including "fallback applied" and "fallback failed", is written at
`trace`. Nothing appears at the default log level.

### Why

The output exists for support conversations, where the user is asked to set the log level to Trace
anyway. A failed connection already shows the user its own error; the fallback adds nothing they
can act on. Telemetry, not the log, is the signal at scale.

### Rejected alternatives

`info` (the original proposal), `warn`, and `warn` once per host (Q4 A to C).

---

## 0015 — Ship as `v0.11.1` from `release/0.11.1`, cut at `v0.11.0`, then forward-merge

**Status:** Accepted · **Date:** 2026-10-09 · **Raised by:** plan Q5; operator decision

### Decision

`v0.11.1` is `v0.11.0` plus this fix, and nothing else. The work branch
(`dev/tnaum/c-ares-workaround`) was cut at the `v0.11.0` commit (`5fd3fb89`), so there is nothing
to cherry-pick. A maintainer creates `release/0.11.1` from the `v0.11.0` tag, the PR targets that
branch, and `v0.11.1` is tagged and published from it. After that, the fix is forward-merged into
`main`, where 1.0 is being prepared, and the release branch is deleted. This is CONTRIBUTING §1.3's
normal patch flow; it is **not** a backport in the `backport` skill's sense, which covers moving a
fix already merged to `main` onto a release branch.

### Why

`main` carries work for the 1.0 release and dependency bumps that #986 had reverted as too fresh
(`undici` 7.30.0 in #987, `browserslist` 4.29.3 in #989). Shipping from the tag keeps the patch to
exactly the vetted `v0.11.0` lockfile plus `dns-packet`.

### Consequences

- **Release steps, confirmed by the operator (2026-10-09):**
  1. A maintainer creates `release/0.11.1` from the `v0.11.0` tag. The `backport` skill never
     creates release branches.
  2. Open the PR from `dev/tnaum/c-ares-workaround` into `release/0.11.1`. Nothing is
     cherry-picked: the branch already starts at `5fd3fb89`, the commit tagged `v0.11.0`.
  3. Tag `v0.11.1` on `release/0.11.1` and publish from that branch (CONTRIBUTING §7.9).
  4. Forward-merge the fix into `main` for 1.0, then delete `release/0.11.1`.
- The forward-merge into `main` will likely conflict in `package-lock.json` (and in
  `l10n/bundle.l10n.json` if strings changed). Regenerate both files (`npm install`,
  `npm run l10n`); do not hand-merge them.
- `origin/release/v0.11.0` exists and points at the same commit as the tag. Its name does not follow
  the `release/<X.Y.Z>` rule, so it is not reused; `release/0.11.1` is cut fresh.
  `origin/release/0.10.1` also still exists, although §1.3 says to delete a release branch after
  its release. Neither branch is touched by this work.

---

## 0016 — Longer fallback timeouts for slow networks

**Status:** Accepted (modified) · **Date:** 2026-10-09 · **Raised by:** plan Q7; operator chose A
"but push it a bit for UDP and TCP"

### Decision

Servers are queried in order (as in Q7 A), with:

| Constant                   | Proposed (Q7 A)          | Accepted                       |
| -------------------------- | ------------------------ | ------------------------------ |
| UDP, per attempt           | 2 s                      | **5 s**                        |
| TCP, per attempt           | 5 s                      | **10 s**                       |
| Overall cap                | `min(10 s, connectionTimeout)` | **`min(20 s, documentDB.connectionTimeout)`** |

The concrete values were chosen by the agent within the operator's direction. They stay constants
in one place, so they can be tuned from `fallbackDurationMs` telemetry.

### Why these values

- The fallback only runs after Node.js received a reply and rejected it, so the first server is
  known to answer. The longer limits cost time only on slow or lossy networks, which is where the
  operator wants the margin.
- On Node.js 22.21.1 (c-ares 1.34.5), one default-resolver `ETIMEOUT` against an unreachable server
  took **27 s** (measured 2026-10-09). A 20 s cap keeps the fallback below a single driver DNS
  timeout.
- `documentDB.connectionTimeout` (default 30 s) still bounds it, so a user who lowered the setting
  is respected.

### Rejected alternatives

Mirroring Node's defaults, parallel queries (breaks split DNS), and scaling with the setting
(Q7 B to D).

---

## 0017 — The probe passes every error that skips the fallback to the driver, with no extra time limit

**Status:** Accepted · **Date:** 2026-10-09 · **Raised by:** plan Q2; the operator chose A over the
agent's recommendation D

### Decision

The Node.js probe (D0005) uses the default `dns.promises` resolver with no added time limit. When it
fails with an error that does not trigger the fallback (anything other than `EBADRESP`, `EFORMERR`
or `ECONNREFUSED`, D0012), the original `+srv` string goes to the driver unchanged, and the driver
reports its own error. The probe never rethrows.

### Why

The driver stays the only source of every error the fallback does not handle. The error object,
its message, the startup stage it is recorded at (`stage04ConnectingAndAuthenticating`), and the
shell and playground error path (`new Error(msg.error)` relayed from the worker) all stay exactly as
they are today. Measured on Node.js 22.21.1 (plan Q2, Investigation): the errors that could be
rethrown early (`ENOTFOUND`, `ENODATA`) fail in 3–46 ms, so rethrowing them saves almost nothing.

### Rejected alternatives

- **B, rethrow every probe error.** It moves failures to an earlier telemetry stage, changes the
  error object on the worker path, and loses the driver's `ETIMEOUT` retry.
- **C, rethrow only errors where retrying cannot help.** It saves about 50 ms, with the same
  stage and error-object shifts as B. The operator was concerned it could make bad decisions, and
  the investigation confirmed it was not worth it.
- **D, a probe limited to 5 s** (the agent's recommendation). It would cut the worst-case extra wait
  with dead DNS from about 27 s to 5 s without changing any outcome. Not chosen for this
  increment; it is the known remedy if telemetry shows the wait matters.
- **E, no probe, retry after the driver fails.** It reopens D0005, loses the count of all SRV
  connections, and needs a second worker spawn on the shell and playground path.

### Consequences

With dead DNS, the probe adds one default-resolver timeout (about 27 s measured) before the
driver's own failure, which itself takes about 2 × 27 s. This is measured as `nodeProbeDurationMs`
on `path=nodeErrorPassthrough` events. If it turns out to matter, switching to D only changes how
the probe is created.

---

## 0018 — DNS preparation and the shell and playground init timeout have separate budgets

**Status:** Accepted · **Date:** 2026-10-09 · **Raised by:** design review R4, plan Q8; the operator
chose A, as recommended

### Decision

On the shell and playground path, `WorkerSessionManager` runs DNS preparation first: the probe
(D0017), then the fallback if needed, within the D0016 deadline. Only after that does it start the
full init timeout (`documentDB.connectionTimeout`, default 30 s). Preparation time is not
subtracted from it. The user documentation states that the connection timeout starts after DNS
resolution.

### Why

- Every connection gets the same budget for connect, TLS, auth and Entra ID token acquisition,
  whether or not it needed the fallback.
- This matches the driver: its own SRV lookup in `MongoClient._connect()` runs before server
  selection, so `serverSelectionTimeoutMS` never counts DNS either.
- On the Node.js path, the worker's driver still resolves SRV inside the init timer, as it does
  today, so that timer covers the same work as before.
- A shared budget cannot work with D0017's unbounded probe: a slow probe would leave almost nothing
  for init.

### Rejected alternatives

- **B, one budget** (init gets `connectionTimeout − preparation`): spurious timeouts after a slow
  probe or a slow fallback.
- **C, one budget with a floor:** still not a hard bound, and one more constant.

### Consequences

When the fallback is needed, connecting can take up to the D0016 deadline (≤ 20 s) longer than the
setting suggests, and a dead DNS server adds the probe's timeout (D0017). Both are visible as
`srvResolutionDurationMs` on `worker.startup`.

---

## 0019 — The UI shows whether the fallback was used: the tooltip now, the dashboard later

**Status:** Accepted · **Date:** 2026-10-09 · **Raised by:** operator requirement

### Decision

The extension keeps an in-memory flag recording whether a cluster's connection was resolved by the
fallback: an `SrvResolutionSummary` on `ClustersClient`, keyed by `clusterId`, with no hostnames and
never persisted. This increment shows it as one line in the cluster tooltip (plan WI-10). The
cluster dashboard shows it later (future-work FW-2).

### Why

Telemetry says how many users hit the fallback, but not whether *this* user's connection did. A
visible flag lets the user and support confirm it without collecting a trace. Showing it only in
the tooltip keeps the increment small.

### Consequences

- Without re-rendering, the row would never show the line, because the tooltip is built before the
  first connection. WI-10 includes re-rendering the row (or resolving the tooltip lazily on
  hover).
- In this increment the flag covers the tree's connection only. Shell and playground sessions
  resolve on their own and report only to trace and telemetry.

---

## 0020 — The VS Code-independent logic lives in a workspace package, published at the operator's discretion

**Status:** Accepted · **Date:** 2026-10-09 · **Raised by:** operator ("could this help another
MongoDB API extension?"); shaped in chat

### Decision

The URI rewrite, the fallback DNS client and the core resolve function (plan WI-2 to WI-4) go into
a new workspace package, `packages/documentdb-js-srv-resolver` (working name
`@documentdb-js/srv-resolver`). It has `mongodb` as a peer dependency and `dns-packet` as a
dependency. The extension consumes it locally through npm workspaces (`"*"`), the same way as the
other `@documentdb-js` packages. Telemetry, the output channel, environment switches, localized
text, the tooltip and the worker wiring stay in the extension. They connect through an injected
`logger`, an `onReport` callback and plain options. The package is created in this increment and
published later, whenever the operator decides.

### Why

- About 85 % of the code has no VS Code dependency: an estimated 700–1,000 lines of production
  code in 4–5 modules, plus 1,000–1,500 lines of tests. That is about the size of
  `@documentdb-js/shell-api-types` (about 750 lines).
- A package boundary is enforced by the compiler: the package cannot import `vscode`. A folder
  under `src/` would rely on discipline, and the code would have to move a second time.
- Another extension that uses the MongoDB API driver can reuse the fix without copying it.

### Publishing has no effect on the extension (checked 2026-10-09)

- The extension depends on `@documentdb-js/*` with `"*"`, and npm workspaces link the local folder
  (`node_modules/@documentdb-js/<name> → ../../packages/…`), whether or not a published version
  exists.
- The VSIX is built with `vsce package --no-dependencies` from webpack output, and `.vscodeignore`
  excludes `packages/**` and `node_modules/**`. The package's code ships inside the bundle, not as
  an npm dependency.
- Publishing runs through `.github/workflows/npm-publish-documentdb-js.yml` (manual trigger,
  reviewer approval gate, npm Trusted Publishing). A new package needs its own `publish_*` input and
  step there, and, as far as I know, its own Trusted Publisher setup on npmjs.com. Neither is part
  of this increment. (The Azure DevOps ESRP pipeline only publishes `@microsoft`-scoped packages.)

### Rejected alternatives

- **Keep the code in `src/documentdb/srv/` with no `vscode` imports, extract later.** Slightly less
  risk for the patch, but nothing enforces the boundary, and it means a second move.

### Consequences

- Once published, the package has its own semantic versioning and README. Its tests run against the
  installed `mongodb` driver, so a consumer on another driver version is protected only if those
  tests run in its CI.
- The name must be final before the first publish.
