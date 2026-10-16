---
title: 'Troubleshoot SRV DNS Lookups'
parent: 'Connecting to Databases'
nav_order: 3
---

# Troubleshoot SRV DNS Lookups (`querySrv EBADRESP`)

A `mongodb+srv://` connection string does not name the servers directly. Before connecting, the extension looks up the servers in DNS (an SRV record, plus an optional TXT record with connection options). On some networks this lookup fails before any connection to the database is attempted, with an error such as:

```
querySrv EBADRESP _mongodb._tcp.<cluster>.global.mongocluster.cosmos.azure.com
```

This page explains why that happens, what the extension does about it, and what you can do when it still fails.

## Why it happens

VS Code's built-in Node.js runtime resolves SRV records with its own DNS client, not with your operating system's resolver. Recent versions of that client reject DNS replies that use _name compression_ inside an SRV record, even though such replies are valid. Many home routers, phone hotspots and some VPN or corporate DNS servers send exactly that kind of reply. Other tools on the same machine (`nslookup`, a browser) work fine, because they use a different resolver.

You may start seeing the error after a VS Code update, without changing anything on your side. Linux machines that use `systemd-resolved` (a local DNS stub at `127.0.0.53`) are usually not affected.

## What the extension does about it

When the built-in lookup fails with `EBADRESP`, `EFORMERR` or `ECONNREFUSED`, the extension resolves the SRV and TXT records itself and connects using the servers it found:

- It asks **the same DNS servers your system is configured with**, in the same order. It never uses a public DNS server and never uses DNS over HTTPS.
- It applies the same rules the database driver applies to SRV records (the servers must belong to the same domain as the host name, only the allowed TXT options are used, TLS stays on).
- The resolved server list exists **only in memory**, for that one connection. It is never saved. Your stored connection string, **Copy Connection String**, **Update Connection String…** and exports all keep the original `mongodb+srv://` string. Every new connection looks up DNS again, but a fallback connection does not periodically refresh the DNS server list while it remains open.
- It works the same way for the tree, the Collection View, the interactive shell and the query playground.

