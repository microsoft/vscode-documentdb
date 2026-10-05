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
Trace/debug records such as `initData` contain manifest descriptions and command
metadata; generic error words in those records are not errors. An error record
is not suppressed merely because its message quotes a trace/debug label.
DocumentDB output errors always fail. Host errors mentioning the target ID or its
installed path fail; unrelated/unattributed host errors are explicitly printed
and saved separately in `log-report.json`. Renderer/network/GPU errors outside
those logs are not asserted by this activation-only check.

There is no blanket shutdown or `Channel has been closed` exclusion. Captured
VS Code 1.105.0 logs show that message after `SchemaStore.dispose` logs to an
already disposed output channel, a product lifecycle failure rather than an
IPC-only test teardown artifact. Those errors remain blocking and require a
separate product fix/triage; the activation harness does not change product code.

`--inject-error` modifies **only the temporary installed entry point**, never the
input VSIX or product source. It intercepts the final command registration and
throws `L3_INJECTED_SWALLOWED_ACTIVATION_ERROR` **after registering that command**.
The real initialization telemetry wrapper catches/logs that failure while the API
still returns and late commands still exist. Thus the negative control exercises
the log gate rather than relying on an activation rejection or missing command.
It fails loudly if the marker was not observed. The injector supports CommonJS
and module entry points; it resolves manifest `main` using Node resolution
(including `./main` resolving to `main.js`) before checking the resolved real
path is inside the installed extension. External/symlink escapes and shebang
entries are rejected.

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
`xvfb-run` is deterministic. Local Linux/WSL displays may use an abstract X11
socket (`\0/tmp/.X11-unix/X<n>`); the runner accepts it even when the corresponding
filesystem socket is absent. It checks reachability, not just whether `DISPLAY`
is set. Only on Linux with `GITHUB_ACTIONS=true`, the test
Electron launch also uses `--no-sandbox`, following `@vscode/test-electron`'s
launch flag to avoid the downloaded SUID helper's ownership/mode restrictions.
This is scoped to the trusted activation probe and VSIX in ephemeral user data;
it does not change product packaging or system permissions. Normal local launches,
generic `CI=true`, and non-Linux platforms retain the sandbox. Both main and proof
use this same guarded launch. The harness never installs system packages. If the
local display is unavailable, run the offline tests and defer both real-host
controls to CI. Workers, native optional modules, the TS server plugin, webviews,
and real backend integrations remain outside L3.

## Activation timing comparison

```sh
npm run measure:activation -- path/to/production.vsix
npm run measure:activation -- path/to/production.vsix --runs 5 --json timing.json
# Offline tests include the timing parsers:
node --test build/verification/activation/*.test.cjs
```

The [timing entry point](./timing.cjs) defaults to five full L3 launches. Each
installs the same VSIX into fresh extensions/user-data directories and must pass
the existing activation, command, and log gates. Child processes set
`DEBUGTELEMETRY=verbose` (prints telemetry locally without sending it), and each
run keeps artifacts until its measurements have been parsed, then deletes them.
Failed L3 runs or parsing failures fail loudly and retain diagnostics.

`codeLoadMs` is the millisecond timestamp interval in the target's `exthost.log`
from `ExtensionService#_doActivateExtension` to
`ExtensionService#_callActivateOptional`, including module loading and context
creation. The intervening `loadModule` record must identify the installed target;
both `[cjs]` and `[esm]` are accepted. This is the load-time quantity shown by
**Developer: Show Running Extensions**.

`activateMs` and `mainFileLoadMs` come from `duration` and `mainFileLoad` in the
successful `vscode-documentdb/activate` telemetry event, converting seconds to
milliseconds. `activateMs` measures time inside the extension's activate telemetry
callback; `totalMs` is each run's `codeLoadMs + activateMs`, not the whole VS Code
launch. `mainFileLoadMs` is recorded but is not a reliable comparison metric yet:
the webpack host hoists the require before its performance timer, reporting zero.

The harness prints each run and medians (plus code-load min/max). Optional JSON
contains the VSIX path, pinned VS Code version, per-run measurements, and
median/min/max for every metric. GitHub runners and WSL timings are noisy and
include cache/scheduling effects; only before/after comparisons made on the same
machine with this same method are meaningful. Linux needs a reachable X11 display
(including an abstract socket); use an existing local display environment or
`xvfb-run` in CI.
