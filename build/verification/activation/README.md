# Installed-VSIX activation check (L3)

No compilation or new dependencies are required. The runner uses the existing
`@vscode/test-electron` download/CLI resolver and Node's built-in test runner.

```sh
# Parent package.json entry: "test:vsix": "node build/verification/activation/run.cjs"
# Parent proof entry: "prove:activation": "node build/verification/activation/prove.cjs"
npm run test:vsix -- path/to/production.vsix
npm run test:vsix -- path/to/production.vsix --keep-artifacts

# Direct invocation before the parent wires the script:
node build/verification/activation/run.cjs path/to/production.vsix

# Offline unit tests (no VS Code, display, or download):
node --test build/verification/activation/activation.test.cjs

# Linux CI (parent supplies xvfb-run and caches .vscode-test):
xvfb-run -a npm run test:vsix -- path/to/production.vsix

# Negative control: this MUST exit nonzero and show the marker in actual logs.
xvfb-run -a npm run test:vsix -- path/to/production.vsix --inject-error

# CI proof wrapper: exits zero only for the expected log-gate rejection.
xvfb-run -a npm run prove:activation -- path/to/production.vsix
```

Without a positional path, the artifact defaults to `<package.name>-<package.version>.vsix`
in the checkout. VS Code is pinned to the exact minimum of the root `engines.vscode`,
not `stable`, an existing newer download, or the probe manifest's engine.
Unsupported engine range syntax fails rather than guessing.

Each run installs the VSIX into a fresh temporary extensions directory, with fresh
user data and disabled updates/telemetry. Child processes set
`DONT_PROMPT_WSL_INSTALL=1` so the VS Code CLI does not prompt on WSL.
The sole development extension is
[the probe](./probe/package.json); the checkout is never passed as a development
extension. The probe resolves the target's real path, activates it, and checks the
last registrations in `activateClustersSupport`, including the non-contributed
`vscode-documentdb.command.internal.exportDocuments` command. It does not execute
commands that prompt for credentials or contact databases.

The Electron process has a two-minute timeout. After it exits, including on probe
failure, the runner reads all actual extension-host and DocumentDB output-channel
log files beneath temporary user data. Both kinds of logs must exist.
`callWithTelemetryAndErrorHandling`'s `[info] Error: ...` records fail the check,
not just `[error]` severity. Stack continuations are included for attribution.
DocumentDB output errors always fail. Host errors mentioning the target ID or its
installed path fail; unrelated/unattributed host errors are explicitly printed
and saved separately in `log-report.json`. Renderer/network/GPU errors outside
those logs are not asserted by this activation-only check.

`--inject-error` modifies **only the temporary installed entry point**, never the
input VSIX or product source. It intercepts the final command registration and
throws `L3_INJECTED_SWALLOWED_ACTIVATION_ERROR` **after registering that command**.
The real initialization telemetry wrapper catches/logs that failure while the API
still returns and late commands still exist. Thus the negative control exercises
the log gate rather than relying on an activation rejection or missing command.
It fails loudly if the marker was not observed. The injector supports CommonJS
and module entry points; it rejects shebang entries.

The [proof entry point](./prove.cjs) runs that negative control and accepts only
the expected log-gate failure: the installed-path/activation/late-command probe
must pass, both actual log types must exist, and every attributed error must
contain the injection marker. Missing displays, failed installation, missing
commands, or unrelated DocumentDB failures never count as proof. Run the normal
check separately on the clean production VSIX before this proof. No archive
reader/writer is needed: the VS Code CLI installs the input VSIX, and only its
temporary installed entry is mutated.

Failed runs retain installation, probe receipt, process logs, actual VS Code logs,
and the log report, and print their temporary path. Successful runs clean up unless
`--keep-artifacts` is given. Offline tests prove the interception/log-gate behavior
with a simulated host; they are not a substitute for running both controls against
the production VSIX in a real extension host.

Linux requires a reachable X11 server (`DISPLAY`); Electron is forced to X11 so
`xvfb-run` is deterministic. Only on Linux with `GITHUB_ACTIONS=true`, the test
Electron launch also uses `--no-sandbox`, following `@vscode/test-electron`'s
launch flag to avoid the downloaded SUID helper's ownership/mode restrictions.
This is scoped to the trusted activation probe and VSIX in ephemeral user data;
it does not change product packaging or system permissions. Normal local launches,
generic `CI=true`, and non-Linux platforms retain the sandbox. Both main and proof
use this same guarded launch. The harness never installs system packages. If the
local display is unavailable, run the offline tests and defer both real-host
controls to CI. Workers, native optional modules, the TS server plugin, webviews,
and real backend integrations remain outside L3.
