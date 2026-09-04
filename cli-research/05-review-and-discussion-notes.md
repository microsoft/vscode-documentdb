# CLI research — review and discussion notes

**Date:** 2026-09-04 · **Status:** for review and discussion

This note summarizes follow-up discussions about the CLI research. It is intended as a shorter
companion to the evidence and recommendation in
[`04-packaging-and-release-design.md`](./04-packaging-and-release-design.md), especially
[§2](./04-packaging-and-release-design.md#2-what-the-spike-proved) and
[§3](./04-packaging-and-release-design.md#3-candidate-comparison).

## Analysed and discussed: SEA vs Bun

Both options produce a self-contained executable, so users do not need to install Node or Bun:

- **Node SEA** packages the application with the official Node.js runtime.
- **Bun compile** packages the application with the Bun runtime.

Bun is therefore not only a build tool. It is an alternative JavaScript/TypeScript runtime with
its own JavaScript engine, event loop, networking and TLS implementation, module loader, package
manager, and compiler.

The spike found both options technically viable. Each passed the packaged daemon and IPC checks
on Windows, macOS, and Linux across x64 and arm64. Bun currently provides the better packaging
developer experience: simpler builds, cross-compilation, smaller raw binaries, and an
experimental native secrets API. With SEA code caching enabled, however, Bun did not retain a
startup-speed advantage in the Linux x64 measurement. The detailed results are in
[§2.1 and §2.2](./04-packaging-and-release-design.md).

## Why a database driver can behave differently

The MongoDB API driver and `@mongosh` are primarily developed and tested on Node. Node uses V8,
libuv, OpenSSL, and its own `net`, `tls`, DNS, module-loading, and native-addon behavior. Bun aims
to provide Node compatibility, but reimplements these facilities on a different foundation.

Most application code can run identically while database-specific paths expose differences.
Long-lived connection pools, replica-set monitoring, TLS negotiation, DNS behavior, BSON module
loading, garbage collection, and native addons all depend on runtime details below the public
JavaScript API. This explains how a driver can work on Node while encountering a Bun-specific
memory, networking, or module-loading bug.

The Bun issues identified during the research were fixed quickly. The concern is therefore not
that Bun is generally unreliable; it is that compatibility with this particular driver stack is
an ongoing responsibility. Node SEA embeds the runtime against which the driver and `@mongosh`
are already tested. This is the "engine fidelity" advantage described in
[the primary recommendation](./04-packaging-and-release-design.md#why-sea-over-bun-as-primary).

## Expected direction of driver support

It is more likely that Bun becomes an additional supported runtime than that the driver ecosystem
"moves" from Node to Bun. That could happen through improved Node compatibility in Bun, explicit
Bun coverage in the driver's CI, or both.

Until the upstream driver and `@mongosh` test Bun directly, Bun compatibility should be treated
as demonstrated by our tests rather than guaranteed by their support contract. Keeping the Bun
build and acceptance suite alive as a CI canary gives us evidence over time and makes the packaging
decision reversible.

## Platform and build trade-offs

| Consideration | Node SEA | Bun compile |
|---|---|---|
| Runtime confidence for this driver stack | Official Node runtime; closest to upstream CI | Node-compatible runtime reimplementation |
| Build experience | esbuild plus SEA assembly on Node 24 | Integrated compile workflow |
| Cross-compilation | Limited; native builds preferred | First-class across most targets |
| Startup in the Linux x64 test | 66 ms with code cache | 139 ms |
| Raw artifact size in CI | 88–130 MB | 70–94 MB |
| Compressed size in the measured example | 29 MB xz | 28 MB xz |
| Native secrets API | None built in | `Bun.secrets`, currently experimental |
| Main maintenance risk | Experimental SEA tooling and platform edges | Runtime-compatibility tracking |

The compressed download sizes are nearly equal in the current measurements. Bun's meaningful
advantages are build simplicity, cross-compilation, and its secrets API rather than transfer
size or measured startup speed.

## SEA development status

SEA remains officially experimental in current Node documentation, but it is actively developed.
Node 25.5 introduced the first-party `--build-sea` command, replacing the more awkward external
`postject` injection flow. The expected path is to adopt that flow with Node 26 LTS and remove the
unmaintained `postject` dependency.

This gives SEA some short-term tooling churn, but the direction is toward a simpler first-party
build rather than abandonment. The remaining weaknesses and mitigations are recorded under
[SEA's honest weaknesses](./04-packaging-and-release-design.md#why-sea-over-bun-as-primary).

## macOS x64 outlook

The macOS concern applies specifically to Intel/x64, not Apple Silicon/arm64:

- macOS arm64 is supported and passed the spike.
- macOS x64 is not covered by Node's upstream SEA CI, but our x64 SEA artifact built and passed
  the packaged acceptance suite on GitHub's Intel runner.
- GitHub's last standard Intel runner image, `macos-15-intel`, is scheduled to retire in August
  2027.
- Intel Macs are a shrinking population, but enterprise deployments can remain in service for
  years after Apple's hardware transition.

The practical proposal is to ship macOS x64 while it can be executed in CI. Before the Intel
runner retires, we can validate a portable-blob build under Rosetta, retain the npm distribution
for Intel users, or retire the standalone x64 artifact if usage data supports that decision. The
target decision is tracked in
[§1.1](./04-packaging-and-release-design.md#11-decisions-i-need-from-you).

## Current position

Node SEA remains the conservative primary choice because failures in TLS, authentication,
connection management, or BSON behavior would cost more than additional build complexity. Bun
remains a credible runner-up and may become the better choice as its driver compatibility record
grows.

The recommendation should be revisited if the credential-store spike shows no acceptable SEA
path, if sandbox testing reveals a Bun-only advantage, if upstream driver CI adds Bun, or if the
ongoing Bun canary remains clean enough to reduce the runtime-substitution risk materially.

## Analysed and discussed: Entra ID and secret storage

The standalone CLI must replace two facilities currently supplied by VS Code: its authentication
session API for Entra access tokens and SecretStorage for durable secrets. Neither replacement
requires changing the Node SEA recommendation.

### Password authentication

Saving a database password should be explicit rather than automatic. Session-only login keeps the
password in daemon memory until the daemon exits; a `--save-password` option stores it in the
current user's OS credential vault so scripts and agents can use a named profile after a restart.
Ordinary profile storage contains only non-secret metadata such as the endpoint, username,
authentication method, and profile name. It must never contain a credential-bearing connection
string.

The intended native stores are Windows Credential Manager, macOS Keychain, and Secret Service /
libsecret on desktop Linux. A package such as `@napi-rs/keyring` can present one API over those
stores. Headless Linux may have no D-Bus session or unlocked keyring, so the CLI must fail clearly
rather than fall back silently to plaintext. Session-only credentials, workload identity,
environment-based injection, or an explicit enterprise credential helper remain alternatives.

### Entra ID authentication without VS Code

The CLI can replace VS Code token retrieval with `@azure/identity`. A human runs
`documentdb login <profile>` using browser or device-code authentication; Azure Identity's
persistent MSAL cache retains the renewable session securely. Application code asks a
`TokenCredential` for an access token and does not extract or manage refresh tokens itself.

The daemon supplies fresh access tokens to the MongoDB API driver through `MONGODB-OIDC` and its
`OIDC_CALLBACK`. Browser or device interaction belongs only in the explicit human-run login
command. Agent and daemon operations never prompt or open a browser; if silent renewal is not
possible, they return an instruction to run `documentdb login <profile>` again.

Other explicit credential sources can include Azure CLI, managed identity, and workload identity.
The selected source should be recorded in the profile rather than hidden behind an unexplained
default credential chain. The CLI also needs its own supported Entra public-client application
registration; it cannot assume continued use of VS Code's application identity.

### SEA packaging implications

Node SEA can run the complete authentication design: Azure Identity, browser and device-code
login, persistent token caching, driver OIDC callbacks, password authentication, and all three
desktop OS credential stores. Pure JavaScript dependencies can be bundled into the SEA.

Native `.node` modules used by keyring or token-cache packages cannot load directly from SEA's
embedded blob. They must be shipped beside the executable and loaded from an explicit trusted
path, or extracted securely from an embedded asset before loading. This may make the release a
self-contained platform archive rather than one physical file. On macOS, a stable Developer ID
signing identity is required so Keychain access remains stable across upgrades.

This is packaging work, not an authentication blocker. SEA remains a good primary choice because
it preserves the Node runtime expected by Azure Identity, the MongoDB API driver, and `@mongosh`.
The next authentication spike should prove password round-tripping through the OS vault and Entra
silent renewal after a process restart from the packaged SEA artifact. The wider packaging risks
and proposed credential-store spike are tracked in
[§8](./04-packaging-and-release-design.md#8-risks-open-items-and-the-next-two-spikes).

## Analysed and discussed: Node SEA history and momentum

### Origin and motivation

Before Node provided SEA, projects such as `pkg`, `nexe`, and boxednode packaged applications by
patching or compiling Node. The Node.js Single Executable initiative began publicly in 2022 with
the goal of advancing standalone Node application packaging across supported operating systems.
The durable product motivation is simple: distribute a Node application to a machine that does
not already have Node installed, while retaining the official Node runtime rather than substituting
another JavaScript engine.

The initial architecture deliberately made the smallest practical change to Node. Node generated
an application blob, an external tool injected that blob into a copy of the Node executable, and
Node detected and executed it at startup. This avoided the much heavier boxednode approach of
compiling Node from source for every application and target.

Primary background:

- [Node.js Single Executable initiative](https://github.com/nodejs/single-executable)
- [Initial implementation, nodejs/node#45038](https://github.com/nodejs/node/pull/45038)
- [Current Node SEA documentation](https://nodejs.org/api/single-executable-applications.html)

### Timeline

| Date | Milestone |
|---|---|
| August 2022 | The Node Single Executable initiative published its ecosystem review and production-CLI requirements. |
| February 2023 | Initial SEA support merged into Node core. |
| April 2023 | Experimental SEA support first shipped in Node 20.0.0. |
| August 2023 | Node 20.6.0 added startup snapshots and V8 code caching. |
| 2024–2025 | Asset APIs, argument handling, signing guidance, platform behavior, and tests continued to mature. |
| January 2026 | Node 25.5.0 added the first-party `node --build-sea <config>` workflow. |
| 2026 | `--build-sea` was backported to Node 24 and is present in Node 26. |

The built-in builder is an important usability milestone: the common path no longer requires the
application build to orchestrate binary injection itself. The older preparation-blob and
`postject` workflow still exists for verification and specialized use; `--build-sea` did not
remove that mechanism from Node entirely.

### Current momentum

SEA remains officially **Stability 1.1: Active development**. It should not yet be described as
finished or generally production-ready without qualification. However, current evidence points to
steady investment rather than abandonment or loss of focus:

- Node added the first-party `--build-sea` command and backported it to an LTS release line.
- SEA tests have received parallelization, isolation fixes, and platform hardening.
- Recent work covers ELF layout, missing-blob handling, snapshots, Windows behavior, and a virtual
  filesystem for embedded assets.
- Documentation remains current in Node 26, and Node has a dedicated single-executable team and
  maintainer guidance.

The work is focused infrastructure development rather than rapid feature expansion. Important
limitations remain: macOS x64 is unsupported upstream, native addons require adjacent files or
secure extraction, and some dynamic-import, ESM/code-cache, architecture, and binary-layout edge
cases are still being fixed. These constraints justify exact Node version pinning and executing
the packaged acceptance suite on every claimed target.

The overall assessment is that SEA is moving from an awkward experiment toward a practical
first-party Node deployment mechanism. Its pace looks measured and focused, not stalled. For this
CLI, that continues to support SEA as the primary candidate while keeping Bun tested as a
reversible alternative.

### Relevance to coding agents

No Node primary source reviewed here identifies AI or coding agents as a motivation for SEA. The
connection is therefore an inference, not part of Node's stated roadmap.

Agents nevertheless strengthen SEA's original distribution case: one downloadable executable is
easier to invoke in ephemeral or sandboxed environments, avoids requiring a compatible Node
installation, and gives generated workflows a deterministic runtime. Faster code generation may
increase demand for this kind of packaging, but it does not remove the specialist work in binary
formats, V8 snapshots, native loading, signing, and cross-platform validation. Agent adoption may
therefore increase demand for SEA faster than it increases the Node project's capacity to maintain
it.
