# @documentdb-js/srv-resolver

In-memory SRV DNS fallback for `mongodb+srv://` connection strings, for Node.js applications that connect with the `mongodb` driver to DocumentDB or any other MongoDB API-compatible service.

When Node.js's own DNS resolver rejects a valid SRV reply, this package resolves the SRV and TXT records itself, from the same DNS servers, and hands the driver an equivalent `mongodb://host1:port1,host2:port2/…` string. The resolved string exists only in memory, for that one connection.

## Why this exists

A `mongodb+srv://` connection string does not list the servers. Before connecting, the driver looks up an SRV record (`_mongodb._tcp.<host>`) and an optional TXT record with connection options, using `dns.promises` from Node.js. Node.js does not use the operating system's resolver for these lookups. It uses its bundled **c-ares** library.

Since c-ares **1.34.7** ([c-ares/c-ares#1190](https://github.com/c-ares/c-ares/pull/1190)), the reply parser rejects DNS **name compression inside SRV record data**. RFC 2782 says senders should not compress the SRV target, but [RFC 3597 section 4](https://www.rfc-editor.org/rfc/rfc3597#section-4) says receivers should decompress it for compatibility with existing servers. Many home routers, phone hotspots, some VPN and corporate DNS servers, and Samba AD domain controllers do compress the target. A cloud host name like `fc-abc-000.<cluster>.global.mongocluster.cosmos.azure.com` shares a long suffix with the queried name, so a compressing server almost always replaces that suffix with a pointer. c-ares treats the otherwise usable reply as malformed, and the lookup fails before any connection is attempted:

```
Error: querySrv EBADRESP _mongodb._tcp.<cluster>.global.mongocluster.cosmos.azure.com
```

Other tools on the same machine (`nslookup`, browsers) keep working, because they use a different resolver. Node.js 24.19+ bundles c-ares 1.34.8, and so does VS Code (through Electron), so users can start seeing the error after an automatic update, with no change on their side. The upstream fix ([c-ares/c-ares#1290](https://github.com/c-ares/c-ares/pull/1290)) was closed without being merged, and any fix would still have to ship through c-ares, Node.js and Electron. The replay in [nodejs/node#66173](https://github.com/nodejs/node/issues/66173) shows the problem.

The replay produces different results for the same DNS bytes depending only on the bundled c-ares version:

| Runtime                                     | c-ares | Compressed SRV target | Uncompressed SRV target |
| ------------------------------------------- | ------ | --------------------- | ----------------------- |
| Node.js 22.21.1                             | 1.34.5 | succeeds              | succeeds                |
| VS Code 1.139.x (Node.js 24.20.0)           | 1.34.8 | `EBADRESP`            | succeeds                |
| VS Code 1.140.0 / 1.141.0 (Node.js 24.21.0) | 1.34.8 | `EBADRESP`            | succeeds                |

This also explains why switching to a public resolver can appear to fix the problem: resolvers such as `1.1.1.1` and `8.8.8.8` return the SRV target in full. That is not a suitable library workaround because it breaks private endpoints and split DNS, and sends host names to a third party. Retrying Node.js, disabling EDNS or forcing TCP does not help either; the failure is in the reply parser, not the query or transport.

### Platform exposure

Exposure depends on the DNS path of the process running Node.js, not on the application UI or the location of the database:

| Platform                       | DNS path seen by c-ares                                                                      | Exposure        |
| ------------------------------ | -------------------------------------------------------------------------------------------- | --------------- |
| Windows                        | Adapter DNS servers, often a home router                                                     | Exposed         |
| macOS                          | System-configured resolvers, often the router from DHCP; c-ares does not use `mDNSResponder` | Exposed         |
| Linux with `systemd-resolved`  | The local `127.0.0.53` stub, which normally parses and re-serializes the upstream reply      | Mostly shielded |
| Linux without a local DNS stub | The router or upstream DNS server directly, common in containers and minimal servers         | Exposed         |

For remote development, the relevant platform is where the Node.js process runs. A process in WSL, a development container or a remote host uses that environment's DNS path, even when its UI is displayed on another machine.

## What it does

`resolveSrvForDriver()` runs right before you create a `MongoClient`:

1. **Not `mongodb+srv://`:** returns the input unchanged.
2. **Probe with Node.js.** It resolves the SRV record with `dns.promises` (default timeouts, as the driver does).
   - **Success:** returns the **original** `+srv` string. Nothing changes for unaffected users, and the driver keeps its own SRV polling.
   - **`EBADRESP`, `EFORMERR` or `ECONNREFUSED`:** runs the fallback.
   - **Any other error** (`ENOTFOUND`, `ETIMEOUT`, …): returns the original string, so the driver reports its own error exactly as before.
3. **Fallback.**
   - It queries SRV and TXT with [`dns-packet`](https://github.com/mafintosh/dns-packet): UDP first, then TCP if the reply is truncated.
   - It asks only the servers from `dns.getServers()`, in order. No public resolvers, no DNS over HTTPS.
   - It applies the driver's SRV rules: the parent-domain check, the TXT option allowlist (`authSource`, `replicaSet`, `loadBalanced`), the `$external` rule for `authSource`, `srvServiceName`, `srvMaxHosts` (the first N targets), and an implicit `tls=true`.
   - It returns a `mongodb://` string plus a copy of your options without the SRV-only options. Credentials are copied byte for byte; other query parameters keep their meaning (the tests check this with the driver's own parser). Conflicting options are rejected by the driver when it parses the result.
4. **If the fallback fails**, it rethrows the **original Node.js error object**, so your error handling sees exactly what it saw before. A rewrite rejection (for example a target outside the parent domain) is thrown as an `SrvRewriteError`.

Nothing is cached: every call looks up DNS again, so failover keeps working.

## Usage

```ts
import { MongoClient, type MongoClientOptions } from 'mongodb';
import { resolveSrvForDriver } from '@documentdb-js/srv-resolver';

async function connect(storedConnectionString: string, signal?: AbortSignal): Promise<MongoClient> {
    const options: MongoClientOptions = { appName: 'my-app' };

    const prepared = await resolveSrvForDriver({
        connectionString: storedConnectionString, // may contain credentials; never logged
        options,
        signal, // optional: aborting cancels pending DNS queries
        deadlineMs: 20_000, // fallback budget for SRV + TXT + TCP retries (20 s at most)
        logger: { trace: (line) => myLogger.trace(line) }, // optional; no credentials in these lines
        logPrefix: `[SrvResolution] ${connectionId}`,
        onReport: (report) => {
            // Called once per mongodb+srv:// connection, on success and on failure.
            // report.srvHost and report.dnsServers are for local use only; keep them out of telemetry.
            myTelemetry.track('srvResolution', {
                path: report.path, // 'node' | 'fallback' | 'nodeErrorPassthrough'
                nodeErrorCode: report.nodeErrorCode,
                fallbackOutcome: report.fallbackOutcome,
                aresVersion: report.aresVersion,
            });
        },
    });

    // prepared.connectionString is the original string, or the resolved mongodb:// string.
    // Hand it to the driver only. Keep storing and showing storedConnectionString.
    const client = new MongoClient(prepared.connectionString, prepared.options);
    await client.connect();
    return client;
}
```

`myLogger`, `myTelemetry` and `connectionId` stand for your own code.

### Options

| Option             | Default             | Purpose                                                                                                                                                                        |
| ------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `connectionString` | required            | The connection string as the driver would get it, including credentials if any.                                                                                                |
| `options`          | `{}`                | The `MongoClientOptions` you would pass to the driver. Never mutated.                                                                                                          |
| `fallback`         | `'auto'`            | `'auto'` runs the fallback only after an eligible Node.js error. `'off'` never runs it (support escape hatch). `'force'` always runs it (diagnosis).                           |
| `deadlineMs`       | `20000`             | One shared budget for the whole fallback, capped at 20 s. The Node.js probe is not limited. Each UDP attempt waits up to 5 s, each TCP attempt up to 10 s, within this budget. |
| `signal`           | none                | Rejects with `signal.reason` if it is an `Error`, otherwise with `SrvResolutionCancelledError`. Pending sockets and the probe are cancelled.                                   |
| `logger`           | no-op               | `{ trace(line: string): void }`. Lines include host names, SRV targets, ports and DNS server addresses, never connection strings, user names or passwords.                     |
| `logPrefix`        | `'[SrvResolution]'` | Prefix for every trace line, for example with a connection ID.                                                                                                                 |
| `onReport`         | none                | Receives a `SrvResolutionReport`: path, error codes, outcome, durations, transport, TXT source, counts and runtime versions.                                                   |

The package never reads environment variables. If you want switches like the extension's `DOCUMENTDB_DISABLE_SRV_FALLBACK=1`, map them to `fallback` yourself.

### Lower-level building blocks

These are exported too, for callers that need only one step:

- `rewriteSrvUri()`: pure rewrite of a `+srv` string plus SRV and TXT records into a `mongodb://` string.
- `resolveSrvFallback()` and `resolveTxtFallback()`: the `dns-packet` client (UDP, then TCP on truncation, one absolute deadline).

## Guarantees and limits

- **Transient only.** Never store the returned `connectionString`. Store and display the original `+srv` string.
- **No SRV polling on the fallback path.** A client created from the rewritten string does not follow SRV changes (failover, scaling) until it is recreated.
- **Same DNS servers.** If `dns.getServers()` itself returns the wrong servers (for example the `127.0.0.1` bug in c-ares 1.34.6 on Windows, [nodejs/node#62326](https://github.com/nodejs/node/issues/62326)), the fallback asks the wrong servers too.
- **Driver parity is tested, not assumed.** The tests compare the rewrite with the installed driver's own SRV resolution. They run against `mongodb` 7.2.0; rerun them when you upgrade the driver.
- **One dependency:** `dns-packet` (pure JavaScript, MIT). No dependency on the `mongodb` driver: options are typed structurally, and your own options type is returned unchanged.
- **ESM only.** CommonJS code can still `require()` it on Node.js 20.19+ / 22.12+ (`require(esm)`); the package declares Node.js 22.18 or later.

## Development

```bash
npm run build    # tsc -p .
npm test         # Vitest, through the repository's root config
```