To see whether a connection was resolved this way, collect a trace (see [Collect a trace for support](#collect-a-trace-for-support)).

Nothing changes for connections where the built-in lookup works.

## How to confirm the problem

Run the SRV lookup with VS Code's own runtime. Replace `<host>` with the host name from your connection string (the part after `@`, without a port).

**Windows** (`cmd`):

```
set ELECTRON_RUN_AS_NODE=1
"%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe" -e "require('dns').resolveSrv('_mongodb._tcp.<host>',console.log)" 2>&1 | more
set ELECTRON_RUN_AS_NODE=
```

**macOS** (Terminal; in older VS Code versions the executable is `Contents/MacOS/Electron`):

```
ELECTRON_RUN_AS_NODE=1 "/Applications/Visual Studio Code.app/Contents/MacOS/Code" -e "require('dns').resolveSrv('_mongodb._tcp.<host>',console.log)"
```

**Linux**:

```
ELECTRON_RUN_AS_NODE=1 "$(dirname "$(readlink -f "$(which code)")")/../code" -e "require('dns').resolveSrv('_mongodb._tcp.<host>',console.log)"
```

If this prints `EBADRESP` while `nslookup -type=SRV _mongodb._tcp.<host>` succeeds, you are affected, and the extension's fallback should handle it.

## When the connection still fails

The fallback cannot help in every case:

- **The DNS server refuses the query, or the system reports the wrong DNS server.** Some VS Code versions on Windows report `127.0.0.1` as the DNS server. The fallback asks the same server and is refused as well.
- **The DNS server does not answer** (`ETIMEOUT`), or the name does not exist (`ENOTFOUND`). The fallback does not run for these errors; the original error is shown.
- **The fallback was turned off** with `DOCUMENTDB_DISABLE_SRV_FALLBACK` (see below).

In these cases you can:

1. **Use a non-SRV connection string.** Look up the servers with a resolver that works, for example `nslookup -type=SRV _mongodb._tcp.<host>`, and build a `mongodb://` string that lists every server with its port, keeps `tls=true`, and adds any options from the TXT record (`nslookup -type=TXT <host>`):

   ```
   mongodb://<user>:<password>@<server1>:<port1>,<server2>:<port2>/?tls=true&<options from the TXT record>
   ```

   **Caveat:** this list does not follow failover or server changes. If the connection stops working later, look the servers up again.

2. **Use a different DNS server** for your network connection. **Caveat:** this is a machine-wide change and can break name resolution for VPN or corporate networks.

## Connection timeout and DNS

The `documentDB.connectionTimeout` setting starts counting **after** the DNS lookup. When the fallback is needed, connecting can take up to 20 seconds longer than the setting suggests (the fallback stops after 20 seconds, or after the connection timeout if that is shorter). If your DNS server does not answer at all, the built-in lookup's own timeout applies before the connection attempt starts.

## Collect a trace for support

1. Open the **Output** panel and select **DocumentDB for VS Code**.
2. Set the log level to **Trace** (the gear icon in the Output panel, or **Developer: Set Log Level…**).
3. Connect again.
4. Copy the lines that start with `[SrvResolution]`.

These lines show the host name, the DNS servers asked, the SRV targets and ports, and which path resolved the connection. They never contain your connection string, user name or password.

## Environment variables

Two environment variables control the fallback. They are meant for support and troubleshooting; there is no setting for them in VS Code.

| Variable                                | Effect                                                                                                                           |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `DOCUMENTDB_DISABLE_SRV_FALLBACK=1`     | Turns the fallback off. The original error is reported exactly as before. Use this if you suspect the fallback causes a problem. |
| `DOCUMENTDB_DEBUG_FORCE_SRV_FALLBACK=1` | Always uses the fallback for `mongodb+srv://` connections, even when the built-in lookup works. For diagnosis only.              |

If both are set, `DOCUMENTDB_DISABLE_SRV_FALLBACK` wins.

The variable must be set in the environment of the **extension host**, which is the process where the extension runs. Close **all** VS Code windows before setting it, then start VS Code again.

- **Windows:** run `setx DOCUMENTDB_DISABLE_SRV_FALLBACK 1` in `cmd`, then start VS Code from the Start menu. To remove it later: `reg delete HKCU\Environment /v DOCUMENTDB_DISABLE_SRV_FALLBACK /f`.
- **macOS:** start VS Code from Terminal: `DOCUMENTDB_DISABLE_SRV_FALLBACK=1 code`. (VS Code started from the Dock or Finder does not see variables exported in your shell.)
- **Linux:** start VS Code from a terminal: `DOCUMENTDB_DISABLE_SRV_FALLBACK=1 code`.

With a remote window, the extension runs on the **remote** machine, and the variable must be set there:

- **WSL:** add `export DOCUMENTDB_DISABLE_SRV_FALLBACK=1` to `~/.vscode-server/server-env-setup` inside the WSL distribution, then run `wsl --shutdown` (or close all VS Code windows) and reconnect.
- **Remote-SSH:** add `export DOCUMENTDB_DISABLE_SRV_FALLBACK=1` to `~/.profile` (or `~/.bash_profile`) on the remote machine, then run **Remote-SSH: Kill VS Code Server on Host…** and reconnect.
- **Dev Containers:** add `"remoteEnv": { "DOCUMENTDB_DISABLE_SRV_FALLBACK": "1" }` to `devcontainer.json`, then run **Dev Containers: Rebuild Container**.

To check that the variable reached the extension, collect a trace (see above): with the variable set, a failing lookup logs `disabled by DOCUMENTDB_DISABLE_SRV_FALLBACK`, and with the force variable set, the start line shows `forced=true`.
