# Node.js / TypeScript CLI — Tech Research (what we already looked at)

> ⚠️ **Read this as an OVERVIEW done a while back (mid-2026).** It may be **inaccurate or out of date today** — treat every library name, download count, and API claim as *to be re-verified*, not as settled fact. Node's own tooling (especially the single-executable story) was moving fast when this was written.
>
> **Scope note:** this research focused on the **runtime + daemon + IPC** layer — i.e. *how the process talks to a background process*. It did **not** seriously cover **packaging/distribution** (single executables, installers, avoiding a Node dependency on the user's machine). That deployment question is exactly what I'm hoping you can dig into — see [`03-where-id-love-your-help.md`](./03-where-id-love-your-help.md).

## Summary of what we concluded (subject to re-check)

The daemon + IPC layer is **almost all Node built-ins**, plus two small dependencies. The pattern is well-trodden (Nx's daemon, LSP language servers, ssh-agent-style brokers).

| Concern | What we landed on | Notes |
|---|---|---|
| **Local IPC (cross-platform)** | built-in **`net`** | `net.createServer()` / `net.connect()` speak **Unix domain sockets** (macOS/Linux) *and* **Windows named pipes** through the *same* API — you just pick the `path` per-OS. This is the key cross-platform fact and needs no library. |
| **Detached daemon spawn** | built-in **`child_process.spawn`** `{ detached:true, windowsHide:true, stdio:'ignore' }` + `.unref()` | The canonical "spawn a background process that outlives the parent" recipe. Works on all three OSes (Windows uses a new process group; no `setsid`). |
| **Message framing / RPC** | **tRPC** (our preference) via a custom `net`-socket link | **We already use tRPC in our extension webviews, so we know it and like working with it — it's a nicer developer experience than `vscode-jsonrpc`.** The big win is end-to-end type safety: the CLI (thin client) infers the daemon's procedure signatures from the router type, so there's no hand-written interface duplication across the socket. tRPC ships HTTP/WebSocket transports, not raw-socket — but its transport is pluggable; **`electron-trpc`** is the blueprint (runs full tRPC over Electron IPC with no HTTP), and we'd write the equivalent thin link over a `net` socket. |
| **Message framing / RPC (fallback)** | `vscode-jsonrpc` | The battle-tested alternative if we ever want to avoid the small custom-link glue: Microsoft-maintained, powers all of LSP; ships `SocketMessageReader`/`SocketMessageWriter` over a `net.Socket`, content-length framing — but *untyped* `sendRequest(method, params)`. Other options: `json-rpc-2.0` (zero-dep, ~15 lines of socket glue), or newline-delimited JSON (what Nx does). |
| **Spawn-race guard** | **`proper-lockfile`** | Prevents two simultaneous CLI invocations both spawning a daemon. Atomic `mkdir` lock, works on NFS, stale-lock heartbeat. (Nx's lighter variant just lets "whoever binds the socket first wins" and the loser exits on `EADDRINUSE`.) |
| **Idle timeout / lifecycle** | inline `setTimeout`/`clearTimeout` + signal handling | No library needed; reset the timer on each request, self-exit on idle. |

**Total new runtime deps for the CLI:** **tRPC** (our preferred RPC layer — see above) **+** `proper-lockfile`. Everything else is Node standard library. (`vscode-jsonrpc` is the fallback if we'd rather not write the small custom tRPC-over-socket link.)

## The one real cross-platform gotcha we found

**Unix domain socket path length limits** (macOS/Linux only): ~**107 chars on Linux, 102 on macOS**. Keep the socket path short — put it in `os.tmpdir()`, not a deep nested path. Windows named pipes don't share this limit. Nx and `vscode-jsonrpc` both guard for it (Nx rejects paths > 95 chars).

```ts
// cross-platform socket path (illustrative)
import { platform, tmpdir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';

function getSocketPath(tool: string, key: string): string {
  const h = createHash('sha256').update(key).digest('hex').slice(0, 16);
  if (platform() === 'win32') return `\\\\.\\pipe\\${tool}\\${h}`;   // Windows named pipe
  return join(tmpdir(), `${tool}-${h}.sock`);                        // Unix socket (keep it short!)
}
```

## Reference implementations worth studying

- **Nx daemon** (`nrwl/nx`, `packages/nx/src/daemon/…`) — the closest real-world TypeScript blueprint: `net` + detached spawn + connect-or-spawn + idle timeout. There is **no** off-the-shelf "connect-to-daemon-or-spawn-it" library — everyone hand-rolls ~50 lines; Nx is the model.
- **Language Server Protocol (LSP)** — the "start a process once, send it many JSON-RPC requests over stdio/socket" pattern; `vscode-jsonrpc` is its RPC layer.
- **ssh-agent / Gradle daemon / Bazel server / PgBouncer** — the general "long-lived process holds the expensive thing; thin clients attach over a socket" family.

## What to AVOID (as of the research; re-verify)

- ❌ **`node-ipc`** — security baggage (2022 "protestware" file-wipe incident; a 2026 credential-compromise release). Use raw `net` + a framing layer instead.
- ❌ **`pm2` / `forever` / `daemonize2`** — built for always-on fleet services; overkill for an auto-spawned per-user helper.
- ❌ **`node-windows` / `node-mac` / `node-linux`** — OS-service wrappers; wrong use case, effectively dead.

## Sources (from the original research — re-verify freshness)

- Node `net` (Unix sockets + Windows named pipes, one API) — https://nodejs.org/api/net.html
- Node `child_process.spawn` (`detached`, `windowsHide`, `unref`) — https://nodejs.org/api/child_process.html
- `vscode-jsonrpc` — https://www.npmjs.com/package/vscode-jsonrpc ; https://github.com/microsoft/vscode-languageserver-node
- `proper-lockfile` — https://github.com/moxystudio/node-proper-lockfile
- tRPC — https://trpc.io ; custom-transport precedents: `electron-trpc` https://github.com/jsonnull/electron-trpc
- Nx daemon — https://github.com/nrwl/nx (`packages/nx/src/daemon/…`)
- `node-ipc` (⚠️ avoid) — https://github.com/RIAEvangelist/node-ipc

---

**Bottom line for the reader:** the *daemon/IPC engineering* is understood and low-risk. The open piece is everything *around* it — **how we package and ship this as a friction-free, cross-platform artifact** (ideally without making users install Node or use `npx`), built entirely on GitHub. Continue to [`03-where-id-love-your-help.md`](./03-where-id-love-your-help.md).
