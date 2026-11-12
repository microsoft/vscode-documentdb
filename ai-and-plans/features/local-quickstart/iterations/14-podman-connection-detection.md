---
feature: local-quickstart
kind: plan
status: implemented
prs: [1076]
created: 2026-11-12
code:
  - src/services/localQuickStart/dockerReadinessClassification.ts
  - src/services/localQuickStart/DockerReadinessService.ts
  - src/services/localQuickStart/dockerRecoveryCommands.ts
  - src/webviews/documentdb/localQuickStart/dockerReadinessPresentation.ts
  - src/webviews/documentdb/localQuickStart/LocalQuickStart.tsx
---

# 14 — Diagnose Podman from the address in its error

> **Implemented, 2026-11-12, on #1076.** Decision:
> [0012](../decisions.md#0012--podman-guidance-follows-the-address-in-its-error). A first
> implementation that re-derived Podman's active connection was replaced by this simpler one at the
> operator's request; see 0012, "Rejected alternative".

Setup must stop guessing Podman's target from the extension host's platform. It improves guidance
only: no new start button, and nothing runs a Windows executable from WSL.

## 1. Problems

The readiness check never asks Podman which connection it is using. A stopped machine, a stopped
Windows machine reached from WSL, and an unreachable remote host all produce the same error. So
the check reads all three as "engine not running" and picks its guidance from the extension
host's platform alone.

| #   | Where                                                            | What happens now                                                                                                                                                                                                                                                                                      | Severity                            |
| --- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| A   | macOS / Windows, active connection is remote or `CONTAINER_HOST` | Machine discovery still runs. With **one** local machine (the usual setup), the sole-machine rule offers **Start Podman machine**. The click boots a VM that cannot help, and the wait runs until it times out. With two machines it shows "several machines" (seen in the macOS test, iteration 13). | Medium: wrong diagnosis and action  |
| B   | WSL, Podman client uses the Windows machine's socket             | Guidance says "Start the Podman user socket" and offers `systemctl --user start podman.socket`. That unit does not exist in the distribution, and the fix is to start the Windows machine. This regressed in `165bc3d1` (P5); the base branch said "Run `podman machine start`…".                     | Medium: wrong guidance (regression) |
| C   | Any Podman CLI check                                             | `endpointKind` and the endpoint probe come from Docker's default socket (`/var/run/docker.sock`, or `docker_engine` on Windows), because Podman checks resolve the endpoint from an empty environment. Details then shows "Endpoint: Unix socket" for an `ssh://` machine connection.                 | Low: wrong detail                   |
| D   | Linux / WSL, generic Podman text                                 | `podmanNotRunning` says "Start its machine in Podman Desktop…", but Linux and WSL have no Podman machine.                                                                                                                                                                                             | Low: wrong wording                  |

Out of scope, recorded for a follow-up issue: if a **remote** Podman (or Docker) host is
_reachable_, setup creates DocumentDB Local on that host, while the connection it saves points at
`localhost:10260` on the extension host. That came with the Podman fallback in #1065 and needs its
own decision. This plan does not change the ready path.

## 2. Evidence (verified 2026-11-12, WSL2 Ubuntu 20.04, Podman 6.1.4)

The operator's own setup: the WSL client is `podman-remote-static`, and Podman 6.1.4 runs on
Windows with a WSL machine, `podman-machine-default`, which is stopped.

- `podman system connection list --format json` inside WSL:
  `[{"Name":"windows-podman-user","URI":"unix:///mnt/wsl/podman-sockets/podman-machine-default/podman-user.sock","Default":true,"ReadWrite":true}]`.
  There is no `IsMachine` field on a connection added by hand.
- `podman.exe system connection list --format json` on Windows lists `podman-machine-default` and
  `podman-machine-default-root`, both with `"IsMachine": true` and URIs
  `ssh://user@127.0.0.1:63483/…` and `ssh://root@127.0.0.1:63483/…`. **An `ssh://127.0.0.1` URI is a
  local machine, not evidence of a remote host.**
- `podman info` while the machine is stopped prints "Cannot connect to Podman…" and
  `Error: unable to connect to Podman socket: … dial unix /mnt/wsl/podman-sockets/podman-machine-default/podman-user.sock: connect: no such file or directory`.
- An unreachable `CONTAINER_HOST=ssh://…` or `tcp://…` prints the same first line. The `Error:`
  line names `dial tcp <host>:<port>`.
- `CONTAINER_HOST` does **not** appear in `system connection list`.
- When both are set, **`CONTAINER_CONNECTION` beats `CONTAINER_HOST`**. With both set, the dial
  went to the named connection's socket.
- `CONTAINER_CONNECTION=<unknown>` fails with `connection "<unknown>" not found`.
- Podman ignores `DOCKER_HOST`: with only `DOCKER_HOST=tcp://127.0.0.1:1` set, it still dialled the
  default connection.
- `systemctl --user list-unit-files podman.socket` lists 0 unit files in this distribution.
- Native (non-remote) Linux Podman runs without a service, so a "Cannot connect to Podman" failure
  means the CLI is in remote mode: a remote build, `--remote`, a connection, or `CONTAINER_HOST`.

## 3. Design

A failed `podman info` already names the address it tried. When a Podman check fails as
`daemonUnavailable`, `classifyPodmanTarget` reads that address (`parsePodmanDialTarget`); for the
Docker CLI shim it uses the Unix socket the Docker endpoint already resolved.

| Address                                                | Target                  | Result                                                                    |
| ------------------------------------------------------ | ----------------------- | ------------------------------------------------------------------------- |
| WSL: `unix /mnt/wsl/podman-sockets/<name>/…`           | `windowsMachineFromWsl` | Copy-only `podman machine start <name>`, "Run in a Windows terminal" (B)  |
| `tcp` or DNS lookup of a host other than this one      | `remote`                | `endpointUnreachable`; no machine lookup, button or command (A)           |
| `tcp 127.0.0.1:<port>` (a machine's SSH port)          | `local`                 | Unchanged macOS/Windows machine logic (0010, 0011)                        |
| Linux / WSL: `unix /run/user/<uid>/podman/podman.sock` | `userSocket`            | Copy-only `systemctl --user start podman.socket`                          |
| Anything else                                          | `local` / `unknown`     | Linux / WSL: "check `podman system connection list`", no machine text (D) |

Failed Podman CLI checks report no endpoint (C). Telemetry records only `podmanTargetKind`; the
machine name is never sent. The webview sends the machine name back with the copy request, and the
host validates it before building the command.
